import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Falls back to a placeholder URL when unconfigured so createClient() doesn't
// throw at import time; callers must check isSupabaseConfigured before use.
export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // Backlog item 61 — close the session-fixation-by-URL vector: without
      // this, an attacker-crafted link like .../#access_token=<their_token>
      // would silently replace the victim's session on first load.
      detectSessionInUrl: false,
      // flowType 'pkce' is the Supabase-js default since 2023 but pin it
      // explicitly so a future library bump can't quietly shift the flow.
      flowType: 'pkce',
    },
  },
);
