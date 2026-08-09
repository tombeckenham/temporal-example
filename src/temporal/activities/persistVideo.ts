import { sha256Hex, signBody } from '../../server/internalAuth.ts'

export interface PersistVideoInput {
  workflowId: string
  videoUrl: string
}

/**
 * Download provider video and POST bytes to the edge for R2 storage.
 * Edge returns a durable `/api/videos/:workflowId` URL and updates JobRoom.
 */
export async function persistVideo(
  input: PersistVideoInput,
): Promise<{ videoUrl: string }> {
  const baseUrl = process.env['STATUS_WEBHOOK_URL']
  const secret = process.env['STATUS_WEBHOOK_SECRET']

  if (!baseUrl) {
    console.warn(
      '[persistVideo] STATUS_WEBHOOK_URL unset — skipping R2 persist',
      input.workflowId,
    )
    return { videoUrl: input.videoUrl }
  }
  if (!secret) {
    throw new Error(
      'STATUS_WEBHOOK_SECRET is required when STATUS_WEBHOOK_URL is set',
    )
  }

  const source = await fetch(input.videoUrl)
  if (!source.ok) {
    // Mock / expired provider URLs: keep original URL so the workflow can complete
    console.warn(
      `[persistVideo] download failed (${source.status}) — keeping provider URL`,
      input.videoUrl,
    )
    return { videoUrl: input.videoUrl }
  }

  const contentType = source.headers.get('content-type') ?? 'video/mp4'
  const bytes = await source.arrayBuffer()
  // Sign the body digest + a timestamp so the signature binds the actual
  // content and cannot be replayed later with different bytes.
  const timestamp = String(Date.now())
  const bodyHash = await sha256Hex(bytes)
  const signPayload = `${input.workflowId}:${timestamp}:${bodyHash}:${contentType}`
  const signature = await signBody(secret, signPayload)

  const url = baseUrl.replace(/\/$/, '') + '/internal/videos'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'X-Signature': signature,
      'X-Timestamp': timestamp,
      'X-Workflow-Id': input.workflowId,
    },
    body: bytes,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `persistVideo failed (${response.status}): ${text || response.statusText}`,
    )
  }

  const result = await response.json<{ videoUrl: string }>()
  return { videoUrl: result.videoUrl }
}
