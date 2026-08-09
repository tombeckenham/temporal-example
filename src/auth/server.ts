import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { emailOTP } from 'better-auth/plugins'
import { getDb } from '../db/index.ts'
import { authSchema } from '../db/schema.ts'
import { newId } from '../lib/id.ts'
import { sendOtpEmail } from './email.ts'

function authSecret(): string {
  const secret = process.env['BETTER_AUTH_SECRET']
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
  return process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000'
}

function createAuth() {
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
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtpEmail({ to: email, otp, type })
        },
      }),
    ],
  })
}

type AuthInstance = ReturnType<typeof createAuth>

let _auth: AuthInstance | undefined

/** Lazy Better Auth — avoids reading secrets at import time on Workers. */
export function getAuth(): AuthInstance {
  if (!_auth) {
    _auth = createAuth()
  }
  return _auth
}

/** Convenience alias used by route handlers */
export const auth = new Proxy(Object.create(null) as AuthInstance, {
  get(_t, prop, receiver) {
    return Reflect.get(getAuth(), prop, receiver) as unknown
  },
})

export type Session = AuthInstance['$Infer']['Session']
