import { expect, test } from '@playwright/test';
import { todayIst } from './helpers';

test.describe('Train detail', () => {
  test('shows the map with an estimated-position label and the route timeline', async ({ page }) => {
    await page.goto(`/trains/12082?date=${todayIst()}`);

    await expect(page.getByTestId('train-detail')).toBeVisible();
    await expect(page.getByTestId('train-header')).toContainText('12082');
    await expect(page.getByTestId('train-header').getByTestId('demo-badge')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('source-freshness')).toContainText('Fetched');

    const map = page.getByTestId('train-map');
    await expect(map).toBeVisible();
    await expect(map.locator('.leaflet-container')).toBeVisible();
    await expect(page.getByTestId('map-recenter')).toBeVisible();
    await expect(page.getByTestId('map-full-route')).toBeVisible();
    await expect(page.getByTestId('map-toggle-stations')).toBeVisible();
    await expect(page.getByTestId('map-toggle-animation')).toBeVisible();

    await expect(page.getByTestId('position-label').first()).toHaveText('Estimated position — not GPS');
    await expect(page.getByTestId('position-basis').first()).toBeVisible();

    const timeline = page.getByTestId('route-timeline');
    await expect(timeline).toBeVisible();
    expect(await timeline.getByTestId('timeline-stop').count()).toBeGreaterThan(1);
  });

  test('shows a clear error for an unknown train', async ({ page }) => {
    await page.goto(`/trains/54321?date=${todayIst()}`);
    await expect(page.locator('[data-testid="train-error"][data-code="TRAIN_NOT_FOUND"]')).toBeVisible();
  });

  test('shows prominent banners for cancelled and diverted trains', async ({ page }) => {
    await page.goto(`/trains/12859?date=${todayIst()}`);
    await expect(page.getByTestId('exception-banner').first()).toBeVisible();
    await expect(page.getByTestId('train-header').getByTestId('status-badge')).toContainText(/cancelled/i);

    await page.goto(`/trains/12622?date=${todayIst()}`);
    await expect(page.locator('[data-testid="exception-banner"]').first()).toContainText(/divert/i);
  });
});
