import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { getEnv } from './env.ts'
import { verifyBodySignature } from './internalAuth.ts'
import { syncVideoJobFromStatus } from './jobSync.ts'

export interface PersistVideoBody {
  workflowId: string
  videoUrl: string
}

function isPersistVideoBody(value: unknown): value is PersistVideoBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['workflowId'] === 'string' &&
    v['workflowId'].length > 0 &&
    typeof v['videoUrl'] === 'string' &&
    v['videoUrl'].length > 0
  )
}

/**
 * POST /internal/videos — Temporal worker asks the edge to persist a completed
 * video. Body is signed JSON metadata only (`workflowId` + provider `videoUrl`);
 * the edge fetches the provider URL and streams the response body into the
 * `VIDEOS` R2 binding — no full-file buffer on Node or in the Worker.
 *
 * HMAC: X-Signature: hex(hmac-sha256(body, STATUS_WEBHOOK_SECRET))
 */
export async function handleVideoPersist(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const env = getEnv()
  const secret = env.STATUS_WEBHOOK_SECRET
  if (!secret) {
    return new Response('STATUS_WEBHOOK_SECRET not configured', { status: 500 })
  }

  const bodyText = await request.text()
  const signature = request.headers.get('X-Signature')
  const ok = await verifyBodySignature(secret, bodyText, signature)
  if (!ok) {
    return new Response('Invalid signature', { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText) as unknown
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  if (!isPersistVideoBody(parsed)) {
    return new Response('Invalid persist body', { status: 400 })
  }

  const source = await fetch(parsed.videoUrl)
  if (!source.ok || !source.body) {
    return Response.json(
      {
        error: 'download_failed',
        status: source.status,
      },
      { status: 422 },
    )
  }

  const contentType = source.headers.get('content-type') ?? 'video/mp4'
  const key = `videos/${parsed.workflowId}.mp4`

  // Stream provider bytes straight into R2 — do not arrayBuffer() the body.
  await env.VIDEOS.put(key, source.body, {
    httpMetadata: { contentType },
  })

  const publicUrl = new URL(request.url)
  publicUrl.pathname = `/api/videos/${encodeURIComponent(parsed.workflowId)}`
  publicUrl.search = ''

  const id = env.JOB_ROOM.idFromName(parsed.workflowId)
  const stub = env.JOB_ROOM.get(id)
  const prev = await stub.getStatus()
  const next: VideoWorkflowStatus = {
    phase: 'completed',
    prompt: prev?.prompt ?? '',
    message: 'Video ready!',
    videoUrl: publicUrl.toString(),
    jobId: prev?.jobId,
    jobStatus: 'completed',
    progress: 100,
    enhancedPrompt: prev?.enhancedPrompt,
  }
  await stub.notify({
    status: next,
    updatedAt: new Date().toISOString(),
  })

  await syncVideoJobFromStatus({
    workflowId: parsed.workflowId,
    status: 'completed',
    videoUrl: publicUrl.toString(),
    r2Key: key,
  })

  return Response.json({ key, videoUrl: publicUrl.toString() })
}

/**
 * GET /api/videos/:workflowId — stream from R2.
 * Ownership is enforced by the caller (server.ts → authorizeJobAccess), so
 * responses must stay private: shared caches would leak videos across users.
 */
export async function handleVideoGet(workflowId: string): Promise<Response> {
  const key = `videos/${workflowId}.mp4`
  const object = await getEnv().VIDEOS.get(key)
  if (!object) {
    return new Response('Not found', { status: 404 })
  }
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'private, max-age=3600')
  return new Response(object.body, { headers })
}
