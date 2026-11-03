// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * The transcript selection action and the composer's quoted-text dock.
 *
 * These tests drive the real Webview script against a jsdom document, so the
 * event wiring, the serialized send text and the draft lifecycle are exercised
 * together. The behaviour contract is the adapted DSH feature: select message
 * text, quote it into the composer as a link-like chip, and send it as a
 * Markdown blockquote ahead of the typed prompt.
 */

const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

const USER = { id: 'u1', role: 'user', text: 'quoted line' }
const ANSWER = { id: 'a1', role: 'assistant', text: 'reply text' }

function open(overrides: Record<string, unknown> = {}): Harness {
  const h = harness()
  live.push(h)
  h.sendState({
    sessionId: 'session-a', messages: [USER, ANSWER], commands: [], skills: [], ...overrides,
  })
  return h
}

const action = (h: Harness) => h.document.getElementById('quoteSelection') as HTMLButtonElement
const prompt = (h: Harness) => h.document.getElementById('prompt') as HTMLTextAreaElement
const dock = (h: Harness) => h.document.getElementById('quotes') as HTMLDivElement
const chips = (h: Harness) => [...h.document.querySelectorAll<HTMLElement>('#quotes .quote-chip')]
const chipTexts = (h: Harness) => chips(h).map(chip => chip.querySelector('.quote-chip-text')?.textContent ?? '')
const chipTitles = (h: Harness) => chips(h).map(chip => chip.querySelector<HTMLElement>('.quote-chip-text')?.title ?? '')
const sends = (h: Harness) => h.posts.filter(post => post.type === 'send')
const type = (h: Harness, text: string): void => {
  const input = prompt(h)
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const selectUser = (h: Harness) => h.selectText('.message.user .message-body')
const clickAction = (h: Harness) => action(h).click()

/** Show the action once, the way a real selection does. */
function showAction(h: Harness): void {
  selectUser(h)
  expect(action(h).hidden).toBe(false)
}

async function quoteSelected(h: Harness): Promise<void> {
  showAction(h)
  clickAction(h)
}

describe('the transcript quote action appears only for quotable selections', () => {
  it('appears for a selection inside a user message', async () => {
    const h = open()
    await h.settle()
    expect(h.document.querySelector('.message.user .message-body')?.getAttribute('data-quote-source')).toBe('true')
    showAction(h)
  })
  it('appears for a selection inside a settled assistant reply', async () => {
    const h = open()
    await h.settle()
    expect(h.document.querySelector('.message.assistant .message-body')?.getAttribute('data-quote-source')).toBe('true')
    h.selectText('.message.assistant .message-body')
    expect(action(h).hidden).toBe(false)
  })
  it('never marks a streaming assistant message', async () => {
    const h = open({ messages: [{ id: 's1', role: 'assistant', text: 'live', streaming: true, reasoning: 'thinking' }] })
    await h.settle()
    expect(h.document.querySelector('.message.assistant .message-body')?.getAttribute('data-quote-source')).toBeNull()
    h.selectText('.thinking-preview')
    expect(action(h).hidden).toBe(true)
  })
  it('never marks a failed assistant message', async () => {
    const h = open({ messages: [{ id: 'f1', role: 'assistant', text: 'gone wrong', failed: true }] })
    await h.settle()
    expect(h.document.querySelector('.message.assistant .message-body')?.getAttribute('data-quote-source')).toBeNull()
    h.selectText('.message.assistant .message-body')
    expect(action(h).hidden).toBe(true)
  })
  it('never marks a deferred assistant body', async () => {
    const h = open({ messages: [{ id: 'd1', role: 'assistant', text: 'long body', deferredBody: true }] })
    await h.settle()
    expect(h.document.querySelector('.message.assistant .message-body')?.getAttribute('data-quote-source')).toBeNull()
    h.selectText('.message.assistant .message-body')
    expect(action(h).hidden).toBe(true)
  })
  it('never marks a tool row', async () => {
    const h = open({ messages: [{ id: 't1', role: 'tool', text: 'tool text' }] })
    await h.settle()
    h.selectText('.tool .tool-title')
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden for a collapsed selection', async () => {
    const h = open()
    await h.settle()
    h.selectText('.message.user .message-body', 2, 2)
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden for a whitespace-only selection', async () => {
    const h = open({ messages: [{ id: 'u2', role: 'user', text: '   ' }] })
    await h.settle()
    h.selectText('.message.user .message-body')
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden for a selection that crosses two messages', async () => {
    const h = open()
    await h.settle()
    h.selectAcross('.message.user .message-body', '.message.assistant .message-body')
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden for a selection in a steering row outside #messages', async () => {
    const h = open({ messages: [USER], queue: [{ id: 's1', placement: 'steering', preview: 'steering text' }] })
    await h.settle()
    h.selectText('.pending-steering .message-body')
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden for a status row inside #messages', async () => {
    const h = open({ messages: [USER, { id: 'n1', role: 'notice', text: 'a notice' }] })
    await h.settle()
    h.selectText('#messages > .status')
    expect(action(h).hidden).toBe(true)
  })
  it('hides when the runtime is lost while the action is visible', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.sendState({ phase: 'loading' })
    await h.settle()
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden while the conversation is unroutable', async () => {
    const h = open({ routable: false })
    await h.settle()
    selectUser(h)
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden while the conversation is held', async () => {
    const h = open({ occupancyNotice: 'Another window holds this conversation.' })
    await h.settle()
    selectUser(h)
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden in a once-only subagent conversation', async () => {
    const h = open({ sessions: [{ id: 'session-a', subagent: { mode: 'once' } }] })
    await h.settle()
    selectUser(h)
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden for a read-only child reason', async () => {
    const h = open({ childReadOnlyReason: 'This child runs as a read-only delegate.' })
    await h.settle()
    selectUser(h)
    expect(action(h).hidden).toBe(true)
  })
  it('stays hidden while the conversation directory is open', async () => {
    const h = open()
    await h.settle()
    h.click('#conversationHome')
    await h.settle()
    selectUser(h)
    expect(action(h).hidden).toBe(true)
  })
})

