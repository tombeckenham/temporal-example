import { getCfEnv } from '../server/cfEnv.ts'

/**
 * Send OTP emails via the Cloudflare Email Service binding, or log the code
 * for local dev (EMAIL_MODE=console). Outside console mode a missing binding
 * is an error — the OTP must never fall back to logs in production.
 */
export async function sendOtpEmail(input: {
  to: string
  otp: string
  type: string
  env?: Cloudflare.Env
}): Promise<void> {
  const env = input.env ?? getCfEnv()

  const from =
    process.env['EMAIL_FROM'] ?? env?.EMAIL_FROM ?? 'noreply@localhost'

  const subject =
    input.type === 'sign-in'
      ? 'Your sign-in code'
      : `Your verification code (${input.type})`

  const text = `Your code is ${input.otp}\n\nIt expires in 10 minutes.`

  const mode = process.env['EMAIL_MODE'] ?? 'console'

  if (mode === 'console') {
    console.info(
      `[email:console] to=${input.to} type=${input.type} otp=${input.otp}`,
    )
    return
  }

  const emailBinding = env?.EMAIL
  if (!emailBinding) {
    throw new Error(
      `EMAIL_MODE=${mode} but the EMAIL binding is not configured — cannot send OTP`,
    )
  }

  await emailBinding.send({
    to: input.to,
    from,
    subject,
    text,
  })
}
