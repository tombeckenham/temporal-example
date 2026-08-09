import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { E2E_USER_ID, isAuthBypassed } from './authBypass.ts'
import { ownsJob } from './jobAccess.ts'

/**
 * Auth middleware for server functions: resolves the Better Auth session and
 * passes the authenticated userId to handlers via context. Rejects
 * signed-out callers. Chain with `.middleware([authMiddleware])` — handlers
 * read `context.userId` instead of resolving the session themselves.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    if (isAuthBypassed()) {
      return next({ context: { userId: E2E_USER_ID } })
    }

    // Dynamic import — avoids loading Better Auth / Postgres on the e2e hot path
    // (Workers runtime has had Buffer issues with some auth deps).
    const { auth } = await import('../auth/server.ts')
    const session = await auth.api.getSession({
      headers: getRequest().headers,
    })
    const userId = session?.user.id
    if (!userId) {
      throw new Error('Sign in required')
    }
    return next({ context: { userId } })
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
    if (
      !isAuthBypassed() &&
      !(await ownsJob(context.userId, data.workflowId))
    ) {
      // Same message as a genuinely missing workflow — no existence probing
      throw new Error(`Workflow not found: ${data.workflowId}`)
    }
    return next()
  })
