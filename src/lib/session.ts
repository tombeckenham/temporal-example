import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getAuth } from '../auth/server.ts'

export type PublicSession = {
  user: {
    id: string
    email: string
    name: string
  }
} | null

export const getSessionFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicSession> => {
    const session = await getAuth().api.getSession({
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
