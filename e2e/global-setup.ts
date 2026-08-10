/**
 * Playwright global setup:
 * 1. Start CopilotKit AIMock (Grok chat + Imagine video)
 * 2. Ensure Temporal is reachable
 * 3. Start a *dedicated* e2e worker (own gateway port + task queue + AIMock)
 *
 * Does NOT touch the local dev worker on :8788 / `video-generation`.
 * App DATABASE_URL / .dev.vars are prepared by e2e/run.ts before Playwright.
 */
import { execSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { LLMock } from '@copilotkit/aimock'
import { E2E_PORTS, E2E_SECRETS, E2E_TASK_QUEUE } from './constants.ts'

export { E2E_PORTS, E2E_SECRETS, E2E_TASK_QUEUE }

const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'

const children: ChildProcess[] = []
let mock: LLMock | undefined

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
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
  child.stdout.on('data', (buf: Buffer) => {
    process.stdout.write(`[${label}] ${buf.toString()}`)
  })
  child.stderr.on('data', (buf: Buffer) => {
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
 * Dedicated e2e worker: AIMock xAI, e2e task queue, webhook → :3100.
 * Spreads process.env then overrides so a developer `.env.local` cannot
 * point this process at live xAI or the dev gateway port.
 */
function e2eWorkerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XAI_API_KEY: 'mock',
    XAI_BASE_URL: `http://127.0.0.1:${E2E_PORTS.aimock}/v1`,
    TEMPORAL_TASK_QUEUE: E2E_TASK_QUEUE,
    TEMPORAL_STARTER_SECRET: E2E_SECRETS.TEMPORAL_STARTER_SECRET,
    TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
    TEMPORAL_GATEWAY_PORT: String(E2E_PORTS.gateway),
    STATUS_WEBHOOK_URL: `http://127.0.0.1:${E2E_PORTS.app}`,
    STATUS_WEBHOOK_SECRET: E2E_SECRETS.STATUS_WEBHOOK_SECRET,
    TEMPORAL_ADDRESS,
    TEMPORAL_NAMESPACE: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    EMAIL_MODE: 'console',
  }
}

/** Only free e2e-owned ports — never pkill the developer's worker on :8788. */
function freeE2ePorts(): void {
  for (const port of [E2E_PORTS.gateway, E2E_PORTS.aimock]) {
    try {
      execSync(
        `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
        { stdio: 'ignore' },
      )
    } catch {
      // ignore
    }
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!process.env['DATABASE_URL']?.trim()) {
    throw new Error(
      'DATABASE_URL is not set. Run e2e via `bun run test:e2e` (e2e/run.ts), not playwright alone.',
    )
  }

  freeE2ePorts()
  await delay(300)

  mock = new LLMock({
    port: E2E_PORTS.aimock,
    // Terminal on first poll so the workflow does not wait on sleep()
    grokVideo: { pollsBeforeInProgress: 0, pollsBeforeCompleted: 0 },
  })

  mock.onMessage(/.*/, {
    content:
      'Enhanced e2e prompt: a cinematic rocket launch with golden-hour light and slow camera push-in',
  })

  mock.onVideo(/.*/, {
    video: {
      id: 'vid_e2e',
      status: 'completed',
      url: 'https://example.com/e2e-video.mp4',
      duration: 5,
    },
  })

  await mock.start()
  console.log(`[e2e] AIMock listening on ${mock.url}`)

  const env = e2eWorkerEnv()

  if (!(await isUp('http://127.0.0.1:8233'))) {
    console.log('[e2e] starting Temporal dev server…')
    spawnLogged('bun', ['run', 'temporal:dev'], env, 'temporal')
    await waitFor('Temporal UI', () => isUp('http://127.0.0.1:8233'))
  } else {
    console.log('[e2e] reusing existing Temporal')
  }

  console.log(
    `[e2e] starting e2e worker queue="${E2E_TASK_QUEUE}" gateway=:${E2E_PORTS.gateway} (AIMock)…`,
  )
  // Invoke tsx directly so `.env.local` cannot override XAI_API_KEY / XAI_BASE_URL
  spawnLogged('bunx', ['tsx', 'src/temporal/worker.ts'], env, 'e2e-worker')
  await waitFor('e2e gateway /health', () =>
    isUp(`http://127.0.0.1:${E2E_PORTS.gateway}/health`),
  )

  return async () => {
    console.log('[e2e] tearing down AIMock + e2e worker (dev worker untouched)…')
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
