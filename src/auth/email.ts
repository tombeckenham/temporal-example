/**
 * Send OTP emails via Cloudflare Email Service binding when available,
 * otherwise log the code for local dev (EMAIL_MODE=console).
 */
export async function sendOtpEmail(input: {
  to: string
  otp: string
  type: string
  env?: Cloudflare.Env
}): Promise<void> {
  const from =
    process.env['EMAIL_FROM'] ??
    (input.env && 'EMAIL_FROM' in input.env
      ? String((input.env as { EMAIL_FROM?: string }).EMAIL_FROM)
      : undefined) ??
    'noreply@localhost'

  const subject =
    input.type === 'sign-in'
      ? 'Your sign-in code'
      : `Your verification code (${input.type})`

  const text = `Your code is ${input.otp}\n\nIt expires in 10 minutes.`

  const mode = process.env['EMAIL_MODE'] ?? 'console'
  const emailBinding = input.env?.EMAIL

  if (mode === 'console' || !emailBinding) {
    console.info(
      `[email:${mode === 'console' || !emailBinding ? 'console' : 'fallback'}] to=${input.to} type=${input.type} otp=${input.otp}`,
    )
    return
  }

  // Cloudflare Email Service Workers binding (shape may vary by API version)
  const send = emailBinding.send.bind(emailBinding) as (opts: {
    to: string | { email: string }[]
    from: string | { email: string }
    subject: string
    text?: string
  }) => Promise<unknown>

  await send({
    to: input.to,
    from,
    subject,
    text,
  })
}
