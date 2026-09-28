// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
import { WEBVIEW_INLINE_CHAR_LIMIT } from '../src/chat-state-patch.js'
import { pageConversationMessage } from '../src/tool-output-page.js'
import type { ConversationMessage } from '../src/conversation.js'

/**
 * A long answer is deferred so the state patch stays small, and expanding it
 * asks the extension for the body. The expanded body is still the model's
 * markdown, so it must render as markdown — not as pre-wrapped plain text.
 *
 * The two limits are the same number (20 000), and `textPage` pages at exactly
 * that size, so *every* deferred assistant body used to come back flagged
 * `plainText` — meaning every expansion silently dropped all formatting.
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

const MARKDOWN = [
  '# Answer heading',
  '',
  'A paragraph with **bold text** and `inline code`.',
  '',
  '- first bullet',
  '- second bullet',
  '',
  '```ts',
  'const answer = 42',
  '```',
  '',
].join('\n')

/** Comfortably past the inline limit, so the extension would defer this body. */
const LONG_TEXT = `${MARKDOWN}\n${'filler text that makes the body long. '.repeat(700)}`

/** What the extension sends inline: a deferred body carries no text at all. */
function deferredMessage(): Record<string, unknown> {
  return {
    id: 'm1',
    role: 'assistant',
    text: '',
    deferredBody: true,
    bodyLength: LONG_TEXT.length,
  }
}

function fullMessage(): ConversationMessage {
  return { id: 'm1', role: 'assistant', text: LONG_TEXT } as ConversationMessage
}

/** Click "Show full response" and answer it, by default exactly as the extension does. */
async function expand(h: Harness, pageOf: (message: ConversationMessage) => unknown = message => pageConversationMessage(message, undefined)): Promise<void> {
  h.sendState({ sessionId: 'session-a', messages: [deferredMessage()] })
  await h.settle()
  const button = [...h.document.querySelectorAll('button')]
    .find(node => (node.textContent ?? '').startsWith('Show full response'))
  expect(button, 'the deferred body should offer an expand button').toBeDefined()

  h.posts.length = 0
  button!.dispatchEvent(new Event('click', { bubbles: true }))
  const request = h.posts.find(post => post.type === 'load-tool-output')
  expect(request, 'expanding should request the body').toBeDefined()

  h.send({
    type: 'tool-output',
    sessionId: request!.sessionId,
    messageId: request!.messageId,
    requestId: request!.requestId,
    // The real extension page builder, so the test covers the actual contract.
    page: pageOf(fullMessage()),
  })
  await h.settle()
}

describe('expanding a deferred answer keeps its markdown', () => {
  it('renders the model markdown instead of plain text', async () => {
    const h = open()
    await expand(h)

    const body = h.document.querySelector('.assistant-page')
    expect(body, 'the expanded page should be rendered').not.toBeNull()
    expect(body!.querySelector('h1')?.textContent).toBe('Answer heading')
    expect(body!.querySelector('strong')?.textContent).toBe('bold text')
    expect(body!.querySelector('code')?.textContent).toBe('inline code')
    expect(body!.querySelectorAll('li')).toHaveLength(2)
    expect(body!.querySelector('pre code')?.textContent).toContain('const answer = 42')
  })

  it('never falls back to the pre-wrapped plain-text view', async () => {
    const h = open()
    await expand(h)
    // streaming-plain is for a live tail and for opaque tool output; the reused
    // element carries the class itself, which is what dropped all formatting.
    const body = h.document.querySelector('.assistant-page')
    expect(body).not.toBeNull()
    expect(body!.classList.contains('streaming-plain')).toBe(false)
  })

  it('still defers the body, so the payload stays small until asked', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', messages: [deferredMessage()] })
    await h.settle()
    // The whole point of deferring must survive the fix.
    expect(h.document.querySelector('.message.assistant .markdown')?.textContent ?? '').not.toContain('Answer heading')
    expect([...h.document.querySelectorAll('button')].some(node => (node.textContent ?? '').startsWith('Show full response'))).toBe(true)
  })
})

describe('the renderer refuses to treat an answer as opaque tool output', () => {
  it('renders markdown even when a page arrives flagged plainText', async () => {
    // Defence in depth: the flag describes tool results, so the renderer must
    // not honor it for an assistant page even if a future producer sets it.
    const h = open()
    await expand(h, message => ({
      message: { ...message, text: LONG_TEXT, resultView: { card: 'assistant-page', plainText: true } },
    }))
    const body = h.document.querySelector('.assistant-page')
    expect(body).not.toBeNull()
    expect(body!.classList.contains('streaming-plain')).toBe(false)
    expect(body!.querySelector('h1')?.textContent).toBe('Answer heading')
    expect(body!.querySelector('strong')?.textContent).toBe('bold text')
  })
})

describe('assistant pages are never shipped as opaque plain text', () => {
  it('does not flag a long assistant page as plainText', () => {
    const page = pageConversationMessage(fullMessage(), undefined)
    const view = page.message.resultView as { plainText?: boolean; card?: string } | undefined
    // Tool results legitimately use this flag (a long web answer); an assistant
    // answer must not, because the flag means "do not render markdown".
    expect(view?.plainText).toBeUndefined()
  })

  it('keeps the flag for a long web answer, which is genuinely opaque', () => {
    const message = {
      id: 't1', role: 'tool' as const, text: '',
      resultView: { card: 'web', answer: 'y'.repeat(WEBVIEW_INLINE_CHAR_LIMIT + 100) },
    } as unknown as ConversationMessage
    const page = pageConversationMessage(message, undefined)
    const view = page.message.resultView as { plainText?: boolean } | undefined
    expect(view?.plainText).toBe(true)
  })
})
