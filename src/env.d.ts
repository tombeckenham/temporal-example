/**
 * Extra Worker secrets/bindings not always present in generated wrangler types.
 * Re-run `bun run cf-typegen` after wrangler.jsonc changes, then merge if needed.
 */
declare namespace Cloudflare {
  interface Env {
    DATABASE_URL?: string
    /** Optional Hyperdrive binding — preferred over raw DATABASE_URL in production */
    HYPERDRIVE?: Hyperdrive
    BETTER_AUTH_SECRET?: string
    BETTER_AUTH_URL?: string
    EMAIL_FROM?: string
    EMAIL_MODE?: string
    STATUS_WEBHOOK_SECRET?: string
    TEMPORAL_STARTER_URL?: string
    TEMPORAL_STARTER_SECRET?: string
    E2E_BYPASS_AUTH?: string
    /** Cloudflare Email Service send binding */
    EMAIL?: {
      send: (opts: {
        to: string | { email: string } | Array<string | { email: string }>
        from: string | { email: string }
        subject: string
        text?: string
        html?: string
      }) => Promise<unknown>
    }
  }
}
