import type { IncomingMessage, ServerResponse } from 'node:http';
import { supabaseForUser } from './chatTools.js';
import { PROVIDER_ORDER, PROVIDER_REGISTRY, type ProviderId, type ProviderMeta } from './llm/providerRegistry.js';
import type { IncomingChatMessage } from './llm/types.js';

interface ChatRequestBody {
  orgChartId?: string;
  messages?: IncomingChatMessage[];
  // Optional per-request override from the frontend's model-picker dropdown
  // (added 2026-08-01) — lets the user switch providers live without editing
  // .env.local/LLM_PROVIDER and restarting. Falls back to the existing
  // env-based resolution when omitted, so LLM_PROVIDER still controls the
  // default a fresh/no-selection client gets.
  provider?: string;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sseWrite(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendJsonError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function metaFor(id: string): ProviderMeta | undefined {
  return PROVIDER_REGISTRY[id as ProviderId];
}

// requestedOverride comes from the client's own `provider` field (the
// dropdown) and takes precedence over LLM_PROVIDER when present and valid —
// that's the whole point of the dropdown existing. Falls through to
// LLM_PROVIDER (pins one provider server-wide) and then auto-detect (first
// provider, in PROVIDER_ORDER, whose env key is actually set) exactly as
// before. See providerRegistry.ts for the order/labels/model ids.
function resolveProviderMeta(requestedOverride?: string): ProviderMeta | { error: string } {
  if (requestedOverride) {
    const meta = metaFor(requestedOverride);
    if (!meta) {
      return { error: `Unknown provider "${requestedOverride}" (expected one of: ${PROVIDER_ORDER.join(', ')}).` };
    }
    if (!process.env[meta.envVar]) {
      return { error: `Provider "${requestedOverride}" was requested but ${meta.envVar} is not configured on the server.` };
    }
    return meta;
  }

  const pinned = process.env.LLM_PROVIDER?.toLowerCase();
  if (pinned) {
    const meta = metaFor(pinned);
    if (!meta) {
      return { error: `LLM_PROVIDER=${pinned} is not a recognized provider (expected one of: ${PROVIDER_ORDER.join(', ')}).` };
    }
    if (!process.env[meta.envVar]) {
      return { error: `LLM_PROVIDER=${pinned} is set but ${meta.envVar} is missing.` };
    }
    return meta;
  }

  for (const id of PROVIDER_ORDER) {
    const meta = PROVIDER_REGISTRY[id];
    if (process.env[meta.envVar]) return meta;
  }
  return {
    error: `No LLM API key configured on the server (set one of: ${PROVIDER_ORDER.map((id) => PROVIDER_REGISTRY[id].envVar).join(', ')}).`,
  };
}

// GET /api/chat — lists every known provider (id/label/model, plus whether
// its API key is actually configured) and which one `resolveProviderMeta()`
// would pick with no override, so the frontend's dropdown (ChatPanel.tsx)
// can populate its options and preselect the server's own default. No
// secrets are exposed — only which env var names are non-empty, never their
// values.
function handleListProviders(res: ServerResponse) {
  const activeMeta = resolveProviderMeta();
  const providers = PROVIDER_ORDER.map((id) => {
    const meta = PROVIDER_REGISTRY[id];
    return { id: meta.id, label: meta.label, model: meta.model, available: Boolean(process.env[meta.envVar]) };
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ providers, activeId: 'error' in activeMeta ? null : activeMeta.id }));
}

// Framework-agnostic on purpose: called as-is from api/chat.ts (Vercel's Node
// runtime hands it a plain IncomingMessage/ServerResponse) and from Vite's dev
// server middleware (vite.config.ts), so /api/chat behaves identically under
// `npm run dev` and in production without a second `vercel dev` workflow.
export async function chatHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJsonError(res, 405, 'Method not allowed.');
    return;
  }

  const authHeader = req.headers.authorization;
  const accessToken = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '';
  if (!accessToken) {
    sendJsonError(res, 401, 'Missing Authorization header.');
    return;
  }

  if (req.method === 'GET') {
    handleListProviders(res);
    return;
  }

  let body: ChatRequestBody;
  try {
    body = (await readJsonBody(req)) as ChatRequestBody;
  } catch {
    sendJsonError(res, 400, 'Invalid JSON body.');
    return;
  }

  const { orgChartId, messages, provider: requestedProvider } = body;
  if (!orgChartId || !Array.isArray(messages) || messages.length === 0) {
    sendJsonError(res, 400, 'orgChartId and a non-empty messages array are required.');
    return;
  }

  const providerMeta = resolveProviderMeta(requestedProvider);
  if ('error' in providerMeta) {
    sendJsonError(res, 500, providerMeta.error);
    return;
  }
  const provider = providerMeta.create(process.env[providerMeta.envVar]!);

  const supabase = supabaseForUser(accessToken);
  // Confirms this is a real, still-live Supabase session — not just any
  // bearer string — before spending an LLM call on it. RLS itself (see
  // 0002_rls_policies.sql) is what actually scopes/authorizes the tool
  // queries and writes below.
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    sendJsonError(res, 401, 'Invalid or expired session.');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  try {
    await provider.run({
      messages,
      toolCtx: { supabase, orgChartId },
      emit: (event, data) => sseWrite(res, event, data),
    });
  } finally {
    res.end();
  }
}
