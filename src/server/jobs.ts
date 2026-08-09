import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

export type VideoJobRow = {
  id: string
  prompt: string
  status: string
  videoUrl: string | null
  createdAt: string
  updatedAt: string
}

async function requireUserId(): Promise<string> {
  if (process.env['E2E_BYPASS_AUTH'] === '1') {
    return 'e2e-user'
  }
  const { auth } = await import('../auth/server.ts')
  const session = await auth.api.getSession({
    headers: getRequest().headers,
  })
  if (!session?.user?.id) {
    throw new Error('Sign in required')
  }
  return session.user.id
}

/**
 * List the current user's recent video jobs (Postgres index — not live DO status).
 */
export const listMyJobs = createServerFn({ method: 'GET' })
  .validator(z.object({ limit: z.number().int().min(1).max(50).optional() }))
  .handler(async ({ data }): Promise<VideoJobRow[]> => {
    if (process.env['E2E_BYPASS_AUTH'] === '1') {
      return []
    }

    const userId = await requireUserId()
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
  if (process.env['E2E_BYPASS_AUTH'] === '1') return

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
