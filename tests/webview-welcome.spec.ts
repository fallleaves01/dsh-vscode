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

  it('shows a shared connection and PID and reconnects without issuing restart', async () => {
    h = harness(); h.sendState({ runtimeConnection: { ownership: 'adopted', pid: 43210 } }); await h.settle()
    expect(h.document.getElementById('runtimeConnectionLabel')?.textContent).toBe('Shared')
    expect(h.document.getElementById('runtimeConnection')?.title).toContain('PID 43210')
    h.click('#runtimeConnection')
    expect(h.posts.at(-1)).toEqual({ type: 'reconnect' })
    expect(h.posts.some(post => post.type === 'restart')).toBe(false)
  })

  it('offers a connection when automatic startup is disabled', async () => {
    h = harness(); h.sendState({ phase: 'idle', statusText: 'Connect to DSH to open your conversations.', runtimeConnection: null }); await h.settle()
    expect((h.document.getElementById('runtimeConnection') as HTMLButtonElement).disabled).toBe(false)
    expect(h.document.getElementById('runtimeConnectionLabel')?.textContent).toBe('Connect')
    expect(h.document.getElementById('conversationStatus')?.textContent).toContain('Connect to DSH')
    expect(h.document.getElementById('conversationStatus')?.textContent).not.toContain('Starting')
  })

  it('keeps external authentication failures on the explicit launch-URL path', async () => {
    h = harness(); h.sendState({ phase: 'error', setup: 'runtime-auth', statusText: 'Authentication failed' }); await h.settle()
    h.click('#runtimeConnection')
    expect(h.posts.at(-1)).toEqual({ type: 'connect-existing-runtime' })
  })

  it('shows the current stage and output access while connecting', async () => {
    h = harness(); h.sendState({ phase: 'loading', statusText: 'Connecting to the existing shared DSH runtime (PID 43210)…' }); await h.settle()
    expect(h.document.getElementById('runtimeIndicator')?.getAttribute('aria-label')).toContain('existing shared DSH')
    expect(h.document.getElementById('runtimeIndicator')?.dataset.phase).toBe('loading')
    expect((h.document.getElementById('runtimeConnection') as HTMLButtonElement).disabled).toBe(true)
    const output = [...h.document.querySelectorAll<HTMLButtonElement>('#conversationStatus button')].find(button => button.textContent === 'Show Output')!
    output.click(); expect(h.posts.at(-1)).toEqual({ type: 'output' })
  })

  it('updates recovery actions when reconnect capability changes without a new error message', async () => {
    h = harness(); h.sendState({ phase: 'error', statusText: 'Connection unavailable', canReconnect: false }); await h.settle()
    expect(h.document.getElementById('conversationStatus')?.textContent).toContain('Retry Connection')
    h.sendState({ phase: 'error', statusText: 'Connection unavailable', canReconnect: true }); await h.settle()
    expect(h.document.getElementById('conversationStatus')?.textContent).toContain('Reconnect')
    expect(h.document.getElementById('conversationStatus')?.textContent).not.toContain('Retry Connection')
  })
})
