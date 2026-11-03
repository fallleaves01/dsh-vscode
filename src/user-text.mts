import { createSecretRule } from './vendor/dsh-credential-matcher.mjs'
import { secretIcon, updateSecretIcon } from './secret-icon.mjs'
import { messageQuoteRanges, quoteTextOf } from './quote-text.mjs'

type SecretRule = ReturnType<typeof createSecretRule>
type SecretMatch = NonNullable<ReturnType<SecretRule['match']>>

/** Longest tooltip value derived from one quote; its visible text stays whole. */
const QUOTE_ATTRIBUTE_MAX_CHARS = 2000

/**
 * DSH's QuotePreview glyph: two filled quotation marks in a 16px box. The paths
 * are drawn around (0, 0), so the group carries DSH's own offset.
 */
const QUOTE_MARK_PATHS = [
  'M2.8125 0.583008L3.2002 1.16602C2.43912 1.6713 1.88491 2.41238 1.60547 3.25684H2.98926V6.70605H0V4.52148C1.96593e-05 2.70313 0.9109 1.00575 2.42578 0L2.8125 0.583008Z',
  'M7.50781 0.583008L7.89551 1.16602C7.13443 1.6713 6.58022 2.41238 6.30078 3.25684H7.68457V6.70605H4.69531V4.52148C4.69533 2.70313 5.60621 1.00575 7.12109 0L7.50781 0.583008Z',
]

function quoteMarkSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'quote-mark')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('transform', 'translate(6.8 2.4)')
  for (const path of QUOTE_MARK_PATHS) {
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    mark.setAttribute('d', path)
    mark.setAttribute('fill', 'currentColor')
    group.append(mark)
  }
  svg.append(group)
  return svg
}

/** The official credential control: masked value plus one per-value reveal. */
function secretSpan(raw: string, match: SecretMatch): HTMLElement {
  const secret = document.createElement('span'); secret.className = 'secret-text'; secret.dataset.secret = ''
  const value = document.createElement('span'); value.className = 'secret-value'; value.textContent = match.data.masked
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'secret-toggle'
  const svg = secretIcon(document); toggle.append(svg)
  let revealed = false
  const update = (): void => {
    toggle.setAttribute('aria-pressed', String(revealed)); toggle.setAttribute('aria-label', revealed ? 'Hide secret' : 'Show secret')
    toggle.title = revealed ? 'Hide secret' : 'Show secret'; updateSecretIcon(svg, revealed)
    value.replaceChildren()
    if (revealed) value.textContent = raw
    else for (const part of match.data.masked.split(/(\*+)/u)) {
      if (!part) continue
      if (!part.startsWith('*')) value.append(document.createTextNode(part))
      else { const run = document.createElement('span'); run.className = 'secret-mask-run'; run.textContent = part; value.append(run) }
    }
  }
  toggle.addEventListener('click', () => { revealed = !revealed; update() }); update()
  secret.append(value, toggle)
  return secret
}

/** Append text with credentials masked, exactly as the message body renders them. */
function appendSecretText(container: HTMLElement, text: string, rule: SecretRule): void {
  if (text === '') return
  let cursor = 0
  for (;;) {
    const match = rule.match(text, cursor)
    if (!match) { container.append(document.createTextNode(text.slice(cursor))); break }
    if (match.start > cursor) container.append(document.createTextNode(text.slice(cursor, match.start)))
    container.append(secretSpan(text.slice(match.start, match.end), match))
    cursor = match.end
  }
}

/** The same masked projection as a plain string, for attributes only. */
function maskedPlainText(text: string, rule: SecretRule): string {
  let out = ''
  let cursor = 0
  for (;;) {
    const match = rule.match(text, cursor)
    if (!match) return out + text.slice(cursor)
    out += text.slice(cursor, match.start) + match.data.masked
    cursor = match.end
  }
}

/** Cap a tooltip value with an ellipsis; the quote's DOM text is not touched. */
function quoteAttributeText(text: string): string {
  if (text.length <= QUOTE_ATTRIBUTE_MAX_CHARS) return text
  let cut = QUOTE_ATTRIBUTE_MAX_CHARS
  // Do not leave a dangling high surrogate in a tooltip attribute.
  const last = text.charCodeAt(cut - 1)
  if (last >= 0xD800 && last <= 0xDBFF) cut -= 1
  return text.slice(0, cut) + '…'
}

/**
 * Mask recognized credentials in one string without building a DOM.
 *
 * The composer chip renders the value the user quoted (usually already masked
 * by the transcript). Its `title` and `aria-label` are attributes, so they are
 * built from this projection: a raw credential must never reach an attribute.
 */
export function maskUserText(text: string): string {
  return maskedPlainText(text, createSecretRule())
}

/**
 * One transcript quote, rendered like DSH's `QuotePreview`: an inline, link-like
 * mark plus a single-line, ellipsized text that keeps the decoded full text in
 * the DOM and in its tooltip.
 *
 * The decoded quote runs through the credential rules again. DSH's own rule
 * order (quote -10 before secret 0) short-circuits the secret rule inside a
 * blockquote, so a quoted credential stays visible there; the adapted renderer
 * deliberately closes that gap. The tooltip is built from the masked projection
 * as well, so hovering and assistive technology cannot reveal a raw value.
 */
function quotePreview(text: string, rule: SecretRule): HTMLElement {
  const preview = document.createElement('span')
  preview.className = 'quote-preview'
  preview.dataset.quotePreview = ''
  const mark = document.createElement('span')
  mark.className = 'quote-preview-mark'
  mark.setAttribute('aria-hidden', 'true')
  mark.append(quoteMarkSvg())
  const source = document.createElement('span')
  source.className = 'quote-preview-text'
  source.dataset.quotePreviewText = ''
  source.title = quoteAttributeText(maskedPlainText(text, rule))
  appendSecretText(source, text, rule)
  preview.append(mark, source)
  return preview
}

/** Official user-text credential rules and per-value reveal interaction. No state is persisted. */
export function renderUserText(text: string): HTMLDivElement {
  const root = document.createElement('div'); root.className = 'user-text'
  const rule = createSecretRule()
  const ranges = messageQuoteRanges(text)
  if (ranges.length === 0) {
    // The pre-quote path: the credential renderer on its own, unchanged.
    let cursor = 0
    for (;;) {
      const match = rule.match(text, cursor)
      if (!match) { root.append(document.createTextNode(text.slice(cursor))); break }
      root.append(document.createTextNode(text.slice(cursor, match.start)))
      root.append(secretSpan(text.slice(match.start, match.end), match))
      cursor = match.end
    }
    return root
  }
  // DSH's quoteRule: a blockquote becomes one atomic node and the two newlines
  // around it collapse to a single space, so quotes read inline instead of as
  // blank lines. A quote at the start or end of the message has no separator.
  let cursor = 0
  for (const range of ranges) {
    const separates = range.start >= 2 && range.start - 2 >= cursor && text.startsWith('\n\n', range.start - 2)
    appendSecretText(root, text.slice(cursor, separates ? range.start - 2 : range.start), rule)
    if (separates) root.append(document.createTextNode(' '))
    root.append(quotePreview(quoteTextOf(text.slice(range.start, range.end)), rule))
    cursor = range.end
  }
  if (text.startsWith('\n\n', cursor)) { root.append(document.createTextNode(' ')); cursor += 2 }
  appendSecretText(root, text.slice(cursor), rule)
  return root
}
