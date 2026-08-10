import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import postgres from 'postgres'
import { dockerPortFor, worktreeKey } from './db-identity.ts'
import { reconcileAndMigrate, truncateAppData } from './db-migrate.ts'
import type { E2eDbState } from './db-types.ts'

const PG_IMAGE = 'postgres:16-alpine'
const PG_USER = 'e2e'
const PG_PASSWORD = 'e2e'
const PG_DB = 'e2e'

function docker(args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function containerExists(name: string): boolean {
  try {
    docker(['container', 'inspect', name])
    return true
  } catch {
    return false
  }
}

function containerRunning(name: string): boolean {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', name]) === 'true'
  } catch {
    return false
  }
}

async function waitForPostgres(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 2 })
    try {
      await sql`SELECT 1`
      await sql.end({ timeout: 2 })
      return
    } catch {
      try {
        await sql.end({ timeout: 1 })
      } catch {
        // ignore
      }
      await delay(400)
    }
  }
  throw new Error(`Timed out waiting for Postgres at ${url}`)
}

export async function setupDockerDatabase(): Promise<E2eDbState> {
  const id = worktreeKey()
  const port = dockerPortFor(id)
  const name = `video-at-scale-e2e-${id}`
  const databaseUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${PG_DB}?sslmode=disable`

  if (containerExists(name)) {
    if (!containerRunning(name)) {
      console.log(`[e2e:db] starting existing container ${name}`)
      docker(['start', name])
    } else {
      console.log(`[e2e:db] reusing container ${name} on :${port}`)
    }
  } else {
    console.log(`[e2e:db] creating Postgres container ${name} on :${port}`)
    try {
      docker([
        'run',
        '-d',
        '--name',
        name,
        '-e',
        `POSTGRES_USER=${PG_USER}`,
        '-e',
        `POSTGRES_PASSWORD=${PG_PASSWORD}`,
        '-e',
        `POSTGRES_DB=${PG_DB}`,
        '-p',
        `${port}:5432`,
        PG_IMAGE,
      ])
    } catch (err) {
      throw new Error(
        `Failed to start Docker Postgres (${name} :${port}). Is Docker running? Port free?\n${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  await waitForPostgres(databaseUrl)
  await reconcileAndMigrate(databaseUrl)
  await truncateAppData(databaseUrl)

  return {
    backend: 'docker',
    id,
    databaseUrl,
  }
}

export async function disposeDockerDatabase(state: E2eDbState): Promise<void> {
  // Keep container for next run in this worktree; only wipe rows
  await truncateAppData(state.databaseUrl)
}
