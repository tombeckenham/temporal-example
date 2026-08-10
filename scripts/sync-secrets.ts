/**
 * Project Doppler (or env) secrets onto platform runtimes.
 *
 * Workers and Fly cannot call Doppler at request time — this script is the
 * CI / ops path that keeps their secret stores in sync with the SoT.
 *
 * Usage (env must already contain the values — typically via doppler run):
 *   bun scripts/sync-secrets.ts edge
 *   bun scripts/sync-secrets.ts fly
 *   bun scripts/sync-secrets.ts all
 *
 * Never logs secret values.
 */

import { spawnSync } from 'node:child_process'

/** Edge Worker (Cloudflare) — auth, DB, Temporal gateway client, webhooks. */
const EDGE_KEYS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'EMAIL_FROM',
  'EMAIL_MODE',
  'STATUS_WEBHOOK_SECRET',
  'TEMPORAL_STARTER_URL',
  'TEMPORAL_STARTER_SECRET',
] as const

/** Node Temporal worker (Fly) — xAI, Temporal Cloud, status push to edge. */
const FLY_KEYS = [
  'XAI_API_KEY',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_NAMESPACE',
  'TEMPORAL_API_KEY',
  'TEMPORAL_STARTER_SECRET',
  'STATUS_WEBHOOK_URL',
  'STATUS_WEBHOOK_SECRET',
] as const

type SecretKey = (typeof EDGE_KEYS)[number] | (typeof FLY_KEYS)[number]

function requireKeys(keys: readonly string[], label: string): void {
  const missing = keys.filter((k) => {
    const v = process.env[k]
    return v === undefined || v === ''
  })
  if (missing.length > 0) {
    console.error(
      `[sync-secrets] ${label}: missing required env: ${missing.join(', ')}`,
    )
    process.exit(1)
  }
}

function payload(keys: readonly SecretKey[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = process.env[k]
    if (v === undefined || v === '') {
      throw new Error(`missing ${k}`)
    }
    out[k] = v
  }
  return out
}

function run(
  cmd: string,
  args: string[],
  opts: { input?: string } = {},
): void {
  const result = spawnSync(cmd, args, {
    stdio: opts.input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: opts.input,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.error) {
    console.error(
      `[sync-secrets] failed to spawn ${cmd}:`,
      result.error.message,
    )
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(
      `[sync-secrets] ${cmd} ${args.join(' ')} exited ${result.status}`,
    )
    process.exit(result.status ?? 1)
  }
}

function syncEdge(): void {
  requireKeys(EDGE_KEYS, 'edge')
  requireKeys(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], 'edge auth')

  const body = JSON.stringify(payload(EDGE_KEYS))
  console.log(
    `[sync-secrets] edge: wrangler secret bulk (${EDGE_KEYS.length} keys: ${EDGE_KEYS.join(', ')})`,
  )
  // Prefer bunx so local wrangler version matches package.json
  run('bunx', ['wrangler', 'secret', 'bulk'], { input: body })
  console.log('[sync-secrets] edge: ok')
}

function syncFly(): void {
  requireKeys(FLY_KEYS, 'fly')
  requireKeys(['FLY_API_TOKEN'], 'fly auth')

  const lines = FLY_KEYS.map((k) => `${k}=${process.env[k]}`).join('\n') + '\n'
  console.log(
    `[sync-secrets] fly: flyctl secrets import --stage (${FLY_KEYS.length} keys: ${FLY_KEYS.join(', ')})`,
  )
  // --stage: apply on the next `fly deploy` (CI runs deploy right after) so we
  // don't roll machines twice.
  run(
    'flyctl',
    ['secrets', 'import', '--stage', '--app', 'video-at-scale-worker'],
    { input: lines },
  )
  console.log('[sync-secrets] fly: ok')
}

const target = process.argv[2] ?? 'all'
if (target === 'edge') {
  syncEdge()
} else if (target === 'fly') {
  syncFly()
} else if (target === 'all') {
  syncEdge()
  syncFly()
} else {
  console.error('Usage: bun scripts/sync-secrets.ts [edge|fly|all]')
  process.exit(1)
}
