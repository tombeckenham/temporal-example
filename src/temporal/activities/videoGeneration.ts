import { generateVideo, getVideoJobStatus } from '@tanstack/ai'
import { grokVideo } from '@tanstack/ai-grok'
import type { VideoJobStatus, VideoSize } from '../types.ts'
import { xaiClientConfig } from './xaiConfig.ts'

const MODEL = 'grok-imagine-video' as const

function videoAdapter() {
  return grokVideo(MODEL, xaiClientConfig())
}

export interface StartVideoJobInput {
  prompt: string
  duration: number
  size: VideoSize
}

export interface PollVideoJobResult {
  status: VideoJobStatus
  progress?: number | undefined
  videoUrl?: string | undefined
  error?: string | undefined
}

/**
 * Activity: submit a Grok Imagine video job and return the provider job id.
 * Does NOT wait for completion — that is polled in a separate activity so the
 * workflow can sleep between polls (durable, replay-safe).
 */
export async function startVideoJob(input: StartVideoJobInput): Promise<string> {
  const { jobId } = await generateVideo({
    adapter: videoAdapter(),
    prompt: input.prompt,
    size: input.size,
    duration: input.duration,
  })

  if (!jobId) {
    throw new Error('Video API did not return a jobId')
  }

  return jobId
}

/**
 * Activity: check one video job once. Keep this short — Temporal retries
 * and workflow sleep handle the wait loop.
 */
export async function pollVideoJob(jobId: string): Promise<PollVideoJobResult> {
  const result = await getVideoJobStatus({
    adapter: videoAdapter(),
    jobId,
  })

  return {
    status: result.status,
    progress: result.progress,
    videoUrl: result.url,
    error: result.error,
  }
}
