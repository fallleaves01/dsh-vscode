import * as vscode from 'vscode'
import type { RuntimeOwnership } from './runtime.js'

/**
 * Whether this window owns the runtime process and its configuration.
 *
 * The one question every consumer actually asks — plugin installs, settings
 * writes, credential writes and restarts all hinge on it. `attached` (the user's
 * own runtime, remembered) and `external` (a launch URL used for this window only)
 * are both *not ours*: nothing may be installed into them, written to them, or
 * restarted on them. Keeping this in one place is what stops the union from having
 * to be re-derived at each call site.
 */
export function runtimeIsOurs(ownership: RuntimeOwnership | undefined): boolean {
  return ownership === 'managed' || ownership === 'adopted'
}

/**
 * Whether the connected runtime belongs to someone else.
 *
 * `attached` and `external` both do: this extension may not install into them,
 * write settings or credentials to them, or restart them.
 *
 * `undefined` means **not connected**, which is not the same thing — a window that
 * has not connected yet still owns its own startup, its own credentials and its own
 * profile. Keeping this separate from a plain negated {@link runtimeIsOurs} is what
 * makes that distinction impossible to get wrong at a call site.
 */
export function runtimeIsNotOurs(ownership: RuntimeOwnership | undefined): boolean {
  return ownership !== undefined && !runtimeIsOurs(ownership)
}

export interface RuntimeChangeController {
  readonly cwd: string
  readonly isDisposed: boolean
  readonly runtimeOwnership: RuntimeOwnership | undefined
  readonly runtimeIdentity: object | undefined
  readonly hasRunningTasks: boolean
  readonly state: { phase: 'idle' | 'loading' | 'ready' | 'error'; statusText: string }
  /** False when another connection operation superseded this restart. */
  restart(): Promise<boolean>
}

export interface RuntimeChangeTarget {
  readonly identity: object | undefined
  readonly cwd: string
}

export function runtimeChangeTarget(controller: RuntimeChangeController): RuntimeChangeTarget {
  return { identity: controller.runtimeIdentity, cwd: controller.cwd }
}

export function isCurrentRuntimeTarget(controller: RuntimeChangeController, target: RuntimeChangeTarget): boolean {
  return !controller.isDisposed && target.identity === controller.runtimeIdentity && target.cwd === controller.cwd
}

/** For automatic restarts after a saved change, not the explicit Restart command. */
export async function restartAfterRuntimeChange(
  controller: RuntimeChangeController,
  target: RuntimeChangeTarget,
  successMessage: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (controller.isDisposed || !isCurrent()) return
  if (!isCurrentRuntimeTarget(controller, target) || controller.state.phase === 'loading'
    || (controller.runtimeOwnership !== undefined && controller.state.phase !== 'ready')) {
    await vscode.window.showWarningMessage(`${successMessage}. The runtime connection changed; no runtime was restarted. Restart the intended runtime when ready to apply the change.`)
    return
  }
  if (runtimeIsNotOurs(controller.runtimeOwnership)) {
    // Neither a URL used for this window alone nor the user's remembered runtime is
    // this extension's to restart: only its owner can apply the change.
    await vscode.window.showWarningMessage(`${successMessage}. Restart that DeepSeek Harness process yourself to apply this change, then reconnect from VS Code.`)
    return
  }
  if (controller.hasRunningTasks) {
    await vscode.window.showWarningMessage(`${successMessage}. DeepSeek tasks are still running, so the runtime was not restarted. Restart it after those tasks and Background Jobs finish to apply the change.`)
    return
  }
  // No asynchronous dialog between the last activity check and starting the restart.
  if (!await controller.restart() || controller.isDisposed || !isCurrent()) return
  if (controller.state.phase === 'error') {
    throw new Error(`${successMessage}, but DSH could not restart: ${controller.state.statusText}`)
  }
  if (controller.state.phase === 'ready') {
    await vscode.window.showInformationMessage(`${successMessage}. DeepSeek Harness restarted.`)
  }
}
