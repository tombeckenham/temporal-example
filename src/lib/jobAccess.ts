import { getAuth } from '../auth/server.ts'
import { createScopedDb } from '../db/scoped.ts'

/**
 * Per-user authorization for job status / video reads (/ws/jobs, /api/jobs,
 * /api/videos): the session user must own the video_job row.
 * Returns null when access is allowed, otherwise the Response to send.
 */
export async function authorizeJobAccess(
  request: Request,
  workflowId: string,
): Promise<Response | null> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  const userId = session?.user.id
  if (!userId) {
    return new Response('Sign in required', { status: 401 })
  }

  if (!(await createScopedDb(userId).jobs.owns(workflowId))) {
    // 404 rather than 403 so workflowIds cannot be probed for existence
    return new Response('Not found', { status: 404 })
  }
  return null
}
