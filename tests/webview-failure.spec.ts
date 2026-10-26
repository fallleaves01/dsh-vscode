// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
import { ConversationProjector } from '../src/conversation.js'
import { messageForWebview } from '../src/chat-state-patch.js'

let h: Harness | undefined
afterEach(() => { h?.dispose(); h = undefined; document.body.replaceChildren() })
const open = (): Harness => { h = harness(); return h }

describe('failed response presentation', () => {
  it('shows recovered text, explicit failure and the recorded error after reopening history', async () => {
    const p = new ConversationProjector()
    p.reset([
      { type: 'assistant/attempt', seq: 3, time: 3000, data: { turn: 1, step: 1, stream: [
        { type: 'text-chunks', index: 0, time0: 1000, texts: ['## Retained answer\n\n', 'Already received.'], dt: [1] },
      ] } },
      { type: 'turn/end', seq: 4, time: 4000, data: { turn: 1, reason: { kind: 'error', error: { code: 'PI_AI_ERROR', message: 'Provider finish_reason: content_filter' } } } },
    ])
    const view = open(); view.sendState({ messages: p.messages() }); await view.settle()
    expect(document.querySelector('.message-body h2')?.textContent).toBe('Retained answer')
    expect(document.querySelector('.assistant-failure-title')?.textContent).toBe('This turn failed')
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('Provider finish_reason: content_filter')
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('PI_AI_ERROR')
    expect(document.querySelector('.assistant-failure')?.getAttribute('role')).toBe('status')
  })

  it('decodes a provider JSON error body and keeps its own code chip', async () => {
    const view = open()
    view.sendState({ messages: [{
      id: 'failed', role: 'assistant', text: '', failed: true,
      detail: 'Internal Server Error (HTTP 500)', failureCode: 'SERVER',
    }] }); await view.settle()
    expect(document.querySelector('.assistant-failure-title')?.textContent).toBe('This turn failed')
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('Internal Server Error (HTTP 500)')
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('SERVER')
  })

  it('shows DSH copy for known codes and hides the chip where DSH hides it', async () => {
    const view = open()
    view.sendState({ messages: [
      { id: 'auth', role: 'assistant', text: '', failed: true, detail: 'raw auth text', failureCode: 'AUTH' },
      { id: 'quota', role: 'assistant', text: '', failed: true, detail: 'raw quota text', failureCode: 'QUOTA' },
      { id: 'signed-out', role: 'assistant', text: '', failed: true, detail: 'raw text', failureCode: 'ACCOUNT_SIGNED_OUT' },
    ] }); await view.settle()
    const failures = [...document.querySelectorAll('.assistant-failure')]
    expect(failures.map(failure => failure.querySelector('.assistant-failure-title')?.textContent))
      .toEqual(['This turn failed', 'This turn failed', 'Task stopped'])
    expect(failures.map(failure => failure.querySelector('.assistant-failure-detail')?.textContent)).toEqual([
      'API key is invalid',
      'Request quota exhausted.',
      'Stopped because you signed out of DeepSeek.',
    ])
    expect(failures.map(failure => failure.querySelector('.assistant-failure-code')?.textContent))
      .toEqual(['AUTH', 'QUOTA', 'ACCOUNT_SIGNED_OUT'])
  })

  it('shows the signed-out and interrupted copy without leaking raw diagnostics', async () => {
    const view = open()
    view.sendState({ messages: [
      { id: 'signin', role: 'assistant', text: '', failed: true, detail: 'raw', failureCode: 'ACCOUNT_SIGN_IN_REQUIRED' },
      { id: 'interrupted', role: 'assistant', text: '', failed: true, detail: 'raw', failureCode: 'INTERRUPTED' },
    ] }); await view.settle()
    const failures = [...document.querySelectorAll('.assistant-failure')]
    expect(failures[0]?.querySelector('.assistant-failure-detail')?.textContent)
      .toBe('Sign in to DeepSeek and ensure the request destination supports account authentication.')
    expect(failures[1]?.querySelector('.assistant-failure-title')?.textContent).toBe('Task stopped')
    expect(failures[1]?.querySelector('.assistant-failure-detail')?.textContent)
      .toBe('The DSH process exited before this turn finished (for example, it was killed, crashed, or timed out while shutting down), so the turn was closed when DSH restarted. Unfinished tool calls have unknown outcomes.')
    // INTERRUPTED is the one code DSH never renders as a chip.
    expect(failures[1]?.querySelector('.assistant-failure-code')).toBeNull()
  })

  it('keeps an unknown code as its own chip and shows the provider text', async () => {
    const view = open()
    view.sendState({ messages: [{ id: 'failed', role: 'assistant', text: '', failed: true, detail: 'Something failed', failureCode: 'FUTURE_CODE' }] })
    await view.settle()
    expect(document.querySelector('.assistant-failure-title')?.textContent).toBe('This turn failed')
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('Something failed')
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('FUTURE_CODE')
  })

  it('shows failure even without answer text and treats provider errors as literal text', async () => {
    const view = open(), detail = 'SERVER: <img src=x onerror=bad()>\nSecond line'
    view.sendState({ messages: [{ id: 'failed', role: 'assistant', text: '', failed: true, detail }] }); await view.settle()
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe(detail)
    expect(document.querySelector('.assistant-failure img')).toBeNull()
    expect(document.querySelector('.assistant-failure-code')).toBeNull()
  })

  it('renders a hostile failure code as literal text, never as markup', async () => {
    const view = open()
    view.sendState({ messages: [{ id: 'failed', role: 'assistant', text: '', failed: true, detail: 'raw', failureCode: '<img src=x onerror=bad()>' }] })
    await view.settle()
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('<img src=x onerror=bad()>')
    expect(document.querySelector('.assistant-failure img')).toBeNull()
  })

  it('updates an unchanged response when its failure reason arrives later', async () => {
    const view = open(), response = { id: 'reply', role: 'assistant', text: 'Received answer', streaming: true }
    view.sendState({ messages: [response] }); await view.settle()
    const fail = { ...response, streaming: false, failed: true, detail: 'Request timed out', failureCode: 'TIMEOUT' }
    view.send({ type: 'state-update', update: { messages: { upserts: [fail] } } }); await view.settle()
    expect(document.querySelector('.message-body')?.textContent).toContain('Received answer')
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('Request timed out')
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('TIMEOUT')
    // A later failure with the same detail but a different code must redraw the
    // chip, which only the row key can notice.
    view.send({ type: 'state-update', update: { messages: { upserts: [{ ...fail, failureCode: 'TRANSPORT' }] } } }); await view.settle()
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('TRANSPORT')
    view.send({ type: 'state-update', update: { messages: { upserts: [{ ...fail, detail: 'Connection closed', failureCode: undefined }] } } }); await view.settle()
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('Connection closed')
    expect(document.querySelector('.assistant-failure-code')).toBeNull()
  })

  it('labels the failed turn duration correctly and retains copying', async () => {
    const view = open()
    view.sendState({ messages: [{ id: 'reply', role: 'assistant', text: 'Received answer', failed: true, detail: 'Failure' }],
      messageMeta: [{ id: 'reply', time: Date.now(), turnEnd: true, turnDurationMs: 65_000 }] })
    await view.settle()
    expect(document.querySelector('.message-duration')?.textContent).toBe('Failed after 1m 5s')
    expect(document.querySelector('.message-copy')).not.toBeNull()
    expect(document.querySelector('.message')?.textContent).not.toContain('Completed in')
  })

  it('keeps failure visible while a long response body is deferred', async () => {
    const view = open(), message = messageForWebview({ id: 'large', role: 'assistant', text: 'Already received.\n'.repeat(2000), failed: true, detail: 'Filtered', failureCode: 'PI_AI_ERROR' })
    expect(message.deferredBody).toBe(true)
    expect(message.failureCode).toBe('PI_AI_ERROR')
    view.sendState({ messages: [message] }); await view.settle()
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('Filtered')
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('PI_AI_ERROR')
    expect(document.querySelector('.message-body')?.textContent).toContain('Show full response')
  })
})
