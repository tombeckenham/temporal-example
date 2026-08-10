import { createServerOnlyFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

/**
 * The Worker's env: vars, secrets *and* object bindings (EMAIL, HYPERDRIVE,
 * R2, Durable Objects). A superset of `process.env`, which carries strings
 * only — hence one accessor rather than two.
 *
 * Never copy the result into module scope. State set during one request is
 * shared with every later request in the isolate, and any I/O object in it is
 * unusable there ("Cannot perform I/O on behalf of a different request").
 * Reading a binding is free anywhere; calling its methods needs a request.
 *
 * Worker-only — the Temporal worker is a separate Node process and reads
 * process.env directly (`cloudflare:workers` does not resolve there).
 */
export const getEnv = createServerOnlyFn(() => env)
