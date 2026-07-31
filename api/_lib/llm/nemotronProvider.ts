import OpenAI from 'openai';
import { chatTools, chatToolsByName, type ToolDefinition } from '../chatTools.js';
import type { LlmProvider, LlmRunParams } from './types.js';
import { SYSTEM_INSTRUCTION } from './systemInstruction.js';

// NVIDIA's hosted NIM catalog (build.nvidia.com) — free with an API key,
// OpenAI-compatible /v1/chat/completions. Added 2026-08-01 as a second free
// option alongside Gemini, per the user's request. Super 49B chosen over the
// smaller Nano 8B for tool-use reliability on this app's multi-step flows
// (chained lookups, create_team, get_team_etp_report) — confirmed by
// NVIDIA's own docs to support tool calling; Nano wasn't.
//
// UNVERIFIED: the exact hosted-API model id string. NVIDIA's docs show two
// different casing conventions in different places (self-hosted NIM
// container docs use "Llama-3_3-Nemotron-Super-49B-v1_5"; the hosted
// catalog's other listed models follow "organization/model-name" lowercase-
// hyphen, e.g. "meta/llama-3.1-70b-instruct") and neither page had a worked
// example against the hosted endpoint specifically. This string is a
// best-effort guess pending a real NVIDIA_API_KEY to test against — same
// situation the Gemini provider was in until testing caught its wrong model
// id (see docs/chat-ia-cahier-des-charges.md). If this 404s, call
// `client.models.list()` once with a real key to get the exact id and fix
// this constant — don't keep guessing.
export const MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';

function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

function nemotronTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return chatTools.map((t: ToolDefinition) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parametersJsonSchema,
    },
  }));
}

interface StreamedToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

export function createNemotronProvider(apiKey: string): LlmProvider {
  const client = new OpenAI({ apiKey, baseURL: 'https://integrate.api.nvidia.com/v1' });
  const tools = nemotronTools();

  return {
    id: 'nemotron',
    async run({ messages, toolCtx, emit }: LlmRunParams) {
      // Same replay shape as the other two providers (see types.ts's
      // IncomingToolCall) translated into OpenAI's role vocabulary: a tool
      // call becomes an assistant message carrying `tool_calls`, followed by
      // one `role: 'tool'` message per call result.
      const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
      ];
      for (const m of messages) {
        if (m.role === 'user') {
          conversation.push({ role: 'user', content: m.text });
          continue;
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          conversation.push({
            role: 'assistant',
            content: null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          });
          for (const tc of m.toolCalls) {
            conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(tc.output) });
          }
        }
        if (m.text) {
          conversation.push({ role: 'assistant', content: m.text });
        }
      }

      try {
        for (let turn = 0; turn < 8; turn++) {
          const stream = await client.chat.completions.create({
            model: MODEL,
            messages: conversation,
            tools,
            stream: true,
          });

          // OpenAI-style streamed tool calls arrive as partial fragments
          // keyed by `index`, reassembled here — the SDK doesn't do this
          // for you the way Anthropic's `stream.finalMessage()` does.
          const toolCallAcc = new Map<number, StreamedToolCall>();
          let assistantText = '';

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              emit('text', { text: delta.content });
              assistantText += delta.content;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const acc = toolCallAcc.get(tc.index) ?? { arguments: '' };
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                toolCallAcc.set(tc.index, acc);
              }
            }
          }

          const toolCalls = Array.from(toolCallAcc.entries())
            .sort(([a], [b]) => a - b)
            .map(([, v]) => v)
            .filter((tc): tc is StreamedToolCall & { id: string; name: string } => Boolean(tc.id && tc.name));

          if (toolCalls.length === 0) break;

          conversation.push({
            role: 'assistant',
            content: assistantText || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });

          for (const tc of toolCalls) {
            let args: Record<string, unknown>;
            try {
              args = tc.arguments ? JSON.parse(tc.arguments) : {};
            } catch {
              args = {};
            }
            emit('tool_call', { name: tc.name, args });
            const tool = chatToolsByName.get(tc.name);
            let output: unknown;
            try {
              output = tool ? await tool.run(toolCtx, args) : { error: `Unknown tool: ${tc.name}` };
            } catch (err) {
              output = { error: err instanceof Error ? err.message : String(err) };
            }
            emit('tool_result', { name: tc.name, output });
            conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(output) });
          }
        }

        emit('done', {});
      } catch (err) {
        if (isRetryableError(err)) {
          emit('error', { code: 'overloaded' });
        } else {
          emit('error', { code: 'unknown', message: err instanceof Error ? err.message : String(err) });
        }
      }
    },
  };
}
