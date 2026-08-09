import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { verifyBodySignature } from './internalAuth.ts'

/**
 * POST /internal/videos — Temporal worker uploads completed video bytes.
 * Headers: X-Signature, X-Workflow-Id, Content-Type
 * Body: raw video bytes
 */
export async function handleVideoPersist(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const secret = env.STATUS_WEBHOOK_SECRET
  if (!secret) {
    return new Response('STATUS_WEBHOOK_SECRET not configured', { status: 500 })
  }

  const workflowId = request.headers.get('X-Workflow-Id')
  if (!workflowId) {
    return new Response('X-Workflow-Id required', { status: 400 })
  }

  const body = await request.arrayBuffer()
  // Sign over workflowId + byte length so we don't re-hash huge bodies twice incorrectly;
  // worker signs the same string.
  const contentType = request.headers.get('content-type') ?? 'video/mp4'
  const signPayload = `${workflowId}:${body.byteLength}:${contentType}`
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

  const { syncVideoJobFromStatus } = await import('./jobs.ts')
  await syncVideoJobFromStatus({
    workflowId,
    status: 'completed',
    videoUrl: publicUrl.toString(),
    r2Key: key,
  })

  return Response.json({ key, videoUrl: publicUrl.toString() })
}

/** GET /api/videos/:workflowId — stream from R2 */
export async function handleVideoGet(
  env: Cloudflare.Env,
  workflowId: string,
): Promise<Response> {
  const key = `videos/${workflowId}.mp4`
  const object = await env.VIDEOS.get(key)
  if (!object) {
    return new Response('Not found', { status: 404 })
  }
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
}
