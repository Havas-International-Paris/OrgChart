import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../hooks/useChat';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import { useUiPreferencesStore } from '../../stores/uiPreferencesStore';
import { ChatMarkdown } from './ChatMarkdown';

interface ChatPanelProps {
  orgChartId: string;
  accessToken: string | undefined;
  onClose: () => void;
  // Backlog item 48 — forwarded straight to useChat; see that hook for why
  // this component has no opinion on which tool names are writes.
  onWriteToolResult?: (name: string, args: Record<string, unknown>, output: unknown) => void;
}

// Web Speech API locale tags, keyed by the app's own two-letter language
// codes (src/i18n/config.ts) — the two don't share a format.
const SPEECH_LANG: Record<string, string> = { en: 'en-US', fr: 'fr-FR' };

// providerRegistry.ts's labels carry provider/pricing detail meant for
// developer-facing contexts (e.g. "GLM-5.2 (Zhipu, via NVIDIA NIM, free)") —
// too much for the model picker's default display, per design-critique
// feedback. Keeps just the name before the first "(", the full label stays
// available via the option/select's title attribute for anyone who hovers.
function shortProviderName(label: string): string {
  return label.split('(')[0].trim();
}

// Plain outline mic — dictation only, matches the ChatGPT/Claude convention
// the user pointed at: fills the input for review, doesn't speak.
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
    </svg>
  );
}

// Soundwave-in-a-filled-circle — the second, distinct control for full voice
// mode (speak the question, hear the answer), same visual language as the
// reference screenshot's black circular button.
function VoiceModeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="9" x2="4" y2="15" />
      <line x1="9" y1="5" x2="9" y2="19" />
      <line x1="14" y1="2" x2="14" y2="22" />
      <line x1="19" y1="7" x2="19" y2="17" />
    </svg>
  );
}

