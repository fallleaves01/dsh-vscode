// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * While a turn runs and sends nothing, the sidebar used to show no state at all,
 * so a model that was quietly working looked exactly like one that had died.
 *
 * DSH's own client answers this with a live clock ("Deep diving for 12s"). The
 * clock alone still cannot separate the two — it ticks either way — so the
 * sidebar also reports the age of the newest runtime event.
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

/** Flushes a render frame and one tick of the live clock under fake timers. */
const flush = async () => { await vi.advanceTimersByTimeAsync(20) }

const status = (h: Harness) => h.document.querySelector('.live-status-text')?.textContent ?? null

async function show(h: Harness, overrides: Record<string, unknown>): Promise<void> {
  h.sendState({ sessionId: 'session-a', ...overrides })
  await flush()
}

describe('the live turn status', () => {
  it('is absent while nothing runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    await show(h, { running: false, turnStartedAt: 0, turnActivityAt: 0 })
    expect(h.document.querySelector('.live-status')).toBeNull()
  })

  it('counts the running turn up, and says how long nothing has arrived', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    const now = Date.now()
    await show(h, { running: true, turnStartedAt: now - 120000, turnActivityAt: now })
    expect(status(h)).toBe('Deep diving for 2m 0s')

    // A quiet turn keeps ticking, and only past the threshold explains itself.
    await vi.advanceTimersByTimeAsync(10000)
    expect(status(h)).toBe('Deep diving for 2m 10s')

    await vi.advanceTimersByTimeAsync(10000)
    expect(status(h)).toBe('Deep diving for 2m 20s · no new output for 20s')

    // Fresh output silences the quiet note without resetting the clock.
    h.sendState({ sessionId: 'session-a', running: true, turnStartedAt: now - 120000, turnActivityAt: Date.now() })
    await flush()
    expect(status(h)).toBe('Deep diving for 2m 20s')
  })

  it('acknowledges a stop request instead of claiming new work', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    const now = Date.now()
    await show(h, { running: true, stopping: true, turnStartedAt: now, turnActivityAt: now })
    expect(status(h)).toBe('Stopping…')
  })

  it('disappears and stops its timer when the turn ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    const now = Date.now()
    await show(h, { running: true, turnStartedAt: now, turnActivityAt: now })
    expect(h.document.querySelector('.live-status')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)

    await show(h, { running: false, turnStartedAt: 0, turnActivityAt: 0 })
    expect(h.document.querySelector('.live-status')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    // Nothing may come back and tick a finished turn.
    await vi.advanceTimersByTimeAsync(60000)
    expect(h.document.querySelector('.live-status')).toBeNull()
  })

  it('highlights a running turn the way DSH does: a mark and a moving sweep', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    const now = Date.now()
    await show(h, { running: true, turnStartedAt: now, turnActivityAt: now })
    const text = h.document.querySelector('.live-status-text')!
    expect(text.classList.contains('shimmer')).toBe(true)
    const mark = h.document.querySelector('.live-status-mark')!
    // DSH's running mark is the tail alone, stroked in the accent colour.
    expect(mark.querySelectorAll('path')).toHaveLength(1)
    expect(mark.querySelector('path')!.getAttribute('d')!.startsWith('M8.844')).toBe(true)
    expect(mark.querySelector('path')!.getAttribute('stroke')).toBe('currentColor')

    await vi.advanceTimersByTimeAsync(9000)
    // One painted copy of the words: the clock cannot drift from its highlight.
    expect(text.textContent).toBe('Deep diving for 9s')
  })

  it('says so when the runtime reported no start time at all', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    await show(h, { running: true, turnStartedAt: 0, turnActivityAt: 0 })
    expect(status(h)).toBe('Deep diving…')
  })

  it('announces the turn once instead of reading every tick aloud', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    const now = Date.now()
    await show(h, { running: true, turnStartedAt: now, turnActivityAt: now })
    const announced = h.document.querySelector('.live-status [role="status"]')
    expect(announced?.textContent).toBe('Deep diving')

    await vi.advanceTimersByTimeAsync(9000)
    expect(status(h)).toBe('Deep diving for 9s')
    expect(announced?.textContent).toBe('Deep diving')
  })

  it('goes away with the conversation when the runtime leaves the ready phase', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    const now = Date.now()
    await show(h, { running: true, turnStartedAt: now, turnActivityAt: now })
    expect(h.document.querySelector('.live-status')).not.toBeNull()

    await show(h, { phase: 'error', statusText: 'lost', running: true, turnStartedAt: now, turnActivityAt: now })
    expect(h.document.querySelector('.live-status')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
