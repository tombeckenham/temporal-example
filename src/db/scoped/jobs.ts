/**
 * Scoped video_job methods. Every query filters on the owning userId, so a
 * caller cannot read or mutate another user's job even if it passes an
 * attacker-supplied workflowId.
 */
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../index.ts'
import { videoJob } from '../schema.ts'

export type VideoJobRow = {
  id: string
  prompt: string
  status: string
  videoUrl: string | null
  createdAt: string
  updatedAt: string
}

export function createJobsMethods(userId: string) {
  return {
    /** The user's recent jobs (Postgres index — not live DO status). */
    async list(options?: {
      limit?: number | undefined
    }): Promise<VideoJobRow[]> {
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
        .limit(options?.limit ?? 20)

      return rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        status: row.status,
        videoUrl: row.videoUrl,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))
    },

    async create(input: { workflowId: string; prompt: string }): Promise<void> {
      await getDb().insert(videoJob).values({
        id: input.workflowId,
        userId,
        prompt: input.prompt,
        status: 'running',
      })
    },

    async markFailed(workflowId: string): Promise<void> {
      await getDb()
        .update(videoJob)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(videoJob.id, workflowId), eq(videoJob.userId, userId)))
    },

    /** True when this user owns `workflowId`. */
    async owns(workflowId: string): Promise<boolean> {
      const row = (
        await getDb()
          .select({ id: videoJob.id })
          .from(videoJob)
          .where(and(eq(videoJob.id, workflowId), eq(videoJob.userId, userId)))
          .limit(1)
      )[0]
      return row !== undefined
    },
  }
}
