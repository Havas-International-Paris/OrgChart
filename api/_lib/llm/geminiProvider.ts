import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { chatTools, chatToolsByName, type ToolDefinition } from '../chatTools.js';
import type { LlmProvider, LlmRunParams } from './types.js';
import { SYSTEM_INSTRUCTION } from './systemInstruction.js';

// Free-tier model — see docs/chat-ia-cahier-des-charges.md §4 for why Gemini
// was the original v1 choice. The "-latest" alias (rather than a pinned
// version like "gemini-2.5-flash") is deliberate: Google periodically retires
// dated model ids for new API keys ("this model is no longer available to
// new users"), and the alias is what keeps working across those retirements
// without needing a code change here.
export const MODEL = 'gemini-flash-latest';

// Google's shared free-tier endpoint occasionally 503s under load ("This
// model is currently experiencing high demand") — a real, expected condition
// on this tier, not a bug. Same treatment for 429 (RESOURCE_EXHAUSTED, rate
// limiting). A short retry absorbs most of these before the user sees them.
const RETRYABLE_ERROR_PATTERN = /"code":\s*(503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED/;

function isRetryableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return RETRYABLE_ERROR_PATTERN.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Only wraps the initial call that opens the stream, not iteration over it:
// once chunks (and possibly partial text already sent to the client) have
// started arriving, retrying from scratch would duplicate output, so a
// mid-stream failure is left to surface as a normal error instead.
async function generateContentStreamWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContentStream']>[0],
  maxRetries = 2,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContentStream(params);
    } catch (err) {
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

export function createGeminiProvider(apiKey: string): LlmProvider {
  const ai = new GoogleGenAI({ apiKey });

  return {
    id: 'gemini',
    async run({ messages, toolCtx, emit }: LlmRunParams) {
      // Replays each past turn's tool calls/results, not just its final text
      // — see types.ts's IncomingToolCall doc comment for why. Unlike the
      // live in-request loop below (which echoes Gemini's own `part` objects
      // verbatim to preserve their thoughtSignature), these reconstructed
      // functionCall parts carry no signature, since we only kept name/args/
      // output across the HTTP boundary, not Gemini's opaque token — this
      // path is unverified against a live Gemini call this session (Claude
      // was the active provider throughout), so if Gemini becomes primary
      // again, re-check that cross-request replay doesn't hit the same
      // "missing thought_signature" 400 the in-request loop had.
      const contents: Content[] = [];
      for (const m of messages) {
        if (m.role === 'user') {
          contents.push({ role: 'user', parts: [{ text: m.text }] });
          continue;
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          contents.push({
            role: 'model',
            parts: m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args } })),
          });
          contents.push({
            role: 'user',
            parts: m.toolCalls.map((tc) => ({ functionResponse: { name: tc.name, response: { output: tc.output } } })),
          });
        }
        if (m.text) {
          contents.push({ role: 'model', parts: [{ text: m.text }] });
        }
      }

      try {
        // A turn ends with the model requesting zero or more tool calls; when
        // it requests some, we run them and loop back in with their results
        // appended (Gemini's standard manual tool-use pattern), stopping once
        // a turn asks for no more tools. The 8-turn cap is a runaway-loop
        // guard, not an expected depth — batch creation happens in one
        // create_team call, so it doesn't need many turns either.
        for (let turn = 0; turn < 8; turn++) {
          const stream = await generateContentStreamWithRetry(ai, {
            model: MODEL,
            contents,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              tools: [
                {
                  functionDeclarations: chatTools.map((t: ToolDefinition) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parametersJsonSchema,
                  })),
                },
              ],
            },
          });

          const functionCalls: { name: string; args: Record<string, unknown> }[] = [];
          const modelParts: Part[] = [];

          for await (const chunk of stream) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              if (part.text) {
                emit('text', { text: part.text });
              }
              if (part.functionCall?.name) {
                functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
              }
              // Echo the whole part back verbatim (not a reconstructed
              // subset) — Gemini attaches a thoughtSignature to functionCall
              // parts that MUST be replayed unchanged on the next turn, or it
              // rejects the request with "missing a thought_signature".
              modelParts.push(part);
            }
          }

          if (functionCalls.length === 0) break;

          contents.push({ role: 'model', parts: modelParts });

          const responseParts: Part[] = [];
          for (const call of functionCalls) {
            emit('tool_call', { name: call.name, args: call.args });
            const tool = chatToolsByName.get(call.name);
            let output: unknown;
            try {
              output = tool ? await tool.run(toolCtx, call.args) : { error: `Unknown tool: ${call.name}` };
            } catch (err) {
              output = { error: err instanceof Error ? err.message : String(err) };
            }
            emit('tool_result', { name: call.name, output });
            responseParts.push({ functionResponse: { name: call.name, response: { output } } });
          }
          contents.push({ role: 'user', parts: responseParts });
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
