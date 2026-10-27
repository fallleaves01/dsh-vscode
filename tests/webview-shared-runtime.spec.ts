// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness, type Posted } from './webview-harness.js'

/**
 * A shared runtime serves several windows at once, so the Webview must not offer
 * actions the Host cannot honour (Stop outside a ready conversation), must keep
 * its recovery actions reachable in every phase (held retry, retry-open), and
 * must never restart a runtime another window is using.
 */

const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  vi.useRealTimers()
  document.body.replaceChildren()
})
function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

const parent = { id: 'session-a', title: 'Active conversation', updatedAt: 200 }
const other = { id: 'session-b', title: 'Other conversation', updatedAt: 100 }
const held = 'This conversation is already in use by another DSH process.'

async function show(h: Harness, overrides: Record<string, unknown>): Promise<void> {
  h.sendState({ sessionId: 'session-a', sessions: [parent, other], ...overrides })
  await h.settle()
}
function stop(h: Harness): HTMLButtonElement {
  return h.document.getElementById('cancel') as HTMLButtonElement
}
function byText(h: Harness, text: string): HTMLButtonElement | undefined {
  return [...h.document.querySelectorAll<HTMLButtonElement>('#conversationStatus button, #heldNotice button')]
    .find(button => button.textContent === text)
}
function posts(h: Harness, from: number): Posted[] {
  return h.posts.slice(from)
}

describe('Stop is offered only where the Host can accept it', () => {
  it('hides Stop in loading and error even when a turn was reported running', async () => {
    const h = open()
    await show(h, { phase: 'loading', statusText: 'Loading project conversation…', running: true })
    expect(stop(h).classList.contains('hidden')).toBe(true)
    await show(h, { phase: 'error', statusText: 'The conversation could not be opened.', running: true, canReconnect: true })
    expect(stop(h).classList.contains('hidden')).toBe(true)
  })

  it('keeps the ready three states unchanged', async () => {
    const h = open()
    await show(h, { phase: 'ready', running: true })
    expect(stop(h).classList.contains('hidden')).toBe(false)
    expect(stop(h).disabled).toBe(false)
    expect(stop(h).title).toBe('Stop')

    await show(h, { phase: 'ready', running: true, stopping: true, cancelRequested: true })
    expect(stop(h).classList.contains('hidden')).toBe(false)
    expect(stop(h).disabled).toBe(true)
    expect(stop(h).title).toBe('Stopping…')

    await show(h, { phase: 'ready', running: true, stopping: false, cancelRequested: true })
    expect(stop(h).classList.contains('hidden')).toBe(false)
    expect(stop(h).disabled).toBe(false)
    expect(stop(h).classList.contains('requested')).toBe(true)
  })
})

describe('held recovery survives the conversation phase', () => {
  for (const phase of ['ready', 'loading', 'error'] as const) {
    it(`shows the held banner and its actions during ${phase}`, async () => {
      const h = open()
      await show(h, { phase, statusText: 'The conversation could not be opened.', occupancyNotice: held, canReconnect: true })
      const banner = h.document.getElementById('heldNotice')!
      expect(banner.classList.contains('hidden')).toBe(false)
      expect(banner.textContent).toContain(held)
      const from = h.posts.length
      byText(h, 'Check again')!.click()
      expect(posts(h, from).at(-1)).toEqual({ type: 'retry-occupancy' })
      byText(h, 'Find the holder')!.click()
      expect(h.posts.at(-1)).toEqual({ type: 'diagnose-occupancy' })
    })
  }

  it('clears the banner when the Host reports the conversation is writable again', async () => {
    const h = open()
    await show(h, { phase: 'error', occupancyNotice: held, statusText: held })
    expect(h.document.getElementById('heldNotice')!.classList.contains('hidden')).toBe(false)
    await show(h, { phase: 'ready', occupancyNotice: null })
    expect(h.document.getElementById('heldNotice')!.classList.contains('hidden')).toBe(true)
  })

  it('renders a hostile occupancy notice as text', async () => {
    const h = open()
    const hostile = '<img src=x onerror="window.pwned=1">'
    await show(h, { phase: 'error', occupancyNotice: hostile, statusText: 'Held.' })
    const banner = h.document.getElementById('heldNotice')!
    expect(banner.querySelector('img')).toBeNull()
    expect(banner.textContent).toContain(hostile)
  })
})

