import { expect, test } from '@playwright/test';
import { trackTrains } from './helpers';

test.describe('Results dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await trackTrains(page, '12082, 12627, 16348');
    await expect(page.getByTestId('result-row')).toHaveCount(3);
  });

  test('filters by search text and status, and sorts', async ({ page }) => {
    const rows = page.getByTestId('result-row');

    await page.getByTestId('search-input').fill('12627');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-train', '12627');
    await expect(page).toHaveURL(/q=12627/);

    await page.getByTestId('search-input').fill('');
    await expect(rows).toHaveCount(3);

    await page.getByTestId('sort-select').selectOption('train_number');
    await expect(page).toHaveURL(/sort=train_number/);
    const sorted = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-train')));
    expect(sorted).toEqual(['12082', '12627', '16348']);

    await page.getByTestId('sort-select').selectOption('largest_delay');
    await expect(page).toHaveURL(/sort=largest_delay/);
    await expect(rows).toHaveCount(3);

    // A status filter that no train has → empty state; clearing restores the list.
    await page.getByTestId('filter-toggle').click();
    await page.getByTestId('filter-status-cancelled').click();
    await expect(page).toHaveURL(/statuses=cancelled/);
    await expect(page.getByTestId('results-no-match')).toBeVisible();
    await page.getByTestId('filter-clear').click();
    await expect(rows).toHaveCount(3);
  });

  test('export CSV link carries trains, sort and filters', async ({ page }) => {
    await page.getByTestId('sort-select').selectOption('train_number');
    await page.getByTestId('filter-toggle').click();
    await page.getByTestId('filter-min-delay').fill('0');

    // The link updates after the URL state commits; wait for it rather than reading it once.
    const exportLink = page.getByTestId('export-csv');
    await expect(exportLink).toHaveAttribute('href', /sort=train_number/);
    await expect(exportLink).toHaveAttribute('href', /minDelay=0/);
    const href = await exportLink.getAttribute('href');
    expect(href).toBeTruthy();
    const url = new URL(href!, 'http://localhost:5173');
    expect(url.pathname).toBe('/api/tracking/export.csv');
    const trains = url.searchParams.get('trains')!.split(',');
    expect(trains).toHaveLength(3);
    for (const t of trains) expect(t).toMatch(/^(12082|12627|16348):\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.get('sort')).toBe('train_number');
    expect(url.searchParams.get('minDelay')).toBe('0');
    expect(url.searchParams.get('fields')).toContain('identity');
    await expect(page.getByTestId('export-csv')).toHaveAttribute('download', '');
  });

  test('opens the quick-view sheet without leaving the dashboard', async ({ page }) => {
    await page.getByTestId('result-row').first().click();
    const sheet = page.getByTestId('train-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('source-freshness')).toBeVisible();
    await expect(page).toHaveURL(/\/results/);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('keeps results after a page reload', async ({ page }) => {
    await page.reload();
    await expect(page.getByTestId('result-row')).toHaveCount(3);
  });
});
