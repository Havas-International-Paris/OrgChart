import { expect, test } from '@playwright/test';
import { MISSING_ACCOUNT_REASON, hasTestAccount } from '../support/env';
import { readTestChart } from '../support/testChart';

// Runs inside the throwaway org chart provisioned by auth.setup.ts. Nothing here
// can reach real data — that is what the isolation test below asserts, and it is
// the precondition for everything else.
test.describe('throwaway org chart', () => {
  test.skip(!hasTestAccount, MISSING_ACCOUNT_REASON);

  test.beforeEach(async ({ page }) => {
    const chart = readTestChart();
    await page.goto('/');

    // selectionStore is in-memory, so a fresh page always lands on orgCharts[0]
    // — the real chart — before this switches away from it.
    await page.getByRole('combobox').selectOption({ label: `${chart.name} – E2E` });

    // Then WAIT for the switch to actually land. This is a safety interlock, not
    // politeness: switching charts triggers an async refetch, so for a moment the
    // grid still shows the real chart's rows. A test proceeding on that stale view
    // would be asserting against production data — the first run of this spec did
    // exactly that, and only failed because a selector happened to be ambiguous.
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });

  // The claim the whole setup rests on. Kept as its own test so a failure reads as
  // "isolation is broken" rather than as some later interaction bug.
  test('is empty, and is not the real chart', async ({ page }) => {
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveValue(readTestChart().id);
  });

  // NOT YET WORKING — do not delete, and do not trust the absence of a failure
  // here as coverage. This is the spec backlog item 30 needs as a regression
  // guard, and it is the one thing this suite still cannot do.
  //
  // Two separate obstacles, both hit for real:
  //
  // 1. Creating the first employee in an empty chart is only possible through AG
  //    Grid cell editing, and that cannot be driven reliably: the editor mounts
  //    asynchronously, so typing straight after Enter produced "Ca" instead of
  //    "Camille" on one run, and on the next the editor never opened at all.
  //    Waiting for the editor's own input did not help — it is not exposed as a
  //    textbox in the accessibility tree where the row renders it. That
  //    interaction is itself slated for rework (item 31), so it is not worth
  //    hardening against now.
  //
  // 2. Seeding an employee directly (bypassing the grid) and driving the chart's
  //    own "+ Nouvel employé" button instead — the obvious way around (1) — made
  //    the chart-switch in beforeEach intermittently fail to take effect: the
  //    assertions saw the real chart's 7 cards rather than the throwaway's. That
  //    is unexplained, and shipping an isolation interlock that only usually holds
  //    would be worse than shipping none.
  //
  // Next step is (2): find out why the switch sometimes does not land. Until then
  // the undo/redo coverage item 30 wants does not exist, and manual browser
  // verification remains the only check on it.
  test.fixme('quick-adds a subordinate, then undoes it', async () => {});
});
