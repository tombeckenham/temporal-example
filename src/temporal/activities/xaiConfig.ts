/**
 * Shared Grok / xAI client options for activities.
 *
 * Production: defaults to https://api.x.ai/v1 via the adapter.
 * E2E: set XAI_BASE_URL=http://127.0.0.1:4010/v1 and XAI_API_KEY=mock
 *      so TanStack AI talks to CopilotKit AIMock instead of live xAI.
 */
export function xaiClientConfig(): { baseURL: string } | undefined {
  const baseURL = process.env['XAI_BASE_URL']?.trim()
  if (!baseURL) return undefined
  return { baseURL: baseURL.replace(/\/$/, '') }
}
