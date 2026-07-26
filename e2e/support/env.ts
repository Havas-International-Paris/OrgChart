import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Two separate files on purpose. .env.local holds the project URL and anon key
// the app itself already needs; .env.test.local holds only the login of a
// throwaway test account, so nobody has to put a real person's password in a
// file to run the suite. Both are gitignored.
const root = resolve(import.meta.dirname, '../..');
config({ path: resolve(root, '.env.local'), quiet: true });
config({ path: resolve(root, '.env.test.local'), quiet: true });

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
export const E2E_EMAIL = process.env.E2E_EMAIL ?? '';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? '';

// Tests that need to sign in skip rather than fail when no test account is
// configured, so `npx playwright test` stays useful (and green) for anyone who
// has only cloned the repo — the public specs still run and still catch things.
export const hasTestAccount = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && E2E_EMAIL && E2E_PASSWORD);

export const MISSING_ACCOUNT_REASON =
  'No test account configured — copy .env.test.local.example to .env.test.local and fill it in.';

// Where auth.setup.ts parks the signed-in browser state and the id of the
// throwaway org chart, for the authenticated project to pick up.
export const STATE_DIR = resolve(root, 'e2e/.auth');
export const STORAGE_STATE = resolve(STATE_DIR, 'state.json');
export const TEST_CHART_FILE = resolve(STATE_DIR, 'chart.json');

export const hasStorageState = () => existsSync(STORAGE_STATE);
