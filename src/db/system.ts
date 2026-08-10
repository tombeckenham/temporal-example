import { and, asc, eq, lt } from 'drizzle-orm'
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

/**
 * Liveness signal: bump updated_at on a running row when any status webhook
 * arrives, so "stale" means "no signal for N minutes" — not "started N
 * minutes ago". Keeps the reconciler's candidate set O(actually suspicious).
 */
export async function touchRunningVideoJob(workflowId: string): Promise<void> {
  await getDb()
    .update(videoJob)
    .set({ updatedAt: new Date() })
    .where(and(eq(videoJob.id, workflowId), eq(videoJob.status, 'running')))
}

/**
 * Running rows that have not been touched since `olderThan` — candidates for
 * reconciliation against Temporal (cron path, no session).
 */
export async function listStaleRunningJobs(
  olderThan: Date,
  limit: number,
): Promise<Array<{ id: string; prompt: string }>> {
  return getDb()
    .select({ id: videoJob.id, prompt: videoJob.prompt })
    .from(videoJob)
    .where(
      and(eq(videoJob.status, 'running'), lt(videoJob.updatedAt, olderThan)),
    )
    .orderBy(asc(videoJob.updatedAt))
    .limit(limit)
}
