import { eq } from 'drizzle-orm'
import { getDb } from './index.ts'
import { videoJob } from './schema.ts'

/**
 * Deliberately *unscoped* writes: these run on the internal webhook path
 * (Temporal → edge), which has no session. Authorization there is the HMAC
 * signature over the request body, verified before this is reached, and the
 * row is addressed by workflowId. Anything with a session user must go
 * through createScopedDb instead.
 */
export async function updateVideoJobStatus(input: {
  workflowId: string
  status: string
  videoUrl?: string
  r2Key?: string
}): Promise<void> {
  const patch: {
    status: string
    updatedAt: Date
    videoUrl?: string
    r2Key?: string
  } = {
    status: input.status,
    updatedAt: new Date(),
  }
  if (input.videoUrl !== undefined) patch.videoUrl = input.videoUrl
  if (input.r2Key !== undefined) patch.r2Key = input.r2Key

  await getDb()
    .update(videoJob)
    .set(patch)
    .where(eq(videoJob.id, input.workflowId))
}
