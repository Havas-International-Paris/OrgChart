import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/support/env';

// Three projects rather than one, so the suite stays useful without credentials:
//   public        — no login needed, always runs
//   setup         — signs in once and creates the throwaway org chart
//   authenticated — reuses that session and that chart; skips if no test account
export default defineConfig({
  testDir: './e2e',
  // Destructive specs touch a shared Supabase project, so never run two at once
  // even locally — a parallel worker would be operating on the same rows.
  workers: 1,
  fullyParallel: false,
  // Fail the run instead of hiding a flaky test behind a retry: these specs
  // exist to tell us the real app works, and a pass-on-second-try is a finding.
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    // Deliberately reuse a dev server that is already up rather than starting
    // (and later killing) one — the usual state of this repo is a dev server
    // running for manual testing, and tearing it down mid-session is hostile.
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'public',
      testMatch: /public\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      // Runs after everything that depends on this project, pass or fail, so a
      // failed run still cleans up its throwaway chart and its session token.
      teardown: 'cleanup',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'cleanup',
      testMatch: /cleanup\.teardown\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'authenticated',
      testMatch: /authenticated\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],
});
