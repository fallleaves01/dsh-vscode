import { RuntimeBroker, type RuntimeDescriptor } from './runtime-broker.js'
import { proveRuntimeIdentity } from './runtime-identity.js'

/** Extension-host only: the descriptor includes a secret URL, never send it to a Webview. */
export interface RuntimeRestartPlan {
  readonly descriptor: RuntimeDescriptor
  readonly otherWindows: readonly string[]
}

const CHANGED = 'The shared DSH runtime changed while restart was being prepared. No process was stopped. Use Restart Runtime again.'

/** Caller holds the transition lock for each operation in this module. */
export async function inspectRuntimeRestart(broker: RuntimeBroker, instanceId: string): Promise<RuntimeRestartPlan | undefined> {
  const descriptor = broker.readDescriptor()
  if (descriptor === undefined || !descriptor.manageable || await broker.recordProcessState(descriptor) === 'dead') return undefined
  return { descriptor, otherWindows: await otherWindows(broker, descriptor, instanceId) }
}

async function otherWindows(broker: RuntimeBroker, descriptor: RuntimeDescriptor, instanceId: string): Promise<string[]> {
  return (await broker.liveLeases()).filter(lease => lease.instanceId !== instanceId
    && (lease.runtimePid === undefined || lease.runtimePid === descriptor.pid)).map(lease => lease.instanceId)
}

/** Confirmation covers one process and the observed windows, never a successor. */
export async function validateRuntimeRestart(
  broker: RuntimeBroker, plan: RuntimeRestartPlan, instanceId: string,
): Promise<RuntimeDescriptor | undefined> {
  const current = broker.readDescriptor(), expected = plan.descriptor
  if (current === undefined && await broker.recordProcessState(expected) === 'dead') return undefined
  if (current === undefined || !current.manageable || current.instanceId !== expected.instanceId
    || current.pid !== expected.pid || current.startedAt !== expected.startedAt
    || current.processStartTime !== expected.processStartTime || current.launchUrl !== expected.launchUrl) throw new Error(CHANGED)
  if (await broker.recordProcessState(current) === 'dead') return current
  if ((await otherWindows(broker, current, instanceId)).some(id => !plan.otherWindows.includes(id))) {
    throw new Error('Another VS Code window connected while restart was being prepared. No process was stopped. Use Restart Runtime again to review the affected windows.')
  }
  return current
}

/** Explicit restart may interrupt confirmed borrowers; automatic shutdown never does. */
export async function stopRuntimeForRestart(broker: RuntimeBroker, plan: RuntimeRestartPlan, instanceId: string): Promise<void> {
  const descriptor = await validateRuntimeRestart(broker, plan, instanceId)
  if (descriptor === undefined) return
  const identity = await broker.recordProcessState(descriptor)
  const authenticated = identity === 'unknown' && await proveRuntimeIdentity(descriptor.launchUrl)
  if (identity === 'unknown' && !authenticated) {
    throw new Error('The recorded DSH process could not be identified by its process start time or launch token. No process was stopped and no replacement was started. See DeepSeek Harness: Diagnose Session Occupancy.')
  }
  if (!await broker.stop(descriptor, { confirmed: authenticated,
    confirmIdentity: () => proveRuntimeIdentity(descriptor.launchUrl) })) {
    throw new Error('The recorded DSH process did not stop. Its record was retained and no replacement was started. Use Restart Runtime to retry; see the DeepSeek Harness output for details.')
  }
}