describe('the transcript quote action dismisses without touching the selection', () => {
  it('hides when the transcript scrolls', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.document.getElementById('scroll')!.dispatchEvent(new Event('scroll'))
    expect(action(h).hidden).toBe(true)
  })
  it('hides on Escape and keeps the browser selection', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(action(h).hidden).toBe(true)
    expect(window.getSelection()?.isCollapsed).toBe(false)
  })
  it('keeps the action dismissed through the Escape keyup and reopens on a keyboard selection release', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(action(h).hidden).toBe(true)
    const scroll = h.document.getElementById('scroll')!
    // The keyup of the dismissing key must not undo the dismissal; the
    // browser selection is still intact, so a re-evaluation would reveal the
    // action again (P2-5).
    scroll.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    expect(window.getSelection()?.isCollapsed).toBe(false)
    expect(action(h).hidden).toBe(true)
    // A real keyboard selection gesture still re-evaluates on its release.
    scroll.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    expect(action(h).hidden).toBe(false)
  })
  it('hides when a pointer goes down outside the action', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(action(h).hidden).toBe(true)
  })
  it('hides when the window loses focus', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    window.dispatchEvent(new Event('blur'))
    expect(action(h).hidden).toBe(true)
  })
  it('hides when the conversation switches', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.sendState({ sessionId: 'session-b', messages: [] })
    await h.settle()
    expect(action(h).hidden).toBe(true)
  })
  it('hides when the selected message is replaced by a render', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.sendState({ messages: [{ id: 'u1', role: 'user', text: 'rewritten line' }, ANSWER] })
    await h.settle()
    expect(action(h).hidden).toBe(true)
  })
  it('keeps the selection when the action is pressed', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    action(h).dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    expect(window.getSelection()?.isCollapsed).toBe(false)
  })
})

