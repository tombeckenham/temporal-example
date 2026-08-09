import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { isAuthBypassed } from './authBypass.ts'
import { authMiddleware } from './middleware.ts'

export type VideoJobRow = {
  id: string
  prompt: string
  status: string
  videoUrl: string | null
  createdAt: string
  updatedAt: string
}

/**
 * List the current user's recent video jobs (Postgres index — not live DO status).
 * Auth is enforced by authMiddleware.
 */
export const listMyJobs = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ limit: z.number().int().min(1).max(50).optional() }))
  .handler(async ({ data, context }): Promise<VideoJobRow[]> => {
    if (isAuthBypassed()) {
      // e2e runs without a database — the jobs list is always empty
      return []
    }

    const { userId } = context
    const limit = data.limit ?? 20
    const { getDb } = await import('../db/index.ts')
    const { videoJob } = await import('../db/schema.ts')

    const rows = await getDb()
      .select({
        id: videoJob.id,
        prompt: videoJob.prompt,
        status: videoJob.status,
        videoUrl: videoJob.videoUrl,
        createdAt: videoJob.createdAt,
        updatedAt: videoJob.updatedAt,
      })
      .from(videoJob)
      .where(eq(videoJob.userId, userId))
      .orderBy(desc(videoJob.createdAt))
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      status: row.status,
      videoUrl: row.videoUrl,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  })

/**
 * Best-effort update of video_job when JobRoom receives a terminal status.
 * Called from edge webhooks — never throws into the webhook path.
 */
export async function syncVideoJobFromStatus(input: {
  workflowId: string
  status: string
  videoUrl?: string
  r2Key?: string
}): Promise<void> {
  if (!process.env['DATABASE_URL']) return
  if (isAuthBypassed()) return

  try {
    const { getDb } = await import('../db/index.ts')
    const { videoJob } = await import('../db/schema.ts')
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
  } catch (err) {
    console.error('[syncVideoJobFromStatus]', input.workflowId, err)
  }
}
