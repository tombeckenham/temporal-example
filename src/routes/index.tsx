import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authClient } from '../auth/client.ts'
import { listMyJobs, type VideoJobRow } from '../server/jobs.ts'
import { getSession, type PublicSession } from '../server/session.ts'
import { startVideoWorkflow } from '../server/video.ts'
import type {
  GenerateVideoInput,
  VideoPhase,
  VideoSize,
  VideoWorkflowStatus,
} from '../temporal/types.ts'

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => {
    if (process.env['E2E_BYPASS_AUTH'] === '1') {
      return {
        session: {
          user: {
            id: 'e2e-user',
            email: 'e2e@example.com',
            name: 'E2E User',
          },
        } satisfies PublicSession,
        jobs: [] as VideoJobRow[],
      }
    }
    const session = await getSession()
    let jobs: VideoJobRow[] = []
    if (session?.user) {
      try {
        jobs = await listMyJobs({ data: { limit: 12 } })
      } catch {
        jobs = []
      }
    }
    return { session, jobs }
  },
})

const PHASES: VideoPhase[] = [
  'enhancing',
  'starting',
  'generating',
  'completed',
]

const SIZE_OPTIONS = [
  { value: '16:9_480p', label: '16:9 · 480p (fast)' },
  { value: '16:9_720p', label: '16:9 · 720p' },
  { value: '9:16_480p', label: '9:16 · 480p (vertical)' },
  { value: '1:1_480p', label: '1:1 · 480p' },
] as const

type WsMessage =
  | { type: 'hello'; status: null }
  | { type: 'status'; status: VideoWorkflowStatus | null; updatedAt: string | null }