describe('a drag selection keeps the action it revealed', () => {
  /**
   * The browser's pointer/mouse sequence for a drag selection, in order:
   * pointerdown, mousedown, selectionchange (during the drag), pointerup,
   * mouseup, and the click that ends the gesture. The click lands on the
   * selected text, not on the action, so any click-based dismissal would hide
   * the action the same gesture had just shown.
   */
  function dragSelect(h: Harness, selector: string): void {
    const target = h.document.querySelector(selector)
    if (target === null) throw new Error(`No element matches ${selector}`)
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    h.selectText(selector)
    h.document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    h.document.getElementById('messages')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('keeps the action visible after pointerup, mouseup and the closing click', async () => {
    const h = open()
    await h.settle()
    dragSelect(h, '.message.user .message-body')
    expect(window.getSelection()?.isCollapsed).toBe(false)
    expect(action(h).hidden).toBe(false)
    expect(chipTexts(h)).toEqual([])
  })
  it('quotes the drag selection when the action is clicked', async () => {
    const h = open()
    await h.settle()
    dragSelect(h, '.message.user .message-body')
    action(h).click()
    expect(chipTexts(h)).toEqual(['quoted line'])
    expect(action(h).hidden).toBe(true)
    expect(chips(h)).toHaveLength(1)
  })
  it('still hides on an external pointerdown and click', async () => {
    const h = open()
    await h.settle()
    dragSelect(h, '.message.user .message-body')
    expect(action(h).hidden).toBe(false)
    h.document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    h.document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(action(h).hidden).toBe(true)
  })
  it('does not hide the action on a click inside the selected text', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.document.querySelector('.message.user .message-body')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(action(h).hidden).toBe(false)
  })
})

describe('the action is positioned against real geometry', () => {
  type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number }
  const rectOf = (top: number, left: number, width: number, height: number): Rect => ({
    top, bottom: top + height, left, right: left + width, width, height,
  })
  const zero: Rect = rectOf(0, 0, 0, 0)
  /**
   * jsdom ships no Range geometry. The positioner reads Range and element
   * rectangles, so the layout is installed for one test and removed afterwards.
   */
  function withGeometry(range: Rect, pane: Rect, scroll: Rect, button: Rect, run: () => void): void {
    const rangePrototype = Range.prototype as unknown as { getBoundingClientRect?: () => Rect }
    const hadRangeRect = typeof rangePrototype.getBoundingClientRect === 'function'
    const previousRangeRect = rangePrototype.getBoundingClientRect
    const elementPrototype = HTMLElement.prototype as unknown as {
      getBoundingClientRect: () => Rect
      offsetWidth: number
      offsetHeight: number
    }
    const hadElementRect = typeof elementPrototype.getBoundingClientRect === 'function'
    const previousElementRect = elementPrototype.getBoundingClientRect
    const previousWidth = Object.getOwnPropertyDescriptor(elementPrototype, 'offsetWidth')
    const previousHeight = Object.getOwnPropertyDescriptor(elementPrototype, 'offsetHeight')
    rangePrototype.getBoundingClientRect = () => range
    elementPrototype.getBoundingClientRect = function (this: HTMLElement): Rect {
      if (this.id === 'conversationPane') return pane
      if (this.id === 'scroll') return scroll
      return zero
    }
    Object.defineProperty(elementPrototype, 'offsetWidth', { configurable: true, get() { return this.id === 'quoteSelection' ? button.width : 0 } })
    Object.defineProperty(elementPrototype, 'offsetHeight', { configurable: true, get() { return this.id === 'quoteSelection' ? button.height : 0 } })
    try {
      run()
    } finally {
      if (hadRangeRect) rangePrototype.getBoundingClientRect = previousRangeRect
      else delete rangePrototype.getBoundingClientRect
      if (hadElementRect) elementPrototype.getBoundingClientRect = previousElementRect
      if (previousWidth) Object.defineProperty(elementPrototype, 'offsetWidth', previousWidth)
      if (previousHeight) Object.defineProperty(elementPrototype, 'offsetHeight', previousHeight)
    }
  }
  const pane = rectOf(50, 0, 400, 600), scroll = rectOf(50, 0, 400, 600), button = rectOf(0, 0, 100, 28)

  it('places the action 8px above the selection', async () => {
    const h = open()
    await h.settle()
    withGeometry(rectOf(300, 150, 100, 20), pane, scroll, button, () => h.selectText('.message.user .message-body'))
    expect(action(h).hidden).toBe(false)
    expect(action(h).style.top).toBe('214px')
    expect(action(h).style.left).toBe('150px')
  })
  it('flips below the selection when the pane has no room above', async () => {
    const h = open()
    await h.settle()
    withGeometry(rectOf(60, 150, 100, 20), pane, scroll, button, () => h.selectText('.message.user .message-body'))
    expect(action(h).style.top).toBe('38px')
  })
  it('clamps the action inside the pane horizontally', async () => {
    const h = open()
    await h.settle()
    withGeometry(rectOf(300, 360, 100, 20), pane, scroll, button, () => h.selectText('.message.user .message-body'))
    expect(action(h).style.left).toBe('296px')
  })
  it('hides when the selection is outside the visible transcript', async () => {
    const h = open()
    await h.settle()
    withGeometry(rectOf(700, 150, 100, 20), pane, scroll, button, () => h.selectText('.message.user .message-body'))
    expect(action(h).hidden).toBe(true)
  })
})

