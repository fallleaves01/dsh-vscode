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
    expect(document.querySelector('.assistant-failure-title')?.textContent).toBe('Response failed')
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('PI_AI_ERROR: Provider finish_reason: content_filter')
    expect(document.querySelector('.assistant-failure')?.getAttribute('role')).toBe('status')
  })

  it('shows failure even without answer text and treats provider errors as literal text', async () => {
    const view = open(), detail = 'SERVER: <img src=x onerror=bad()>\nSecond line'
    view.sendState({ messages: [{ id: 'failed', role: 'assistant', text: '', failed: true, detail }] }); await view.settle()
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe(detail)
    expect(document.querySelector('.assistant-failure img')).toBeNull()
  })

  it('updates an unchanged response when its failure reason arrives later', async () => {
    const view = open(), response = { id: 'reply', role: 'assistant', text: 'Received answer', streaming: true }
    view.sendState({ messages: [response] }); await view.settle()
    const fail = { ...response, streaming: false, failed: true, detail: 'TIMEOUT: Request timed out' }
    view.send({ type: 'state-update', update: { messages: { upserts: [fail] } } }); await view.settle()
    expect(document.querySelector('.message-body')?.textContent).toContain('Received answer')
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('TIMEOUT: Request timed out')
    view.send({ type: 'state-update', update: { messages: { upserts: [{ ...fail, detail: 'TRANSPORT: Connection closed' }] } } }); await view.settle()
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('TRANSPORT: Connection closed')
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
    const view = open(), message = messageForWebview({ id: 'large', role: 'assistant', text: 'Already received.\n'.repeat(2000), failed: true, detail: 'PI_AI_ERROR: Filtered' })
    expect(message.deferredBody).toBe(true)
    view.sendState({ messages: [message] }); await view.settle()
    expect(document.querySelector('.assistant-failure-detail')?.textContent).toBe('PI_AI_ERROR: Filtered')
    expect(document.querySelector('.message-body')?.textContent).toContain('Show full response')
  })
})
