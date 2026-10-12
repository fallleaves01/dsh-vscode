import { describe, expect, it } from 'vitest'
import { CONVERSATION_HELD_TEXT, NO_ROUTABLE_PROVIDER_TEXT, dshErrorText, dshFailure, isConversationHeld } from '../src/dsh-errors.js'

/** The shape DshConnection throws: a preserved DSH code plus the runtime message. */
function failure(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

describe('DSH failure text', () => {
  it('explains the rc.2 credential failure instead of echoing protocol text', () => {
    const text = dshErrorText(failure('session/provider-credentials-unavailable', 'no provider credentials'))
    expect(text).toContain('Sign in with your DeepSeek account')
    expect(text).toContain('API key')
    // The raw code must never reach a notice.
    expect(text).not.toContain('session/provider-credentials-unavailable')
  })

  it('names the offending route when the runtime reports one', () => {
    const text = dshErrorText(failure('session/model-unavailable', 'model "deepseek-official/deepseek-v9" is unavailable'))
    expect(text).toContain('deepseek-official/deepseek-v9')
  })

  it('ignores a route-shaped phrase that is too long to be an identifier', () => {
    const noisy = `a/${'x'.repeat(120)}`
    const text = dshErrorText(failure('session/model-unavailable', noisy))
    expect(text).not.toContain(noisy)
  })

  it('leaves an unknown code alone, so new runtime failures stay readable', () => {
    const text = dshErrorText(failure('session/some-future-code', 'something DSH added later'))
    expect(text).toBe('something DSH added later')
  })

  it('explains that a subagent session is driven through its parent', () => {
    const text = dshErrorText(failure('session/agent-busy', 'session "s" is owned by subagent routing'))
    expect(text).toContain('subagent session')
    expect(text).not.toContain('session/agent-busy')
  })

  it('explains a subagent that outlived its owner', () => {
    const text = dshErrorText(failure('subagent/unauthorized', 'subagent does not belong to this parent'))
    expect(text).toContain('no longer owned')
  })

  it('passes through plain errors and non-errors unchanged', () => {
    expect(dshErrorText(new Error('boom'))).toBe('boom')
    expect(dshErrorText('boom')).toBe('boom')
    expect(dshErrorText(undefined)).toBe('undefined')
  })

  it('reports the code separately from the message', () => {
    expect(dshFailure(failure('a/b', 'm'))).toEqual({ code: 'a/b', message: 'm' })
    expect(dshFailure(new Error('m'))).toEqual({ message: 'm' })
  })

  it('recognises a code prefixed onto text, which is all the agent channel sends', () => {
    // `api-session/error` carries message text only, so the code can only arrive
    // inline; the notice must still read as one actionable sentence.
    const text = dshErrorText('session/provider-credentials-unavailable: no credentials for this deployment')
    expect(text).toContain('Sign in with your DeepSeek account')
    expect(text).not.toContain('no credentials for this deployment')
  })

  it('keeps an unknown inline prefix readable instead of trimming it', () => {
    const text = dshErrorText('some/new-code: something happened')
    expect(text).toBe('some/new-code: something happened')
  })

  it('does not mistake an ordinary sentence for a code prefix', () => {
    expect(dshErrorText('Note: the run finished')).toBe('Note: the run finished')
  })

  it('describes a missing file without pasting an absolute path', () => {
    // A model can name a file that does not exist; DSH reports the raw Node
    // error, which is not something to show in a conversation.
    const text = dshErrorText(failure('ENOENT', "ENOENT: no such file or directory, stat '/home/user/project/bucket.hpp'"))
    expect(text).toContain('bucket.hpp')
    expect(text).not.toContain('/home/user')
    expect(text).not.toContain('ENOENT')
  })

  it('recognises the wording VS Code uses for the same condition', () => {
    const text = dshErrorText(new Error('No such file or directory, stat'))
    expect(text).toContain('not available on this machine')
  })

  it('leaves unrelated failures alone', () => {
    expect(dshErrorText(new Error('the model is unavailable'))).toBe('the model is unavailable')
  })

  it('explains a conversation held by another runtime, as DSH itself does', () => {
    const text = dshErrorText(failure('session/writer-held', 'session "s" is already owned by an active write handle'))
    expect(text).toContain('already in use')
    expect(text).toContain('another running DSH instance')
    expect(text).not.toContain('write handle')
  })

  it('explains the failures a stale conversation produces', () => {
    for (const [code, expected] of [
      ['session/not-found', 'no longer on the runtime'],
      ['session/projections-unavailable', 'unavailable right now'],
      ['session/queue-item-not-found', 'no longer pending'],
      ['session/steer-unavailable', 'no longer accepts steering'],
      ['session/workspace-attach-failed', 'project folder could not be opened'],
      ['session/title-invalid', 'shorter'],
      ['subagent/parent-unavailable', 'is not running'],
      ['subagent/not-found', 'no longer available'],
    ]) {
      expect(dshErrorText(failure(code, 'raw protocol text')), code).toContain(expected)
    }
  })

  it('explains an empty provider catalog rather than leaving the composer dead', () => {
    expect(NO_ROUTABLE_PROVIDER_TEXT).toContain('No DeepSeek model is available')
  })
})

/**
 * A conversation another DSH process owns is a state, not a fault. It reaches the
 * sidebar in three shapes and every one of them must be recognised, because the
 * alternative is raw persistence wording in the UI.
 */
describe('a conversation held by another DSH process', () => {
  // The exact message of DSH's SessionAlreadyOwnedError, which the background
  // resume during `follow` delivers as bare text on the agent channel.
  const persisted = 'session "session-a" is already owned by an active write handle'

  it('is recognised from the wire code, from bare agent text, and under a generic code', () => {
    expect(isConversationHeld(failure('session/writer-held', 'session "session-a" is already owned by an active write handle'))).toBe(true)
    expect(isConversationHeld(persisted)).toBe(true)
    expect(isConversationHeld(failure('gateway/internal', persisted))).toBe(true)
  })

  it('is not claimed for unrelated failures', () => {
    expect(isConversationHeld(failure('session/not-found', 'session "x" not found'))).toBe(false)
    expect(isConversationHeld(new Error('spawn dsh ENOENT'))).toBe(false)
    expect(isConversationHeld(undefined)).toBe(false)
  })

  it('does not mistake a port conflict for a held conversation', () => {
    // "address already in use" must keep its own meaning: it is a startup failure,
    // not a conversation another instance owns.
    const port = failure('gateway/internal', 'listen EADDRINUSE: address already in use 127.0.0.1:3080')
    expect(isConversationHeld(port)).toBe(false)
    expect(dshErrorText(port)).toContain('EADDRINUSE')
  })

  it('never shows the persistence layer wording, whatever code wrapped it', () => {
    for (const error of [failure('session/writer-held', persisted), persisted, failure('gateway/internal', persisted)]) {
      const text = dshErrorText(error)
      expect(text).toBe(CONVERSATION_HELD_TEXT)
      expect(text).not.toContain('write handle')
      expect(text).toContain('another running DSH instance')
    }
  })
})