describe('quoting text into the composer', () => {
  it('adds a chip, clears the selection, hides the action and focuses the prompt', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    expect(chips(h)).toHaveLength(1)
    expect(chipTexts(h)).toEqual(['quoted line'])
    expect(dock(h).classList.contains('hidden')).toBe(false)
    expect(action(h).hidden).toBe(true)
    expect(window.getSelection()?.isCollapsed ?? true).toBe(true)
    expect(document.activeElement?.id).toBe('prompt')
    expect(h.document.getElementById('sessionNotice')?.textContent).toBe('Quote added')
    expect(h.document.getElementById('sessionNotice')?.classList.contains('hidden')).toBe(false)
  })
  it('does not insert when the selection is gone at click time', async () => {
    const h = open()
    await h.settle()
    showAction(h)
    h.clearSelection()
    clickAction(h)
    expect(chips(h)).toHaveLength(0)
    expect(action(h).hidden).toBe(true)
  })
  it('allows the same text to be quoted twice', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    await quoteSelected(h)
    expect(chipTexts(h)).toEqual(['quoted line', 'quoted line'])
  })
  it('removes one chip and disables Send when nothing remains', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    const send = h.document.getElementById('send') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    chips(h)[0]!.querySelector<HTMLButtonElement>('.quote-chip-remove')!.click()
    expect(chips(h)).toHaveLength(0)
    expect(dock(h).classList.contains('hidden')).toBe(true)
    expect(send.disabled).toBe(true)
  })
  it('keeps the insertion order across several quotes', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'first' }, { id: 'u2', role: 'user', text: 'second' }] })
    await h.settle()
    h.selectText('.message.user .message-body', 0, 5)
    action(h).click()
    h.selectText('.message.user + .message.user .message-body')
    action(h).click()
    expect(chipTexts(h)).toEqual(['first', 'second'])
  })
  it('ellipsizes a long chip while keeping the full tooltip', async () => {
    const text = 'x'.repeat(300)
    const h = open({ messages: [{ id: 'u1', role: 'user', text }] })
    await h.settle()
    await quoteSelected(h)
    const shown = chipTexts(h)[0]!
    expect(shown.endsWith('…')).toBe(true)
    expect(shown.length).toBeLessThan(210)
    expect(chipTitles(h)[0]).toBe(text)
  })
  it('refuses a selection longer than the quote limit', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'a'.repeat(100_001) }] })
    await h.settle()
    showAction(h)
    clickAction(h)
    expect(chips(h)).toHaveLength(0)
    expect(action(h).hidden).toBe(false)
    expect(h.document.getElementById('sessionNotice')?.textContent).toBe('The selected text is too long to quote.')
  })
  it('renders quoted markup as text and keeps it literal in the send', async () => {
    const text = '<img src=x onerror=alert(1)>'
    const h = open({ messages: [{ id: 'u1', role: 'user', text }] })
    await h.settle()
    await quoteSelected(h)
    expect(h.document.querySelector('#quotes img')).toBeNull()
    expect(chipTexts(h)).toEqual([text])
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> ' + text)
  })
})

