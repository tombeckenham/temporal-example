import {
  ApplicationFailure,
  defineQuery,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from '@temporalio/workflow'
import type * as activities from '../activities/index.ts'
import type {
  GenerateVideoInput,
  GenerateVideoResult,
  VideoWorkflowStatus,
} from '../types.ts'

/**
 * Query: read workflow progress without mutating state.
 * Kept for Temporal UI / ops. Product UI uses JobRoom WebSockets instead.
 */
export const statusQuery = defineQuery<VideoWorkflowStatus>('status')

const {
  enhancePrompt,
  startVideoJob,
  pollVideoJob,
  publishStatus,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
  },
})

async function projectStatus(
  workflowId: string,
  next: VideoWorkflowStatus,
): Promise<VideoWorkflowStatus> {
  await publishStatus({ workflowId, status: next })
  return next
}

/**
 * Durable video generation workflow.
 *
 * Why Temporal fits video gen:
 * - Generation takes minutes; the process can crash and resume
 * - Polling lives in the workflow (sleep + activity), not a fragile Node loop
 * - Queries expose live status for ops; JobRoom gets push updates via publishStatus
 * - Activities are the only place that talks to xAI / TanStack AI / edge webhooks
 */
export async function generateVideoWorkflow(
  input: GenerateVideoInput,
): Promise<GenerateVideoResult> {
  const { workflowId } = workflowInfo()

  let status: VideoWorkflowStatus = {
    phase: input.enhancePrompt ? 'enhancing' : 'starting',
    prompt: input.prompt,
    message: input.enhancePrompt
      ? 'Enhancing prompt with Grok…'
      : 'Starting video job…',
  }

  setHandler(statusQuery, () => status)
  status = await projectStatus(workflowId, status)

  const enhancedPrompt = input.enhancePrompt
    ? await enhancePrompt(input.prompt)
    : input.prompt

  status = await projectStatus(workflowId, {
    ...status,
    phase: 'starting',
    enhancedPrompt,
    message: 'Submitting job to Grok Imagine…',
  })

  const jobId = await startVideoJob({
    prompt: enhancedPrompt,
    duration: input.duration,
    size: input.size,
  })

  status = await projectStatus(workflowId, {
    ...status,
    phase: 'generating',
    jobId,
    jobStatus: 'pending',
    message: 'Video is generating (this can take a few minutes)…',
  })

  const maxPolls = 120 // ~10 minutes at 5s interval
  let lastPublishedProgress: number | undefined

  for (let i = 0; i < maxPolls; i++) {
    const poll = await pollVideoJob(jobId)

    if (poll.status === 'completed' && poll.videoUrl) {
      status = await projectStatus(workflowId, {
        ...status,
        phase: 'completed',
        jobStatus: 'completed',
        progress: 100,
        videoUrl: poll.videoUrl,
        message: 'Video ready!',
      })

      return {
        videoUrl: poll.videoUrl,
        enhancedPrompt,
        jobId,
        duration: input.duration,
      }
    }

    if (poll.status === 'failed') {
      const error = poll.error ?? 'Video generation failed'
      status = await projectStatus(workflowId, {
        ...status,
        phase: 'failed',
        jobStatus: 'failed',
        error,
        message: error,
      })
      throw ApplicationFailure.nonRetryable(error, 'VideoGenerationFailed')
    }

    const progress = poll.progress
    status = {
      ...status,
      phase: 'generating',
      jobStatus: poll.status,
      progress,
      message:
        progress != null
          ? `Generating… ${progress}%`
          : 'Generating… (polling Grok Imagine)',
    }
    // Keep query handler in sync even when we throttle edge publishes
    setHandler(statusQuery, () => status)

    // Throttle progress publishes: first tick or ≥5% change
    const shouldPublish =
      progress == null ||
      lastPublishedProgress == null ||
      progress - lastPublishedProgress >= 5

    if (shouldPublish) {
      await publishStatus({ workflowId, status })
      if (progress != null) lastPublishedProgress = progress
    }

    await sleep('5 seconds')
  }

  status = await projectStatus(workflowId, {
    ...status,
    phase: 'failed',
    error: 'Timed out waiting for video',
    message: 'Timed out waiting for video',
  })
  throw ApplicationFailure.nonRetryable(
    'Timed out waiting for video generation',
    'VideoGenerationTimeout',
  )
}
