import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { authClient } from '../auth/client.ts'
import { listMyJobsFn } from '../lib/jobs.ts'
import type { VideoJobRow } from '../lib/jobs.ts'
import { getSessionFn } from '../lib/session.ts'
import type { PublicSession } from '../lib/session.ts'
import { startVideoWorkflowFn } from '../lib/video.ts'
import type {
  GenerateVideoInput,
  VideoSize,
  VideoWorkflowStatus,
} from '../temporal/types.ts'

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => {
    // E2E bypass is handled inside the server functions — this loader also
    // runs in the browser, where process.env does not exist.
    const session = await getSessionFn()
    let jobs: VideoJobRow[] = []
    if (session?.user) {
      try {
        jobs = await listMyJobsFn({ data: { limit: 12 } })
      } catch {
        jobs = []
      }
    }
    return { session, jobs }
  },
})

/** Grok Imagine accepts integer durations 1–15s (GROK_VIDEO_MIN/MAX_DURATION) */
const DURATION_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 1)

const SIZE_OPTIONS = [
  { value: '16:9_480p', label: '16:9 · 480p (fast)' },
  { value: '16:9_720p', label: '16:9 · 720p' },
  { value: '9:16_480p', label: '9:16 · 480p (vertical)' },
  { value: '1:1_480p', label: '1:1 · 480p' },
] as const

/** Starter prompts for the shuffle button — striking characters, surreal settings */
const SAMPLE_PROMPTS = [
  'A woman in a mirrored evening gown crossing a salt flat at dusk, her reflection walking one step behind her',
  'A masked figure in a red silk suit walking calmly through a burning ballroom, embers swirling like snow',
  'A tango dancer spinning through a smoke-filled Buenos Aires bar, her dress trailing sparks with every turn',
  'Slow orbit around a samurai standing on a moving train roof, cherry blossoms frozen mid-air around him',
  'A jazz singer in a sequined dress on a rooftop stage, the city lights drifting toward her like moths',
  'A matador in a glittering suit of lights facing down an oncoming sandstorm instead of a bull',
  'A biker in chrome leathers stopped on a desert highway, the aurora borealis reflected in her visor',
  'A ballerina rehearsing alone in a flooded theater, each pirouette sending rings across the mirror-still water',
  'A couple slow-dancing on the wing of a parked 747 at golden hour, wind tugging at her scarf',
  'A street magician in a velvet coat levitating a storm of playing cards around a stunned crowd in a neon alley',
  'An astronaut opens a weathered door standing alone in the desert and steps through into a rolling ocean',
  'A detective in a rain-soaked trench coat under a flickering streetlamp, every raindrop freezing as she looks up',
] as const

type WsMessage =
  | { type: 'hello'; status: null }
  | {
      type: 'status'
      status: VideoWorkflowStatus | null
      updatedAt: string | null
    }