describe('the composer serializes quotes as Markdown blockquotes', () => {
  it('sends the trimmed prompt byte-for-byte when no quote exists', async () => {
    const h = open()
    await h.settle()
    h.enter('  hello  ')
    expect(sends(h)).toHaveLength(1)
    expect(sends(h)[0]?.text).toBe('hello')
  })
  it('sends one quote ahead of the prompt with one blank line', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    type(h, 'hello')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> quoted line\n\nhello')
  })
  it('sends several quotes in insertion order', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'first' }, { id: 'u2', role: 'user', text: 'second' }] })
    await h.settle()
    h.selectText('.message.user .message-body', 0, 5); action(h).click()
    h.selectText('.message.user + .message.user .message-body'); action(h).click()
    type(h, 'explain')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> first\n\n> second\n\nexplain')
  })
  it('prefixes every line of a multiline quote', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'line one\nline two' }] })
    await h.settle()
    await quoteSelected(h)
    type(h, 'why')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> line one\n> line two\n\nwhy')
  })
  it('normalizes a CRLF selection', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'a\r\nb' }] })
    await h.settle()
    await quoteSelected(h)
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> a\n> b')
  })
  it('sends a quote-only message and enables Send for it', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    type(h, '   ')
    const send = h.document.getElementById('send') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    send.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> quoted line')
  })
  it('round-trips a transcript quote through the composer', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: '> hello' }, ANSWER] })
    await h.settle()
    h.selectText('.message.user .quote-preview-text')
    expect(action(h).hidden).toBe(false)
    action(h).click()
    expect(chipTexts(h)).toEqual(['hello'])
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> hello')
  })
})

describe('quoting never changes command routing', () => {
  it('refuses to send a known command behind a quote and keeps the chip', async () => {
    const h = open({ commands: [{ name: 'compact', description: 'Compact the conversation' }] })
    await h.settle()
    await quoteSelected(h)
    type(h, '/compact')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h)).toHaveLength(0)
    expect(chips(h)).toHaveLength(1)
    expect(h.document.getElementById('sessionNotice')?.textContent).toBe('Remove the quoted text to run /compact.')
  })
  it('refuses a typed /permission preset behind a quote', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    type(h, '/permission danger-full-access')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h)).toHaveLength(0)
    expect(h.document.getElementById('sessionNotice')?.textContent).toBe('Remove the quoted text to run /permission.')
  })
  it('lets ordinary slash text through as prompt text', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    type(h, '/etc/passwd')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> quoted line\n\n/etc/passwd')
  })
  it('sends a command picked from the menu without the quotes and keeps them', async () => {
    const h = open({ commands: [{ name: 'compact', description: 'Compact the conversation' }] })
    await h.settle()
    await quoteSelected(h)
    type(h, '/compact')
    const option = h.document.querySelector('#commandMenu .command-option')!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(sends(h).at(-1)).toMatchObject({ type: 'send', text: '/compact' })
    expect(chipTexts(h)).toEqual(['quoted line'])
    expect(prompt(h).value).toBe('')
  })
})

