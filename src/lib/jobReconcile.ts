import {
  listStaleRunningJobs,
  touchRunningVideoJob,
  updateVideoJobStatus,
} from '../db/system.ts'
import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { getEnv } from './env.ts'

/**
 * Cron reconciliation: heal video_job rows stuck at `running`.
 *
 * A row can wedge two ways — the terminal webhook never landed (edge was
 * unreachable longer than publishStatus retries), or the row was inserted but
 * the workflow never started / was purged. Both leave the UI showing a live
 * progress bar for a job that will never finish. This pass asks the Temporal
 * gateway for the truth and syncs Postgres + JobRoom to it.
 */

/**
 * Rows are "stale" after this long without a status webhook — every
 * non-terminal webhook bumps updated_at (see handleJobEvents), so this is
 * silence, not age. Confirmed-RUNNING rows are re-touched below, so each
 * healthy job is checked at most once per silence window.
 */
const STALE_AFTER_MS = 5 * 60_000
/** Rows fetched per run — a mass-wedge event drains in a few ticks. */
const BATCH_LIMIT = 500
/** Stop before the next cron tick fires (runs every 5 minutes). */
const TIME_BUDGET_MS = 4 * 60_000

interface GatewayStatus {
  workflowId: string
  executionStatus: string
  status: VideoWorkflowStatus
}

export async function reconcileStuckJobs(): Promise<void> {
  const env = getEnv()
  if (!env['DATABASE_URL']) return

  const base = env.TEMPORAL_STARTER_URL?.replace(/\/$/, '')
  const secret = env['TEMPORAL_STARTER_SECRET']
  if (!base || !secret) {
    console.warn('[reconcile] TEMPORAL_STARTER_URL/SECRET unset — skipping')
    return
  }

  const stale = await listStaleRunningJobs(
    new Date(Date.now() - STALE_AFTER_MS),
    BATCH_LIMIT,
  )
  if (stale.length === 0) return

  console.log(`[reconcile] checking ${stale.length} stale running job(s)`)
  const deadline = Date.now() + TIME_BUDGET_MS
  for (const row of stale) {
    if (Date.now() >= deadline) {
      console.warn('[reconcile] time budget exhausted — resuming next tick')
      return
    }
    await reconcileJob(base, secret, row)
  }
}

async function reconcileJob(
  base: string,
  secret: string,
  row: { id: string; prompt: string },
): Promise<void> {
  let res: Response
  try {
    res = await fetch(
      `${base}/workflows/${encodeURIComponent(row.id)}/status`,
      { headers: { authorization: `Bearer ${secret}` } },
    )
  } catch (err) {
    // Gateway down: nothing is trustworthy — try again next cron
    console.error('[reconcile] gateway unreachable', row.id, err)
    return
  }

  if (res.status === 404) {
    // No workflow behind this row (phantom, or purged after retention).
    // Either way it will never complete.
    const failed: VideoWorkflowStatus = {
      phase: 'failed',
      prompt: row.prompt,
      error: 'Workflow not found',
      message: 'Workflow not found — marked failed by reconciliation',
    }
    console.warn('[reconcile] workflow not found — marking failed', row.id)
    await updateVideoJobStatus({ workflowId: row.id, status: 'failed' })
    await notifyJobRoom(row.id, failed)
    return
  }

  if (!res.ok) {
    console.error('[reconcile] gateway error', row.id, res.status)
    return
  }

  const body = await res.json<GatewayStatus>()
  if (body.executionStatus === 'RUNNING') {
    // Verified alive: the check itself is a liveness signal, so the row
    // leaves the stale set until the next silence window
    await touchRunningVideoJob(row.id)
    return
  }

  // Workflow is closed. Trust its final projected status; a close without a
  // terminal phase (terminated, timed out) counts as failed.
  const terminal = body.status.phase === 'completed' ? 'completed' : 'failed'
  const finalStatus: VideoWorkflowStatus =
    terminal === 'completed'
      ? body.status
      : {
          ...body.status,
          phase: 'failed',
          error:
            body.status.error ??
            `Workflow ${body.executionStatus.toLowerCase()}`,
          message:
            body.status.error ??
            `Workflow ${body.executionStatus.toLowerCase()}`,
        }

  console.warn(`[reconcile] syncing ${row.id} → ${terminal}`)
  const patch: { workflowId: string; status: string; videoUrl?: string } = {
    workflowId: row.id,
    status: terminal,
  }
  if (finalStatus.videoUrl) patch.videoUrl = finalStatus.videoUrl
  await updateVideoJobStatus(patch)
  await notifyJobRoom(row.id, finalStatus)
}

/** Push the healed status to any open tabs watching this job. */
async function notifyJobRoom(
  workflowId: string,
  status: VideoWorkflowStatus,
): Promise<void> {
  const env = getEnv()
  const id = env.JOB_ROOM.idFromName(workflowId)
  await env.JOB_ROOM.get(id).notify({
    status,
    updatedAt: new Date().toISOString(),
  })
}
