import { describe, expect, it } from 'vitest'
import { NO_ROUTABLE_PROVIDER_TEXT, dshErrorText, dshFailure } from '../src/dsh-errors.js'

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

  it('explains an empty provider catalog rather than leaving the composer dead', () => {
    expect(NO_ROUTABLE_PROVIDER_TEXT).toContain('No DeepSeek model is available')
  })
})