describe('quote drafts follow the conversation lifecycle', () => {
  it('keeps quotes per conversation', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    h.sendState({ sessionId: 'session-b', messages: [{ id: 'b1', role: 'user', text: 'other line' }] })
    await h.settle()
    expect(chips(h)).toHaveLength(0)
    await quoteSelected(h)
    expect(chipTexts(h)).toEqual(['other line'])
    h.sendState({ sessionId: 'session-a', messages: [USER, ANSWER] })
    await h.settle()
    expect(chipTexts(h)).toEqual(['quoted line'])
    h.sendState({ sessionId: 'session-b', messages: [{ id: 'b1', role: 'user', text: 'other line' }] })
    await h.settle()
    expect(chipTexts(h)).toEqual(['other line'])
  })
  it('restores the prompt text and the chips after a rejected send', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    h.enter('hello')
    const sent = sends(h).at(-1)!
    expect(sent.text).toBe('> quoted line\n\nhello')
    h.send({ type: 'restore-draft', sessionId: 'session-a', requestId: sent.requestId, text: sent.text })
    expect(prompt(h).value).toBe('hello')
    expect(chipTexts(h)).toEqual(['quoted line'])
    expect(prompt(h).value).not.toContain('> ')
  })
  it('appends quotes and text added while the send was in flight', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    h.enter('hello')
    const sent = sends(h).at(-1)!
    type(h, 'more')
    await quoteSelected(h)
    h.send({ type: 'restore-draft', sessionId: 'session-a', requestId: sent.requestId, text: sent.text })
    expect(prompt(h).value).toBe('hello\nmore')
    expect(chipTexts(h)).toEqual(['quoted line', 'quoted line'])
  })
  it('clears quotes for a programmatic set-prompt', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    h.send({ type: 'set-prompt', text: 'new draft' })
    expect(prompt(h).value).toBe('new draft')
    expect(chips(h)).toHaveLength(0)
  })
  it('keeps quotes while the runtime is lost and re-enables Send after reconnect', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    const send = h.document.getElementById('send') as HTMLButtonElement
    h.sendState({ phase: 'loading' })
    await h.settle()
    expect(chips(h)).toHaveLength(1)
    expect(send.disabled).toBe(true)
    h.sendState({ phase: 'ready', messages: [USER, ANSWER] })
    await h.settle()
    expect(chips(h)).toHaveLength(1)
    expect(send.disabled).toBe(false)
  })
  it('keeps quotes cleared after the runtime acknowledges the send', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    h.enter('hello')
    const sent = sends(h).at(-1)!
    h.send({ type: 'draft-sent', sessionId: 'session-a', requestId: sent.requestId, text: sent.text })
    expect(chips(h)).toHaveLength(0)
    expect(prompt(h).value).toBe('')
  })
})

describe('quoted credentials never reach a visible attribute', () => {
  // Deliberately synthetic; this fixture cannot authenticate to any service.
  const key = 'sk-' + 'A1'.repeat(16)
  it('masks the chip and its tooltip, and sends the selected masked text', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'use ' + key }, ANSWER] })
    await h.settle()
    expect(h.document.querySelector('.message.user')!.innerHTML).not.toContain(key)
    await quoteSelected(h)
    expect(chips(h)).toHaveLength(1)
    expect(dock(h).outerHTML).not.toContain(key)
    expect(chipTexts(h)[0]).not.toContain(key)
    expect(chipTitles(h)[0]).not.toContain(key)
    expect(chipTitles(h)[0]).toContain('sk-')
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(String(sends(h).at(-1)?.text)).not.toContain(key)
  })
})

