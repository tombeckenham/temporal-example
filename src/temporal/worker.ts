import { NativeConnection, Worker } from '@temporalio/worker'
import { fileURLToPath } from 'node:url'
import * as activities from './activities/index.ts'
import { TASK_QUEUE } from './types.ts'

/**
 * Temporal Worker process.
 *
 * Run separately from the web app:
 *   bun run worker
 *
 * The worker:
 * 1. Polls the Temporal server for workflow + activity tasks
 * 2. Bundles workflow code (deterministic sandbox)
 * 3. Executes activities (Node — HTTP, TanStack AI, etc.)
 */
async function run() {
  const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'
  const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'default'

  const connection = await NativeConnection.connect({ address })

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: TASK_QUEUE,
    // Webpack-bundled by the worker; keep this folder free of Node APIs
    workflowsPath: fileURLToPath(new URL('./workflows/index.ts', import.meta.url)),
    activities,
  })

  console.log(
    `Temporal worker listening on queue "${TASK_QUEUE}" at ${address} (ns=${namespace})`,
  )

  await worker.run()
}

run().catch((err) => {
  console.error('Worker failed:', err)
  process.exit(1)
})
