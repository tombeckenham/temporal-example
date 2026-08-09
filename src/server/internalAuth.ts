/**
 * HMAC helpers for Temporal worker → Cloudflare edge webhooks.
 * Works in both Node (gateway/worker) and Workers (Web Crypto).
 */

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return [...view].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256(
  secret: string,
  body: string,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
}

export async function signBody(secret: string, body: string): Promise<string> {
  const sig = await hmacSha256(secret, body)
  return bytesToHex(sig)
}

export async function verifyBodySignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false
  const expected = await signBody(secret, body)
  // Constant-time-ish compare
  if (expected.length !== signatureHeader.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i)
  }
  return mismatch === 0
}
