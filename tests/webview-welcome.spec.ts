// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
let h: Harness
afterEach(async () => { h.sendState({ phase: 'error' }); await h.settle(); h.dispose(); document.body.replaceChildren() })
describe('welcome and runtime status', () => {
  it('fills a suggested prompt as an editable draft without sending it', async () => {
    h = harness(); h.sendState({ messages: [] }); await h.settle()
    h.click('.empty-action')
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toContain('main entry points')
    expect(h.document.activeElement?.id).toBe('prompt')
    expect(h.posts.some(post => post.type === 'send')).toBe(false)
    h.sendState({ sessionId: 'other', messages: [] }); await h.settle()
    h.sendState({ sessionId: 'session-a', messages: [] }); await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toContain('main entry points')
  })
  it('exposes runtime state without relying only on the indicator color', async () => {
    h = harness(); h.sendState({ phase: 'ready' }); await h.settle()
    expect(h.document.getElementById('runtimeIndicator')?.getAttribute('aria-label')).toBe('Runtime connected')
    h.sendState({ phase: 'error' }); await h.settle()
    expect(h.document.getElementById('runtimeIndicator')?.getAttribute('aria-label')).toBe('Runtime connection failed')
  })
})
