import { signBody } from '../../lib/internalAuth.ts'

export interface PersistVideoInput {
  workflowId: string
  videoUrl: string
}

/**
 * Ask the edge to pull the provider video into R2.
 *
 * The Node worker does **not** download or re-upload bytes — that would buffer
 * full videos in worker memory and ship them over the webhook hop. The edge
 * owns the `VIDEOS` R2 binding, so it fetches the provider URL and streams the
 * body into `env.VIDEOS.put`. This activity only posts signed metadata.
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

  const body = JSON.stringify({
    workflowId: input.workflowId,
    videoUrl: input.videoUrl,
  })
  const signature = await signBody(secret, body)

  const url = baseUrl.replace(/\/$/, '') + '/internal/videos'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Signature': signature,
    },
    body,
  })

  // Edge could not fetch the provider URL (expired / AIMock placeholder).
  // Keep the original so the workflow can still complete.
  if (response.status === 422) {
    console.warn(
      '[persistVideo] edge could not download provider URL — keeping original',
      input.videoUrl,
    )
    return { videoUrl: input.videoUrl }
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `persistVideo failed (${response.status}): ${text || response.statusText}`,
    )
  }

  const result = await response.json<{ videoUrl: string }>()
  return { videoUrl: result.videoUrl }
}
