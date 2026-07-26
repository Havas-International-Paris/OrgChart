import { expect, test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { E2E_EMAIL, E2E_PASSWORD, MISSING_ACCOUNT_REASON, STATE_DIR, STORAGE_STATE, hasTestAccount } from './support/env';
import { createTestChart } from './support/testChart';

// Runs once before the authenticated project: signs in through the real login
// form (rather than injecting a token, so the login path itself stays covered)
// and provisions the throwaway org chart the destructive specs operate in.
setup('sign in and provision a throwaway org chart', async ({ page }) => {
  setup.skip(!hasTestAccount, MISSING_ACCOUNT_REASON);

  mkdirSync(STATE_DIR, { recursive: true });

  await page.goto('/');
  await page.getByLabel('Email').fill(E2E_EMAIL);
  await page.getByLabel('Mot de passe').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // The chart selector only exists once authenticated, so it is the signal that
  // the session took — not the absence of an error message.
  await expect(page.getByRole('combobox')).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE });

  const chart = await createTestChart();
  console.log(`E2E throwaway org chart: ${chart.name} (${chart.id})`);
});
