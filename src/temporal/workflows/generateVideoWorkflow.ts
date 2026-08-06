import {
  ApplicationFailure,
  defineQuery,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow'
import type * as activities from '../activities/index.ts'
import type {
  GenerateVideoInput,
  GenerateVideoResult,
  VideoWorkflowStatus,
} from '../types.ts'

/**
 * Query: read workflow progress without mutating state.
 * The UI polls this while the video job runs (minutes-long).
 */
export const statusQuery = defineQuery<VideoWorkflowStatus>('status')

const {
  enhancePrompt,
  startVideoJob,
  pollVideoJob,
} = proxyActivities<typeof activities>({
  // Short activities — start/poll are single HTTP calls
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
  },
})

/**
 * Durable video generation workflow.
 *
 * Why Temporal fits video gen:
 * - Generation takes minutes; the process can crash and resume
 * - Polling lives in the workflow (sleep + activity), not a fragile Node loop
 * - Queries expose live status to the UI without side effects
 * - Activities are the only place that talks to xAI / TanStack AI
 */
export async function generateVideoWorkflow(
  input: GenerateVideoInput,
): Promise<GenerateVideoResult> {
  let status: VideoWorkflowStatus = {
    phase: input.enhancePrompt ? 'enhancing' : 'starting',
    prompt: input.prompt,
    message: input.enhancePrompt
      ? 'Enhancing prompt with Grok…'
      : 'Starting video job…',
  }

  setHandler(statusQuery, () => status)

  // 1) Optional: polish the prompt with a text model
  const enhancedPrompt = input.enhancePrompt
    ? await enhancePrompt(input.prompt)
    : input.prompt

  status = {
    ...status,
    phase: 'starting',
    enhancedPrompt,
    message: 'Submitting job to Grok Imagine…',
  }

  // 2) Start async video generation (returns job id immediately)
  const jobId = await startVideoJob({
    prompt: enhancedPrompt,
    duration: input.duration,
    size: input.size,
  })

  status = {
    ...status,
    phase: 'generating',
    jobId,
    jobStatus: 'pending',
    message: 'Video is generating (this can take a few minutes)…',
  }

  // 3) Durable poll loop — sleep in the workflow, not the activity
  const maxPolls = 120 // ~10 minutes at 5s interval
  for (let i = 0; i < maxPolls; i++) {
    const poll = await pollVideoJob(jobId)

    if (poll.status === 'completed' && poll.videoUrl) {
      status = {
        ...status,
        phase: 'completed',
        jobStatus: 'completed',
        progress: 100,
        videoUrl: poll.videoUrl,
        message: 'Video ready!',
      }

      return {
        videoUrl: poll.videoUrl,
        enhancedPrompt,
        jobId,
        duration: input.duration,
      }
    }

    if (poll.status === 'failed') {
      const error = poll.error ?? 'Video generation failed'
      status = {
        ...status,
        phase: 'failed',
        jobStatus: 'failed',
        error,
        message: error,
      }
      throw ApplicationFailure.nonRetryable(error, 'VideoGenerationFailed')
    }

    status = {
      ...status,
      phase: 'generating',
      jobStatus: poll.status,
      progress: poll.progress,
      message:
        poll.progress != null
          ? `Generating… ${poll.progress}%`
          : 'Generating… (polling Grok Imagine)',
    }

    // Deterministic sleep — survives worker restarts
    await sleep('5 seconds')
  }

  status = {
    ...status,
    phase: 'failed',
    error: 'Timed out waiting for video',
    message: 'Timed out waiting for video',
  }
  throw ApplicationFailure.nonRetryable(
    'Timed out waiting for video generation',
    'VideoGenerationTimeout',
  )
}
