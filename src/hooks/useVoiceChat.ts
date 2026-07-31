import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API has no types in lib.dom (still non-standard across
// browsers), so these are hand-written minimal shapes for exactly what this
// hook touches — not an attempt at a full ambient declaration.
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultList;
}
interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// The voice list loads asynchronously in some browsers (empty on the first
// call, populated once 'voiceschanged' fires) — this waits for it instead of
// silently working from an empty list on a cold page load.
function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const handle = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handle);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handle);
    // Some browsers never fire the event at all — don't hang forever.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500);
  });
}

// speechSynthesis defaults to whichever voice the OS/browser considers
// "default" for the language, which is often its lowest-quality offline
// voice. Prefer, in order: a voice explicitly named as higher quality (macOS
// Safari/Chrome expose "Enhanced"/"Premium" system voices once downloaded in
// System Settings; some platforms use "Neural"), then any non-`localService`
// voice (network-backed, e.g. Chrome's "Google français" — these are
// consistently better than the bundled offline voice), then whatever's left
// that matches the language. This can only pick from voices the OS/browser
// already has — it cannot conjure a better voice that isn't installed.
function pickBestVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const langPrefix = lang.split('-')[0];
  const candidates = voices.filter((v) => v.lang === lang || v.lang.startsWith(langPrefix));
  if (candidates.length === 0) return null;
  const rank = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase();
    if (/enhanced|premium|neural/.test(name)) return 2;
    if (!v.localService) return 1;
    return 0;
  };
  return [...candidates].sort((a, b) => rank(b) - rank(a))[0];
}

// Strips the Markdown syntax the chat now renders (ChatMarkdown.tsx) down to
// plain prose before speaking it — otherwise the browser reads out literal
// asterisks, pipes and heading hashes, which is worse than the formatting
// problem it's meant to fix. A heuristic, not a real parser: good enough for
// what an LLM answer actually contains (bold, lists, tables, the odd link).
function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\|.*\|$/gm, (row) => row.replace(/\|/g, ' ').trim())
    .replace(/^[-:\s]+$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Speech-to-text for the question, text-to-speech for the answer — the two
// halves of "chat vocal" the user asked for, kept in one hook since both are
// keyed off the same BCP-47 language tag (from the app's current UI
// language) and share the same "is this even available" feature-detection
// story. Real microphone capture can't be driven by this session's browser
// automation (no physical mic), so this hook's own correctness — actually
// hearing a transcript come back, actually hearing speech play — needs a
// manual check in a real browser; only wiring/feature-detection is verified
// here.
export function useVoiceChat(lang: string) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const [recognitionSupported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [synthesisSupported] = useState(() => hasSpeechSynthesis());

  const listen = useCallback(
    (onFinalResult: (text: string) => void) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const text = event.results[0]?.[0]?.transcript ?? '';
        if (text.trim()) onFinalResult(text.trim());
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      recognitionRef.current = recognition;
      setListening(true);
      recognition.start();
    },
    [lang],
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Exposed separately from speak()'s own internal cancel-then-speak so the
  // caller can interrupt a reply that's still being read — asking a new
  // question (by voice or by typing) or leaving the chat should cut off
  // speech immediately rather than letting it finish underneath the next
  // interaction.
  const cancelSpeech = useCallback(() => {
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const clean = stripMarkdownForSpeech(text);
      if (!hasSpeechSynthesis() || !clean) return;
      // Cancel first: a fast-arriving second answer (or the user re-asking
      // before the first finished) would otherwise queue utterances back to
      // back instead of the latest one replacing the former.
      window.speechSynthesis.cancel();
      const voices = await getVoicesAsync();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = lang;
      const best = pickBestVoice(voices, lang);
      if (best) utterance.voice = best;
      window.speechSynthesis.speak(utterance);
    },
    [lang],
  );

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    },
    [],
  );

  return { recognitionSupported, synthesisSupported, listening, listen, stopListening, speak, cancelSpeech };
}
