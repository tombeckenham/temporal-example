import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const JOURNAL_PATH = join('drizzle', 'meta', '_journal.json')

type Journal = {
  entries: Array<{ tag: string }>
}

function localMigrationCount(): number {
  const raw = readFileSync(JOURNAL_PATH, 'utf8')
  const journal = JSON.parse(raw) as Journal
  return journal.entries.length
}

function sqlFiles(): string[] {
  return readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * If this DB was migrated by a newer/different checkout (more applied
 * migrations than local journal), drop and recreate public so migrate is clean.
 */
export async function reconcileAndMigrate(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    const expected = localMigrationCount()
    let applied = 0
    try {
      const rows = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM drizzle.__drizzle_migrations
      `
      applied = Number(rows[0]?.count ?? 0)
    } catch {
      // table missing — fresh DB
      applied = 0
    }

    if (applied > expected) {
      console.log(
        `[e2e:db] applied migrations (${applied}) > local journal (${expected}); resetting schema`,
      )
      await sql.unsafe('DROP SCHEMA public CASCADE')
      await sql.unsafe('CREATE SCHEMA public')
    } else if (applied > 0 && sqlFiles().length < applied) {
      console.log(
        '[e2e:db] fewer SQL files than applied migrations; resetting schema',
      )
      await sql.unsafe('DROP SCHEMA public CASCADE')
      await sql.unsafe('CREATE SCHEMA public')
    }
  } finally {
    await sql.end({ timeout: 5 })
  }

  console.log('[e2e:db] running drizzle migrate…')
  execFileSync('bun', ['run', 'db:migrate'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    cwd: process.cwd(),
  })
}

/** Wipe app data; keep schema + drizzle journal. */
export async function truncateAppData(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    // Order doesn't matter with CASCADE; listed for clarity
    await sql.unsafe(`
      TRUNCATE TABLE
        video_job,
        session,
        account,
        verification,
        "user"
      RESTART IDENTITY CASCADE
    `)
    console.log('[e2e:db] truncated app tables')
  } catch (err) {
    // Tables may not exist yet on a half-failed migrate — surface clearly
    throw new Error(
      `truncateAppData failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}
