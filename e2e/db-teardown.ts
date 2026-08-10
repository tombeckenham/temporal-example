/**
 * Dispose e2e DB from .e2e-db.json (truncate docker data or delete PS branch).
 * Usage: bun run e2e/db-teardown.ts
 */
import { readFileSync, unlinkSync } from 'node:fs'
import { E2E_DB_STATE_PATH } from './constants.ts'
import { disposeE2eDatabase } from './db-setup.ts'
import type { E2eDbState } from './db-types.ts'

export async function teardownE2eDatabaseFromStateFile(): Promise<void> {
  let raw: string
  try {
    raw = readFileSync(E2E_DB_STATE_PATH, 'utf8')
  } catch {
    console.log('[e2e:db] no state file; nothing to tear down')
    return
  }

  const state = JSON.parse(raw) as E2eDbState
  await disposeE2eDatabase(state)

  try {
    unlinkSync(E2E_DB_STATE_PATH)
  } catch {
    // ignore
  }
}

if (import.meta.main) {
  await teardownE2eDatabaseFromStateFile()
}
