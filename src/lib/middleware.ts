import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getAuth } from '../auth/server.ts'
import { createScopedDb } from '../db/scoped.ts'

/**
 * Auth middleware for server functions: resolves the Better Auth session and
 * passes the authenticated userId — plus a user-scoped db — to handlers via
 * context. Rejects signed-out callers. Chain with
 * `.middleware([authMiddleware])` and read `context.scopedDb` instead of
 * querying with a hand-written user filter.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const session = await getAuth().api.getSession({
      headers: getRequest().headers,
    })
    const userId = session?.user.id
    if (!userId) {
      throw new Error('Sign in required')
    }
    return next({ context: { userId, scopedDb: createScopedDb(userId) } })
  },
)

/**
 * Ownership middleware for workflow-scoped server functions: requires auth
 * (via authMiddleware) and verifies the caller owns the video_job row for
 * the workflowId in the payload. Its validator composes with the server
 * function's own, so callers must always send a workflowId.
 */
export const jobOwnerMiddleware = createMiddleware({ type: 'function' })
  .middleware([authMiddleware])
  .validator(z.object({ workflowId: z.string().min(1) }))
  .server(async ({ next, data, context }) => {
    if (!(await context.scopedDb.jobs.owns(data.workflowId))) {
      // Same message as a genuinely missing workflow — no existence probing
      throw new Error(`Workflow not found: ${data.workflowId}`)
    }
    return next()
  })
