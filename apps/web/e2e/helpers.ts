import { expect, type Page } from '@playwright/test';

/** Today's date in IST (YYYY-MM-DD), independent of the machine's time zone. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Start each test with an empty dashboard (results persist in localStorage). */
export async function freshStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('railtrack-dashboard'));
  await page.reload();
}

/** Enter train numbers on the Track page, submit and wait for the dashboard. */
export async function trackTrains(page: Page, input: string): Promise<void> {
  await freshStart(page);
  await page.getByTestId('train-input').fill(input);
  await expect(page.getByTestId('track-submit')).toBeEnabled();
  await page.getByTestId('track-submit').click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByTestId('results-page')).toBeVisible();
}
