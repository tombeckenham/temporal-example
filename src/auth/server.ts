import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { emailOTP } from 'better-auth/plugins'
import { getDb } from '../db/index.ts'
import { authSchema } from '../db/schema.ts'
import { newId } from '../lib/id.ts'
import { getEnv } from '../lib/env.ts'
import { perRequest } from '../lib/requestScope.ts'
import { sendOtpEmail } from './email.ts'

function authSecret(): string {
  const secret = getEnv()['BETTER_AUTH_SECRET']
  if (!secret || secret.length < 16) {
    // Dev-server fallback so the app can boot; production builds compile
    // import.meta.env.DEV to false and always require a real secret
    // (NODE_ENV is unreliable on the Workers runtime — often unset).
    if (import.meta.env.DEV) {
      return 'dev-only-better-auth-secret-change-me'
    }
    throw new Error(
      'BETTER_AUTH_SECRET is required (min 16 chars). Generate with: openssl rand -base64 32',
    )
  }
  return secret
}

function authBaseUrl(): string {
  return getEnv()['BETTER_AUTH_URL'] ?? 'http://localhost:3000'
}

/**
 * Playwright e2e uses a fixed OTP so tests can complete email sign-in without
 * scraping logs. Only active when Vite DEV + E2E_FIXED_OTP=1 (set by e2e/run).
 * Production bundles compile import.meta.env.DEV to false.
 */
function e2eFixedOtpEnabled(): boolean {
  return import.meta.env.DEV && getEnv()['E2E_FIXED_OTP'] === '1'
}

const E2E_OTP = '424242'

function createAuth() {
  const emailOtpOptions = {
    otpLength: 6,
    expiresIn: 600,
    async sendVerificationOTP({
      email,
      otp,
      type,
    }: {
      email: string
      otp: string
      type: string
    }) {
      await sendOtpEmail({ to: email, otp, type })
    },
    ...(e2eFixedOtpEnabled() ? { generateOTP: () => E2E_OTP } : {}),
  }

  return betterAuth({
    secret: authSecret(),
    baseURL: authBaseUrl(),
    trustedOrigins: [authBaseUrl()],
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: authSchema,
    }),
    advanced: {
      database: {
        // user / session / account / verification primary keys
        generateId: () => newId(),
      },
    },
    emailAndPassword: {
      enabled: false,
    },
    plugins: [emailOTP(emailOtpOptions)],
  })
}

type AuthInstance = ReturnType<typeof createAuth>

/**
 * Better Auth, built once per request. It cannot be a module-level singleton:
 * the Drizzle adapter captures the client it is handed at construction, and a
 * client from an earlier request is a dead socket on Workers. Construction is
 * pure CPU (plugin + route wiring), so per-request costs no I/O.
 */
export const getAuth = perRequest(createAuth)

export type Session = AuthInstance['$Infer']['Session']
