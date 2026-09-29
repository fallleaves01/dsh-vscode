import { describe, expect, it } from 'vitest'
import { formatExactTokenCount, formatTokenCount, tokenUsageOf, turnUsageOf } from '../src/token-usage.js'

describe('per-call token usage', () => {
  it('reads a figure DSH reported', () => {
    expect(tokenUsageOf({ inputTokens: 1200, outputTokens: 300, totalTokens: 1500 })).toEqual({
      inputTokens: 1200, outputTokens: 300, totalTokens: 1500,
    })
  })

  it('refuses a payload that is not a usage figure', () => {
    // Substituting a zero would invent a number the runtime never reported.
    expect(tokenUsageOf(undefined)).toBeUndefined()
    expect(tokenUsageOf({})).toBeUndefined()
    expect(tokenUsageOf({ inputTokens: 10 })).toBeUndefined()
    expect(tokenUsageOf({ inputTokens: 10, outputTokens: -1 })).toBeUndefined()
    expect(tokenUsageOf({ inputTokens: 1.5, outputTokens: 2 })).toBeUndefined()
    expect(tokenUsageOf({ inputTokens: '10', outputTokens: 2 })).toBeUndefined()
  })
})

describe('turn usage', () => {
  const first = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, totalTokens: 115 }
  const second = { inputTokens: 200, outputTokens: 20, cacheReadTokens: 7, totalTokens: 227 }

  it('sums one turn’s calls', () => {
    expect(turnUsageOf([first, second], ['p/m'])).toEqual({
      uncachedInputTokens: 300, outputTokens: 30, totalTokens: 342,
      cacheReadTokens: 12, routes: ['p/m'],
    })
  })

  it('drops a cache bucket one call did not report', () => {
    // A partial sum would under-report the cache, so the bucket is omitted
    // instead — which is what DSH's own panel does.
    const partial = turnUsageOf([first, { inputTokens: 1, outputTokens: 1 }], [])
    expect(partial?.cacheReadTokens).toBeUndefined()
    expect(partial?.uncachedInputTokens).toBe(101)
  })

  it('reports nothing when no call reported anything', () => {
    expect(turnUsageOf([undefined, undefined], [])).toBeUndefined()
  })

  it('keeps the routes that contributed, without duplicates', () => {
    expect(turnUsageOf([first], ['p/m', 'p/m', 'q/n'])?.routes).toEqual(['p/m', 'q/n'])
  })

  it('derives a total when no call reported one', () => {
    const derived = turnUsageOf([{ inputTokens: 10, outputTokens: 3, cacheWriteTokens: 2 }], [])
    expect(derived?.totalTokens).toBe(15)
  })
})

describe('token figures', () => {
  it('compacts the way the usage pill does', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(12_345)).toBe('12.3K')
    expect(formatTokenCount(123_456)).toBe('123K')
    expect(formatTokenCount(1_234_567)).toBe('1.2M')
  })

  it('groups the exact figure the panel shows', () => {
    expect(formatExactTokenCount(12_345)).toBe('12,345')
  })
})
