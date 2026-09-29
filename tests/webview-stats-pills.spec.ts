// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * The session's own statistics, drawn the way DSH's composer dock draws them:
 * one pill for what the session has done, one for what it has cost, each with
 * DSH's own mark. The dock used to be a single 10px line of text; the split is
 * DSH's, so it is asserted structure by structure rather than as one string.
 */

const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

const dock = (h: Harness) => h.document.getElementById('usageStats') as HTMLElement
/** One pill's label, as the pieces it is built from: text runs and dotted separators. */
function parts(pill: Element): string[] {
  return [...pill.querySelector('.stat-label')!.childNodes]
    .map(child => child.nodeType === Node.TEXT_NODE ? child.textContent ?? '' : (child as Element).textContent ?? '')
}
const labels = (h: Harness) => [...dock(h).querySelectorAll('.stat-pill')].map(parts)

const usage = (overrides: Record<string, unknown> = {}) => ({
  available: true, percent: 12, usedTokens: 1000, contextWindow: 8000,
  sessionStats: { turns: 2, steps: 5, llmMs: 30_000, toolMs: 4_000, ttftSteps: 5, ttftMs: 5_000, decodeMs: 10_000, decodeTokens: 240 },
  tokenUsage: { uncachedInputTokens: 1_000, cacheReadTokens: 9_000, cacheWriteTokens: 0, outputTokens: 500 },
  ...overrides,
})

describe('the session statistics dock', () => {
  it('is absent until the runtime has something to report', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready' })
    await h.settle()
    expect(dock(h).classList.contains('hidden')).toBe(true)
    expect(dock(h).childNodes).toHaveLength(0)
  })

  it('reports what the session has done, and what it has cost', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', usage: usage() })
    await h.settle()
    expect(dock(h).classList.contains('hidden')).toBe(false)
    // DSH's own wording: "{turns} turns {steps} steps", then the decode rate,
    // and "{total} tok" then "Cache hit {percent}%". The dot between them is the
    // pill's own element, as DSH separates them, not a character in the label.
    expect(labels(h)).toEqual([
      ['2 turns 5 steps', '·', '24 tok/s'],
      ['11K tok', '·', 'Cache hit 90%'],
    ])
    // Each pill carries DSH's mark: the gauge for pace, the database for spend.
    const pills = [...dock(h).querySelectorAll('.stat-pill')]
    expect(pills).toHaveLength(2)
    expect(pills.every(pill => pill.querySelector('svg') !== null)).toBe(true)
    expect(pills[0]!.querySelectorAll('path')).toHaveLength(3)
    expect(pills[1]!.querySelectorAll('path')).toHaveLength(5)
  })

  it('drops a figure it cannot compute instead of printing a zero', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      usage: usage({
        sessionStats: { turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftSteps: 0, ttftMs: 0, decodeMs: 0, decodeTokens: 0 },
        tokenUsage: { uncachedInputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
      }),
    })
    await h.settle()
    // No decode timing: the rate is simply absent. A cache hit of zero is a real
    // measurement and stays, as DSH reports it.
    expect(labels(h)).toEqual([['1 turn 1 step'], ['500 tok', '·', 'Cache hit 0%']])
  })

  it('says nothing about the cache when no prompt side was billed at all', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      usage: usage({
        sessionStats: { turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftSteps: 0, ttftMs: 0, decodeMs: 0, decodeTokens: 0 },
        tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100 },
      }),
    })
    await h.settle()
    // Zero prompt tokens is not a 0% hit, it is no hit rate at all.
    expect(labels(h)).toEqual([['1 turn 1 step'], ['100 tok']])
  })

  it('shows DSH’s rounded rate: whole tokens from ten up, one decimal below', async () => {
    const h = open()
    const rate = (decodeTokens: number) => usage({
      sessionStats: { turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftSteps: 0, ttftMs: 0, decodeMs: 10_000, decodeTokens },
    })
    h.sendState({ sessionId: 'session-a', phase: 'ready', usage: rate(94) })
    await h.settle()
    expect(labels(h)[0]).toEqual(['1 turn 1 step', '·', '9.4 tok/s'])

    h.sendState({ sessionId: 'session-a', phase: 'ready', usage: rate(940) })
    await h.settle()
    expect(labels(h)[0]).toEqual(['1 turn 1 step', '·', '94 tok/s'])
  })

  it('offers the full breakdown on the pill it cannot fit', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', usage: usage() })
    await h.settle()
    const title = dock(h).querySelector('.stat-pill')!.getAttribute('title')!
    expect(title).toContain('2 turns · 5 steps')
    expect(title).toContain('LLM 30s')
    expect(title).toContain('TTFT avg 1.0s')
    expect(title).toContain('in 10K · out 500')
  })
})
