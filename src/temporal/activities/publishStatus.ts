import { signBody } from '../../server/internalAuth.ts'
import type { VideoWorkflowStatus } from '../types.ts'

export interface PublishStatusInput {
  workflowId: string
  status: VideoWorkflowStatus
}

/**
 * Activity: push workflow status to the Cloudflare JobRoom via HMAC webhook.
 * Product UI reads JobRoom over WebSocket — it does not poll Temporal.
 */
export async function publishStatus(input: PublishStatusInput): Promise<void> {
  const baseUrl = process.env['STATUS_WEBHOOK_URL']
  const secret = process.env['STATUS_WEBHOOK_SECRET']

  if (!baseUrl) {
    // Local-only: edge may not be reachable; log and continue
    console.warn(
      '[publishStatus] STATUS_WEBHOOK_URL unset — skipping edge notify',
      input.workflowId,
      input.status.phase,
    )
    return
  }
  if (!secret) {
    throw new Error(
      'STATUS_WEBHOOK_SECRET is required when STATUS_WEBHOOK_URL is set',
    )
  }

  const body = JSON.stringify({
    workflowId: input.workflowId,
    status: input.status,
    updatedAt: new Date().toISOString(),
  })
  const signature = await signBody(secret, body)

  const url = baseUrl.replace(/\/$/, '') + '/internal/job-events'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Signature': signature,
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `publishStatus failed (${response.status}): ${text || response.statusText}`,
    )
  }
}
