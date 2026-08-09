/**
 * Thin HTTP Temporal gateway for the Cloudflare edge.
 *
 * Runs in the same Node process as the Temporal worker (see worker.ts).
 * Edge must not import @temporalio/* — it only HTTP-calls this service.
 *
 * POST /workflows/start
 *   Authorization: Bearer <TEMPORAL_STARTER_SECRET>
 *   { workflowId, prompt, duration, size, enhancePrompt }
 *
 * GET /workflows/:workflowId/status
 *   Authorization: Bearer <TEMPORAL_STARTER_SECRET>
 *   → Temporal query snapshot (ops / fallback; product UI uses JobRoom WS)
 */
import { createServer } from 'node:http'
import { WorkflowNotFoundError } from '@temporalio/client'
import { getTemporalClient } from './client.ts'
import type {
  GenerateVideoInput,
  VideoSize,
  VideoWorkflowStatus,
} from './types.ts'
import { TASK_QUEUE, VIDEO_SIZES } from './types.ts'
import { generateVideoWorkflow, statusQuery } from './workflows/index.ts'

const DEFAULT_PORT = 8788

/** Simple sliding-window rate limit for workflow starts (per process). */
const START_RATE_WINDOW_MS = 60_000
const START_RATE_MAX = Number(process.env['TEMPORAL_START_RATE_MAX'] ?? 30)
const startTimestamps: number[] = []

function allowStart(): boolean {
  const now = Date.now()
  while (startTimestamps.length > 0) {
    const oldest = startTimestamps[0]
    if (oldest === undefined || now - oldest < START_RATE_WINDOW_MS) break
    startTimestamps.shift()
  }
  if (startTimestamps.length >= START_RATE_MAX) return false
  startTimestamps.push(now)
  return true
}

function readBearer(req: { headers: { authorization?: string | undefined } }): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

function json(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function isVideoSize(value: string): value is VideoSize {
  for (const size of VIDEO_SIZES) {
    if (size === value) return true
  }
  return false
}

function isGenerateInput(value: unknown): value is GenerateVideoInput & {
  workflowId: string
} {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v['workflowId'] !== 'string' || v['workflowId'].length === 0) {
    return false
  }
  if (typeof v['prompt'] !== 'string' || v['prompt'].trim().length === 0) {
    return false
  }
  if (typeof v['duration'] !== 'number' || !Number.isInteger(v['duration'])) {
    return false
  }
  if (typeof v['enhancePrompt'] !== 'boolean') return false
  if (typeof v['size'] !== 'string' || !isVideoSize(v['size'])) return false
  return true
}

async function readJson(
  req: import('node:http').IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return null
  return JSON.parse(raw) as unknown
}

export function startTemporalGateway(port = DEFAULT_PORT): void {
  const secret = process.env['TEMPORAL_STARTER_SECRET']
  if (!secret) {
    console.warn(
      '[gateway] TEMPORAL_STARTER_SECRET not set — gateway will reject all requests',
    )
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

      // Public liveness for e2e / load balancers
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true })
        return
      }

      const token = readBearer(req)
      if (!secret || token !== secret) {
        json(res, 401, { error: 'Unauthorized' })
        return
      }

      if (req.method === 'POST' && url.pathname === '/workflows/start') {
        if (!allowStart()) {
          json(res, 429, {
            error: `Rate limit: max ${START_RATE_MAX} starts per minute`,
          })
          return
        }

        const body = await readJson(req)
        if (!isGenerateInput(body)) {
          json(res, 400, { error: 'Invalid start payload' })
          return
        }

        const client = await getTemporalClient()
        const input: GenerateVideoInput = {
          prompt: body.prompt.trim(),
          duration: body.duration,
          size: body.size,
          enhancePrompt: body.enhancePrompt,
        }

        await client.workflow.start(generateVideoWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: body.workflowId,
          args: [input],
        })

        json(res, 200, { workflowId: body.workflowId })
        return
      }

      const statusMatch = url.pathname.match(
        /^\/workflows\/([^/]+)\/status$/,
      )
      if (req.method === 'GET' && statusMatch) {
        const workflowId = statusMatch[1]
        if (!workflowId) {
          json(res, 400, { error: 'workflowId required' })
          return
        }

        const client = await getTemporalClient()
        const handle = client.workflow.getHandle(workflowId)
        try {
          const description = await handle.describe()
          const status = await handle.query(statusQuery)
          const result: {
            workflowId: string
            executionStatus: string
            status: VideoWorkflowStatus
          } = {
            workflowId,
            executionStatus: description.status.name,
            status,
          }
          json(res, 200, result)
        } catch (err) {
          if (err instanceof WorkflowNotFoundError) {
            json(res, 404, { error: `Workflow not found: ${workflowId}` })
            return
          }
          throw err
        }
        return
      }

      json(res, 404, { error: 'Not found' })
    } catch (err) {
      console.error('[gateway] error', err)
      json(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  server.listen(port, () => {
    console.log(`[gateway] Temporal starter listening on :${port}`)
  })
}

export { DEFAULT_PORT as GATEWAY_DEFAULT_PORT }
