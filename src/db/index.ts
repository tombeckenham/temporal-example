import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

/**
 * Shared Drizzle client for Postgres (PlanetScale).
 * prepare: false is required for PgBouncer / transaction pooling (port 6432).
 */
function createClient() {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL is required (PlanetScale Postgres connection string)')
  }
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
export const db = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver)
  },
})
