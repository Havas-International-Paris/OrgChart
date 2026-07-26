import { expect, test, type Page } from '@playwright/test';
import { MISSING_ACCOUNT_REASON, hasTestAccount } from '../support/env';
import { readTestChart } from '../support/testChart';

// Runs inside the throwaway org chart provisioned by auth.setup.ts, seeded with
// exactly one root employee. Nothing here can reach real data.
//
// Drives the CHART's buttons rather than the grid's cell editors on purpose: AG
// Grid's editor mounts asynchronously and can close mid-keystroke, which made an
// earlier draft produce "Ca" instead of "Camille" on one run and fail to open at
// all on the next. That interaction is slated for rework (backlog item 31); the
// undo/redo paths worth covering are reachable through plain buttons anyway.
const cards = (page: Page) => page.locator('.react-flow__node');

// Both corner "+" popovers render an identically-labelled "+ Nouvel employé"
// button, so a page-wide query matches two elements. Scope to the popover that
// belongs to THIS trigger by going through its own wrapper element.
async function quickAddSubordinate(page: Page) {
  const trigger = cards(page).first().getByTitle('Ajouter un subordonné');
  await trigger.click();
  await trigger.locator('..').getByRole('button', { name: '+ Nouvel employé' }).click();
}

// Undo/redo are driven through the toolbar buttons rather than Ctrl+Z, and this
// is a correctness point rather than a preference. quickAddSubordinate pushes its
// history command only AFTER both writes and their refetches have completed, so
// the new card can be on screen a moment before there is anything to undo —
// pressing the shortcut then silently does nothing. The button's disabled state
// is the app's own signal that the command has landed, so waiting for it to be
// enabled removes the race (and covers the visible affordance too).
// `.first()`: the same buttons render in both panes, and the toast offers a third.
async function clickWhenEnabled(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true }).first();
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
}

test.describe('throwaway org chart', () => {
  test.skip(!hasTestAccount, MISSING_ACCOUNT_REASON);

  test.beforeEach(async ({ page }) => {
    const chart = readTestChart();
    await page.goto('/');

    // selectionStore is in-memory, so a fresh page always lands on orgCharts[0]
    // — the real chart — before this switches away from it.
    await page.getByRole('combobox').selectOption({ label: `${chart.name} – E2E` });

    // Then WAIT for the switch to actually land. This is a safety interlock, not
    // politeness: a test proceeding on the pre-switch view would be asserting
    // against production data.
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Racine');
  });

  // The claim the whole setup rests on. Kept as its own test so a failure reads
  // as "isolation is broken" rather than as some later interaction bug.
  test('shows only the seeded employee, not the real chart', async ({ page }) => {
    await expect(cards(page)).toHaveCount(1);
    // By ARIA role, not AG Grid's internal classes: .ag-center-cols-container
    // does not exist in v36's DOM, and an earlier draft silently matched nothing.
    await expect(page.getByRole('grid')).toContainText('Racine');
    await expect(page.getByRole('combobox')).toHaveValue(readTestChart().id);
  });

  // MARKED FIXME BECAUSE IT IS FLAKY, and the cause is the chart canvas being
  // hard to click reliably — NOT, as first suspected, the undo path being broken.
  // Established by probing:
  //
  //   * The department legend is an absolutely-positioned overlay at top-left of
  //     the canvas, and Playwright names it explicitly as intercepting pointer
  //     events on any card beneath it. Whether the seeded card lands under it
  //     depends on the auto-fit, which is why the failure came and went.
  //   * Panning the canvas clear of the legend first does not fully fix it: the
  //     click then retries against an element reported visible/enabled/stable
  //     until the test times out, alongside ResizeObserver warnings — consistent
  //     with the viewport still moving (auto-fit, and setCenter's 400ms animation
  //     on selection) while the click is being attempted.
  //
  // So this is a testability problem in the chart, not evidence about undo. Do
  // not cite it as a reason to change the undo design. Making these pass needs a
  // way to quiet the viewport during tests (or to assert against the grid
  // instead), which is worth doing but is its own piece of work.
  test.fixme('quick-adds a subordinate, then undoes it', async ({ page }) => {
    // The bottom-right "+" opens a two-item popover; "+ Nouvel employé" creates
    // the employee AND links it in one action, recorded as a single undo command
    // (useChartActions' quickAddSubordinate).
    await quickAddSubordinate(page);

    // This also covers Realtime actually delivering the INSERT: the new card
    // arrives through the subscription, not from local state.
    await expect(cards(page)).toHaveCount(2, { timeout: 15_000 });

    // The compound undo: one gesture created an employee AND a reporting edge, so
    // a single Ctrl+Z must remove both rather than leaving a dangling half.
    await clickWhenEnabled(page, 'Annuler');
    await expect(cards(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(cards(page).first()).toContainText('Racine');
  });

  // Same flake as above — see the note there.
  test.fixme('redoes what it undid', async ({ page }) => {
    await quickAddSubordinate(page);
    await expect(cards(page)).toHaveCount(2, { timeout: 15_000 });

    await clickWhenEnabled(page, 'Annuler');
    await expect(cards(page)).toHaveCount(1, { timeout: 15_000 });

    // Redo recreates the employee under a FRESH id — the whole reason the idBox
    // indirection exists today, and the behaviour backlog item 30 is about to
    // replace. This is the regression guard for that work.
    await clickWhenEnabled(page, 'Rétablir');
    await expect(cards(page)).toHaveCount(2, { timeout: 15_000 });
  });
});
