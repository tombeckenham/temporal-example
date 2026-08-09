import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { E2E_USER_ID, isAuthBypassed } from './authBypass.ts'

export type PublicSession = {
  user: {
    id: string
    email: string
    name: string
  }
} | null

export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicSession> => {
    if (isAuthBypassed()) {
      return {
        user: {
          id: E2E_USER_ID,
          email: 'e2e@example.com',
          name: 'E2E User',
        },
      }
    }
    const { auth } = await import('../auth/server.ts')
    const session = await auth.api.getSession({
      headers: getRequest().headers,
    })
    if (!session?.user) return null
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    }
  },
)

/** Resolve session from a Request (API / server handlers). */
export async function sessionFromRequest(request: Request) {
  const { auth } = await import('../auth/server.ts')
  return auth.api.getSession({ headers: request.headers })
}
