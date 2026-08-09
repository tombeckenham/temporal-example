import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

/**
 * Shared Drizzle client for Postgres (PlanetScale).
 * prepare: false is required for PgBouncer / transaction pooling (port 6432).
 *
 * Production Workers: prefer Cloudflare Hyperdrive — set `HYPERDRIVE.connectionString`
 * (binding) or `DATABASE_URL` to the Hyperdrive connection string.
 */
function resolveDatabaseUrl(): string {
  // Hyperdrive injects a local connection string on Workers
  const hyperdrive =
    typeof process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING'] ===
    'string'
      ? process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING']
      : undefined
  const url = process.env['DATABASE_URL'] ?? hyperdrive
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (PlanetScale Postgres or Hyperdrive connection string)',
    )
  }
  // Strip accidental surrounding quotes from .env paste
  return url.replace(/^['"]|['"]$/g, '')
}

function createClient() {
  const url = resolveDatabaseUrl()
  const sql = postgres(url, {
    prepare: false,
    max: 5,
    ssl: 'require',
  })
  return drizzle(sql, { schema })
}

let _db: ReturnType<typeof createClient> | undefined

export function getDb() {
  if (!_db) {
    _db = createClient()
  }
  return _db
}

/** @deprecated use getDb() — lazy so import does not require DATABASE_URL at build time */
export const db = new Proxy(
  Object.create(null) as ReturnType<typeof createClient>,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getDb(), prop, receiver) as unknown
    },
  },
)
