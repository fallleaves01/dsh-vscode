// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
let h: Harness
afterEach(() => { h?.dispose(); document.body.replaceChildren() })
describe('masked user messages in the main conversation', () => {
  it('masks before display, reveals individually, and remasks on a conversation switch', async () => {
    h = harness(); const secret = 'sk-' + 'A1'.repeat(16), messages = [{ id: 'user', role: 'user', text: 'Use ' + secret }]
    h.sendState({ messages }); await h.settle()
    expect(h.document.querySelector('.message.user')!.innerHTML).not.toContain(secret)
    h.click('.secret-toggle'); expect(h.document.querySelector('.message.user')!.textContent).toContain(secret)
    h.sendState({ messages, running: true }); await h.settle()
    expect(h.document.querySelector('.message.user')!.textContent).toContain(secret)
    h.sendState({ sessionId: 'other', messages }); await h.settle()
    expect(h.document.querySelector('.message.user')!.innerHTML).not.toContain(secret)
  })
  it('preserves explicit original-message copy and send semantics', async () => {
    h = harness(); const secret = 'sk-' + 'A1'.repeat(16), text = 'Use ' + secret
    h.sendState({ messages: [{ id: 'user', role: 'user', text }], messageMeta: [{ id: 'user', time: 1000, turn: 1 }] }); await h.settle()
    h.click('.message.user .message-copy')
    expect(h.posts).toContainEqual({ type: 'copy-text', text })
    h.enter(text); expect(h.posts).toContainEqual(expect.objectContaining({ type: 'send', text }))
    expect(h.document.querySelector('.message.user')!.innerHTML).not.toContain(secret)
  })
  it('applies official user-text rules without changing model output', async () => {
    h = harness(); const secret = 'sk-' + 'A1'.repeat(16)
    h.sendState({ messages: [{ id: 'user', role: 'user', text: secret }, { id: 'assistant', role: 'assistant', text: 'Example: ' + secret }] }); await h.settle()
    expect(h.document.querySelector('.message.user')!.textContent).not.toContain(secret)
    expect(h.document.querySelector('.message.assistant')!.textContent).toContain(secret)
  })
})
