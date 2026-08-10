import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '../auth/client.ts'

function sanitizeRedirect(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) {
    return '/'
  }
  return url
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    if (search['redirect'] === undefined) return {}
    return { redirect: sanitizeRedirect(search['redirect']) }
  },
  // Already signed in? Don't show the form.
  beforeLoad: ({ context, search }) => {
    if (context.session?.user) {
      throw redirect({ href: sanitizeRedirect(search.redirect) })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const search = Route.useSearch()
  const redirectTo = sanitizeRedirect(search.redirect)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: 'sign-in',
      })
      if (err) {
        setError(err.message ?? 'Failed to send code')
        return
      }
      setStep('otp')
      setHint(
        'Check your email for a 6-digit code. Locally, codes are printed in the server log (EMAIL_MODE=console).',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { error: err } = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: otp.trim(),
      })
      if (err) {
        setError(err.message ?? 'Invalid code')
        return
      }
      // Cookie is set — re-run root beforeLoad so session is on route context
      await router.invalidate()
      await navigate({ to: redirectTo })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-sm font-medium tracking-wide text-violet-400 uppercase">
          Sign in
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Email one-time code
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          No password — we email a 6-digit code.
        </p>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="mt-8 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 outline-none ring-violet-500/40 focus:ring-2"
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="w-full rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="mt-8 space-y-4">
            <p className="text-sm text-zinc-400">
              Code sent to <span className="text-zinc-200">{email}</span>
            </p>
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 font-mono tracking-widest outline-none ring-violet-500/40 focus:ring-2"
                placeholder="123456"
              />
            </label>
            <button
              type="submit"
              disabled={busy || otp.trim().length < 4}
              className="w-full rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setOtp('')
                setError(null)
              }}
              className="w-full text-sm text-zinc-500 hover:text-zinc-300"
            >
              Use a different email
            </button>
          </form>
        )}

        {hint && <p className="mt-4 text-xs text-zinc-500">{hint}</p>}
        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
