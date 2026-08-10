import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { VideoJobRow } from '../db/scoped/jobs.ts'
import { authMiddleware } from './middleware.ts'

export type { VideoJobRow }

/**
 * List the current user's recent video jobs (Postgres index — not live DO status).
 * Auth and user scoping are enforced by authMiddleware / context.scopedDb.
 */
export const listMyJobsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ limit: z.number().int().min(1).max(50).optional() }))
  .handler(async ({ data, context }): Promise<VideoJobRow[]> => {
    return context.scopedDb.jobs.list({ limit: data.limit })
  })
