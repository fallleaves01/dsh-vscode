import { RuntimeBroker, countSessionsHeldBy, type RuntimeDescriptor } from './runtime-broker.js'
import { proveRuntimeIdentity } from './runtime-identity.js'

/**
 * The manual half of the release story.
 *
 * The automatic path ends a runtime only when no window is left using it. This
 * path exists for the other case: a runtime an earlier window left behind that
 * nothing will ever adopt — because it was started with different settings, or
 * because it stopped answering — and that still holds the conversations it opened.
 *
 * Two rules are load-bearing:
 *
 * - Only a record this extension wrote is ever considered, so a runtime the user
 *   started themselves (the desktop app, a `dsh web` in a terminal) is out of
 *   reach by construction.
 * - The process is signalled only after it proves it is the recorded instance by
 *   answering with its own launch token, because the record's pid may since have
 *   been reused by something unrelated.
 */

export type RecordedRuntimeState =
  /** No record: nothing this extension started is known. */
  | { readonly state: 'none' }
  /** Recorded, but the process is gone; the record was removed. */
  | { readonly state: 'gone' }
  /** Recorded and attach-only: deliberately never ended from here. */
  | { readonly state: 'attach-only'; readonly descriptor: RuntimeDescriptor }
  /** Recorded and alive: ending it is this extension's decision to offer. */
  | { readonly state: 'ready'; readonly descriptor: RuntimeDescriptor; readonly held: number; readonly heldIsLowerBound: boolean }

/** What is on record, and what ending it would release. Read-only. */
export async function inspectRecordedRuntime(
  broker: RuntimeBroker,
  dshHome: string,
): Promise<RecordedRuntimeState> {
  const descriptor = broker.readDescriptor()
  if (descriptor === undefined) return { state: 'none' }
  if (!descriptor.manageable) return { state: 'attach-only', descriptor }
  const pid = descriptor.pid
  // A managed record is required to carry a pid (see `parseDescriptor`).
  if (pid === undefined) return { state: 'gone' }
  if (!await broker.isRecordRunning(pid, descriptor.processStartTime)) {
    broker.clearDescriptor()
    return { state: 'gone' }
  }
  const held = await countSessionsHeldBy(dshHome, pid)
  return { state: 'ready', descriptor, held: held.count, heldIsLowerBound: held.truncated }
}

export type EndRecordedRuntimeResult =
  /** The runtime answered with its own launch token and was ended. */
  | { readonly ended: true }
  /** Nothing was signalled: the pid could not be proved to be the recorded runtime. */
  | { readonly ended: false; readonly reason: 'unproved' }
  /** Nothing was signalled: the runtime is the user's own and is never ended from here. */
  | { readonly ended: false; readonly reason: 'attach-only' }
  /** The signal was sent but the process was still there afterwards. */
  | { readonly ended: false; readonly reason: 'still-running' }

/**
 * End a recorded runtime after proving it is the recorded instance.
 *
 * Returns `unproved` without sending any signal when the runtime does not answer:
 * the process holding that pid may be something else entirely.
 */
export async function endRecordedRuntime(
  broker: RuntimeBroker,
  descriptor: RuntimeDescriptor,
): Promise<EndRecordedRuntimeResult> {
  // Checked first, so a user-owned runtime is never even authenticated for the
  // purpose of ending it.
  if (!descriptor.manageable) return { ended: false, reason: 'attach-only' }
  if (!await proveRuntimeIdentity(descriptor.launchUrl)) return { ended: false, reason: 'unproved' }
  const stopped = await broker.stop(descriptor, { confirmed: true })
  return stopped ? { ended: true } : { ended: false, reason: 'still-running' }
}
