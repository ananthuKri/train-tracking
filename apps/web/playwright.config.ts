import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/** Both dev servers are started from the monorepo root. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Tests don't need file watching.
      command: 'npm run serve -w @railtrack/api',
      url: 'http://127.0.0.1:8000/api/health',
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { TRAIN_DATA_PROVIDER: 'mock' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -w @railtrack/web',
      url: 'http://127.0.0.1:5173',
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