function jobWebSocketUrl(workflowId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/jobs/${encodeURIComponent(workflowId)}`
}

function Home() {
  const { session: initialSession, jobs: initialJobs } = Route.useLoaderData()
  const [session, setSession] = useState<PublicSession>(initialSession)
  const [jobs, setJobs] = useState<VideoJobRow[]>(initialJobs)
  /** Jobs started this session — shown immediately, before the DB list catches up */
  const [localJobs, setLocalJobs] = useState<VideoJobRow[]>([])
  /** Latest pushed status per running job (JobRoom WebSocket) */
  const [liveStatuses, setLiveStatuses] = useState<
    Record<string, VideoWorkflowStatus>
  >({})

  // Fixed initial value (not random) so SSR and hydration render the same
  const [prompt, setPrompt] = useState<string>(SAMPLE_PROMPTS[0])
  const [duration, setDuration] = useState(5)
  const [size, setSize] = useState<VideoSize>('16:9_480p')
  const [enhancePrompt, setEnhancePrompt] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const signedIn = !!session?.user

  const refreshJobs = useCallback(async () => {
    if (!session?.user) return
    try {
      const next = await listMyJobsFn({ data: { limit: 12 } })
      setJobs(next)
    } catch {
      // listing is secondary — don't surface as primary error
    }
  }, [session?.user])

  const merged: VideoJobRow[] = [
    ...localJobs.filter((local) => !jobs.some((job) => job.id === local.id)),
    ...jobs,
  ]

  /** DB status, overridden by a fresher live phase from the WebSocket */
  function effectiveStatus(job: VideoJobRow): string {
    const phase = liveStatuses[job.id]?.phase
    if (phase === 'completed' || phase === 'failed') return phase
    return job.status
  }

  const runningKey = merged
    .filter((job) => effectiveStatus(job) === 'running')
    .map((job) => job.id)
    .join(',')

  const applyLiveStatus = useCallback(
    (id: string, next: VideoWorkflowStatus | null) => {
      if (!next) return
      setLiveStatuses((prev) => ({ ...prev, [id]: next }))
      if (next.phase === 'completed' || next.phase === 'failed') {
        void refreshJobs()
      }
    },
    [refreshJobs],
  )

  // One JobRoom WebSocket per running job; each pushes its last snapshot on
  // connect, so a page refresh repopulates progress without extra requests.
  useEffect(() => {
    if (!runningKey) return

    let cancelled = false
    const sockets = new Set<WebSocket>()
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const connect = (id: string, attempt: number) => {
      if (cancelled) return
      const ws = new WebSocket(jobWebSocketUrl(id))
      sockets.add(ws)

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WsMessage
          if (msg.type === 'status') {
            applyLiveStatus(id, msg.status)
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }

      ws.onclose = () => {
        sockets.delete(ws)
        if (cancelled) return
        // Still running? reconnect with backoff
        const delay = Math.min(1000 * 2 ** Math.min(attempt + 1, 4), 15_000)
        timers.add(setTimeout(() => connect(id, attempt + 1), delay))
      }
    }

    for (const id of runningKey.split(',')) connect(id, 0)

    return () => {
      cancelled = true
      for (const timer of timers) clearTimeout(timer)
      for (const ws of sockets) ws.close()
    }
  }, [runningKey, applyLiveStatus])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!signedIn) {
      setError('Sign in required')
      return
    }
    setError(null)
    setIsStarting(true)

    try {
      const input: GenerateVideoInput = {
        prompt,
        duration,
        size,
        enhancePrompt,
      }
      const { workflowId } = await startVideoWorkflowFn({ data: input })
      const now = new Date().toISOString()
      setLocalJobs((prev) => [
        {
          id: workflowId,
          prompt,
          status: 'running',
          videoUrl: null,
          createdAt: now,
          updatedAt: now,
        },
        ...prev,
      ])
      void refreshJobs()
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

  function shufflePrompt() {
    const others = SAMPLE_PROMPTS.filter((p) => p !== prompt)
    const next = others[Math.floor(Math.random() * others.length)]
    if (next) setPrompt(next)
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium tracking-wide text-violet-400 uppercase">
                video-at-scale
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                AI video at scale
              </h1>
            </div>
            <div className="text-sm text-zinc-400">
              {session ? (
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
            <span className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">Prompt</span>
              <button
                type="button"
                onClick={shufflePrompt}
                disabled={isStarting}
                className="text-xs font-medium text-violet-400 transition hover:text-violet-300 disabled:opacity-50"
              >
                🎲 Shuffle prompt
              </button>
            </span>
            <textarea
              aria-label="Prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              disabled={isStarting}
              className="mt-2 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none ring-violet-500/40 placeholder:text-zinc-600 focus:ring-2 disabled:opacity-60"
              placeholder="Describe the video you want…"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">
                Duration
              </span>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={isStarting}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 outline-none ring-violet-500/40 focus:ring-2 disabled:opacity-60"
              >
                {DURATION_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} {seconds === 1 ? 'second' : 'seconds'}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Size</span>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as VideoSize)}
                disabled={isStarting}
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
              disabled={isStarting}
              className="size-4 rounded border-zinc-600 bg-zinc-950 text-violet-500 focus:ring-violet-500"
            />
            <span className="text-sm text-zinc-300">
              Enhance prompt with Grok text before video gen
            </span>
          </label>

          <div className="pt-1">
            <button
              type="submit"
              disabled={!signedIn || isStarting || !prompt.trim()}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStarting ? 'Starting workflow…' : 'Generate video'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {signedIn && merged.length > 0 && (
          <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-sm font-medium text-zinc-300">Videos</h2>
            <ul className="mt-3 divide-y divide-zinc-800">
              {merged.map((job) => {
                const live = liveStatuses[job.id]
                const shown = effectiveStatus(job)
                const videoUrl = job.videoUrl ?? live?.videoUrl ?? null
                return (
                  <li key={job.id} className="py-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-zinc-200">{job.prompt}</p>
                        <p className="mt-0.5 font-mono text-xs text-zinc-600">
                          {job.id}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                          shown === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : shown === 'failed'
                              ? 'bg-red-500/15 text-red-300'
                              : 'bg-violet-500/15 text-violet-300'
                        }`}
                      >
                        {shown}
                      </span>
                    </div>

                    {live && !videoUrl && (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-zinc-400">{live.message}</p>
                        {live.enhancedPrompt &&
                          live.enhancedPrompt !== live.prompt && (
                            <p className="text-xs text-zinc-500 italic">
                              {live.enhancedPrompt}
                            </p>
                          )}
                        {live.error && (
                          <p className="text-xs text-red-300">{live.error}</p>
                        )}
                        {live.progress != null &&
                          live.phase === 'generating' && (
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-violet-500 transition-all"
                                style={{ width: `${live.progress}%` }}
                              />
                            </div>
                          )}
                      </div>
                    )}

                    {live && videoUrl && (
                      <p className="mt-2 text-xs text-zinc-400">
                        {live.message}
                      </p>
                    )}

                    {videoUrl && (
                      <video
                        src={videoUrl}
                        controls
                        preload="metadata"
                        className="mt-2 aspect-video w-full rounded-xl border border-zinc-800 bg-black"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
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
