import { createServerFn } from '@tanstack/react-start'
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

/**
 * Resolve Temporal starter base URL.
 * - Production edge: TEMPORAL_STARTER_URL (Node gateway)
 * - Local: defaults to http://127.0.0.1:8788
 */
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

/**
 * Start a video workflow via the Node Temporal gateway.
 * Edge never imports @temporalio/* (gRPC is not for Workers isolates).
 */
export const startVideoWorkflow = createServerFn({ method: 'POST' })
  .validator(generateVideoInputSchema)
  .handler(async ({ data }) => {
    const workflowId = `video-${nanoid(10)}`

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
 * Prefer JobRoom WebSocket + GET /api/jobs/:id for product UI.
 */
export const getVideoWorkflowStatus = createServerFn({ method: 'GET' })
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

    return (await response.json()) as {
      workflowId: string
      executionStatus: string
      status: VideoWorkflowStatus
    }
  })
