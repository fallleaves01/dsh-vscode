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
