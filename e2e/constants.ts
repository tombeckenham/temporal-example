/**
 * Shared e2e ports + secrets (must match e2e worker and workerd).
 *
 * Isolated from local `bun run dev` / `bun run worker`:
 * - app :3100  (dev uses :3000)
 * - gateway :8789  (dev uses :8788)
 * - task queue `video-generation-e2e` (dev uses `video-generation`)
 *
 * Same local Temporal server is fine — different queues do not steal work.
 */
export const E2E_PORTS = {
  aimock: 4010,
  gateway: 8789,
  app: 3100,
} as const

/** Temporal task queue only the e2e worker polls. */
export const E2E_TASK_QUEUE = 'video-generation-e2e'

export const E2E_SECRETS = {
  TEMPORAL_STARTER_SECRET: 'dev-starter-secret-change-me',
  STATUS_WEBHOOK_SECRET: 'dev-webhook-secret-change-me',
  /** Required for fixed OTP path in Better Auth (DEV only). */
  E2E_TEST_SECRET: 'e2e-test-secret-min-16-chars',
} as const

/** Fixed OTP when `E2E_FIXED_OTP=1` (DEV builds only). */
export const E2E_FIXED_OTP = '424242'

export const E2E_USER_EMAIL = 'e2e@example.com'
export const E2E_USER_NAME = 'E2E User'

/** Written by db-setup / run.ts; read by teardown. */
export const E2E_DB_STATE_PATH = '.e2e-db.json'

/** Backup of the user's `.dev.vars` for the duration of an e2e run. */
export const E2E_DEV_VARS_BACKUP_PATH = '.dev.vars.e2e-backup'
