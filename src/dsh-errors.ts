/**
 * Actionable text for the DSH failures a user can actually do something about.
 *
 * DSH 0.1.7-rc.1 shipped provider failures as opaque generic errors; rc.2 added
 * the specific codes below. They mean "you can fix this", so they must not be
 * shown as raw protocol text.
 */

/** Codes the sidebar knows how to explain, keyed exactly as DSH reports them. */
const MESSAGES: Readonly<Record<string, string>> = {
  'session/provider-credentials-unavailable':
    'DeepSeek has no credentials on this runtime. Sign in with your DeepSeek account, or configure an API key, then send again.',
  'session/provider-models-unavailable':
    'The selected model provider is offering no available models. Pick another model, or check that provider\'s credentials.',
  'session/model-unavailable':
    'That model is not available on this runtime. Pick another model and send again.',
  // DSH's own UI has a dedicated string for this one: a conversation is
  // single-writer, so a second runtime holding it is the expected cause.
  'session/writer-held':
    'This conversation is already in use, possibly by another running DSH instance (such as another dsh web, or the desktop app). Quit the other instance and try again.',
  'session/not-found':
    'This conversation is no longer on the runtime. It may have been archived or removed; refresh the conversation list.',
  'session/projections-unavailable':
    'The state of this conversation is unavailable right now. Reconnect and try again.',
  'session/queue-item-not-found':
    'That queued message is no longer pending.',
  'session/steer-unavailable':
    'The current turn no longer accepts steering.',
  'session/workspace-attach-failed':
    'The conversation was created but the project folder could not be opened. Check that the folder still exists and is readable.',
  'session/title-invalid':
    'The runtime did not accept that title. Try a shorter one.',
  'subagent/parent-unavailable':
    'The conversation that started this subagent is not running, so it cannot be continued.',
  'subagent/not-found':
    'This subagent is no longer available.',
  'session/agent-busy':
    'This is a subagent session, so it is driven through its parent conversation rather than directly.',
  'subagent/unauthorized':
    'That subagent is no longer owned by the conversation that started it, so it cannot be controlled from here.',
  'subagent/attachment-invalid':
    'A subagent conversation cannot take that attachment. Files are not delivered to a subagent, and images need a model that accepts them.',
  'subagent/not-resumable':
    'This subagent has already finished, so it cannot be continued. Its work is part of the conversation that started it.',
  'subagent/delivery-unavailable':
    'This subagent cannot accept a follow-up right now. Try again in a moment.',
}

/**
 * A path that is not on this machine.
 *
 * Both layers word this differently — a Node stat reports
 * `ENOENT: no such file or directory, stat '/abs/path'`, while VS Code's file
 * system reports `No such file or directory, stat` — and neither is worth
 * showing a user verbatim. A model can name a file that does not exist, and the
 * absolute path belongs in the log rather than in a notice.
 */
function missingFileText(message: string): string | undefined {
  if (!/ENOENT|no such file or directory/i.test(message)) return undefined
  const name = /'([^']+)'/.exec(message)?.[1]?.split(/[\\/]/).pop()
  return name === undefined || name === ''
    ? 'That file is not available on this machine. It may have been moved or deleted.'
    : '`' + name + '` is not available on this machine. It may have been moved or deleted.'
}

/** Extra context for a code whose message names the exact route that failed. */
function detailOf(error: { code: string; message: string }): string {
  if (error.code !== 'session/model-unavailable' && error.code !== 'session/provider-models-unavailable') return ''
  // DSH reports the offending route in the message; keep it so the user knows
  // which of several configured providers is the broken one.
  const route = /["']?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)["']?/.exec(error.message)
  return route === null || route[0].length > 80 ? '' : ` (${route[1]}/${route[2]})`
}

export interface DshFailure {
  code?: string
  message: string
}

/** Narrow anything thrown by the client into a code plus a readable message. */
export function dshFailure(error: unknown): DshFailure {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown }
    return {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      message: typeof record.message === 'string' && record.message !== '' ? record.message : String(error),
    }
  }
  return { message: String(error) }
}

/** A code DSH embedded at the front of a message instead of a separate field. */
function leadingCode(message: string): string | undefined {
  const match = /^\s*([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)\s*:/.exec(message)
  return match?.[1]
}

/**
 * Render one DSH failure for a notice or dialog.
 *
 * Failures reach the sidebar two ways: as a thrown RPC error carrying `code`
 * (the session Remotes), or as an `api-session/error` frame whose only payload
 * is text (the agent channel). Accepting a leading `namespace/name:` prefix
 * covers the second without inventing a code field the runtime never sends.
 * @param error - anything thrown by the DSH client, or a `{code?, message}` frame.
 * @returns actionable text for a known code, otherwise the runtime's own message.
 */
export function dshErrorText(error: unknown): string {
  const failure = dshFailure(error)
  if (failure.code !== 'session/provider-credentials-unavailable') {
    const missing = missingFileText(failure.message)
    if (missing !== undefined) return missing
  }
  const code = failure.code ?? leadingCode(failure.message)
  const known = code === undefined ? undefined : MESSAGES[code]
  if (known === undefined || code === undefined) return failure.message
  // Drop the prefix we just consumed so the notice reads as one sentence.
  const body = failure.message.replace(/^\s*[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\s*:\s*/, '')
  return `${known}${detailOf({ code, message: body })}`
}

/**
 * Why the composer is unavailable when the runtime reports no routable provider.
 * rc.2 tightened `routableProviders` to "has at least one available model", so
 * an empty list is a real, explainable state rather than a silent dead input.
 */
export const NO_ROUTABLE_PROVIDER_TEXT =
  'No DeepSeek model is available on this runtime. Sign in, or configure an API key, to start a conversation.'
