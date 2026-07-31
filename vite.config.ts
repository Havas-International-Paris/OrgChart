import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dotenv from 'dotenv'
import { chatHandler } from './api/_lib/chatHandler.js'

// Vite doesn't put .env.local's values on process.env by default (only
// VITE_-prefixed ones reach import.meta.env, and only inside app code) — but
// the dev middleware below runs in this Node process and needs GEMINI_API_KEY
// / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY there directly, same as
// scripts/gen-types.mjs already needs .env.local for its own purposes.
dotenv.config({ path: '.env.local' })

// Makes /api/chat work under plain `npm run dev`, not just a real Vercel
// deploy or a separate `vercel dev` process — same chatHandler either way,
// see api/chat.ts and docs/chat-ia-cahier-des-charges.md §4.
function apiChatDevMiddleware(): Plugin {
  return {
    name: 'api-chat-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res) => {
        chatHandler(req, res).catch((err: unknown) => {
          console.error('chat handler error', err)
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), apiChatDevMiddleware()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
