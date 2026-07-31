import OpenAI from 'openai';
import { chatTools, chatToolsByName, type ToolDefinition } from '../chatTools.js';
import type { LlmProvider, LlmRunParams } from './types.js';
import { SYSTEM_INSTRUCTION } from './systemInstruction.js';

// GLM-5.2 (Zhipu/Z.ai) via OpenRouter — added 2026-08-01 to compare quality
// against Nemotron/Gemini on the same questions, per the user's explicit
// request ("je suis prêt à mettre quelques $"). OpenRouter is pay-as-you-go
// here, not a free tier — GLM-5.2 has no genuine free hosted endpoint as of
// this writing (Z.ai's own API and OpenRouter's routing are both metered;
// only the older GLM-4.5-air has an OpenRouter :free tier, which is a
// different, weaker model). Cost at this app's usage volume (occasional
// chat questions) is expected to be a few cents per test session.
export const MODEL = 'z-ai/glm-5.2';

function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

function glmTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
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

// Identical shape to nemotronProvider.ts — both are OpenAI-compatible
// endpoints (NVIDIA NIM vs. OpenRouter), same replay/streaming-tool-call-
// reassembly logic. Kept as separate files rather than parameterizing one
// provider over {baseURL, model}, matching this codebase's existing
// per-provider-owns-its-whole-loop convention (see systemInstruction.ts's
// comment on anthropicProvider.ts/geminiProvider.ts) — a shared base would
// save a little duplication now but couples two providers' error/retry
// tuning together the moment either one needs a provider-specific quirk.
export function createGlmProvider(apiKey: string): LlmProvider {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  });
  const tools = glmTools();

  return {
    id: 'glm',
    async run({ messages, toolCtx, emit }: LlmRunParams) {
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
