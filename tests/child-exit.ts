/**
 * Deterministic child-process exit wait for real-spawn tests.
 *
 * A broker can prove a PID dead with `process.kill(pid, 0)` before Node has
 * updated the `ChildProcess` handle (Windows delivers the exit event later), so
 * asserting `exitCode`/`signalCode` immediately after a stop is racy. This waits
 * for the authoritative `exit` event with a bounded timeout.
 */
import type { ChildProcess } from 'node:child_process'

export const CHILD_EXIT_TIMEOUT_MS = 5_000

export async function waitForChildExit(child: ChildProcess, timeoutMs = CHILD_EXIT_TIMEOUT_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      reject(new Error(
        `Child process ${String(child.pid)} did not exit within ${String(timeoutMs)} ms `
        + `(exitCode=${String(child.exitCode)}, signalCode=${String(child.signalCode)}).`,
      ))
    }, timeoutMs)
    timer.unref?.()
    const onExit = (): void => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
  })
}
