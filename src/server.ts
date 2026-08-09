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

    if (url.pathname === '/internal/job-events') {
      return handleJobEvents(request, env)
    }

    const wsJobId = matchJobPath(url.pathname, '/ws/jobs/')
    if (wsJobId) {
      return handleJobWebSocket(request, env, wsJobId)
    }

    const apiJobId = matchJobPath(url.pathname, '/api/jobs/')
    if (apiJobId && request.method === 'GET') {
      return handleJobStatusHttp(env, apiJobId)
    }

    // TanStack Start default entry expects the Request (and optional options)
    return handler.fetch(request)
  },
}
