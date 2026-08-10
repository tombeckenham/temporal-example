import { createJobsMethods } from './scoped/jobs.ts'

/**
 * User-scoped database access. Handlers get one of these from authMiddleware
 * (`context.scopedDb`) and never write their own `eq(videoJob.userId, …)` —
 * the ownership filter lives in one place instead of at every call site.
 *
 * Only this module, ./system.ts and auth/server.ts may import getDb (enforced
 * by no-restricted-imports in eslint.config.js).
 */
export function createScopedDb(userId: string) {
  return {
    userId,
    jobs: createJobsMethods(userId),
  }
}

export type ScopedDb = ReturnType<typeof createScopedDb>
