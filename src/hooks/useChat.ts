import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiPreferencesStore } from '../stores/uiPreferencesStore';

export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  output: unknown;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  // Carried forward into the *next* request's history so the model can see
  // its own past tool calls and results, not just their final text summary —
  // needed for anything that depends on exact prior tool output (e.g. "undo
  // that deletion"). See api/_lib/llm/types.ts's IncomingToolCall for the
  // other half of this.
  toolCalls?: ChatToolCall[];
}

interface SseEvent {
  event: string;
  data: unknown;
}

export interface ChatProviderOption {
  id: string;
  label: string;
  model: string;
  available: boolean;
}

// Manual SSE parsing rather than EventSource: EventSource can't send a POST
// body or an Authorization header, both of which /api/chat requires (the
// conversation + orgChartId as the body, the user's Supabase session as the
// header — see api/_lib/chatHandler.ts).
async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      let event = 'message';
      let data = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice('event: '.length);
        else if (line.startsWith('data: ')) data = line.slice('data: '.length);
      }
      if (data) {
        try {
          yield { event, data: JSON.parse(data) };
        } catch {
          // Ignore a malformed chunk rather than aborting the whole stream.
        }
      }
    }
  }
}

// Ephemeral by design (v1 scope, see docs/chat-ia-cahier-des-charges.md §3):
// messages live only in this hook's state, nothing is persisted to Supabase.
// Resets whenever orgChartId changes, since the chat is scoped to whichever
// chart is currently open and a stale conversation from a different chart
// would be actively misleading, not just irrelevant.
export function useChat(
  orgChartId: string | null,
  accessToken: string | undefined,
  providerId: string | null,
  // Backlog item 48 — fired for every tool_result, write tools included; the
  // caller (ChatPanel, forwarded from AppShell) decides which tool names are
  // writes and turns those into a historyStore Command. Kept fully generic
  // here, this hook has no notion of undo/redo or which tools mutate data.
  onWriteToolResult?: (name: string, args: Record<string, unknown>, output: unknown) => void,
) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [providers, setProviders] = useState<ChatProviderOption[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const hideDepartedEmployees = useUiPreferencesStore((s) => s.hideDepartedEmployees);

  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSending(false);
    setStatusLabel(null);
    setError(null);
  }, [orgChartId]);

  // Fetches once per access token (not per orgChartId — the set of
  // configured LLM providers has nothing to do with which chart is open),
  // powers ChatPanel.tsx's model-picker dropdown. `activeId` is whichever
  // provider chatHandler.ts's resolveProviderMeta() would pick with no
  // override — used only to preselect the dropdown when the user hasn't
  // chosen anything yet (uiPreferencesStore's chatProviderId is null).
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetch('/api/chat', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { providers?: ChatProviderOption[]; activeId?: string | null } | null) => {
        if (cancelled || !data) return;
        setProviders(data.providers ?? []);
        setActiveProviderId(data.activeId ?? null);
      })
      .catch(() => {
        // Non-fatal: the dropdown just stays empty and the server falls back
        // to its own default resolution, same as before this feature existed.
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !orgChartId || !accessToken || sending) return;

      setError(null);
      const history = [...messages, { role: 'user' as const, text: trimmed }];
      // Local mutable mirror of `messages`, updated synchronously as SSE
      // events arrive — deliberately NOT read back out of React state via
      // setMessages's functional-updater form. Outside a React event
      // handler (this runs inside an async for-await loop), React defers
      // actually running that updater rather than executing it inline, so
      // a synchronous read right after calling setMessages(fn) always saw
      // the value from BEFORE the update — item 48's onWriteToolResult
      // needs the matched tool_call's args the instant its result arrives,
      // not whenever React gets around to it.
      let workingMessages: ChatMessage[] = [...history, { role: 'model', text: '' }];
      setMessages(workingMessages);
      setSending(true);
      setStatusLabel(t('chat.thinking'));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            orgChartId,
            messages: history,
            provider: providerId ?? undefined,
            hideDepartedEmployees,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }

        for await (const { event, data } of parseSseStream(response.body)) {
          if (event === 'text') {
            const delta = (data as { text: string }).text;
            setStatusLabel(null);
            const last = workingMessages[workingMessages.length - 1];
            workingMessages = [...workingMessages.slice(0, -1), { ...last, text: last.text + delta }];
            setMessages(workingMessages);
          } else if (event === 'tool_call') {
            const { name, args } = data as { name: string; args: Record<string, unknown> };
            setStatusLabel(t('chat.searching'));
            const last = workingMessages[workingMessages.length - 1];
            const toolCalls = [...(last.toolCalls ?? []), { id: crypto.randomUUID(), name, args, output: undefined }];
            workingMessages = [...workingMessages.slice(0, -1), { ...last, toolCalls }];
            setMessages(workingMessages);
          } else if (event === 'tool_result') {
            const { name, output } = data as { name: string; output: unknown };
            const last = workingMessages[workingMessages.length - 1];
            const toolCalls = [...(last.toolCalls ?? [])];
            // Tool calls/results arrive as ordered pairs, so the most
            // recent still-unresolved entry for this tool name is always
            // the one this result belongs to.
            let matchedArgs: Record<string, unknown> | undefined;
            for (let i = toolCalls.length - 1; i >= 0; i--) {
              if (toolCalls[i].name === name && toolCalls[i].output === undefined) {
                matchedArgs = toolCalls[i].args;
                toolCalls[i] = { ...toolCalls[i], output };
                break;
              }
            }
            workingMessages = [...workingMessages.slice(0, -1), { ...last, toolCalls }];
            setMessages(workingMessages);
            // Deferred via queueMicrotask — onWriteToolResult (item 48) ends
            // up calling historyStore's zustand `push`, which re-renders
            // UndoRedoButtons; doing that synchronously in the same tick as
            // the setMessages call just above is a "Cannot update a
            // component while rendering a different component" violation
            // (React is still processing ChatPanel's own queued update) and
            // silently drops the push — hit live.
            if (matchedArgs) {
              const args = matchedArgs;
              queueMicrotask(() => onWriteToolResult?.(name, args, output));
            }
          } else if (event === 'error') {
            const errorData = data as { code: 'overloaded' | 'unknown'; message?: string };
            // 'overloaded' has no server-supplied message on purpose — it's a
            // known, expected condition on Gemini's free tier (see
            // chatHandler.ts's RETRYABLE_ERROR_PATTERN), so it gets a
            // translated, friendly message here instead of Google's raw JSON.
            throw new Error(errorData.code === 'overloaded' ? t('chat.overloaded') : errorData.message);
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSending(false);
        setStatusLabel(null);
        abortRef.current = null;
      }
    },
    [orgChartId, accessToken, providerId, sending, messages, t, onWriteToolResult, hideDepartedEmployees],
  );

  return { messages, sendMessage, sending, statusLabel, error, providers, activeProviderId };
}
