import { updateVideoJobStatus } from '../db/system.ts'
import { getEnv } from './env.ts'

/**
 * Best-effort update of video_job when JobRoom receives a terminal status.
 * Called from edge webhooks — never throws into the webhook path.
 *
 * Kept out of jobs.ts: that module is imported by route components for its
 * server function, and a plain exported function like this one keeps its
 * Drizzle/Postgres imports in the client graph (server function *handlers*
 * are compiled away, plain exports are not).
 */
export async function syncVideoJobFromStatus(input: {
  workflowId: string
  status: string
  videoUrl?: string
  r2Key?: string
}): Promise<void> {
  if (!getEnv()['DATABASE_URL']) return

  try {
    await updateVideoJobStatus(input)
  } catch (err) {
    console.error('[syncVideoJobFromStatus]', input.workflowId, err)
  }
}
