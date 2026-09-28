// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * Code blocks are produced by the Markdown renderer and inserted as the answer
 * streams, so the copy handler is delegated on the conversation container
 * instead of bound per button. That means it has to work for a block that
 * appears after the listener was installed — which is what these tests cover.
 */

const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

/** The DOM the Markdown renderer emits for one fenced block. */
function appendCodeBlock(h: Harness, source: string): HTMLButtonElement {
  h.sendState({ sessionId: 'session-a', messages: [] })
  const container = h.document.getElementById('messages')!
  const block = h.document.createElement('div')
  block.className = 'code-block'
  block.innerHTML = '<div class="code-block-bar"><span class="code-block-language">ts</span>'
    + '<button class="code-copy" type="button" aria-label="Copy code">Copy</button></div>'
    + `<pre><code class="hljs language-ts">${source}</code></pre>`
  container.append(block)
  return block.querySelector('button.code-copy') as HTMLButtonElement
}

describe('copying a code block', () => {
  it('writes the source text, not the highlighted markup', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const h = open()
    const button = appendCodeBlock(h, '<span class="hljs-keyword">const</span> answer = 42')
    button.dispatchEvent(new Event('click', { bubbles: true }))
    await Promise.resolve()

    expect(writeText).toHaveBeenCalledWith('const answer = 42')
    expect(button.textContent).toBe('Copied')
    expect(h.posts.filter(post => post.type === 'copy-text')).toHaveLength(0)
  })

  it('falls back to the extension when the clipboard is refused', async () => {
    // The clipboard API rejects while the Webview has not been focused, which is
    // exactly the state right after an answer renders.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('Document is not focused') }) },
      configurable: true,
    })
    const h = open()
    const button = appendCodeBlock(h, 'print("hi")')
    h.posts.length = 0
    button.dispatchEvent(new Event('click', { bubbles: true }))
    await vi.waitFor(() => expect(h.posts.some(post => post.type === 'copy-text')).toBe(true))

    expect(h.posts.find(post => post.type === 'copy-text')?.text).toBe('print("hi")')
    expect(button.textContent).toBe('Copied')
  })

  it('falls back to the extension when the clipboard API is missing entirely', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const h = open()
    const button = appendCodeBlock(h, 'let x = 1')
    h.posts.length = 0
    button.dispatchEvent(new Event('click', { bubbles: true }))

    expect(h.posts.find(post => post.type === 'copy-text')?.text).toBe('let x = 1')
    expect(button.textContent).toBe('Copied')
  })

  it('ignores a click that is not on a copy button', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const h = open()
    const button = appendCodeBlock(h, 'let x = 1')
    h.posts.length = 0
    button.closest('.code-block')?.querySelector('code')?.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts.filter(post => post.type === 'copy-text')).toHaveLength(0)
  })
})
