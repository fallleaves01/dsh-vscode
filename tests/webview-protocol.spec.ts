import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Webview and the extension host are two bundles joined only by message
 * type strings. A type that the Webview posts and the host does not handle is a
 * button that silently does nothing — there is no type system across the gap,
 * so the contract is asserted here.
 */

const webview = readFileSync(join(process.cwd(), 'src', 'webview.ts'), 'utf8')
const extension = readFileSync(join(process.cwd(), 'src', 'extension.ts'), 'utf8')

function postedTypes(): string[] {
  return [...new Set([...webview.matchAll(/vscode\.postMessage\(\{\s*type:\s*'([a-z0-9-]+)'/g)].map(match => match[1]!))].sort()
}

function handledTypes(): string[] {
  // Scope to the switch that dispatches incoming Webview messages.
  const start = extension.indexOf('private acceptMessage(')
  expect(start, 'the host should dispatch Webview messages').toBeGreaterThan(-1)
  const next = extension.indexOf('\n  private ', start + 10)
  const region = extension.slice(start, next === -1 ? undefined : next)
  return [...new Set([...region.matchAll(/case '([a-z0-9-]+)':/g)].map(match => match[1]!))].sort()
}

describe('Webview to host protocol', () => {
  it('finds the message types on both sides', () => {
    expect(postedTypes().length).toBeGreaterThan(40)
    expect(handledTypes().length).toBeGreaterThan(40)
  })

  it('handles every message the Webview can post', () => {
    const handled = new Set(handledTypes())
    expect(postedTypes().filter(type => !handled.has(type))).toEqual([])
  })

  it('routes the clipboard fallback end to end', () => {
    // The copy button relies on this pair existing; a rename on one side only
    // would leave the button reporting success while copying nothing.
    const poster = [...webview.matchAll(/type: 'copy-text'/g)]
    expect(poster.length).toBeGreaterThan(0)
    expect(handledTypes()).toContain('copy-text')
    expect(extension).toMatch(/case 'copy-text':[\s\S]{0,400}clipboard\.writeText/)
  })
})
