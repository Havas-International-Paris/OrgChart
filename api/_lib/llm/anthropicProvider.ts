import Anthropic from '@anthropic-ai/sdk';
import { chatTools, chatToolsByName, type ToolDefinition } from '../chatTools.js';
import type { LlmProvider, LlmRunParams } from './types.js';
import { SYSTEM_INSTRUCTION } from './systemInstruction.js';

// Chosen 2026-07-31 as a temporary swap while Gemini's free tier is
// overloaded — see docs/chat-ia-cahier-des-charges.md §4/§7. Sonnet, not
// Opus: strong enough for this tool-use shape (lookups + scoped writes) at a
// fraction of Opus's per-token cost, which matters since this still isn't
// the user's paid personal Claude account being spent, it's a fresh
// Anthropic API key for the app.
export const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8192;

function isRetryableError(err: unknown): boolean {
  // The SDK already retries 429/5xx internally (default maxRetries: 2)
  // before throwing, so anything that reaches here has already exhausted
  // that — this only decides how to *label* it for the client.
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500) return true;
  return false;
}

function anthropicTools() {
  return chatTools.map((t: ToolDefinition) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parametersJsonSchema as Anthropic.Tool.InputSchema,
  }));
}

export function createAnthropicProvider(apiKey: string): LlmProvider {
  const client = new Anthropic({ apiKey });
  const tools = anthropicTools();

  return {
    id: 'anthropic',
    async run({ messages, toolCtx, emit }: LlmRunParams) {
      // Replays each past turn's tool_use/tool_result blocks (not just its
      // final text) so the model can see exactly what a prior tool call
      // returned — see types.ts's IncomingToolCall doc comment for why this
      // matters. A turn with tool calls expands into an assistant message
      // carrying all of them as parallel tool_use blocks, then a user
      // message with the matching tool_result blocks (valid per Anthropic's
      // "multiple tool_use blocks execute concurrently" shape, even though
      // these already-resolved calls may not have been literally parallel
      // originally — order doesn't matter for a replay, the values are
      // already resolved), then the turn's own text as a final assistant
      // message if any. A turn with no tool calls is just plain text, same
      // as before.
      const conversation: Anthropic.MessageParam[] = [];
      for (const m of messages) {
        if (m.role === 'user') {
          conversation.push({ role: 'user', content: m.text });
          continue;
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          conversation.push({
            role: 'assistant',
            content: m.toolCalls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.args,
            })),
          });
          conversation.push({
            role: 'user',
            content: m.toolCalls.map((tc) => ({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: JSON.stringify(tc.output),
            })),
          });
        }
        if (m.text) {
          conversation.push({ role: 'assistant', content: m.text });
        }
      }

      try {
        // Same shape as Gemini's provider: loop turns, streaming text as it
        // arrives, running any requested tools, and feeding results back —
        // stopping once a turn ends without requesting a tool. See the
        // Claude API skill's "Streaming Manual Loop" pattern this follows.
        for (let turn = 0; turn < 8; turn++) {
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_INSTRUCTION,
            tools,
            messages: conversation,
          });

          stream.on('text', (delta) => emit('text', { text: delta }));

          const message = await stream.finalMessage();

          if (message.stop_reason === 'pause_turn') {
            // Server-side tool ran out of its own internal iteration budget;
            // re-sending the same turn resumes it. Not expected here (this
            // app declares no server-side tools), kept for robustness.
            conversation.push({ role: 'assistant', content: message.content });
            continue;
          }

          const toolUseBlocks = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );

          conversation.push({ role: 'assistant', content: message.content });

          if (toolUseBlocks.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const call of toolUseBlocks) {
            const args = (call.input ?? {}) as Record<string, unknown>;
            emit('tool_call', { name: call.name, args });
            const tool = chatToolsByName.get(call.name);
            let output: unknown;
            try {
              output = tool ? await tool.run(toolCtx, args) : { error: `Unknown tool: ${call.name}` };
            } catch (err) {
              output = { error: err instanceof Error ? err.message : String(err) };
            }
            emit('tool_result', { name: call.name, output });
            toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) });
          }
          conversation.push({ role: 'user', content: toolResults });
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
