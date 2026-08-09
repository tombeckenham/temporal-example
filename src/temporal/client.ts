import { Client, Connection } from '@temporalio/client'
import { readFileSync } from 'node:fs'

const address = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const namespace = process.env['TEMPORAL_NAMESPACE'] ?? 'default'

let clientPromise: Promise<Client> | undefined

/**
 * Shared Temporal client for the Node worker / HTTP gateway only.
 * Never import this from Cloudflare Workers edge code.
 *
 * Temporal Cloud: set TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, and either:
 *   - TEMPORAL_API_KEY, or
 *   - TEMPORAL_TLS_CERT_PATH + TEMPORAL_TLS_KEY_PATH (mTLS)
 */
export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect().then(
      (connection) =>
        new Client({
          connection,
          namespace,
        }),
    )
  }
  return clientPromise
}

async function connect(): Promise<Connection> {
  const apiKey = process.env['TEMPORAL_API_KEY']
  const certPath = process.env['TEMPORAL_TLS_CERT_PATH']
  const keyPath = process.env['TEMPORAL_TLS_KEY_PATH']

  if (apiKey) {
    return Connection.connect({
      address,
      tls: true,
      apiKey,
    })
  }

  if (certPath && keyPath) {
    return Connection.connect({
      address,
      tls: {
        clientCertPair: {
          crt: readFileSync(certPath),
          key: readFileSync(keyPath),
        },
      },
    })
  }

  // Local Temporal CLI / docker (no TLS)
  return Connection.connect({ address })
}
