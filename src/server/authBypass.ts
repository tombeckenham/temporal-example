/**
 * E2E auth bypass gate.
 *
 * Honored only in Vite dev-server builds (`import.meta.env.DEV`), which is a
 * build-time constant — a stray E2E_BYPASS_AUTH=1 var on a deployed Worker can
 * never disable auth because production bundles compile this to `false`.
 */
export function isAuthBypassed(): boolean {
  return import.meta.env.DEV && process.env['E2E_BYPASS_AUTH'] === '1'
}

/** Synthetic user id used everywhere the bypass is active. */
export const E2E_USER_ID = 'e2e-user'
