import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
  getVideoWorkflowStatus,
  startVideoWorkflow,
} from '../server/video.ts'
import type {
  GenerateVideoInput,
  VideoPhase,
  VideoSize,
  VideoWorkflowStatus,
} from '../temporal/types.ts'

export const Route = createFileRoute('/')({ component: Home })

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

function Home() {
  const [prompt, setPrompt] = useState(
    'A glowing crystal-powered rocket launching from the red dunes of Mars at golden hour',
  )
  const [duration, setDuration] = useState(5)
  const [size, setSize] = useState<VideoSize>('16:9_480p')
  const [enhancePrompt, setEnhancePrompt] = useState(true)

  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [executionStatus, setExecutionStatus] = useState<string | null>(null)
  const [status, setStatus] = useState<VideoWorkflowStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const isRunning =
    !!workflowId &&
    status?.phase !== 'completed' &&
    status?.phase !== 'failed' &&
    executionStatus !== 'FAILED' &&
    executionStatus !== 'TERMINATED' &&
    executionStatus !== 'CANCELED' &&
    executionStatus !== 'TIMED_OUT'

  const refreshStatus = useCallback(async (id: string) => {
    const result = await getVideoWorkflowStatus({ data: { workflowId: id } })
    setExecutionStatus(result.executionStatus)
    setStatus(result.status)
    if (result.status.phase === 'failed' || result.status.error) {
      setError(result.status.error ?? result.status.message)
    }
  }, [])

  useEffect(() => {
    if (!workflowId || !isRunning) return

    const tick = () => {
      refreshStatus(workflowId).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }

    tick()
    const interval = setInterval(tick, 2000)
    return () => clearInterval(interval)
  }, [workflowId, isRunning, refreshStatus])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    setExecutionStatus(null)
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

  function reset() {
    setWorkflowId(null)
    setStatus(null)
    setExecutionStatus(null)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10">
          <p className="text-sm font-medium tracking-wide text-violet-400 uppercase">
            Temporal + TanStack AI
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            AI video generation
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-400">
            Submit a prompt → Temporal workflow enhances it with Grok text,
            starts a Grok Imagine video job, then durably polls until the clip
            is ready. Open the{' '}
            <a
              href="http://localhost:8233"
              target="_blank"
              rel="noreferrer"
              className="text-violet-400 underline decoration-violet-400/40 underline-offset-2 hover:text-violet-300"
            >
              Temporal UI
            </a>{' '}
            to watch the event history.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/30"
        >
          <label className="block">
            <span className="text-sm font-medium text-zinc-300">Prompt</span>
            <textarea
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
              disabled={isStarting || isRunning || !prompt.trim()}
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

        {(workflowId || error) && (
          <section className="mt-8 space-y-6">
            {workflowId && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-zinc-300">
                    Workflow
                  </h2>
                  {executionStatus && (
                    <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                      {executionStatus}
                    </span>
                  )}
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
                    Provider URLs can expire — download promptly if you need to
                    keep the clip.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="mt-12 border-t border-zinc-900 pt-6 text-xs text-zinc-600">
          <p>
            Requires: Temporal server (:7233), worker process, and{' '}
            <code className="text-zinc-500">XAI_API_KEY</code> in{' '}
            <code className="text-zinc-500">.env.local</code>.
          </p>
        </footer>
      </div>
    </div>
  )
}
