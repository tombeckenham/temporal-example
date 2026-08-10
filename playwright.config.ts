import { defineConfig, devices } from '@playwright/test'
import { E2E_PORTS, E2E_SECRETS } from './e2e/constants.ts'

// Match BETTER_AUTH_URL / cookie host (127.0.0.1) — do not mix with localhost.
const baseURL = `http://127.0.0.1:${E2E_PORTS.app}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  reporter: process.env['CI'] ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // `.dev.vars` is prepared by e2e/run.ts before Playwright starts
    command: `bunx vite dev --host 127.0.0.1 --port ${E2E_PORTS.app} --strictPort`,
    url: `http://127.0.0.1:${E2E_PORTS.app}`,
    // Always start a fresh Vite so .dev.vars (e2e DATABASE_URL) is loaded
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      EMAIL_MODE: 'console',
      E2E_FIXED_OTP: '1',
      E2E_TEST_SECRET: E2E_SECRETS.E2E_TEST_SECRET,
      TEMPORAL_STARTER_SECRET: E2E_SECRETS.TEMPORAL_STARTER_SECRET,
      TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
      STATUS_WEBHOOK_SECRET: E2E_SECRETS.STATUS_WEBHOOK_SECRET,
      // DATABASE_URL must already be set by e2e/run.ts
    },
  },
})
