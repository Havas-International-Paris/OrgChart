import { expect, test } from '@playwright/test';
import { MISSING_ACCOUNT_REASON, hasTestAccount } from '../support/env';
import { readTestChart } from '../support/testChart';

// NOTE: this spec has not yet been executed — running it needs a test account
// that only the repo owner can create. Treat the selectors below as a first
// draft: AG Grid and React Flow are both awkward to drive (see the project's
// browser-testing notes), so expect to adjust them on the first real run.
// Everything before the grid interaction is straightforward and should hold.
test.describe('employee lifecycle in a throwaway org chart', () => {
  test.skip(!hasTestAccount, MISSING_ACCOUNT_REASON);

  test.beforeEach(async ({ page }) => {
    const chart = readTestChart();
    await page.goto('/');
    // Selecting by label rather than value: the option label is what a human
    // sees, and the id is not stable across runs.
    await page.getByRole('combobox').selectOption({ label: `${chart.name} – E2E` });
  });

  // The safety claim the whole E2E setup rests on: the throwaway chart really is
  // empty, so nothing below can touch production data. If this fails, stop —
  // do not let the rest of the spec run against a populated chart.
  test('the throwaway chart starts empty', async ({ page }) => {
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(0);
  });

  test('adds an employee, then undoes it', async ({ page }) => {
    await page.getByRole('button', { name: '+ Ajouter' }).click();

    // A freshly-created row is pinned to the top until the user leaves it
    // (useRowStabilizer.ts), which is what makes it findable here.
    const pinnedRow = page.locator('.ag-floating-top-container .ag-row').first();
    await expect(pinnedRow).toBeVisible();

    await pinnedRow.getByRole('gridcell').nth(1).dblclick();
    await page.keyboard.type('Camille');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Testeur');
    await page.keyboard.press('Enter');

    // Grid → chart propagation goes through Supabase Realtime, not local state,
    // so this also covers the subscription actually delivering the INSERT.
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Camille' })).toBeVisible({
      timeout: 15_000,
    });

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Camille' })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
