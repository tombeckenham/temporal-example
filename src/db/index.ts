import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getEnv } from '../server/env.ts'
import { perRequest } from '../server/requestScope.ts'
import * as schema from './schema.ts'

/**
 * Drizzle client for Postgres (PlanetScale), created once per request.
 *
 * A Postgres client owns a socket, and Workers forbids using an I/O object
 * created by one request from another request's handler. Caching the client in
 * module scope therefore fails on the *second* request with "Cannot perform
 * I/O on behalf of a different request". Hyperdrive pools connections on
 * Cloudflare's side, so a fresh client per request costs no connection setup.
 *
 * prepare: false is required for PgBouncer / transaction pooling (port 6432).
 */
function resolveDatabaseUrl(): string {
  const url = getEnv().HYPERDRIVE?.connectionString ?? getEnv()['DATABASE_URL']
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (PlanetScale Postgres or Hyperdrive connection string)',
    )
  }
  // Strip accidental surrounding quotes from .env paste
  return url.replace(/^['"]|['"]$/g, '')
}

function createClient() {
  const sql = postgres(resolveDatabaseUrl(), {
    prepare: false,
    max: 5,
    ssl: 'require',
  })
  return drizzle(sql, { schema })
}

/** The current request's client. Connections close with the request. */
export const getDb = perRequest(createClient)
