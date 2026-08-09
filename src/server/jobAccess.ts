import { eq } from 'drizzle-orm'
import { isAuthBypassed } from './authBypass.ts'

/** True when `userId` owns the video_job row for `workflowId`. */
export async function ownsJob(
  userId: string,
  workflowId: string,
): Promise<boolean> {
  const { getDb } = await import('../db/index.ts')
  const { videoJob } = await import('../db/schema.ts')
  const row = (
    await getDb()
      .select({ userId: videoJob.userId })
      .from(videoJob)
      .where(eq(videoJob.id, workflowId))
      .limit(1)
  )[0]
  return row?.userId === userId
}

/**
 * Per-user authorization for job status / video reads (/ws/jobs, /api/jobs,
 * /api/videos): the session user must own the video_job row.
 * Returns null when access is allowed, otherwise the Response to send.
 */
export async function authorizeJobAccess(
  request: Request,
  workflowId: string,
): Promise<Response | null> {
  if (isAuthBypassed()) return null

  const { sessionFromRequest } = await import('./session.ts')
  const session = await sessionFromRequest(request)
  const userId = session?.user.id
  if (!userId) {
    return new Response('Sign in required', { status: 401 })
  }

  if (!(await ownsJob(userId, workflowId))) {
    // 404 rather than 403 so workflowIds cannot be probed for existence
    return new Response('Not found', { status: 404 })
  }
  return null
}
