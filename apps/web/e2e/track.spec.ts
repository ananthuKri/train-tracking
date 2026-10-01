import { expect, test } from '@playwright/test';
import { freshStart, trackTrains } from './helpers';

test.describe('Track trains', () => {
  test('tracks a single train and shows the result with the DEMO banner', async ({ page }) => {
    await trackTrains(page, '12082');

    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText('DEMO DATA — simulated trains, not live railway data');

    const rows = page.getByTestId('result-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-train', '12082');
    await expect(rows.first().getByTestId('status-badge')).toBeVisible();
    await expect(rows.first().getByTestId('demo-badge')).toBeVisible();
  });

  test('tracks multiple trains and lists each in the dashboard', async ({ page }) => {
    await trackTrains(page, '12082, 12627, 16348');

    const rows = page.getByTestId('result-row');
    await expect(rows).toHaveCount(3);
    const numbers = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-train')).sort());
    expect(numbers).toEqual(['12082', '12627', '16348']);
    await expect(page.getByTestId('stat-total')).toContainText('3');

    // Cards view shows the same trains as independent cards.
    await page.getByTestId('view-cards').click();
    await expect(page.getByTestId('result-card')).toHaveCount(3);
  });

  test('gives inline feedback for invalid input and blocks submit', async ({ page }) => {
    await freshStart(page);
    await page.getByTestId('train-input').fill('1234, abcde');

    const feedback = page.getByTestId('invalid-feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback.getByTestId('invalid-item')).toHaveCount(2);
    await expect(feedback).toContainText('1234');
    await expect(feedback).toContainText('Train numbers have 5 digits');
    await expect(feedback).toContainText('abcde');
    await expect(feedback).toContainText('may only contain digits');
    await expect(page.getByTestId('valid-chip')).toHaveCount(0);
    await expect(page.getByTestId('track-submit')).toBeDisabled();

    // Duplicates are reported once.
    await page.getByTestId('train-input').fill('12082 12082');
    await expect(page.getByTestId('duplicate-feedback')).toContainText('12082');
    await expect(page.getByTestId('valid-chip')).toHaveCount(1);
    await expect(page.getByTestId('track-submit')).toBeEnabled();
  });

  test('shows failed trains with their error state next to successful ones', async ({ page }) => {
    await trackTrains(page, '12082, 99999, 54321');
    await page.getByTestId('view-cards').click();
    await expect(page.getByTestId('result-card')).toHaveCount(3);
    await expect(page.locator('[data-testid="train-error"][data-code="RATE_LIMITED"]')).toBeVisible();
    await expect(page.locator('[data-testid="train-error"][data-code="TRAIN_NOT_FOUND"]')).toBeVisible();
  });
});
