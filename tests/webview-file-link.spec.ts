// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import * as realMarkdown from '../src/markdown.mjs'
import { harness, type Harness } from './webview-harness.js'

/**
 * The Markdown renderer ships as its own bundle, and the shared harness stands
 * in for it with a renderer that has no hooks — so nothing there can see which
 * path a reply's file link carries. This suite gives the Webview the real
 * renderer, which is the only way a click can be followed from the label a
 * reader sees to the message it posts.
 */
const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  ;(window as unknown as Record<string, unknown>).dshMarkdown = realMarkdown
  return instance
}

function answer(h: Harness, text: string): void {
  h.sendState({ sessionId: 'session-a', messages: [{ id: 'm1', role: 'assistant', text }] })
}

describe('clicking a file a reply named', () => {
  it('posts the destination the link pointed at, at the line it named', async () => {
    const h = open()
    answer(h, 'The kernel lives in [rdma.cuh](csrc/kernels/rdma.cuh#L42).')
    await h.settle()
    h.posts.length = 0

    const link = h.document.querySelector('button.file-link')
    expect(link?.textContent).toBe('rdma.cuh')
    expect(link?.getAttribute('title')).toBe('Open csrc/kernels/rdma.cuh:42')
    // The label is itself path-shaped, so a linkifier that entered the button
    // would nest a second link inside it — one whose click answers with the
    // label instead of the destination.
    expect(h.document.querySelectorAll('button.file-link')).toHaveLength(1)
    expect(link?.querySelector('button')).toBeNull()

    h.click('button.file-link')

    expect(h.posts).toEqual([{ type: 'open-file', path: 'csrc/kernels/rdma.cuh', line: 42 }])
  })

  it('keeps an inline code label inside the link instead of nesting a second one', async () => {
    const h = open()
    answer(h, 'See [`src/a.ts`](docs/README.md) and [`https://example.com`](https://example.com/x).')
    await h.settle()
    h.posts.length = 0

    const links = [...h.document.querySelectorAll('button.file-link')]
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('title')).toBe('Open docs/README.md')
    expect(links[0]?.querySelector('code')?.textContent).toBe('src/a.ts')
    expect(h.document.querySelectorAll('button.code-link')).toHaveLength(0)

    links[0]?.click()
    h.click('a')

    expect(h.posts).toEqual([
      { type: 'open-file', path: 'docs/README.md' },
      { type: 'open-link', href: 'https://example.com/x' },
    ])
  })

  it('posts a basename the reply named in inline code, for the project to resolve', async () => {
    const h = open()
    answer(h, 'I updated `hybrid.cuh` and `reduce_scatter.hpp`.')
    await h.settle()
    h.posts.length = 0

    const links = [...h.document.querySelectorAll('button.file-link')] as HTMLButtonElement[]
    expect(links.map(link => link.textContent)).toEqual(['hybrid.cuh', 'reduce_scatter.hpp'])
    for (const link of links) link.click()

    expect(h.posts).toEqual([
      { type: 'open-file', path: 'hybrid.cuh' },
      { type: 'open-file', path: 'reduce_scatter.hpp' },
    ])
  })

  it('sends a web link out and leaves a fragment or a blocked scheme alone', async () => {
    const h = open()
    answer(h, '[docs](https://example.com/docs) [section](#heading) [bad](javascript:alert%281%29)')
    await h.settle()
    h.posts.length = 0

    // Only the web link is a link at all; the other two are inert text, so a
    // click on them cannot post anything.
    expect(h.document.querySelectorAll('a')).toHaveLength(1)
    // The destination a model wrote is visible before the click: a friendly or
    // truncated label cannot hide where the link leads (S6).
    const anchor = h.document.querySelector('a')!
    expect(anchor.getAttribute('href')).toBe('https://example.com/docs')
    expect(anchor.getAttribute('title')).toBe('Open external link: https://example.com/docs')
    expect(anchor.getAttribute('aria-label')).toContain('example.com')
    h.click('a')

    expect(h.posts).toEqual([{ type: 'open-link', href: 'https://example.com/docs' }])
    expect(h.document.querySelectorAll('button.file-link')).toHaveLength(0)
    expect(h.document.getElementById('messages')?.textContent).toContain('section')
    expect(h.document.getElementById('messages')?.textContent).toContain('bad')
  })

  it('names the real target even when the label claims another site', async () => {
    const h = open()
    answer(h, '[https://trusted.example](https://evil.example/path)')
    await h.settle()
    const anchor = h.document.querySelector('a')!
    expect(anchor.textContent).toBe('https://trusted.example')
    expect(anchor.getAttribute('href')).toBe('https://evil.example/path')
    expect(anchor.getAttribute('title')).toContain('evil.example')
    expect(anchor.getAttribute('aria-label')).toContain('evil.example')
  })
})
