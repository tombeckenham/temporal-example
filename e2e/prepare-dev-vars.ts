/**
 * Ensure `.dev.vars` has e2e secrets *before* Vite/workerd starts.
 * Playwright starts webServer before globalSetup, so CI (no .dev.vars) needs this.
 *
 * Usage: bun run e2e/prepare-dev-vars.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { E2E_PORTS, E2E_SECRETS } from './constants.ts'

const DEV_VARS_PATH = '.dev.vars'

const overrides: Record<string, string> = {
  TEMPORAL_STARTER_SECRET: E2E_SECRETS.TEMPORAL_STARTER_SECRET,
  TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
  STATUS_WEBHOOK_SECRET: E2E_SECRETS.STATUS_WEBHOOK_SECRET,
  E2E_BYPASS_AUTH: '1',
  EMAIL_MODE: 'console',
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
if (!map.has('BETTER_AUTH_SECRET')) {
  map.set('BETTER_AUTH_SECRET', 'e2e-better-auth-secret-min-16')
}
if (!map.has('BETTER_AUTH_URL')) {
  map.set('BETTER_AUTH_URL', `http://127.0.0.1:${E2E_PORTS.app}`)
}

writeFileSync(
  DEV_VARS_PATH,
  [
    '# e2e secrets (prepare-dev-vars.ts / global-setup may restore after tests)',
    ...[...map.entries()].map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n'),
)
console.log('[e2e] wrote .dev.vars for workerd')
