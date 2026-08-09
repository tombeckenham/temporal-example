import { defineConfig, devices } from '@playwright/test'
import { E2E_PORTS, E2E_SECRETS } from './e2e/constants.ts'

// Prefer localhost (may resolve to ::1). Vite on this machine listens on IPv6.
const baseURL = `http://localhost:${E2E_PORTS.app}`

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
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // `.dev.vars` is prepared by `bun run test:e2e` → prepare-dev-vars.ts
    // (Playwright starts webServer *before* globalSetup)
    command: `bunx vite dev --host 127.0.0.1 --port ${E2E_PORTS.app} --strictPort`,
    url: `http://127.0.0.1:${E2E_PORTS.app}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      E2E_BYPASS_AUTH: '1',
      EMAIL_MODE: 'console',
      // Match e2e/global-setup E2E_SECRETS (workerd also reads .dev.vars)
      TEMPORAL_STARTER_SECRET: E2E_SECRETS.TEMPORAL_STARTER_SECRET,
      TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
      STATUS_WEBHOOK_SECRET: E2E_SECRETS.STATUS_WEBHOOK_SECRET,
    },
  },
})