describe('a conversation that failed to open can be retried in place', () => {
  it('offers Retry Conversation on the error page and reopens the same conversation', async () => {
    const h = open()
    await show(h, { phase: 'error', statusText: 'DSH did not send the conversation snapshot in time.', canReconnect: true })
    const from = h.posts.length
    byText(h, 'Retry Conversation')!.click()
    expect(posts(h, from)).toEqual([{ type: 'select-session', sessionId: 'session-a' }])
  })

  it('re-checks ownership instead when the conversation is held', async () => {
    const h = open()
    await show(h, { phase: 'error', statusText: held, occupancyNotice: held, canReconnect: true })
    const from = h.posts.length
    byText(h, 'Retry Conversation')!.click()
    expect(posts(h, from)).toEqual([{ type: 'retry-occupancy' }])
  })

  it('has no Retry Conversation without a selected conversation', async () => {
    const h = open()
    await show(h, { phase: 'error', sessionId: '', statusText: 'The runtime failed to start.', canReconnect: false })
    expect(byText(h, 'Retry Conversation')).toBeUndefined()
    expect(byText(h, 'Retry Connection')).toBeDefined()
  })

  it('retries the open when the failed conversation row is selected again', async () => {
    const h = open()
    await show(h, { phase: 'error', statusText: 'The conversation could not be opened.', canReconnect: true })
    h.click('#sessionTrigger')
    const from = h.posts.length
    h.click('#sessionList .session-row[data-session-id="session-a"] .session-main')
    expect(posts(h, from)).toEqual([{ type: 'select-session', sessionId: 'session-a' }])
  })

  it('only restores the view when the ready conversation row is selected again', async () => {
    const h = open()
    await show(h, { phase: 'ready' })
    h.click('#sessionTrigger')
    const from = h.posts.length
    h.click('#sessionList .session-row[data-session-id="session-a"] .session-main')
    expect(posts(h, from)).toEqual([])
  })
})

