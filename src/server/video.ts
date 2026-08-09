import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { VIDEO_SIZES } from '../temporal/types.ts'

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
      ...(init?.headers ?? {}),
    },
  })
}

async function requireUserId(): Promise<string> {
  if (process.env['E2E_BYPASS_AUTH'] === '1') {
    return 'e2e-user'
  }

  // Dynamic import — avoids loading Better Auth / Postgres on the e2e hot path
  // (Workers runtime has had Buffer issues with some auth deps).
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
 * Start a video workflow via the Node Temporal gateway.
 * Requires a Better Auth session (unless E2E_BYPASS_AUTH=1).
 */
export const startVideoWorkflow = createServerFn({ method: 'POST' })
  .validator(generateVideoInputSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const workflowId = `video-${nanoid(10)}`
    const recordJob = process.env['E2E_BYPASS_AUTH'] !== '1'

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

    const body = (await response.json()) as { workflowId: string }
    return { workflowId: body.workflowId }
  })

/**
 * Optional Temporal query via gateway (ops / fallback).
 */
export const getVideoWorkflowStatus = createServerFn({ method: 'GET' })
  .validator(workflowIdSchema)
  .handler(async ({ data }) => {
    await requireUserId()

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

    return (await response.json()) as {
      workflowId: string
      executionStatus: string
      status: VideoWorkflowStatus
    }
  })
