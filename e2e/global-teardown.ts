/**
 * Belt-and-suspenders dispose if e2e/run.ts state file remains.
 * Primary teardown lives in e2e/run.ts.
 */
import { teardownE2eDatabaseFromStateFile } from './db-teardown.ts'

export default async function globalTeardown(): Promise<void> {
  // run.ts already disposes; this is a no-op when state file is gone
  await teardownE2eDatabaseFromStateFile()
}
