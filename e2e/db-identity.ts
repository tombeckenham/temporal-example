import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'

/** Stable short id for this worktree (path-based, not git branch). */
export function worktreeKey(): string {
  const cwd = realpathSync(process.cwd())
  return createHash('sha256').update(cwd).digest('hex').slice(0, 8)
}

/** Docker host port unique to this worktree (55432–56431). */
export function dockerPortFor(key: string): number {
  const n = Number.parseInt(key.slice(0, 4), 16)
  if (Number.isNaN(n)) {
    throw new Error(`Invalid worktree key for port: ${key}`)
  }
  return 55_432 + (n % 1000)
}
