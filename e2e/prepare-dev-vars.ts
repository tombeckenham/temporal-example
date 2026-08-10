/**
 * Ensure `.dev.vars` has e2e secrets *before* Vite/workerd starts.
 * Playwright starts webServer before globalSetup, so CI (no .dev.vars) needs this.
 *
 * Usage: bun run e2e/prepare-dev-vars.ts
 * Requires DATABASE_URL in the environment (from e2e/db-setup / e2e/run.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { E2E_PORTS, E2E_SECRETS } from './constants.ts'

const DEV_VARS_PATH = '.dev.vars'

const databaseUrl = process.env['DATABASE_URL']?.trim()
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required before prepare-dev-vars (run e2e/db-setup or e2e/run.ts)',
  )
}

const overrides: Record<string, string> = {
  DATABASE_URL: databaseUrl,
  TEMPORAL_STARTER_SECRET: E2E_SECRETS.TEMPORAL_STARTER_SECRET,
  TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
  STATUS_WEBHOOK_SECRET: E2E_SECRETS.STATUS_WEBHOOK_SECRET,
  EMAIL_MODE: 'console',
  /** DEV-only fixed OTP for Playwright sign-in (see auth/server.ts). */
  E2E_FIXED_OTP: '1',
  E2E_TEST_SECRET: E2E_SECRETS.E2E_TEST_SECRET,
  BETTER_AUTH_URL: `http://127.0.0.1:${E2E_PORTS.app}`,
}

let existing = ''
try {
  existing = readFileSync(DEV_VARS_PATH, 'utf8')
} catch {
  existing = ''
}

const map = new Map<string, string>()
for (const line of existing.split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m?.[1] !== undefined && m[2] !== undefined) {
    map.set(m[1], m[2])
  }
}
for (const [k, v] of Object.entries(overrides)) {
  map.set(k, v)
}
// Never leave auth bypass on for e2e
map.delete('E2E_BYPASS_AUTH')

if (!map.has('BETTER_AUTH_SECRET')) {
  map.set('BETTER_AUTH_SECRET', 'e2e-better-auth-secret-min-16')
}

writeFileSync(
  DEV_VARS_PATH,
  [
    '# e2e secrets (e2e/run.ts / prepare-dev-vars.ts; original restored after tests)',
    ...[...map.entries()].map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n'),
)
console.log('[e2e] wrote .dev.vars for workerd (DATABASE_URL + e2e secrets)')
