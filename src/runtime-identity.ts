import { DshConnection } from './dsh-connection.js'
import { probeDshServer } from './runtime-endpoint.js'

/**
 * Ceiling for the identity handshake.
 *
 * Both requests are loopback, so a healthy runtime answers in single-digit
 * milliseconds (measured: 1.4 ms median, 2.7 ms p90). Only a wedged runtime
 * reaches this bound, and that is exactly the case whose answer must be "do not
 * guess".
 */
export const IDENTITY_HANDSHAKE_MS = 3_000

/**
 * Prove that a launch URL still belongs to the runtime process that produced it.
 *
 * DSH mints its launch token per process with `randomBytes` and keeps it in memory
 * only, so a runtime that accepts the recorded token *is* that exact instance. An
 * instance that is alive cannot have had its pid reused, which makes this a
 * stronger identity check than any process attribute — and the only one available
 * where the platform cannot report a process start time.
 *
 * Every failure means "not proved": a stale port, a runtime that restarted (and
 * so holds a fresh token), a wedged process, or a service that merely answers.
 */
export async function proveRuntimeIdentity(launchUrl: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(launchUrl)
  } catch {
    return false
  }
  const connection = new DshConnection(new URL(url.origin))
  try {
    await connection.authenticate(url, AbortSignal.timeout(IDENTITY_HANDSHAKE_MS))
    return (await probeDshServer(connection, IDENTITY_HANDSHAKE_MS)).kind === 'ready'
  } catch {
    return false
  } finally {
    connection.dispose()
  }
}
