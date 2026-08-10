import type { APIRequestContext, Page } from '@playwright/test'
import {
  E2E_FIXED_OTP,
  E2E_PORTS,
  E2E_USER_EMAIL,
  E2E_USER_NAME,
} from './constants.ts'

const origin = `http://127.0.0.1:${E2E_PORTS.app}`

/**
 * Sign in via Better Auth email OTP using the DEV fixed OTP (E2E_FIXED_OTP=1).
 * Cookies land on the browser context for subsequent page navigations.
 */
export async function signInE2e(
  page: Page,
  options?: { email?: string; name?: string },
): Promise<void> {
  const email = options?.email ?? E2E_USER_EMAIL
  const name = options?.name ?? E2E_USER_NAME
  await signInE2eWithRequest(page.request, { email, name })
}

export async function signInE2eWithRequest(
  request: APIRequestContext,
  options?: { email?: string; name?: string },
): Promise<void> {
  const email = options?.email ?? E2E_USER_EMAIL
  const name = options?.name ?? E2E_USER_NAME

  const send = await request.post(
    `${origin}/api/auth/email-otp/send-verification-otp`,
    {
      data: { email, type: 'sign-in' },
      headers: {
        origin,
        'content-type': 'application/json',
      },
    },
  )
  if (!send.ok()) {
    throw new Error(`send OTP failed: ${send.status()} ${await send.text()}`)
  }

  const signIn = await request.post(`${origin}/api/auth/sign-in/email-otp`, {
    data: { email, otp: E2E_FIXED_OTP, name },
    headers: {
      origin,
      'content-type': 'application/json',
    },
  })
  if (!signIn.ok()) {
    throw new Error(
      `sign-in OTP failed: ${signIn.status()} ${await signIn.text()}`,
    )
  }
}
