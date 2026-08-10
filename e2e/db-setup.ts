/**
 * Resolve e2e Postgres: Docker per worktree (default local) or PlanetScale branch (CI).
 *
 * Usage: bun run e2e/db-setup.ts
 * Writes DATABASE_URL to stdout line `DATABASE_URL=...` and state to .e2e-db.json
 */
import { writeFileSync } from 'node:fs'
import { E2E_DB_STATE_PATH } from './constants.ts'
import { disposeDockerDatabase, setupDockerDatabase } from './db-docker.ts'
import {
  disposePlanetScaleDatabase,
  setupPlanetScaleDatabase,
} from './db-planetscale.ts'
import type { E2eDbBackend, E2eDbState } from './db-types.ts'

export type { E2eDbState }

function resolveBackend(): E2eDbBackend {
  const explicit = process.env['E2E_DB_BACKEND']?.trim()
  if (explicit === 'docker' || explicit === 'planetscale') return explicit
  if (process.env['CI'] === 'true' || process.env['CI'] === '1') {
    return 'planetscale'
  }
  return 'docker'
}

export async function setupE2eDatabase(): Promise<E2eDbState> {
  const backend = resolveBackend()
  console.log(`[e2e:db] backend=${backend}`)
  const state =
    backend === 'planetscale'
      ? await setupPlanetScaleDatabase()
      : await setupDockerDatabase()

  writeFileSync(E2E_DB_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
  return state
}

export async function disposeE2eDatabase(state: E2eDbState): Promise<void> {
  if (state.backend === 'planetscale') {
    await disposePlanetScaleDatabase(state)
    return
  }
  await disposeDockerDatabase(state)
}

if (import.meta.main) {
  const state = await setupE2eDatabase()
  process.stdout.write(`DATABASE_URL=${state.databaseUrl}\n`)
}
