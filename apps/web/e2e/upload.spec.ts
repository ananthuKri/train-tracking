import { expect, test } from '@playwright/test';
import { freshStart, todayIst } from './helpers';

test.describe('Upload CSV', () => {
  test('previews rows, highlights the invalid one and tracks the valid trains', async ({ page }) => {
    await freshStart(page);
    await page.getByTestId('tab-upload').click();

    const today = todayIst();
    const csv = ['train_number,journey_date,email', `12082,${today},ops@example.com`, `12627,${today},`, `abcde,${today},`].join('\n');
    await page.getByTestId('upload-input').setInputFiles({
      name: 'trains.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    const preview = page.getByTestId('upload-preview');
    await expect(preview).toBeVisible();
    const rows = preview.getByTestId('upload-row');
    await expect(rows).toHaveCount(3);

    const invalid = preview.locator('[data-testid="upload-row"][data-valid="false"]');
    await expect(invalid).toHaveCount(1);
    await expect(invalid).toContainText('abcde');
    await expect(invalid).toContainText('Invalid');
    await expect(invalid.getByTestId('row-errors')).toContainText(/digits/i);

    await expect(page.getByTestId('download-errors')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('download-errors').click();
    expect((await download).suggestedFilename()).toBe('trains-errors.csv');

    await expect(page.getByTestId('track-upload')).toContainText('Track 2 valid trains');
    await page.getByTestId('track-upload').click();
    await expect(page).toHaveURL(/\/results/);
    await expect(page.getByTestId('result-row')).toHaveCount(2);
  });

  test('rejects unsupported files before uploading', async ({ page }) => {
    await freshStart(page);
    await page.getByTestId('tab-upload').click();
    await page.getByTestId('upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByTestId('upload-client-error')).toContainText('not supported');
  });
});
