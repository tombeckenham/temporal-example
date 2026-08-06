import { Client, Connection } from '@temporalio/client'

const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'default'

let clientPromise: Promise<Client> | undefined

/**
 * Shared Temporal client for server functions.
 * Lazy-connects so importing this module does not require Temporal at build time.
 */
export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({ address }).then(
      (connection) =>
        new Client({
          connection,
          namespace,
        }),
    )
  }
  return clientPromise
}
