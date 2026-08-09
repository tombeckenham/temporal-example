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
import {
  handleJobEvents,
  handleJobStatusHttp,
  handleJobWebSocket,
} from './server/jobEvents.ts'
import { handleVideoGet, handleVideoPersist } from './server/videos.ts'

export { JobRoom }

function matchJobPath(
  pathname: string,
  prefix: string,
): string | null {
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const workflowId = rest.split('/')[0]
  return workflowId && workflowId.length > 0 ? workflowId : null
}

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Bindings → process.env so Better Auth / Drizzle see secrets on Workers
    if (env.HYPERDRIVE?.connectionString) {
      process.env['DATABASE_URL'] = env.HYPERDRIVE.connectionString
    } else if (env.DATABASE_URL) {
      process.env['DATABASE_URL'] = env.DATABASE_URL
    }
    if (env.BETTER_AUTH_SECRET)
      process.env['BETTER_AUTH_SECRET'] = env.BETTER_AUTH_SECRET
    if (env.BETTER_AUTH_URL) process.env['BETTER_AUTH_URL'] = env.BETTER_AUTH_URL
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

    if (url.pathname === '/internal/job-events') {
      return handleJobEvents(request, env)
    }

    if (url.pathname === '/internal/videos') {
      return handleVideoPersist(request, env)
    }

    const videoId = matchJobPath(url.pathname, '/api/videos/')
    if (videoId && request.method === 'GET') {
      return handleVideoGet(env, videoId)
    }

    const wsJobId = matchJobPath(url.pathname, '/ws/jobs/')
    if (wsJobId) {
      return handleJobWebSocket(request, env, wsJobId)
    }

    const apiJobId = matchJobPath(url.pathname, '/api/jobs/')
    if (apiJobId && request.method === 'GET') {
      return handleJobStatusHttp(env, apiJobId)
    }

    return handler.fetch(request)
  },
}
