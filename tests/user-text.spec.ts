// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderUserText } from '../src/user-text.mjs'
import { createSecretRule } from '../src/vendor/dsh-credential-matcher.mjs'

// Deliberately synthetic, assembled fixtures cannot authenticate to any service.
const key = (prefix = 'sk-') => prefix + 'A1'.repeat(prefix === 'ghp_' ? 18 : 16)
afterEach(() => document.body.replaceChildren())
describe('official user message credential masks', () => {
  it.each([key(), key('ghp_'), 'https://user:synthetic-password@example.test/path', '-----BEGIN PRIVATE KEY-----\n' + 'QUJD'.repeat(20) + '\n-----END PRIVATE KEY-----'])('hides recognized credentials before mounting %#', text => {
    const node = renderUserText(text); document.body.append(node)
    expect(node.querySelector('.secret-toggle')).not.toBeNull()
    expect(node.outerHTML).not.toContain(text)
    expect(node.querySelector('[aria-label="Show secret"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(node.querySelector('.secret-mask-run')).not.toBeNull()
  })
  it('reveals exactly one credential and hides it again without storing raw values in attributes', () => {
    const first = key(), second = key('ghp_'), node = renderUserText(`First ${first}; second ${second}`)
    const buttons = node.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons).toHaveLength(2); buttons[0]!.click()
    expect(node.textContent).toContain(first); expect(node.textContent).not.toContain(second)
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Hide secret')
    for (const element of node.querySelectorAll('*')) for (const attr of element.attributes) { expect(attr.value).not.toContain(first); expect(attr.value).not.toContain(second) }
    buttons[0]!.click(); expect(node.textContent).not.toContain(first)
    expect(renderUserText(first).textContent).not.toContain(first)
  })
  it('keeps ordinary text and HTML literal, with no links or executable nodes', () => {
    const text = '<img src=x onerror=alert(1)> **plain** 你好 🙂\nhttps://example.test/path\nsk-short'
    const node = renderUserText(text)
    expect(node.textContent).toBe(text); expect(node.querySelector('img,a,strong,script,button')).toBeNull()
  })
  it('preserves URL context and masks only its password', () => {
    const node = renderUserText('https://user:synthetic-password@example.test/path')
    expect(node.textContent).toContain('https://user:'); expect(node.textContent).toContain('@example.test/path')
    expect(node.innerHTML).not.toContain('synthetic-password')
  })
  it('matches boundaries and preserves PEM line breaks', () => {
    const text = '🙂 before ' + key() + '\n-----BEGIN PRIVATE KEY-----\r\n' + 'QUJD'.repeat(20) + '\r\n-----END PRIVATE KEY-----'
    const rule = createSecretRule(), first = rule.match(text, 0)!, second = rule.match(text, first.end)!
    expect(text.slice(first.start, first.end)).toBe(key())
    expect(second.data.masked.match(/\r\n/g)).toHaveLength(2)
    expect(rule.match(text, second.end)).toBeUndefined()
  })
  it('scans large ordinary input and repeated near-prefixes without an unbounded loop', () => {
    const text = ('ordinary sk-short https://example.test/ ').repeat(15000) + key()
    const started = performance.now(), match = createSecretRule().match(text, 0)!
    expect(text.slice(match.start, match.end)).toBe(key())
    expect(performance.now() - started).toBeLessThan(3000)
  })
})

describe('user message blockquotes', () => {
  // Synthetic fixture; it cannot authenticate to any service.
  const key = 'sk-' + 'A1'.repeat(16)
  it('renders a blockquote as one decoded quote preview without the markers', () => {
    const node = renderUserText('> quoted')
    expect(node.querySelectorAll('.quote-preview')).toHaveLength(1)
    expect(node.querySelector('[data-quote-preview-text]')?.textContent).toBe('quoted')
    expect(node.textContent).toBe('quoted')
    expect(node.textContent).not.toContain('>')
    expect(node.querySelector('.quote-preview-mark svg')).not.toBeNull()
  })
  it('decodes every line of a multiline quote', () => {
    const node = renderUserText('> line one\n> line two')
    expect(node.querySelector('[data-quote-preview-text]')?.textContent).toBe('line one\nline two')
  })
  it('shows the blank lines around a quote as single spaces', () => {
    const node = renderUserText('before\n\n> quoted\n\nafter')
    expect(node.textContent).toBe('before quoted after')
  })
  it('separates two adjacent quotes with one space', () => {
    const node = renderUserText('> one\n\n> two')
    expect(node.querySelectorAll('.quote-preview')).toHaveLength(2)
    expect(node.textContent).toBe('one two')
  })
  it('keeps ordinary text in order around the quote', () => {
    const node = renderUserText('before\n\n> quoted\n\nafter')
    const text = node.textContent ?? ''
    expect(text.indexOf('before')).toBeLessThan(text.indexOf('quoted'))
    expect(text.indexOf('quoted')).toBeLessThan(text.indexOf('after'))
  })
  it('leaves an indented marker of four spaces as literal text', () => {
    const node = renderUserText('    > code')
    expect(node.querySelector('.quote-preview')).toBeNull()
    expect(node.textContent).toBe('    > code')
  })
  it('recognizes blockquote lines inside a code fence, matching the documented DSH limit', () => {
    const node = renderUserText('```\n> inside\n```')
    expect(node.querySelectorAll('.quote-preview')).toHaveLength(1)
    expect(node.querySelector('[data-quote-preview-text]')?.textContent).toBe('inside')
  })
  it('masks a credential inside the quote and keeps it out of every attribute', () => {
    const node = renderUserText('> use ' + key)
    const preview = node.querySelector('.quote-preview')!
    expect(preview.querySelector('.secret-toggle')).not.toBeNull()
    expect(preview.querySelector('.quote-preview-text')?.textContent).not.toContain(key)
    expect(node.outerHTML).not.toContain(key)
    for (const element of node.querySelectorAll('*')) {
      for (const attribute of element.attributes) expect(attribute.value).not.toContain(key)
    }
    preview.querySelector<HTMLButtonElement>('.secret-toggle')!.click()
    expect(preview.textContent).toContain(key)
  })
  it('renders quote content as text only, never as markup', () => {
    const node = renderUserText('> <img src=x onerror=alert(1)> **plain**')
    expect(node.querySelector('img, a, strong, script')).toBeNull()
    expect(node.querySelector('[data-quote-preview-text]')?.textContent).toContain('<img src=x onerror=alert(1)>')
  })
  it('keeps the no-quote path byte-identical', () => {
    const text = 'ordinary **text** <b>literal</b>\nsecond line'
    const node = renderUserText(text)
    expect(node.querySelector('.quote-preview')).toBeNull()
    expect(node.textContent).toBe(text)
  })
})
