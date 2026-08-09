import type { VideoWorkflowStatus } from '../temporal/types.ts'
import { verifyBodySignature } from './internalAuth.ts'

export interface JobEventBody {
  workflowId: string
  status: VideoWorkflowStatus
  updatedAt: string
}

function isJobEventBody(value: unknown): value is JobEventBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['workflowId'] === 'string' &&
    typeof v['updatedAt'] === 'string' &&
    typeof v['status'] === 'object' &&
    v['status'] !== null
  )
}

/**
 * POST /internal/job-events — Temporal activity publishes status here.
 * HMAC: X-Signature: hex(hmac-sha256(body, STATUS_WEBHOOK_SECRET))
 */
export async function handleJobEvents(
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

  if (!isJobEventBody(parsed)) {
    return new Response('Invalid job event body', { status: 400 })
  }

  const id = env.JOB_ROOM.idFromName(parsed.workflowId)
  const stub = env.JOB_ROOM.get(id)
  const result = await stub.notify({
    status: parsed.status,
    updatedAt: parsed.updatedAt,
  })

  // Keep Postgres job index in sync for "my videos" listing (not the live UX path)
  const phase = parsed.status.phase
  if (phase === 'completed' || phase === 'failed') {
    const { syncVideoJobFromStatus } = await import('./jobs.ts')
    const sync: {
      workflowId: string
      status: string
      videoUrl?: string
    } = {
      workflowId: parsed.workflowId,
      status: phase,
    }
    if (parsed.status.videoUrl) sync.videoUrl = parsed.status.videoUrl
    await syncVideoJobFromStatus(sync)
  }

  return Response.json(result)
}

export async function handleJobWebSocket(
  request: Request,
  env: Cloudflare.Env,
  workflowId: string,
): Promise<Response> {
  if (!workflowId) {
    return new Response('workflowId required', { status: 400 })
  }
  const id = env.JOB_ROOM.idFromName(workflowId)
  const stub = env.JOB_ROOM.get(id)
  return stub.fetch(request)
}

export async function handleJobStatusHttp(
  env: Cloudflare.Env,
  workflowId: string,
): Promise<Response> {
  const id = env.JOB_ROOM.idFromName(workflowId)
  const stub = env.JOB_ROOM.get(id)
  const status = await stub.getStatus()
  if (!status) {
    return Response.json(
      { workflowId, status: null },
      { status: 404 },
    )
  }
  return Response.json({ workflowId, status })
}
