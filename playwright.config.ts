import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [['html'], ['github']] : 'html',
    use: {
        baseURL: 'https://localhost:4200',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        ignoreHTTPSErrors: true,
    },
    projects: process.env.CI
        ? [
              // Only run Chromium in CI for speed
              {
                  name: 'chromium',
                  use: { ...devices['Desktop Chrome'] },
              },
          ]
        : [
              // Run all browsers locally for comprehensive testing
              {
                  name: 'chromium',
                  use: { ...devices['Desktop Chrome'] },
              },
              {
                  name: 'firefox',
                  use: { ...devices['Desktop Firefox'] },
              },
              {
                  name: 'webkit',
                  use: { ...devices['Desktop Safari'] },
              },
          ],
    webServer: {
        command: 'bun run dev:e2e',
        url: 'https://localhost:4200',
        reuseExistingServer: !process.env.CI,
        ignoreHTTPSErrors: true,
        timeout: 120000, // 2 minutes for both servers to start
    },
});
