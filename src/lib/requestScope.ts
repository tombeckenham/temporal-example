import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-request singletons for anything that owns request-bound I/O.
 *
 * Workers rejects use of an I/O object (a Postgres socket, a stream) created
 * by one request from another request's handler, so a module-level cache of
 * such a value breaks on the *second* request in an isolate. Values cached
 * here live and die with the request that created them.
 */
const store = new AsyncLocalStorage<Map<() => unknown, unknown>>()

/** Opens the scope. Call once per request, in the Workers entry. */
export function runInRequestScope<T>(fn: () => T): T {
  return store.run(new Map(), fn)
}

/**
 * Wraps `create` so it runs at most once per request, keyed by the factory
 * itself. Outside a scope — a deferred stream callback the runtime resumes on
 * its own — it creates a fresh value rather than sharing another request's.
 */
export function perRequest<T>(create: () => T): () => T {
  return () => {
    const cache = store.getStore()
    if (!cache) return create()
    if (!cache.has(create)) cache.set(create, create())
    return cache.get(create) as T
  }
}
