import { NativeConnection, Worker } from '@temporalio/worker'
import { fileURLToPath } from 'node:url'
import * as activities from './activities/index.ts'
import { GATEWAY_DEFAULT_PORT, startTemporalGateway } from './gateway.ts'
import { resolveTaskQueue, XAI_TASK_QUEUE } from './types.ts'

/**
 * Temporal Worker process (+ optional HTTP starter gateway for Cloudflare edge).
 *
 * Run separately from the web app:
 *   bun run worker
 *
 * The worker:
 * 1. Polls the Temporal server for workflow + activity tasks
 * 2. Bundles workflow code (deterministic sandbox)
 * 3. Executes activities (Node — HTTP, TanStack AI, edge webhooks)
 * 4. Serves POST /workflows/start for the edge (TEMPORAL_STARTER_SECRET)
 */
async function connectWithRetry(
  address: string,
  attempts = 30,
  delayMs = 1000,
): Promise<NativeConnection> {
  const apiKey = process.env['TEMPORAL_API_KEY']
  const certPath = process.env['TEMPORAL_TLS_CERT_PATH']
  const keyPath = process.env['TEMPORAL_TLS_KEY_PATH']

  let lastError: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      if (apiKey) {
        return await NativeConnection.connect({
          address,
          tls: true,
          apiKey,
        })
      }
      if (certPath && keyPath) {
        const { readFileSync } = await import('node:fs')
        return await NativeConnection.connect({
          address,
          tls: {
            clientCertPair: {
              crt: readFileSync(certPath),
              key: readFileSync(keyPath),
            },
          },
        })
      }
      return await NativeConnection.connect({ address })
    } catch (err) {
      lastError = err
      console.log(
        `Waiting for Temporal at ${address} (attempt ${i}/${attempts})…`,
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to connect to Temporal at ${address}`, {
        cause: lastError,
      })
}

async function run() {
  const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'
  const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'default'

  // HTTP gateway so Cloudflare Workers never import @temporalio/*
  const gatewayDisabled =
    process.env['TEMPORAL_GATEWAY_DISABLED'] === '1' ||
    process.env['TEMPORAL_GATEWAY_DISABLED'] === 'true'
  if (!gatewayDisabled) {
    const port = Number(
      process.env['TEMPORAL_GATEWAY_PORT'] ?? GATEWAY_DEFAULT_PORT,
    )
    startTemporalGateway(Number.isFinite(port) ? port : GATEWAY_DEFAULT_PORT)
  }

  const connection = await connectWithRetry(address)

  const { enhancePrompt, startVideoJob, pollVideoJob, ...edgeActivities } =
    activities

  const taskQueue = resolveTaskQueue()

  // Workflows + edge-facing activities (webhooks, persists) — unthrottled
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: fileURLToPath(
      new URL('./workflows/index.ts', import.meta.url),
    ),
    activities: edgeActivities,
  })

  // xAI-calling activities on their own queue, capped fleet-wide by the
  // Temporal SERVER: imagine-video is 10 RPS regardless of tier; 8 leaves
  // headroom for retries. Excess work queues durably — nothing is dropped.
  const xaiPerSecond = Number(process.env['XAI_ACTIVITIES_PER_SECOND'] ?? 8)
  const xaiWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: XAI_TASK_QUEUE,
    maxTaskQueueActivitiesPerSecond: xaiPerSecond,
    activities: { enhancePrompt, startVideoJob, pollVideoJob },
  })

  console.log(
    `Temporal workers listening on "${taskQueue}" and "${XAI_TASK_QUEUE}" (≤${xaiPerSecond}/s) at ${address} (ns=${namespace})`,
  )

  await Promise.all([worker.run(), xaiWorker.run()])
}

run().catch((err) => {
  console.error('Worker failed:', err)
  process.exit(1)
})
