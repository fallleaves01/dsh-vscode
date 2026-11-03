import { describe, expect, it } from 'vitest'
import {
  formatQuoteText, messageQuoteRanges, quoteTextOf, serializeQuotePrompt,
} from '../src/quote-text.mjs'

/**
 * The quote format is the contract between the composer (which writes
 * blockquotes) and the transcript (which reads them back). These functions are
 * ports of the official DSH message-quotes rules, so the vectors are the DSH
 * ones: a change here changes what a model sees.
 */

describe('formatQuoteText', () => {
  it('prefixes one line with the blockquote marker', () => {
    expect(formatQuoteText('quoted')).toBe('> quoted')
  })
  it('prefixes every line, including an empty one', () => {
    expect(formatQuoteText('a\n\nb')).toBe('> a\n> \n> b')
  })
  it('normalizes CRLF and lone CR to LF before prefixing', () => {
    expect(formatQuoteText('a\r\nb\rc')).toBe('> a\n> b\n> c')
  })
  it('keeps a trailing empty line as a marker-only line', () => {
    expect(formatQuoteText('a\n')).toBe('> a\n> ')
  })
})

describe('quoteTextOf', () => {
  it('removes one marker and one optional space or tab per line', () => {
    expect(quoteTextOf('> a\n>\tb\n>c')).toBe('a\nb\nc')
  })
  it('removes at most one marker, so a nested quote keeps one', () => {
    expect(quoteTextOf('>> nested')).toBe('> nested')
  })
  it('accepts at most three leading spaces and keeps the rest', () => {
    expect(quoteTextOf('  > q\n    > text')).toBe('q\n    > text')
  })
  it('normalizes CRLF to LF', () => {
    expect(quoteTextOf('> a\r\n> b')).toBe('a\nb')
  })
})

describe('messageQuoteRanges', () => {
  it('accepts zero through three leading spaces', () => {
    expect(messageQuoteRanges('> a\n  > b\n   > c')).toEqual([{ start: 0, end: 16 }])
  })
  it('does not treat four leading spaces as a quote', () => {
    expect(messageQuoteRanges('    > code')).toEqual([])
  })
  it('does not treat an inline > as a quote', () => {
    expect(messageQuoteRanges('a > b')).toEqual([])
  })
  it('merges consecutive explicitly marked lines, including a marker-only line', () => {
    expect(messageQuoteRanges('> a\n>\n> b')).toEqual([{ start: 0, end: 9 }])
  })
  it('does not implement lazy continuation lines', () => {
    expect(messageQuoteRanges('> a\nb\n> c')).toEqual([{ start: 0, end: 3 }, { start: 6, end: 9 }])
  })
  it('drops a block that decodes to whitespace only', () => {
    expect(messageQuoteRanges('> \n> ')).toEqual([])
  })
  it('recognizes two quotes separated by a blank line separately', () => {
    expect(messageQuoteRanges('> a\n\n> b')).toEqual([{ start: 0, end: 3 }, { start: 5, end: 8 }])
  })
  it('does not parse code fences, matching the documented DSH limit', () => {
    expect(messageQuoteRanges('```\n> inside\n```')).toEqual([{ start: 4, end: 12 }])
  })
  it('scans a large message in bounded time', () => {
    const text = ('ordinary text without markers\n').repeat(4000) + '> last'
    const started = performance.now()
    expect(messageQuoteRanges(text)).toEqual([{ start: text.length - 6, end: text.length }])
    expect(performance.now() - started).toBeLessThan(3000)
  })
})

describe('serializeQuotePrompt', () => {
  it('returns the trimmed prose when there is no quote (byte-for-byte legacy behavior)', () => {
    expect(serializeQuotePrompt([], '  hello\n')).toBe('hello')
    expect(serializeQuotePrompt([], '   ')).toBe('')
  })
  it('sends a quote alone with no surrounding blank line', () => {
    expect(serializeQuotePrompt(['quoted'], '')).toBe('> quoted')
    expect(serializeQuotePrompt(['quoted'], '  ')).toBe('> quoted')
  })
  it('separates one quote from the trimmed prose with exactly one blank line', () => {
    expect(serializeQuotePrompt(['quoted'], '  hello  ')).toBe('> quoted\n\nhello')
  })
  it('keeps quote insertion order and one blank line between blocks', () => {
    expect(serializeQuotePrompt(['a', 'b'], 'explain')).toBe('> a\n\n> b\n\nexplain')
  })
  it('formats a multiline quote line by line', () => {
    expect(serializeQuotePrompt(['line one\nline two'], 'why')).toBe('> line one\n> line two\n\nwhy')
  })
  it('keeps an empty line inside a quote as a marker-only line', () => {
    expect(serializeQuotePrompt(['a\n\nb'], 'x')).toBe('> a\n> \n> b\n\nx')
  })
  it('normalizes a CRLF quote', () => {
    expect(serializeQuotePrompt(['a\r\nb'], 'q')).toBe('> a\n> b\n\nq')
  })
  it('keeps a trailing empty line of a quote before the prose', () => {
    expect(serializeQuotePrompt(['a\n'], 'q')).toBe('> a\n> \n\nq')
  })
})
