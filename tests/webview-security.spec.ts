// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import * as realMarkdown from '../src/markdown.mjs'
import { harness, type Harness } from './webview-harness.js'

/**
 * The Webview renders text a model or a tool wrote. Two properties are asserted
 * here: a pathological run of file-reference characters must be scanned in
 * bounded time (F2), and content that nests or refers to itself must not walk
 * the recursion until the stack dies (S4).
 */
const live: Harness[] = []
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
function open(): Harness {
  const h = harness()
  live.push(h)
  // The shared harness stands in for the Markdown bundle without hooks; the
  // file-reference scan only exists in the real renderer.
  ;(window as unknown as Record<string, unknown>).dshMarkdown = realMarkdown
  return h
}
function answer(h: Harness, text: string): void {
  h.sendState({ sessionId: 'session-a', messages: [{ id: 'm1', role: 'assistant', text }] })
}
async function timed(h: Harness, text: string): Promise<number> {
  const start = performance.now()
  answer(h, text)
  await h.settle()
  return performance.now() - start
}

describe('file-reference scanning is bounded', () => {
  it('skips a very long run without matching or backtracking', async () => {
    const h = open()
    // The S4/F2 proof of concept: a long `a/a/a/…` chain with no extension.
    // The old global regex backtracked quadratically and froze the view.
    const elapsed = await timed(h, 'a/'.repeat(100_000) + '!')
    expect(h.document.querySelectorAll('button.file-link')).toHaveLength(0)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('bounds a long inline code span and drops it as a link candidate', async () => {
    const h = open()
    const value = 'a/'.repeat(100_000) + '!'
    const elapsed = await timed(h, '`' + value + '`')
    // The span renders as code, never as a file link.
    expect(h.document.querySelector('code')?.textContent).toBe(value)
    expect(h.document.querySelectorAll('button.file-link, button.code-link')).toHaveLength(0)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('keeps scanning after a long run and links a real reference beside it', async () => {
    const h = open()
    await timed(h, 'a/'.repeat(50_000) + ' b.ts')
    const links = [...h.document.querySelectorAll<HTMLButtonElement>('button.file-link')]
    expect(links.map(link => link.textContent)).toEqual(['b.ts'])
  })

  it('links a legitimate long path that fits the bounded candidate window', async () => {
    const h = open()
    // Longer than the previous 512 limit, still a plausible deep project path:
    // the raised 2048 bound keeps it linkable (S5).
    const path = ('a'.repeat(200) + '/').repeat(4) + 'b.ts'
    expect(path.length).toBeGreaterThan(512)
    expect(path.length).toBeLessThan(2048)
    await timed(h, path)
    const links = [...h.document.querySelectorAll<HTMLButtonElement>('button.file-link')]
    expect(links.map(link => link.textContent)).toEqual([path])
    links[0]!.click()
    expect(h.posts.at(-1)).toEqual({ type: 'open-file', path })
  })

  it('bounds the regex work at the raised candidate boundary', async () => {
    const h = open()
    // Exactly the limit: the run is handed to the pattern, so this pins that the
    // backtracking stays bounded at the new 2048-character window.
    const run = 'a/'.repeat(1024)
    expect(run.length).toBe(2048)
    const elapsed = await timed(h, run)
    expect(h.document.querySelectorAll('button.file-link')).toHaveLength(0)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('still skips a candidate above the raised window', async () => {
    const h = open()
    const path = ('a'.repeat(100) + '/').repeat(21) + 'b.ts'
    expect(path.length).toBeGreaterThan(2048)
    const elapsed = await timed(h, path)
    expect(h.document.querySelectorAll('button.file-link')).toHaveLength(0)
    expect(elapsed).toBeLessThan(2_000)
    // The inline-code path applies the same bound.
    await timed(h, '`' + path + '`')
    expect(h.document.querySelector('code')?.textContent).toBe(path)
    expect(h.document.querySelectorAll('button.file-link, button.code-link')).toHaveLength(0)
  })
})

describe('nested tool content is depth and cycle bounded', () => {
  function tool(content: unknown): Record<string, unknown> {
    return { id: 'tool:1', role: 'tool', text: 'tool', detail: 'Completed', streaming: true,
      callView: { card: 'generic', title: 'Tool' }, resultView: { card: 'generic', content } }
  }

  it('replaces content nested past the limit with a placeholder', async () => {
    const h = open()
    let content: unknown[] = [{ type: 'text', text: 'leaf' }]
    for (let depth = 0; depth < 200; depth += 1) content = [{ content }]
    h.sendState({ sessionId: 'session-a', messages: [tool(content)] })
    await h.settle()
    expect(h.document.getElementById('messages')!.textContent).toContain('[nested content omitted]')
  })

  it('renders a self-referencing content graph without recursing forever', async () => {
    const h = open()
    const node: Record<string, unknown> = { type: 'text' }
    node.content = [node]
    h.sendState({ sessionId: 'session-a', messages: [tool([node])] })
    await h.settle()
    expect(h.document.getElementById('messages')!.textContent).toContain('[nested content omitted]')
  })
})