function jobWebSocketUrl(workflowId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/jobs/${encodeURIComponent(workflowId)}`
}

function Home() {
  const { session: initialSession, jobs: initialJobs } = Route.useLoaderData()
  const [session, setSession] = useState<PublicSession>(initialSession)
  const [jobs, setJobs] = useState<VideoJobRow[]>(initialJobs)

  const [prompt, setPrompt] = useState(
    'A glowing crystal-powered rocket launching from the red dunes of Mars at golden hour',
  )
  const [duration, setDuration] = useState(5)
  const [size, setSize] = useState<VideoSize>('16:9_480p')
  const [enhancePrompt, setEnhancePrompt] = useState(true)

  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [status, setStatus] = useState<VideoWorkflowStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [wsState, setWsState] = useState<'idle' | 'connecting' | 'open' | 'closed'>(
    'idle',
  )
  const wsRef = useRef<WebSocket | null>(null)

  const signedIn = !!session?.user

  const refreshJobs = useCallback(async () => {
    if (process.env['E2E_BYPASS_AUTH'] === '1') return
    if (!session?.user) return
    try {
      const next = await listMyJobs({ data: { limit: 12 } })
      setJobs(next)
    } catch {
      // listing is secondary — don't surface as primary error
    }
  }, [session?.user])

  const isRunning =
    !!workflowId &&
    status?.phase !== 'completed' &&
    status?.phase !== 'failed'

  const applyStatus = useCallback(
    (next: VideoWorkflowStatus | null) => {
      if (!next) return
      setStatus(next)
      if (next.phase === 'failed' || next.error) {
        setError(next.error ?? next.message)
      }
      if (next.phase === 'completed' || next.phase === 'failed') {
        void refreshJobs()
      }
    },
    [refreshJobs],
  )

  // Real-time: JobRoom Durable Object WebSocket (no Temporal poll storm)
  useEffect(() => {
    if (!workflowId || !isRunning) {
      wsRef.current?.close()
      wsRef.current = null
      if (!workflowId) setWsState('idle')
      return
    }

    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const connect = () => {
      if (cancelled) return
      setWsState('connecting')
      const ws = new WebSocket(jobWebSocketUrl(workflowId))
      wsRef.current = ws

      ws.onopen = () => {
        attempt = 0
        setWsState('open')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WsMessage
          if (msg.type === 'status') {
            applyStatus(msg.status)
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }

      ws.onerror = () => {
        // onclose handles reconnect
      }

      ws.onclose = () => {
        setWsState('closed')
        if (cancelled) return
        // Still running? reconnect with backoff
        attempt += 1
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000)
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [workflowId, isRunning, applyStatus])

  // HTTP snapshot fallback if WS is slow to deliver first status
  useEffect(() => {
    if (!workflowId || !isRunning) return
    if (status) return

    const controller = new AbortController()
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(workflowId)}`,
          { signal: controller.signal },
        )
        if (!res.ok) return
        const body = (await res.json()) as {
          status: VideoWorkflowStatus | null
        }
        if (body.status) applyStatus(body.status)
      } catch {
        // ignore abort / transient
      }
    }

    void tick()
    const interval = setInterval(() => void tick(), 5000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [workflowId, isRunning, status, applyStatus])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!signedIn) {
      setError('Sign in required')
      return
    }
    setError(null)
    setStatus(null)
    setWorkflowId(null)
    setIsStarting(true)

    try {
      const input: GenerateVideoInput = {
        prompt,
        duration,
        size,
        enhancePrompt,
      }
      const { workflowId: id } = await startVideoWorkflow({ data: input })
      setWorkflowId(id)
      void refreshJobs()
      setStatus({
        phase: enhancePrompt ? 'enhancing' : 'starting',
        prompt,
        message: 'Workflow started…',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStarting(false)
    }
  }

  async function signOut() {
    await authClient.signOut()
    setSession(null)
  }

  function reset() {
    wsRef.current?.close()
    setWorkflowId(null)
    setStatus(null)
    setError(null)
    setWsState('idle')
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium tracking-wide text-violet-400 uppercase">
                Temporal + TanStack AI + Cloudflare
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                AI video generation
              </h1>
            </div>
            <div className="text-sm text-zinc-400">
              {signedIn && session ? (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-300">{session.user.email}</span>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-500"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-zinc-400">
            Submit a prompt → Temporal workflow enhances it with Grok text,
            starts a Grok Imagine video job, then durably polls until the clip
            is ready. Live progress is pushed over a{' '}
            <strong className="font-medium text-zinc-300">
              Durable Object WebSocket
            </strong>
            . Completed clips are stored in R2.
          </p>
          {!signedIn && (
            <p className="mt-3 text-sm text-amber-200/90">
              <Link to="/login" className="underline">
                Sign in with email OTP
              </Link>{' '}
              to generate videos.
            </p>
          )}
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/30"
        >
          <label className="block">
            <span className="text-sm font-medium text-zinc-300">Prompt</span>
            <textarea
              aria-label="Prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              disabled={isStarting || isRunning}
              className="mt-2 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none ring-violet-500/40 placeholder:text-zinc-600 focus:ring-2 disabled:opacity-60"
              placeholder="Describe the video you want…"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">
                Duration (seconds)
              </span>
              <input
                type="number"
                min={1}
                max={15}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={isStarting || isRunning}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 outline-none ring-violet-500/40 focus:ring-2 disabled:opacity-60"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Size</span>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as VideoSize)}
                disabled={isStarting || isRunning}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 outline-none ring-violet-500/40 focus:ring-2 disabled:opacity-60"
              >
                {SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              aria-label="Enhance prompt with Grok text before video gen"
              checked={enhancePrompt}
              onChange={(e) => setEnhancePrompt(e.target.checked)}
              disabled={isStarting || isRunning}
              className="size-4 rounded border-zinc-600 bg-zinc-950 text-violet-500 focus:ring-violet-500"
            />
            <span className="text-sm text-zinc-300">
              Enhance prompt with Grok text before video gen
            </span>
          </label>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="submit"
              disabled={
                !signedIn || isStarting || isRunning || !prompt.trim()
              }
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStarting
                ? 'Starting workflow…'
                : isRunning
                  ? 'Generating…'
                  : 'Generate video'}
            </button>
            {(workflowId || error) && (
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
              >
                Reset
              </button>
            )}
          </div>
        </form>

        {signedIn && jobs.length > 0 && (
          <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-sm font-medium text-zinc-300">Recent videos</h2>
            <ul className="mt-3 divide-y divide-zinc-800">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-200">{job.prompt}</p>
                    <p className="mt-0.5 font-mono text-xs text-zinc-600">
                      {job.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                        job.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : job.status === 'failed'
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {job.status}
                    </span>
                    {job.videoUrl ? (
                      <a
                        href={job.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-violet-400 hover:text-violet-300"
                      >
                        Open
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-zinc-400 hover:text-zinc-200"
                        onClick={() => {
                          setWorkflowId(job.id)
                          setStatus(null)
                          setError(null)
                        }}
                      >
                        Watch
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(workflowId || error) && (
          <section className="mt-8 space-y-6">
            {workflowId && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-zinc-300">
                    Workflow
                  </h2>
                  <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                    WS: {wsState}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs break-all text-zinc-500">
                  {workflowId}
                </p>

                <ol className="mt-5 space-y-2">
                  {PHASES.map((phase) => {
                    const active = status?.phase === phase
                    const done =
                      status &&
                      PHASES.indexOf(status.phase) > PHASES.indexOf(phase)
                    return (
                      <li
                        key={phase}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                          active
                            ? 'bg-violet-500/15 text-violet-200'
                            : done
                              ? 'text-emerald-400/90'
                              : 'text-zinc-600'
                        }`}
                      >
                        <span
                          className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                            active
                              ? 'bg-violet-500 text-white'
                              : done
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {done ? '✓' : PHASES.indexOf(phase) + 1}
                        </span>
                        <span className="capitalize">{phase}</span>
                      </li>
                    )
                  })}
                </ol>

                {status && (
                  <div className="mt-5 space-y-2 border-t border-zinc-800 pt-4 text-sm">
                    <p className="text-zinc-300">{status.message}</p>
                    {status.enhancedPrompt &&
                      status.enhancedPrompt !== status.prompt && (
                        <div>
                          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                            Enhanced prompt
                          </p>
                          <p className="mt-1 text-zinc-400">
                            {status.enhancedPrompt}
                          </p>
                        </div>
                      )}
                    {status.jobId && (
                      <p className="font-mono text-xs text-zinc-600">
                        xAI job: {status.jobId}
                      </p>
                    )}
                    {status.progress != null && status.phase === 'generating' && (
                      <div className="pt-1">
                        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-violet-500 transition-all"
                            style={{ width: `${status.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {status?.videoUrl && (
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
                <video
                  src={status.videoUrl}
                  controls
                  autoPlay
                  className="aspect-video w-full"
                />
                <div className="border-t border-zinc-800 px-4 py-3">
                  <a
                    href={status.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-violet-400 hover:text-violet-300"
                  >
                    Open video URL
                  </a>
                  <p className="mt-1 text-xs text-zinc-600">
                    Served from R2 when persist succeeds; otherwise a temporary provider URL.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="mt-12 border-t border-zinc-900 pt-6 text-xs text-zinc-600">
          <p>
            Requires: Temporal + worker/gateway (:8788), web app,{' '}
            <code className="text-zinc-500">XAI_API_KEY</code>, and{' '}
            <code className="text-zinc-500">TEMPORAL_STARTER_SECRET</code>. Edge
            status path: JobRoom DO (not D1).
          </p>
        </footer>
      </div>
    </div>
  )
}