describe('switching stays available while a new conversation is pending', () => {
  function startCreation(h: Harness): Posted {
    h.click('#newSession')
    const pending = h.posts.findLast(item => item.type === 'create-conversation')
    expect(pending).toBeDefined()
    return pending!
  }

  it('keeps the switcher and rows enabled while creating', async () => {
    const h = open()
    await show(h, { phase: 'ready' })
    startCreation(h)
    expect((h.document.getElementById('sessionTrigger') as HTMLButtonElement).disabled).toBe(false)
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(true)
    h.click('#sessionTrigger')
    const rows = [...h.document.querySelectorAll<HTMLButtonElement>('#sessionList .session-main')]
    expect(rows.every(row => !row.disabled)).toBe(true)
  })

  it('switches to another conversation and abandons the pending creation', async () => {
    const h = open()
    await show(h, { phase: 'ready' })
    startCreation(h)
    h.click('#sessionTrigger')
    const from = h.posts.length
    h.click('#sessionList .session-row[data-session-id="session-b"] .session-main')
    expect(posts(h, from)).toEqual([{ type: 'select-session', sessionId: 'session-b' }])
    // The abandoned request must not keep the control disabled afterwards.
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(false)
    expect((h.document.getElementById('homeError') as HTMLElement).textContent).toBe('')
  })

  it('keeps a late receipt from an abandoned creation from navigating away', async () => {
    const h = open()
    await show(h, { phase: 'ready' })
    const pending = startCreation(h)
    h.click('#sessionTrigger')
    h.click('#sessionList .session-row[data-session-id="session-b"] .session-main')
    const count = h.posts.length
    h.send({ type: 'conversation-created', requestId: pending.requestId, cwd: pending.cwd, sessionId: 'created' })
    expect(h.posts.length).toBe(count)
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Restart Runtime is limited to a runtime this window owns', () => {
  it('offers Restart for a managed runtime', async () => {
    const h = open()
    await show(h, { phase: 'error', statusText: 'The runtime failed.', canReconnect: true, runtimeConnection: { ownership: 'managed' } })
    const from = h.posts.length
    byText(h, 'Restart Runtime')!.click()
    expect(posts(h, from)).toEqual([{ type: 'restart' }])
  })

  it.each(['adopted', 'attached', 'external'])('hides Restart for a shared %s runtime', async ownership => {
    const h = open()
    await show(h, { phase: 'error', statusText: 'The runtime failed.', canReconnect: true, runtimeConnection: { ownership } })
    expect(byText(h, 'Restart Runtime')).toBeUndefined()
    // Recovery remains reachable: reconnect in place or inspect the output.
    expect(byText(h, 'Reconnect')).toBeDefined()
    expect(byText(h, 'Show Output')).toBeDefined()
  })

  it('hides Restart when no runtime ownership is known', async () => {
    const h = open()
    await show(h, { phase: 'error', statusText: 'The runtime failed.', canReconnect: true, runtimeConnection: null })
    expect(byText(h, 'Restart Runtime')).toBeUndefined()
  })

  it('drops a stale Restart when the ownership changes without another status change', async () => {
    const h = open()
    await show(h, { phase: 'error', statusText: 'The runtime failed.', canReconnect: true, runtimeConnection: { ownership: 'managed' } })
    expect(byText(h, 'Restart Runtime')).toBeDefined()
    // Same phase, text, setup and reconnect flag: only the ownership differs, so
    // the status block must still be rebuilt for the hidden action to disappear.
    await show(h, { phase: 'error', statusText: 'The runtime failed.', canReconnect: true, runtimeConnection: { ownership: 'adopted' } })
    expect(byText(h, 'Restart Runtime')).toBeUndefined()
  })
})

describe('a failed render asks for a fresh state instead of freezing', () => {
  it('reports one render failure and requests a full state', async () => {
    const h = open()
    await show(h, { phase: 'ready' })
    const before = h.posts.length
    const proto = Node.prototype as unknown as { insertBefore: (...args: unknown[]) => unknown }
    const original = proto.insertBefore
    let armed = true
    proto.insertBefore = function (this: Node, ...args: unknown[]) {
      if (armed) { armed = false; throw new Error('injected layout failure') }
      return original.apply(this, args)
    }
    try {
      // The new message makes the next render touch insertBefore, which throws
      // before the view can be reconciled.
      h.sendState({ sessionId: 'session-a', sessions: [parent, other], messages: [{ id: 'user:1', role: 'user', text: 'hello' }] })
      await h.settle()
    } finally {
      proto.insertBefore = original
    }
    const posted = posts(h, before)
    const reports = posted.filter(post => post.type === 'webview-error' && String(post.message).includes('render failed'))
    expect(reports).toHaveLength(1)
    const resync = posted.filter(post => post.type === 'resync')
    expect(resync).toHaveLength(1)
    expect(resync[0]).toMatchObject({ staleSessionId: 'session-a', phase: 'ready' })
    // The next state renders from the fresh snapshot, and the report is throttled.
    h.sendState({ sessionId: 'session-a', sessions: [parent, other], messages: [{ id: 'user:2', role: 'user', text: 'second' }] })
    await h.settle()
    expect(h.document.getElementById('messages')!.textContent).toContain('second')
    expect(h.posts.filter(post => post.type === 'webview-error' && String(post.message).includes('render failed'))).toHaveLength(1)
  })
})

describe('a conversation click is acknowledged before the Host state lands', () => {
  const title = (h: Harness) => h.document.getElementById('sessionTriggerTitle')!.textContent

  it('shows the intent in the header until the target state arrives', async () => {
    const h = open()
    await show(h, { phase: 'ready' })
    h.click('#sessionTrigger')
    const from = h.posts.length
    h.click('#sessionList .session-row[data-session-id="session-b"] .session-main')
    expect(posts(h, from)).toContainEqual({ type: 'select-session', sessionId: 'session-b' })
    // The click is visible immediately, while the Host's state is still pending.
    expect(title(h)).toBe('Switching to “Other conversation”…')
    expect(h.document.getElementById('sessionTrigger')!.getAttribute('aria-busy')).toBe('true')
    // The real state ends the local intent.
    await show(h, { sessionId: 'session-b' })
    expect(title(h)).toBe('Other conversation')
    expect(h.document.getElementById('sessionTrigger')!.hasAttribute('aria-busy')).toBe(false)
  })

  it('asks for a retry when the switch does not land within the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    h.sendState({ sessionId: 'session-a', sessions: [parent, other] })
    await vi.advanceTimersByTimeAsync(20)
    h.click('#sessionTrigger')
    h.click('#sessionList .session-row[data-session-id="session-b"] .session-main')
    expect(title(h)).toBe('Switching to “Other conversation”…')
    await vi.advanceTimersByTimeAsync(10_100)
    expect(title(h)).toBe('Still switching to “Other conversation”…')
    expect(h.document.getElementById('sessionTrigger')!.getAttribute('title')).toContain('did not change')
    // A late state still settles the local intent.
    h.sendState({ sessionId: 'session-b', sessions: [parent, other] })
    await vi.advanceTimersByTimeAsync(20)
    expect(title(h)).toBe('Other conversation')
  })
})
