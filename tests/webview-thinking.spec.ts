// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
import { WEBVIEW_INLINE_CHAR_LIMIT } from '../src/chat-state-patch.js'

/**
 * The collapsed thinking summary is the only progress signal while the model
 * reasons, so it has to keep moving and it has to show that a turn is live.
 *
 * It previously showed the *first* 140 characters of reasoning, which never
 * changed once the model passed 140 characters — a live turn and a finished one
 * looked identical. Its whitespace-collapsing regex had also lost a backslash in
 * the embedding template literal, so it replaced every letter "s" with a space.
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

function thinking(reasoning: string, streaming: boolean): Record<string, unknown> {
  return { id: 'm1', role: 'assistant', text: '', reasoning, streaming }
}

async function show(h: Harness, reasoning: string, streaming = false): Promise<void> {
  h.sendState({ sessionId: 'session-a', messages: [thinking(reasoning, streaming)] })
  await h.settle()
}

const preview = (h: Harness) => h.document.querySelector('.thinking-preview')?.textContent ?? ''
const title = (h: Harness) => h.document.querySelector('.thinking-title')?.textContent ?? ''
const root = (h: Harness) => h.document.querySelector('.thinking')

describe('thinking summary follows the newest line', () => {
  it('shows the last line, not the first characters written', async () => {
    const h = open()
    await show(h, 'First thought.\nSecond thought.\nThird and newest line.')
    expect(preview(h)).toBe('Third and newest line.')
  })

  it('keeps moving as more thinking streams in', async () => {
    const h = open()
    await show(h, 'Starting the analysis.', true)
    expect(preview(h)).toBe('Starting the analysis.')

    h.sendState({ sessionId: 'session-a', messages: [thinking('Starting the analysis.\nMeasuring the repository.', true)] })
    await h.settle()
    expect(preview(h)).toBe('Measuring the repository.')

    h.sendState({ sessionId: 'session-a', messages: [thinking('Starting the analysis.\nMeasuring the repository.\nWriting the summary.', true)] })
    await h.settle()
    expect(preview(h)).toBe('Writing the summary.')
  })

  it('collapses whitespace without eating the letter s', async () => {
    const h = open()
    // The damaged regex turned this into " u e   everal    pace ".
    await show(h, '  uses   several    spaces  ')
    expect(preview(h)).toBe('uses several spaces')
  })

  it('keeps the newest characters when a single line is very long', async () => {
    const h = open()
    await show(h, `${'a'.repeat(300)}the newest words`)
    const shown = preview(h)
    expect(shown.startsWith('…')).toBe(true)
    expect(shown.endsWith('the newest words')).toBe(true)
  })

  it('skips trailing blank lines so the summary is never empty mid-turn', async () => {
    const h = open()
    await show(h, 'The last real line.\n\n  \n')
    expect(preview(h)).toBe('The last real line.')
  })

  it('does not materialize the collapsed body until it is opened', async () => {
    const h = open()
    await show(h, 'Private reasoning that should stay collapsed.')
    expect(h.document.querySelector('.thinking-body')?.textContent).toBe('')
  })
})

describe('thinking summary shows that a turn is live', () => {
  /** Flushes a render frame and the elapsed timer under fake timers. */
  const flush = async () => { await vi.advanceTimersByTimeAsync(20) }

  it('counts elapsed time while thinking and freezes it once settled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    h.sendState({ sessionId: 'session-a', messages: [thinking('Working on it.', true)] })
    await flush()
    expect(root(h)?.classList.contains('live')).toBe(true)
    expect(title(h)).toBe('Thinking')

    await vi.advanceTimersByTimeAsync(7000)
    expect(title(h)).toBe('Thinking · 7s')

    // Settling must stop the clock rather than leave it running.
    h.sendState({ sessionId: 'session-a', messages: [thinking('Working on it.\nDone.', false)] })
    await flush()
    expect(root(h)?.classList.contains('live')).toBe(false)
    expect(title(h)).toBe('Thought · 7s')

    await vi.advanceTimersByTimeAsync(20000)
    h.sendState({ sessionId: 'session-a', messages: [thinking('Working on it.\nDone.', false)] })
    await flush()
    expect(title(h)).toBe('Thought · 7s')
  })

  it('stops its timer when the conversation is replaced', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const h = open()
    h.sendState({ sessionId: 'session-a', messages: [thinking('Working on it.', true)] })
    await flush()
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    h.sendState({ sessionId: 'session-b', messages: [] })
    await flush()
    // Only the render frame may remain; a runaway thinking interval must not.
    h.sendState({ sessionId: 'session-b', messages: [] })
    await flush()
    expect(root(h)).toBeNull()
  })
})
