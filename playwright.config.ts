import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: { baseURL: process.env.LIVE_URL ?? 'http://127.0.0.1:4173/shell-env-generator/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.LIVE_URL ? undefined : { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173/shell-env-generator/', reuseExistingServer: !process.env.CI },
});
