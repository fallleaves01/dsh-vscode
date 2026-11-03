/**
 * Markdown blockquote text, shared by the composer and the transcript.
 *
 * The three recognition/formatting functions are byte-for-byte ports of the
 * official DSH message-quotes rules, so the text the composer sends is exactly
 * the text the transcript decodes back into a quote preview. Keeping them in
 * one module (bundled into `window.dshMarkdown`) is what stops the writer and
 * the reader from drifting apart.
 */

export interface QuoteRange {
  start: number
  end: number
}

const QUOTE_SEPARATOR = '\n\n'

/**
 * Serialize one quote as Markdown blockquote lines (DSH `formatQuoteText`).
 *
 * CRLF and lone CR become LF and every line, including an empty one, receives
 * the `> ` marker, so a blank line inside a quote is preserved as `> `.
 */
export function formatQuoteText(text: string): string {
  return text.replace(/\r\n?/gu, '\n').split('\n').map(line => '> ' + line).join('\n')
}

/**
 * Remove one blockquote marker and one optional space or tab per line.
 *
 * Mirrors DSH `quoteTextOf`: at most three leading spaces are accepted before
 * the marker, and a nested `> ` line keeps one marker in the decoded text.
 */
export function quoteTextOf(quote: string): string {
  return quote.replace(/\r\n?/gu, '\n').replace(/^ {0,3}>[ \t]?/gmu, '')
}

/**
 * Consecutive explicitly marked blockquote lines that decode to nonblank text.
 *
 * Mirrors DSH `messageQuoteRanges`: a block starts at a line whose first
 * nonindent character is `>` (at most three leading spaces) and continues only
 * through lines that are explicitly marked. Lazy continuation lines and code
 * fences are not interpreted; blocks that decode to whitespace only are
 * dropped. That is the documented DSH behavior, and it is asserted here rather
 * than silently "improved" so both sides of the feature agree.
 */
export function messageQuoteRanges(text: string): QuoteRange[] {
  const ranges: QuoteRange[] = []
  for (const match of text.matchAll(/^ {0,3}>[^\r\n]*(?:\r?\n {0,3}>[^\r\n]*)*/gmu)) {
    const start = match.index ?? 0
    const value = match[0]
    if (quoteTextOf(value).trim() === '') continue
    ranges.push({ start, end: start + value.length })
  }
  return ranges
}

/**
 * Serialize the composer's quote chips followed by the typed prose.
 *
 * This is the observable output of DSH's `normalizeQuoteBoundaries` for the
 * adapted composer, where quotes keep insertion order instead of caret order:
 *
 * - quotes come first, in insertion order, each through {@link formatQuoteText};
 * - exactly one blank line separates two quotes and a quote from the prose;
 * - the prose is trimmed, so a quote-only message has no leading or trailing
 *   blank line;
 * - without quotes the result is the trimmed prose itself, which is byte-for-
 *   byte what the composer sent before quoting existed.
 */
export function serializeQuotePrompt(quotes: readonly string[], prose: string): string {
  const text = prose.trim()
  if (quotes.length === 0) return text
  const quoted = quotes.map(quote => formatQuoteText(quote)).join(QUOTE_SEPARATOR)
  return text === '' ? quoted : quoted + QUOTE_SEPARATOR + text
}
