/**
 * Cloudflare Workers entry for TanStack Start + Durable Objects.
 *
 * Custom routes (before TanStack):
 *   GET  /ws/jobs/:workflowId     → JobRoom WebSocket (hibernation)
 *   GET  /api/jobs/:workflowId    → last status snapshot (HTTP fallback)
 *   POST /internal/job-events     → HMAC webhook from Temporal activities
 */
import handler from '@tanstack/react-start/server-entry'
import { JobRoom } from './durable-objects/JobRoom.ts'
import { authorizeJobAccess } from './lib/jobAccess.ts'
import { runInRequestScope } from './lib/requestScope.ts'
import {
  handleJobEvents,
  handleJobStatusHttp,
  handleJobWebSocket,
} from './lib/jobEvents.ts'
import { reconcileStuckJobs } from './lib/jobReconcile.ts'
import { handleVideoGet, handleVideoPersist } from './lib/videos.ts'

export { JobRoom }

function matchJobPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const workflowId = rest.split('/')[0]
  return workflowId && workflowId.length > 0 ? workflowId : null
}

/** workflowIds are ULIDs (Crockford Base32, 26 chars) — see src/lib/id.ts */
const WORKFLOW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i

type JobRouteHandler = (
  request: Request,
  workflowId: string,
) => Promise<Response>

/**
 * Workflow-scoped routes (`<prefix>:workflowId`). The dispatch loop below
 * guards every entry uniformly: the param must be a ULID and the session
 * user must own the video_job row (authorizeJobAccess). Add new job routes
 * here — never as ad-hoc branches that could skip the guard.
 * Handlers read bindings via getEnv() (lib/env.ts), not a threaded env param.
 */
const jobRoutes: Array<{
  method: string
  prefix: string
  handler: JobRouteHandler
}> = [
  {
    method: 'GET',
    prefix: '/api/videos/',
    handler: (_request, workflowId) => handleVideoGet(workflowId),
  },
  {
    // WebSocket upgrades arrive as GET
    method: 'GET',
    prefix: '/ws/jobs/',
    handler: handleJobWebSocket,
  },
  {
    method: 'GET',
    prefix: '/api/jobs/',
    handler: (_request, workflowId) => handleJobStatusHttp(workflowId),
  },
]

/**
 * Machine-to-machine webhooks from the Temporal worker. Not session-authed —
 * each handler verifies the request's HMAC signature (STATUS_WEBHOOK_SECRET)
 * before acting, since the signature covers the request body.
 */
const internalRoutes: Array<{
  path: string
  handler: (request: Request) => Promise<Response>
}> = [
  { path: '/internal/job-events', handler: handleJobEvents },
  { path: '/internal/videos', handler: handleVideoPersist },
]

/**
 * Vars and secrets reach server code through process.env (populated by
 * `nodejs_compat`) and object bindings through `cloudflare:workers` — see
 * lib/env.ts (getEnv). Nothing is copied into module scope here: state set
 * during one request is shared with every other request in the isolate.
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'POST') {
    for (const route of internalRoutes) {
      if (url.pathname === route.path) {
        return route.handler(request)
      }
    }
  }

  for (const route of jobRoutes) {
    if (request.method !== route.method) continue
    const workflowId = matchJobPath(url.pathname, route.prefix)
    if (!workflowId) continue
    if (!WORKFLOW_ID_RE.test(workflowId)) {
      return new Response('Invalid workflow id', { status: 400 })
    }
    const denied = await authorizeJobAccess(request, workflowId)
    if (denied) return denied
    return route.handler(request, workflowId)
  }

  return handler.fetch(request)
}

export default {
  fetch(
    request: Request,
    _env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // Every getDb() / getAuth() below this point shares one instance, and that
    // instance dies with the request — Workers rejects I/O created by another.
    return runInRequestScope(() => handleRequest(request))
  },

  // Cron (wrangler.jsonc triggers): heal jobs stuck at 'running' whose
  // workflow finished, died, or never existed — the terminal webhook is
  // best-effort, so Postgres/JobRoom need a truth pass against Temporal.
  scheduled(
    _controller: ScheduledController,
    _env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runInRequestScope(() => reconcileStuckJobs()))
  },
}
