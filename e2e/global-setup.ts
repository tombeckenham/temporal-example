/**
 * Playwright global setup:
 * 1. Start CopilotKit AIMock (Grok chat + Imagine video)
 * 2. Ensure Temporal is reachable
 * 3. Start worker (gateway + activities) with XAI_BASE_URL → AIMock
 *
 * Uses the same ports as local docs (gateway :8788, app :3000) so edge
 * `.dev.vars` secrets match. If those ports are busy, stop the other stack first.
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { LLMock } from '@copilotkit/aimock'

export const E2E_PORTS = {
  aimock: 4010,
  gateway: 8788,
  app: 3000,
} as const

const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'

const children: ChildProcess[] = []
let mock: LLMock | undefined

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    // vite may listen on ::1 only when host is not forced
    if (url.includes('127.0.0.1')) {
      try {
        const res = await fetch(url.replace('127.0.0.1', 'localhost'), {
          signal: AbortSignal.timeout(2000),
        })
        return res.ok
      } catch {
        return false
      }
    }
    return false
  }
}

async function waitFor(
  name: string,
  check: () => Promise<boolean>,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await check()) return
    await delay(400)
  }
  throw new Error(`Timed out waiting for ${name}`)
}

function spawnLogged(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  label: string,
): ChildProcess {
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
  })
  child.stdout?.on('data', (buf: Buffer) => {
    process.stdout.write(`[${label}] ${buf.toString()}`)
  })
  child.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[${label}] ${buf.toString()}`)
  })
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[${label}] exited code=${code} signal=${signal}`)
    }
  })
  children.push(child)
  return child
}

/**
 * Must match `.dev.vars` / `.env.local` so the edge Worker and worker process agree.
 */
function e2eEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XAI_API_KEY: 'mock',
    XAI_BASE_URL: `http://127.0.0.1:${E2E_PORTS.aimock}/v1`,
    TEMPORAL_STARTER_SECRET: 'dev-starter-secret-change-me',
    TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
    TEMPORAL_GATEWAY_PORT: String(E2E_PORTS.gateway),
    STATUS_WEBHOOK_URL: `http://127.0.0.1:${E2E_PORTS.app}`,
    STATUS_WEBHOOK_SECRET: 'dev-webhook-secret-change-me',
    TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
  }
}

function killStrayWorkers(): void {
  // Any leftover worker (real XAI_API_KEY, old workflow bundle) will steal
  // tasks from the AIMock worker and break e2e — kill them first.
  const patterns = [
    'src/temporal/worker.ts',
    'temporal/worker.ts',
    'tsx.*worker.ts',
  ]
  for (const pattern of patterns) {
    try {
      execSync(`pkill -f ${JSON.stringify(pattern)} || true`, {
        stdio: 'ignore',
      })
    } catch {
      // ignore
    }
  }
  try {
    execSync(
      `lsof -nP -iTCP:${E2E_PORTS.gateway} -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
      { stdio: 'ignore' },
    )
  } catch {
    // ignore
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  killStrayWorkers()
  await delay(500)

  mock = new LLMock({
    port: E2E_PORTS.aimock,
    // Terminal on first poll so the workflow does not wait on sleep()
    grokVideo: { pollsBeforeInProgress: 0, pollsBeforeCompleted: 0 },
  })

  mock.onMessage(/.*/, {
    content:
      'Enhanced e2e prompt: a cinematic rocket launch with golden-hour light and slow camera push-in',
  })

  mock.onVideo(
    /.*/,
    {
      video: {
        id: 'vid_e2e',
        status: 'completed',
        url: 'https://example.com/e2e-video.mp4',
        duration: 5,
      },
    },
    { model: 'grok-imagine-video' },
  )

  await mock.start()
  console.log(`[e2e] AIMock listening on ${mock.url}`)

  const env = e2eEnv()

  if (!(await isUp('http://127.0.0.1:8233'))) {
    console.log('[e2e] starting Temporal dev server…')
    spawnLogged('bun', ['run', 'temporal:dev'], env, 'temporal')
    await waitFor('Temporal UI', () => isUp('http://127.0.0.1:8233'))
  } else {
    console.log('[e2e] reusing existing Temporal')
  }

  console.log(
    `[e2e] starting Temporal worker + gateway on :${E2E_PORTS.gateway} (AIMock)…`,
  )
  // Invoke tsx directly so `.env.local` cannot override XAI_API_KEY / XAI_BASE_URL
  spawnLogged('bunx', ['tsx', 'src/temporal/worker.ts'], env, 'worker')
  await waitFor('gateway /health', () =>
    isUp(`http://127.0.0.1:${E2E_PORTS.gateway}/health`),
  )

  return async () => {
    console.log('[e2e] tearing down…')
    for (const child of children) {
      child.kill('SIGTERM')
    }
    children.length = 0
    if (mock) {
      await mock.stop()
      mock = undefined
    }
  }
}
