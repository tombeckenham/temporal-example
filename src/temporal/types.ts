/** Shared types for the video generation workflow (safe for workflow sandbox). */

export type VideoPhase =
  'enhancing' | 'starting' | 'generating' | 'completed' | 'failed'

export type VideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** Subset of Grok Imagine sizes exposed in the UI */
export const VIDEO_SIZES = [
  '16:9_480p',
  '16:9_720p',
  '9:16_480p',
  '1:1_480p',
] as const

export type VideoSize = (typeof VIDEO_SIZES)[number]

export interface GenerateVideoInput {
  /** User's original prompt */
  prompt: string
  /** Clip length in seconds (1–15 for Grok Imagine) */
  duration: number
  /** Aspect ratio + resolution, e.g. "16:9_480p" */
  size: VideoSize
  /** Run Grok text model to polish the prompt before video gen */
  enhancePrompt: boolean
}

export interface VideoWorkflowStatus {
  phase: VideoPhase
  prompt: string
  enhancedPrompt?: string | undefined
  jobId?: string | undefined
  jobStatus?: VideoJobStatus | undefined
  progress?: number | undefined
  videoUrl?: string | undefined
  error?: string | undefined
  /** Human-readable step description for the UI */
  message: string
}

export interface GenerateVideoResult {
  videoUrl: string
  enhancedPrompt: string
  jobId: string
  duration: number
}

/** Default Temporal task queue (local dev + production). */
export const TASK_QUEUE = 'video-generation'

/**
 * Queue this process should poll / start on.
 * Override with TEMPORAL_TASK_QUEUE (e.g. `video-generation-e2e` for Playwright).
 * Node-only — do not call from workflow sandbox code.
 */
export function resolveTaskQueue(): string {
  const fromEnv = process.env['TEMPORAL_TASK_QUEUE']?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : TASK_QUEUE
}