describe('quoted credentials are warned about without being shown', () => {
  // Deliberately synthetic; this fixture cannot authenticate to any service.
  const key = 'sk-' + 'A1'.repeat(16)
  const credentialWarning = 'This quote contains a credential. The model receives the selected text as written.'
  const maskUnavailableWarning = 'Credential masking is unavailable here, so this quote is not previewed. The model receives the selected text as written.'

  it('warns on an assistant reply carrying a raw credential and still sends it verbatim', async () => {
    const h = open({ messages: [{ id: 'a1', role: 'assistant', text: 'The key is ' + key }] })
    await h.settle()
    h.selectText('.message.assistant .message-body')
    action(h).click()
    const chip = chips(h)[0]!
    expect(chip.hasAttribute('data-credential-warning')).toBe(true)
    expect(chip.querySelector('.quote-chip-warning')).not.toBeNull()
    expect(chip.textContent).not.toContain(key)
    expect(chip.outerHTML).not.toContain(key)
    expect(chipTexts(h)[0]).not.toContain(key)
    expect(chipTexts(h)[0]).toContain('sk-')
    expect(chipTitles(h)[0]).not.toContain(key)
    expect(chipTitles(h)[0]).toContain('model receives the selected text as written')
    expect(chip.getAttribute('aria-label')).toContain('model receives the selected text as written')
    for (const element of chip.querySelectorAll('*')) {
      for (const attribute of element.attributes) expect(attribute.value).not.toContain(key)
    }
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    // DSH send semantics are display-only masking: the model gets the selection.
    expect(String(sends(h).at(-1)?.text)).toBe('> The key is ' + key)
  })
  it('does not warn on ordinary quoted text', async () => {
    const h = open()
    await h.settle()
    await quoteSelected(h)
    const chip = chips(h)[0]!
    expect(chip.hasAttribute('data-credential-warning')).toBe(false)
    expect(chip.querySelector('.quote-chip-warning')).toBeNull()
    expect(chipTitles(h)[0]).toBe('quoted line')
  })
  it('does not warn about a user selection that is already masked', async () => {
    const h = open({ messages: [{ id: 'u1', role: 'user', text: 'use ' + key }, ANSWER] })
    await h.settle()
    expect(h.document.querySelector('.message.user')!.innerHTML).not.toContain(key)
    await quoteSelected(h)
    const chip = chips(h)[0]!
    expect(chip.hasAttribute('data-credential-warning')).toBe(false)
    expect(chip.outerHTML).not.toContain(key)
    expect(chipTitles(h)[0]).not.toContain(key)
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(String(sends(h).at(-1)?.text)).not.toContain(key)
  })
  it('uses a safe placeholder when the masking entry point is unavailable', async () => {
    const h = open({ messages: [{ id: 'a1', role: 'assistant', text: 'The key is ' + key }] })
    await h.settle()
    const globals = window as unknown as Record<string, Record<string, unknown>>
    const markdown = globals.dshMarkdown!
    const original = markdown.maskUserText
    delete markdown.maskUserText
    try {
      h.selectText('.message.assistant .message-body')
      action(h).click()
      const chip = chips(h)[0]!
      expect(chip.hasAttribute('data-credential-warning')).toBe(true)
      expect(chipTexts(h)[0]).toBe('Quoted text')
      expect(chip.textContent).not.toContain(key)
      expect(chip.outerHTML).not.toContain(key)
      expect(chipTitles(h)[0]).not.toContain(key)
      expect(chipTitles(h)[0]).toContain('masking is unavailable')
      expect(chip.getAttribute('aria-label')).toContain('masking is unavailable')
      for (const element of chip.querySelectorAll('*')) {
        for (const attribute of element.attributes) expect(attribute.value).not.toContain(key)
      }
      h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
      // The send is unchanged; only the preview falls back to a safe placeholder.
      expect(String(sends(h).at(-1)?.text)).toBe('> The key is ' + key)
    } finally {
      markdown.maskUserText = original
    }
  })
  it('caps chip tooltips at 2000 characters and keeps the full quoted text', async () => {
    const long = 'word '.repeat(1000)
    const h = open({ messages: [{ id: 'u1', role: 'user', text: long }] })
    await h.settle()
    await quoteSelected(h)
    const chip = chips(h)[0]!
    expect(chip.hasAttribute('data-credential-warning')).toBe(false)
    expect(chipTitles(h)[0]).toHaveLength(2001)
    expect(chipTitles(h)[0]).toBe(long.slice(0, 2000) + '…')
    // The visible chip remains the established single-line preview.
    expect(chipTexts(h)[0]!.endsWith('…')).toBe(true)
    expect(chipTexts(h)[0]!.length).toBeLessThan(210)
    // The stored quote and the send keep every character (selection edges trimmed).
    h.document.getElementById('send')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sends(h).at(-1)?.text).toBe('> ' + long.trim())
  })
})
