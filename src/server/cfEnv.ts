/**
 * Holds the current Cloudflare env so code outside the fetch handler can reach
 * non-string bindings (e.g. the EMAIL send binding). Set once per request in
 * the Workers entry; string secrets are still mirrored into process.env there.
 */
let currentEnv: Cloudflare.Env | undefined

export function setCfEnv(env: Cloudflare.Env): void {
  currentEnv = env
}

export function getCfEnv(): Cloudflare.Env | undefined {
  return currentEnv
}
