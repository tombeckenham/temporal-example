import { createServerFn } from '@tanstack/react-start'
import { WorkflowNotFoundError } from '@temporalio/client'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { getTemporalClient } from '../temporal/client.ts'
import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { TASK_QUEUE, VIDEO_SIZES } from '../temporal/types.ts'
import {
  generateVideoWorkflow,
  statusQuery,
} from '../temporal/workflows/index.ts'

const generateVideoInputSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required'),
  duration: z.number().int().min(1).max(15),
  size: z.enum(VIDEO_SIZES).default('16:9_480p'),
  enhancePrompt: z.boolean(),
})

const workflowIdSchema = z.object({
  workflowId: z.string().min(1, 'workflowId is required'),
})

export const startVideoWorkflow = createServerFn({ method: 'POST' })
  .validator(generateVideoInputSchema)
  .handler(async ({ data }) => {
    const client = await getTemporalClient()
    const workflowId = `video-${nanoid(10)}`

    await client.workflow.start(generateVideoWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [data],
    })

    return { workflowId }
  })

export const getVideoWorkflowStatus = createServerFn({ method: 'GET' })
  .validator(workflowIdSchema)
  .handler(async ({ data }) => {
    const client = await getTemporalClient()
    const handle = client.workflow.getHandle(data.workflowId)

    try {
      const description = await handle.describe()
      const status = await handle.query(statusQuery)

      const result: {
        workflowId: string
        executionStatus: string
        status: VideoWorkflowStatus
      } = {
        workflowId: data.workflowId,
        executionStatus: description.status.name,
        status,
      }
      return result
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        throw new Error(`Workflow not found: ${data.workflowId}`)
      }
      throw err
    }
  })
