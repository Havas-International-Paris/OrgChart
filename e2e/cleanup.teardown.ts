import { test as teardown } from '@playwright/test';
import { rmSync } from 'node:fs';
import { MISSING_ACCOUNT_REASON, STATE_DIR, hasTestAccount } from './support/env';
import { deleteOrphanedTestCharts } from './support/testChart';

// Attached as the setup project's `teardown`, so it runs after the authenticated
// specs whether they passed or failed. Without it every run would leave another
// throwaway chart behind in a shared Supabase project.
//
// It deletes by name prefix rather than only the id from this run, so charts
// stranded by an earlier crash get swept up too. The prefix match is what makes
// that safe: it can never match a chart a human created.
teardown('remove throwaway org charts and the saved session', async () => {
  teardown.skip(!hasTestAccount, MISSING_ACCOUNT_REASON);

  const removed = await deleteOrphanedTestCharts();
  console.log(`Removed ${removed} throwaway org chart(s).`);

  // The saved storage state holds a live session token — don't leave it lying
  // around between runs.
  rmSync(STATE_DIR, { recursive: true, force: true });
});
