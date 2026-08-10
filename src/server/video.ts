import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { newId } from '../lib/id.ts'
import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { VIDEO_SIZES } from '../temporal/types.ts'
import { isAuthBypassed } from './authBypass.ts'
import { authMiddleware, jobOwnerMiddleware } from './middleware.ts'

const generateVideoInputSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required'),
  duration: z.number().int().min(1).max(15),
  size: z.enum(VIDEO_SIZES).default('16:9_480p'),
  enhancePrompt: z.boolean(),
})

const workflowIdSchema = z.object({
  workflowId: z.string().min(1, 'workflowId is required'),
})

function starterBaseUrl(): string {
  return (
    process.env['TEMPORAL_STARTER_URL'] ??
    process.env['TEMPORAL_GATEWAY_URL'] ??
    'http://127.0.0.1:8788'
  )
}

function starterSecret(): string {
  const secret = process.env['TEMPORAL_STARTER_SECRET']
  if (!secret) {
    throw new Error(
      'TEMPORAL_STARTER_SECRET is required (shared secret for edge → Temporal gateway)',
    )
  }
  return secret
}

async function starterFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = starterBaseUrl().replace(/\/$/, '')
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${starterSecret()}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
}

/**
 * Start a video workflow via the Node Temporal gateway.
 * Auth is enforced by authMiddleware (bypassed only in dev e2e builds).
 */
export const startVideoWorkflow = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(generateVideoInputSchema)
  .handler(async ({ data, context }) => {
    const { userId } = context
    const workflowId = newId()
    const recordJob = !isAuthBypassed()

    if (recordJob) {
      const { getDb } = await import('../db/index.ts')
      const { videoJob } = await import('../db/schema.ts')
      await getDb().insert(videoJob).values({
        id: workflowId,
        userId,
        prompt: data.prompt,
        status: 'running',
      })
    }

    const response = await starterFetch('/workflows/start', {
      method: 'POST',
      body: JSON.stringify({
        workflowId,
        prompt: data.prompt,
        duration: data.duration,
        size: data.size,
        enhancePrompt: data.enhancePrompt,
      }),
    })

    if (!response.ok) {
      if (recordJob) {
        const { getDb } = await import('../db/index.ts')
        const { videoJob } = await import('../db/schema.ts')
        await getDb()
          .update(videoJob)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(videoJob.id, workflowId))
      }
      const text = await response.text()
      throw new Error(
        `Failed to start workflow (${response.status}): ${text || response.statusText}`,
      )
    }

    const body = await response.json<{ workflowId: string }>()
    return { workflowId: body.workflowId }
  })

/**
 * Optional Temporal query via gateway (ops / fallback).
 * Auth + per-user ownership are enforced by jobOwnerMiddleware.
 */
export const getVideoWorkflowStatus = createServerFn({ method: 'GET' })
  .middleware([jobOwnerMiddleware])
  .validator(workflowIdSchema)
  .handler(async ({ data }) => {
    const response = await starterFetch(
      `/workflows/${encodeURIComponent(data.workflowId)}/status`,
    )

    if (response.status === 404) {
      throw new Error(`Workflow not found: ${data.workflowId}`)
    }
    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `Failed to query workflow (${response.status}): ${text || response.statusText}`,
      )
    }

    return await response.json<{
      workflowId: string
      executionStatus: string
      status: VideoWorkflowStatus
    }>()
  })
