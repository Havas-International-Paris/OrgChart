import type { IncomingMessage, ServerResponse } from 'node:http';
import { chatHandler } from './_lib/chatHandler.js';

// Vercel's Node runtime hands a plain (IncomingMessage, ServerResponse) pair
// to a function exporting this shape — chatHandler is written directly
// against those types so this file is a one-line passthrough, and the exact
// same handler also runs under Vite's dev middleware (vite.config.ts).
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return chatHandler(req, res);
}
