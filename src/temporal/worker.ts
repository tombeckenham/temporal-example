import { NativeConnection, Worker } from '@temporalio/worker'
import { fileURLToPath } from 'node:url'
import * as activities from './activities/index.ts'
import { GATEWAY_DEFAULT_PORT, startTemporalGateway } from './gateway.ts'
import { resolveTaskQueue } from './types.ts'

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

  const taskQueue = resolveTaskQueue()
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: fileURLToPath(
      new URL('./workflows/index.ts', import.meta.url),
    ),
    activities,
  })

  console.log(
    `Temporal worker listening on queue "${taskQueue}" at ${address} (ns=${namespace})`,
  )

  await worker.run()
}

run().catch((err) => {
  console.error('Worker failed:', err)
  process.exit(1)
})
