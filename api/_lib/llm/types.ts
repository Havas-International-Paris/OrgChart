import type { ToolContext } from '../chatTools.js';

// A model turn's tool activity, carried across HTTP requests so the model
// can see its own past tool calls and results — not just their final text
// summary. This matters whenever a later question depends on the exact data
// a tool returned (e.g. "undo that deletion": the model needs the precise
// deleted-row data from delete_employee's earlier result, not a prose
// recollection of it). Each request to /api/chat is a fresh, stateless
// invocation (no server-side session), so this is the only way that data
// survives to the next turn — see chatHandler.ts/useChat.ts for the other
// half of this.
export interface IncomingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  output: unknown;
}

export interface IncomingChatMessage {
  role: 'user' | 'model';
  text: string;
  toolCalls?: IncomingToolCall[];
}

// Matches the SSE contract useChat.ts already parses: 'text' | 'tool_call' |
// 'tool_result' | 'error' | 'done'. Kept as a plain (event, data) pair rather
// than a typed union so either provider can emit without both needing to
// import each other's event shapes.
export type EmitFn = (event: string, data: unknown) => void;

export interface LlmRunParams {
  messages: IncomingChatMessage[];
  toolCtx: ToolContext;
  emit: EmitFn;
}

// Each provider owns its full multi-turn tool-use loop end-to-end, in its own
// SDK's idioms (Gemini's Content/Part shapes vs Anthropic's MessageParam/
// content-block shapes are different enough that forcing a shared inner loop
// would fight both APIs) — chatHandler.ts only picks one and calls .run().
// A provider is responsible for emitting its own 'done' or 'error' event.
export interface LlmProvider {
  id: string;
  run(params: LlmRunParams): Promise<void>;
}
