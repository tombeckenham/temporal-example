import { DurableObject } from 'cloudflare:workers'
import type { VideoWorkflowStatus } from '../temporal/types.ts'

export interface JobNotifyPayload {
  status: VideoWorkflowStatus
  /** ISO timestamp — older notifies are ignored */
  updatedAt: string
}

interface StoredRow {
  payload: string
  updated_at: string
}

/** Re-check generating jobs if no notify arrives for this long (ms). */
const STUCK_ALARM_MS = 2 * 60_000
/** Stop rebroadcasting after this many alarms (abandoned jobs must not wake forever). */
const STUCK_ALARM_MAX = 15

/**
 * One Durable Object per video workflow.
 *
 * - Holds latest status in SQLite (source of truth for the UI)
 * - Accepts hibernating WebSockets and pushes status on notify()
 * - Alarm rebroadcasts last status if a job looks stuck (capped)
 * - Scales horizontally: millions of jobs ⇒ millions of independent objects
 *
 * D1 is intentionally not used for live status — see plan storage section.
 */
export class JobRoom extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS job_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generation_run (
        run_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        record TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS generation_run_thread
        ON generation_run (thread_id, updated_at DESC);
    `)
  }

  override async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade')
    if (upgrade?.toLowerCase() === 'websocket') {
      return this.acceptWebSocket()
    }

    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname.endsWith('/status')) {
      const status = await this.getStatus()
      if (!status) {
        return Response.json({ status: null }, { status: 404 })
      }
      return Response.json({ status })
    }

    return new Response('Not found', { status: 404 })
  }

  /** RPC: push a new status snapshot and broadcast to all sockets. */
  async notify(payload: JobNotifyPayload): Promise<{ accepted: boolean }> {
    const existing = this.readRow()
    if (
      existing &&
      Date.parse(payload.updatedAt) < Date.parse(existing.updated_at)
    ) {
      return { accepted: false }
    }

    const json = JSON.stringify(payload.status)
    this.ctx.storage.sql.exec(
      `INSERT INTO job_status (id, payload, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      json,
      payload.updatedAt,
    )

    const message = JSON.stringify({
      type: 'status',
      status: payload.status,
      updatedAt: payload.updatedAt,
    })

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message)
      } catch {
        // Drop broken sockets; hibernation runtime will clean them up
      }
    }

    await this.scheduleAlarmForPhase(payload.status.phase)

    return { accepted: true }
  }

  /**
   * If a job stays in a non-terminal phase with no new notifies, rebroadcast
   * last status so reconnecting clients recover. Capped so abandoned DOs sleep.
   * Does not call Temporal (hot path stays free of gRPC).
   */
  override async alarm(): Promise<void> {
    const row = this.readRow()
    if (!row) {
      await this.ctx.storage.deleteAlarm()
      return
    }

    const status = JSON.parse(row.payload) as VideoWorkflowStatus
    if (status.phase === 'completed' || status.phase === 'failed') {
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.delete('alarmCount')
      return
    }

    const prev = (await this.ctx.storage.get<number>('alarmCount')) ?? 0
    const next = prev + 1
    await this.ctx.storage.put('alarmCount', next)

    const message = JSON.stringify({
      type: 'status',
      status,
      updatedAt: row.updated_at,
      stale: true,
    })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message)
      } catch {
        // ignore broken sockets
      }
    }

    if (next >= STUCK_ALARM_MAX) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Date.now() + STUCK_ALARM_MS)
  }

  private async scheduleAlarmForPhase(phase: VideoWorkflowStatus['phase']): Promise<void> {
    if (phase === 'completed' || phase === 'failed') {
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.delete('alarmCount')
      return
    }
    // Fresh notify resets the stuck counter
    await this.ctx.storage.put('alarmCount', 0)
    await this.ctx.storage.setAlarm(Date.now() + STUCK_ALARM_MS)
  }

  /** RPC: read last known status (for HTTP fallback / hydrate). */
  async getStatus(): Promise<VideoWorkflowStatus | null> {
    const row = this.readRow()
    if (!row) return null
    return JSON.parse(row.payload) as VideoWorkflowStatus
  }

  /**
   * RPC: store a TanStack AI generation-run record (persistence adapter).
   * Keyed by runId; threadId is typically the workflowId.
   */
  async putGenerationRun(
    runId: string,
    threadId: string,
    record: unknown,
  ): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO generation_run (run_id, thread_id, record, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         record = excluded.record,
         updated_at = excluded.updated_at`,
      runId,
      threadId,
      JSON.stringify(record),
      new Date().toISOString(),
    )
  }

  async getGenerationRun(runId: string): Promise<unknown | null> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT record FROM generation_run WHERE run_id = ? LIMIT 1`,
        runId,
      )
      .toArray()[0] as { record: string } | undefined
    if (!row) return null
    return JSON.parse(row.record) as unknown
  }

  async getLatestGenerationRun(threadId: string): Promise<unknown | null> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT record FROM generation_run
         WHERE thread_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        threadId,
      )
      .toArray()[0] as { record: string } | undefined
    if (!row) return null
    return JSON.parse(row.record) as unknown
  }

  private acceptWebSocket(): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Hibernation API — DO can sleep while sockets stay open
    this.ctx.acceptWebSocket(server)

    // Late joiner: send last status immediately
    const row = this.readRow()
    if (row) {
      server.send(
        JSON.stringify({
          type: 'status',
          status: JSON.parse(row.payload) as VideoWorkflowStatus,
          updatedAt: row.updated_at,
        }),
      )
    } else {
      server.send(JSON.stringify({ type: 'hello', status: null }))
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Clients may ping; reply with current status on "ping" / "getStatus"
    const text =
      typeof message === 'string' ? message : new TextDecoder().decode(message)
    if (text === 'ping' || text === 'getStatus') {
      const status = await this.getStatus()
      ws.send(
        JSON.stringify({
          type: 'status',
          status,
          updatedAt: this.readRow()?.updated_at ?? null,
        }),
      )
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ) {
    ws.close(code, reason)
  }

  private readRow(): StoredRow | null {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT payload, updated_at FROM job_status WHERE id = 1 LIMIT 1`,
      )
      .toArray()[0] as StoredRow | undefined
    return row ?? null
  }
}
