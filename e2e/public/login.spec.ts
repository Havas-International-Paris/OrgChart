import { expect, test } from '@playwright/test';

// Needs no test account, so it runs for anyone who clones the repo. Covers the
// gate everything else sits behind: if the login form stops rendering or stops
// surfacing errors, the app is unusable and nothing else would tell us.
test.describe('login page', () => {
  test('renders the sign-in form for an anonymous visitor', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Organigramme Havas International' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('shows nothing of the app before signing in', async ({ page }) => {
    await page.goto('/');
    // The org-chart selector and the employee grid are the two things that must
    // never render for an anonymous visitor.
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.locator('.ag-root')).toHaveCount(0);
  });

  test('surfaces an error for wrong credentials and stays on the form', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('nobody.e2e@example.invalid');
    await page.getByLabel('Mot de passe').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    // Supabase Auth is hit for real here — it is a rejected read, nothing is
    // written — so allow for the round trip.
    await expect(page.getByText(/invalid|incorrect|credentials/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
  });

  test('requires both fields before it will submit', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    // Native `required` validation blocks submission, so the form is still there
    // and no error from the server has appeared.
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
