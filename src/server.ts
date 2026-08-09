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
import { setCfEnv } from './server/cfEnv.ts'
import { authorizeJobAccess } from './server/jobAccess.ts'
import {
  handleJobEvents,
  handleJobStatusHttp,
  handleJobWebSocket,
} from './server/jobEvents.ts'
import { handleVideoGet, handleVideoPersist } from './server/videos.ts'

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
  env: Cloudflare.Env,
  workflowId: string,
) => Promise<Response>

/**
 * Workflow-scoped routes (`<prefix>:workflowId`). The dispatch loop below
 * guards every entry uniformly: the param must be a ULID and the session
 * user must own the video_job row (authorizeJobAccess). Add new job routes
 * here — never as ad-hoc branches that could skip the guard.
 */
const jobRoutes: Array<{
  method: string
  prefix: string
  handler: JobRouteHandler
}> = [
  {
    method: 'GET',
    prefix: '/api/videos/',
    handler: (_request, env, workflowId) => handleVideoGet(env, workflowId),
  },
  {
    // WebSocket upgrades arrive as GET
    method: 'GET',
    prefix: '/ws/jobs/',
    handler: (request, env, workflowId) =>
      handleJobWebSocket(request, env, workflowId),
  },
  {
    method: 'GET',
    prefix: '/api/jobs/',
    handler: (_request, env, workflowId) =>
      handleJobStatusHttp(env, workflowId),
  },
]

/**
 * Machine-to-machine webhooks from the Temporal worker. Not session-authed —
 * each handler verifies the request's HMAC signature (STATUS_WEBHOOK_SECRET)
 * before acting, since the signature covers the request body.
 */
const internalRoutes: Array<{
  path: string
  handler: (request: Request, env: Cloudflare.Env) => Promise<Response>
}> = [
  { path: '/internal/job-events', handler: handleJobEvents },
  { path: '/internal/videos', handler: handleVideoPersist },
]

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Non-string bindings (EMAIL, …) for code outside this handler
    setCfEnv(env)

    // Bindings → process.env so Better Auth / Drizzle see secrets on Workers
    if (env.HYPERDRIVE?.connectionString) {
      process.env['DATABASE_URL'] = env.HYPERDRIVE.connectionString
    } else if (env.DATABASE_URL) {
      process.env['DATABASE_URL'] = env.DATABASE_URL
    }
    if (env.BETTER_AUTH_SECRET)
      process.env['BETTER_AUTH_SECRET'] = env.BETTER_AUTH_SECRET
    if (env.BETTER_AUTH_URL)
      process.env['BETTER_AUTH_URL'] = env.BETTER_AUTH_URL
    if (env.EMAIL_FROM) process.env['EMAIL_FROM'] = env.EMAIL_FROM
    if (env.EMAIL_MODE) process.env['EMAIL_MODE'] = env.EMAIL_MODE
    if (env.STATUS_WEBHOOK_SECRET)
      process.env['STATUS_WEBHOOK_SECRET'] = env.STATUS_WEBHOOK_SECRET
    if (env.TEMPORAL_STARTER_URL)
      process.env['TEMPORAL_STARTER_URL'] = env.TEMPORAL_STARTER_URL
    if (env.TEMPORAL_STARTER_SECRET)
      process.env['TEMPORAL_STARTER_SECRET'] = env.TEMPORAL_STARTER_SECRET
    if (env.E2E_BYPASS_AUTH)
      process.env['E2E_BYPASS_AUTH'] = env.E2E_BYPASS_AUTH

    if (request.method === 'POST') {
      for (const route of internalRoutes) {
        if (url.pathname === route.path) {
          return route.handler(request, env)
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
      return route.handler(request, env, workflowId)
    }

    return handler.fetch(request)
  },
}