// Resizable side panel, opened/closed by ChatToggleButton.tsx — rendered as a
// third section in AppShell.tsx's flex row, after its own divider, mirroring
// the existing grid/chart split rather than a floating window or modal.
export function ChatPanel({ orgChartId, accessToken, onClose, onWriteToolResult }: ChatPanelProps) {
  const { t, i18n } = useTranslation();
  const chatProviderId = useUiPreferencesStore((s) => s.chatProviderId);
  const setChatProviderId = useUiPreferencesStore((s) => s.setChatProviderId);
  const { messages, sendMessage, sending, statusLabel, error, providers, activeProviderId } = useChat(
    orgChartId,
    accessToken,
    chatProviderId,
    onWriteToolResult,
  );
  // The dropdown's effective selection: the user's own explicit pick if
  // they've made one, else whichever provider the server would use by
  // default (activeProviderId, from the GET /api/chat the hook just fetched).
  const selectedProviderId = chatProviderId ?? activeProviderId;
  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const speechLang = SPEECH_LANG[i18n.language] ?? SPEECH_LANG.en;
  const { recognitionSupported, synthesisSupported, listening, listen, stopListening, speak, cancelSpeech } =
    useVoiceChat(speechLang);
  const wasSendingRef = useRef(sending);
  // Two distinct entry points share the same underlying recognition session
  // (only one can run at a time regardless), so this just tracks which
  // button started it — purely for which button shows the "listening" pulse.
  const [activeMic, setActiveMic] = useState<'dictate' | 'voice' | null>(null);
  // Whether to read the *answer* back is decided per-question, by how that
  // question was asked — dictation always yields a text-only reply (even
  // though it used the mic), only voice-mode's auto-sent question does.
  const lastInputWasVoiceRef = useRef(false);

  useEffect(() => {
    if (!listening) setActiveMic(null);
  }, [listening]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, statusLabel]);

  useEffect(() => {
    if (wasSendingRef.current && !sending && lastInputWasVoiceRef.current && !error && synthesisSupported) {
      const last = messages[messages.length - 1];
      if (last?.role === 'model' && last.text) speak(last.text);
    }
    wasSendingRef.current = sending;
  }, [sending, error, messages, synthesisSupported, speak]);

  // Cut off before the panel closes — otherwise speech kicked off from an
  // answer would keep going in the background after the panel is gone.
  function handleClose() {
    cancelSpeech();
    onClose();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    cancelSpeech();
    lastInputWasVoiceRef.current = false;
    void sendMessage(draft);
    setDraft('');
  }

  // Dictate: fills the input for the user to review/edit, same as typing —
  // it never auto-sends and never triggers a spoken reply.
  function handleDictateClick() {
    if (listening) {
      stopListening();
      return;
    }
    cancelSpeech();
    setActiveMic('dictate');
    listen((text) => setDraft(text));
  }

  // Voice mode: hands-free — auto-sends the transcribed question and speaks
  // the reply back once it arrives.
  function handleVoiceModeClick() {
    if (listening) {
      stopListening();
      return;
    }
    cancelSpeech();
    setActiveMic('voice');
    listen((text) => {
      lastInputWasVoiceRef.current = true;
      void sendMessage(text);
    });
  }

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{t('chat.title')}</h2>
        <button
          onClick={handleClose}
          title={t('chat.close')}
          className="rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">{t('chat.emptyState')}</p>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((message, i) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={i}
                className={`max-w-[90%] rounded-lg px-3 py-2 ${
                  isUser ? 'ml-auto bg-slate-900 text-white' : 'mr-auto bg-slate-100 text-slate-800'
                }`}
              >
                {message.text ? (
                  <ChatMarkdown text={message.text} inverted={isUser} />
                ) : sending && i === messages.length - 1 ? (
                  <span className="text-sm">…</span>
                ) : null}
              </div>
            );
          })}
        </div>
        {statusLabel && <p className="mt-2 text-xs italic text-slate-400">{statusLabel}</p>}
        {error && <p className="mt-2 text-xs text-red-600">{t('chat.error', { message: error })}</p>}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? t('chat.listening') : t('chat.placeholder')}
          disabled={sending || listening}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
        />
        {recognitionSupported && (
          <button
            type="button"
            onClick={handleDictateClick}
            disabled={sending}
            title={activeMic === 'dictate' ? t('chat.listening') : t('chat.dictate')}
            className={`flex items-center justify-center rounded border px-2 py-1.5 ${
              activeMic === 'dictate'
                ? 'animate-pulse border-red-300 bg-red-50 text-red-600'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <MicIcon />
          </button>
        )}
        {recognitionSupported && synthesisSupported && (
          <button
            type="button"
            onClick={handleVoiceModeClick}
            disabled={sending}
            title={activeMic === 'voice' ? t('chat.listening') : t('chat.voiceMode')}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              activeMic === 'voice' ? 'animate-pulse bg-red-600' : 'bg-slate-900 hover:bg-slate-700'
            } text-white disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <VoiceModeIcon />
          </button>
        )}
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
        >
          {t('chat.send')}
        </button>
      </form>
      {providers.length > 0 && (
        <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1 text-xs text-slate-400">
          <span>{t('chat.modelLabel')}</span>
          {/* Design-critique finding: showing the raw model id (e.g.
              "z-ai/glm-5.2") and provider plumbing detail ("via NVIDIA NIM")
              inline is more than a non-technical user needs to see by
              default. Visible text is now just the provider's short name;
              the full label + exact model id still live in the title
              attribute for anyone who hovers wanting the technical detail. */}
          <select
            value={selectedProviderId ?? ''}
            onChange={(e) => setChatProviderId(e.target.value)}
            title={selectedProvider ? `${selectedProvider.label} — ${selectedProvider.model}` : undefined}
            className="min-w-0 flex-1 truncate bg-transparent text-xs text-slate-500 outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available} title={`${p.label} — ${p.model}`}>
                {shortProviderName(p.label)}
                {!p.available ? ` (${t('chat.providerUnavailable')})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
