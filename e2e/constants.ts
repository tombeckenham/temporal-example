/** Shared e2e ports + secrets (must match worker and workerd). */
export const E2E_PORTS = {
  aimock: 4010,
  gateway: 8788,
  app: 3000,
} as const

export const E2E_SECRETS = {
  TEMPORAL_STARTER_SECRET: 'dev-starter-secret-change-me',
  STATUS_WEBHOOK_SECRET: 'dev-webhook-secret-change-me',
} as const
