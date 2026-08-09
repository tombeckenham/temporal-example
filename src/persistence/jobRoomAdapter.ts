/**
 * TanStack AI generation persistence backed by JobRoom Durable Object storage.
 *
 * Scales with jobs (1 DO per workflowId/threadId) — not a central D1 table.
 * Wire into activities/server when full generation middleware is enabled.
 *
 * See: https://tanstack.com/ai/latest/docs/persistence/generation-persistence
 */

export interface GenerationRunRecord {
  runId: string
  threadId: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  result?: unknown
  error?: { message: string; code?: string }
  updatedAt: string
}

/** Shape expected by JobRoom RPC for persistence helpers */
export type JobRoomPersistenceStub = {
  putGenerationRun: (
    runId: string,
    threadId: string,
    record: unknown,
  ) => Promise<void>
  getGenerationRun: (runId: string) => Promise<unknown | null>
  getLatestGenerationRun: (threadId: string) => Promise<unknown | null>
}

export function createJobRoomGenerationStore(
  getStub: (threadId: string) => JobRoomPersistenceStub,
) {
  return {
    async put(run: GenerationRunRecord): Promise<void> {
      const stub = getStub(run.threadId)
      await stub.putGenerationRun(run.runId, run.threadId, run)
    },
    async get(
      runId: string,
      threadId: string,
    ): Promise<GenerationRunRecord | null> {
      const stub = getStub(threadId)
      const record = await stub.getGenerationRun(runId)
      return (record as GenerationRunRecord | null) ?? null
    },
    async getLatest(threadId: string): Promise<GenerationRunRecord | null> {
      const stub = getStub(threadId)
      const record = await stub.getLatestGenerationRun(threadId)
      return (record as GenerationRunRecord | null) ?? null
    },
  }
}
