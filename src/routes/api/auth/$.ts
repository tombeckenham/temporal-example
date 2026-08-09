import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '../../../auth/server.ts'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => getAuth().handler(request),
      POST: async ({ request }) => getAuth().handler(request),
    },
  },
})
