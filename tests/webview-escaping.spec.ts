import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Webview's HTML, CSS and JavaScript are one big template literal, so a
 * backslash written once is consumed as a template escape. That is silent and
 * survives review:
 *
 *   /\s+/g   reached the browser as  /s+/g    (replaced every letter "s")
 *   /\.0$/   reached the browser as  /.0$/    (stripped any character)
 *
 * The first of those mangled every thinking preview. Nothing about reading the
 * source shows it, so this file asserts the invariant instead: inside the
 * embedded script every backslash must be doubled.
 */

const source = readFileSync(join(process.cwd(), 'src', 'webview.ts'), 'utf8')

/** The template literal that carries the Webview script, found by its content. */
function scriptRegion(): string {
  const anchor = source.indexOf('function renderMessage')
  expect(anchor, 'the Webview script should define renderMessage').toBeGreaterThan(-1)
  const ticks: number[] = []
  for (let index = source.indexOf('`'); index !== -1; index = source.indexOf('`', index + 1)) ticks.push(index)
  const start = ticks.filter(tick => tick < anchor).pop()
  const end = ticks.find(tick => tick > anchor && tick > (start ?? 0) + 5000)
  expect(start, 'the script should open a template literal').toBeDefined()
  expect(end, 'the script should close its template literal').toBeDefined()
  return source.slice(start!, end!)
}

/** Single backslashes, which the template literal swallows. */
function eatenEscapes(region: string): Array<{ line: number; escaped: string; context: string }> {
  const found: Array<{ line: number; escaped: string; context: string }> = []
  const pattern = /\\(.)/g
  for (let match = pattern.exec(region); match !== null; match = pattern.exec(region)) {
    if (match[1] === '\\') continue
    found.push({
      line: source.slice(0, source.indexOf(region) + match.index).split('\n').length,
      escaped: match[1] ?? '',
      context: region.slice(Math.max(0, match.index - 40), match.index + 24).replace(/\n/g, ' '),
    })
  }
  return found
}

describe('Webview template literal escaping', () => {
  it('never leaves a single backslash inside the embedded script', () => {
    const eaten = eatenEscapes(scriptRegion())
    expect(eaten.map(entry => `line ${entry.line}: \\${entry.escaped} in …${entry.context}…`)).toEqual([])
  })

  it('keeps the regexes that had been silently damaged', () => {
    const region = scriptRegion()
    // Each of these must appear with its escape intact, because the template
    // literal is the only thing between here and the browser.
    // split('\n') is covered by its own behaviour test; the general invariant
    // above already accounts for every other backslash in the script.
    for (const pattern of ['replace(/\\\\s+/g', 'replace(/\\\\.0$/']) {
      expect(region, `${pattern} must keep a doubled backslash`).toContain(pattern)
    }
  })
})
