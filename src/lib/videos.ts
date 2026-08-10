import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { getEnv } from './env.ts'
import { sha256Hex, verifyBodySignature } from './internalAuth.ts'
import { syncVideoJobFromStatus } from './jobSync.ts'

/** Reject uploads whose timestamp is further than this from now (replay window). */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60_000

/**
 * POST /internal/videos — Temporal worker uploads completed video bytes.
 * Headers: X-Signature, X-Timestamp, X-Workflow-Id, Content-Type
 * Body: raw video bytes
 * Signature covers workflowId + timestamp + SHA-256(body) + content-type.
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

  const workflowId = request.headers.get('X-Workflow-Id')
  if (!workflowId) {
    return new Response('X-Workflow-Id required', { status: 400 })
  }

  const timestamp = request.headers.get('X-Timestamp')
  const ts = Number(timestamp)
  if (
    !timestamp ||
    !Number.isFinite(ts) ||
    Math.abs(Date.now() - ts) > MAX_TIMESTAMP_SKEW_MS
  ) {
    return new Response('Invalid or stale timestamp', { status: 401 })
  }

  const body = await request.arrayBuffer()
  const contentType = request.headers.get('content-type') ?? 'video/mp4'
  const bodyHash = await sha256Hex(body)
  const signPayload = `${workflowId}:${timestamp}:${bodyHash}:${contentType}`
  const signature = request.headers.get('X-Signature')
  const ok = await verifyBodySignature(secret, signPayload, signature)
  if (!ok) {
    return new Response('Invalid signature', { status: 401 })
  }

  const key = `videos/${workflowId}.mp4`
  await env.VIDEOS.put(key, body, {
    httpMetadata: { contentType },
  })

  const publicUrl = new URL(request.url)
  publicUrl.pathname = `/api/videos/${encodeURIComponent(workflowId)}`
  publicUrl.search = ''

  const id = env.JOB_ROOM.idFromName(workflowId)
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
    workflowId,
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
