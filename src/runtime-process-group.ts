import type { ChildProcess } from 'node:child_process'
import { nodeProcessProbe, type ProcessProbe } from './runtime-broker.js'
import { terminateProcessTree } from './process-tree.js'

/** Only for a child we just spawned with detached:true on POSIX. */
export class OwnedRuntimeGroup {
  private identity: Promise<string | undefined>
  constructor(private readonly child: ChildProcess, private readonly probe: ProcessProbe = nodeProcessProbe()) {
    this.identity = child.pid === undefined ? Promise.resolve(undefined) : probe.startTime(child.pid)
  }

  isAlive(): boolean {
    if (this.child.pid === undefined) return false
    if (process.platform === 'win32') return this.child.exitCode === null && this.child.signalCode === null
    try { process.kill(-this.child.pid, 0); return true } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  }

  async signal(signal: NodeJS.Signals): Promise<void> {
    const pid = this.child.pid
    if (pid === undefined) return
    if (process.platform === 'win32') { terminateProcessTree(this.child, signal); return }
    // Descendants can retain the process group after the leader exits. A PID
    // reused by an unrelated leader must never authorise signalling its group.
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      if (this.probe.isAlive(pid)) {
        const expected = await this.identity
        if (expected === undefined || await this.probe.startTime(pid) !== expected) return
      }
    }
    try { process.kill(-pid, signal) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}
