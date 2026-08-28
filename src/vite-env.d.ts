/// <reference types="vite/client" />

// Injected by vite.config.ts's `define` — an ISO timestamp stamped once per
// build (dev server start, or the `vite build` every Vercel deploy runs),
// not per-request. Shown under the app title in AppShell.tsx so a user with
// a stale tab open can tell they're behind the latest deploy.
declare const __BUILD_TIME__: string;
