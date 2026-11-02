// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * The ask-question card owns a text input, so its DOM must survive every state
 * delivery that carries the same content. The Webview asks for a full snapshot
 * when deliveries stall (`RESYNC_STALE_MS` / `RESYNC_MIN_INTERVAL_MS`), and the
 * Host answers with fresh object identities for deep-equal content: comparing
 * the question by identity rebuilt the card and erased the half-typed answer.
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

/** One ask-question request with two single-select options. */
function question(rpcId = 'rpc-1', detail = 'Pick one option or write your own.'): Record<string, unknown> {
  return {
    rpcId,
    questions: [{
      id: 'q1',
      header: 'Choose a path',
      question: 'Which implementation should I use?',
      detail,
      options: [{ label: 'Option A' }, { label: 'Option B', description: 'The safer one' }],
      multiSelect: false,
    }],
  }
}

/** A multi-select request whose two questions each own a custom answer. */
function multiQuestion(rpcId = 'rpc-multi'): Record<string, unknown> {
  return {
    rpcId,
    questions: [
      {
        id: 'q1', header: 'Pick scopes', question: 'Which scopes should change?',
        options: [{ label: 'api' }, { label: 'web' }], multiSelect: true,
      },
      {
        id: 'q2', header: 'Explain', question: 'Anything else?',
        options: [], multiSelect: false,
      },
    ],
  }
}

/**
 * Deliver one full state whose question is a fresh object, exactly as a resync
 * answer does: the harness loses no content, only the object identities.
 */
async function showQuestion(h: Harness, request: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  h.sendState({ sessionId: 'session-a', phase: 'ready', question: request, ...extra })
  await h.settle()
}

const card = (h: Harness): HTMLElement | null => h.document.querySelector('.interaction.question')
const custom = (h: Harness): HTMLInputElement => h.document.querySelector('.custom-answer') as HTMLInputElement
const customFor = (h: Harness, questionId: string): HTMLInputElement => {
  const item = h.document.querySelector('[data-question-id="' + questionId + '"]')
  if (item === null) throw new Error('No question item ' + questionId)
  return item.querySelector('.custom-answer') as HTMLInputElement
}
const option = (h: Harness, label: string): HTMLInputElement =>
  h.document.querySelector('input[value="' + label + '"]') as HTMLInputElement

function typeAnswer(h: Harness, text: string): void {
  const input = custom(h)
  input.value = text
  input.focus()
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function check(h: Harness, label: string): void {
  const input = option(h, label)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Every resync answer: the same content as a new object graph. */
async function resyncAnswer(h: Harness, request: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  h.sendState({ sessionId: 'session-a', phase: 'ready', question: request, ...extra })
  await h.settle()
}

describe('the ask-question card survives repeated full-state deliveries', () => {
  it('keeps the typed answer and the card itself across deep-equal states', async () => {
    const h = open()
    await showQuestion(h, question())
    const before = card(h)!
    expect(before).not.toBeNull()

    typeAnswer(h, 'Use the memory plan')
    check(h, 'Option B')

    // Two resync answers in a row: same content, new question object each time.
    await resyncAnswer(h, question())
    await resyncAnswer(h, question())

    // The card was never replaced, so focus and caret stayed in the input.
    expect(card(h)).toBe(before)
    expect(custom(h).value).toBe('Use the memory plan')
    expect(option(h, 'Option B').checked).toBe(true)
    expect(h.document.activeElement).toBe(custom(h))
  })

  it('keeps the answer through a simulated live-turn resync loop', async () => {
    const h = open()
    await showQuestion(h, question(), { running: true, turnStartedAt: Date.now() - 1_000, turnActivityAt: Date.now() - 1_000 })
    const before = card(h)!
    typeAnswer(h, 'typed before the watchdog fires')

    // Five full states, as roughly forty seconds of 8 s resync answers would be.
    for (let round = 0; round < 5; round += 1) {
      await resyncAnswer(h, question(), { running: true, turnStartedAt: Date.now() - 1_000, turnActivityAt: Date.now() - 1_000 })
    }
    expect(card(h)).toBe(before)
    expect(custom(h).value).toBe('typed before the watchdog fires')
  })

  it('asks for a full snapshot after the resync interval and keeps the answer when it lands', async () => {
    vi.useFakeTimers()
    try {
      const h = open()
      h.sendState({ sessionId: 'session-a', phase: 'ready', running: true, turnStartedAt: Date.now() - 1_000, turnActivityAt: Date.now() - 1_000, question: question() })
      await vi.advanceTimersByTimeAsync(100)
      expect(card(h)).not.toBeNull()
      typeAnswer(h, 'answer written before a resync')
      h.posts.length = 0
      await vi.advanceTimersByTimeAsync(9_000)
      const resyncs = h.posts.filter(post => post.type === 'resync')
      expect(resyncs).toHaveLength(1)
      expect(Number(resyncs[0]!.staleMs)).toBeGreaterThanOrEqual(5_000)
      h.sendState({ sessionId: 'session-a', phase: 'ready', running: true, turnStartedAt: Date.now() - 1_000, turnActivityAt: Date.now() - 1_000, question: question() })
      await vi.advanceTimersByTimeAsync(100)
      expect(custom(h).value).toBe('answer written before a resync')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a forced question rebuild restores the user input', () => {
  it('restores text, selection, focus and caret when content changes', async () => {
    const h = open()
    await showQuestion(h, question())
    const before = card(h)!
    typeAnswer(h, 'kept while the card is rebuilt')
    check(h, 'Option B')
    const input = custom(h)
    input.setSelectionRange(7, 12)

    // A real content change forces the tail to rebuild; the draft must survive it.
    await resyncAnswer(h, question('rpc-1', 'Pick one option or write a better one.'))

    expect(card(h)).not.toBe(before)
    expect(custom(h).value).toBe('kept while the card is rebuilt')
    expect(option(h, 'Option B').checked).toBe(true)
    expect(h.document.activeElement).toBe(custom(h))
    expect(custom(h).selectionStart).toBe(7)
    expect(custom(h).selectionEnd).toBe(12)
  })

  it('restores per-question answers and checkbox selections', async () => {
    const h = open()
    await showQuestion(h, multiQuestion())
    customFor(h, 'q1').value = 'first thought'
    customFor(h, 'q1').dispatchEvent(new Event('input', { bubbles: true }))
    customFor(h, 'q2').value = 'second thought'
    customFor(h, 'q2').dispatchEvent(new Event('input', { bubbles: true }))
    const checkboxes = [...h.document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    for (const box of checkboxes) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })) }

    // Multi-select content changes (an option is added) and the card rebuilds.
    h.sendState({
      sessionId: 'session-a',
      question: {
        ...multiQuestion(),
        questions: [
          { id: 'q1', header: 'Pick scopes', question: 'Which scopes should change?', options: [{ label: 'api' }, { label: 'web' }, { label: 'docs' }], multiSelect: true },
          { id: 'q2', header: 'Explain', question: 'Anything else?', options: [], multiSelect: false },
        ],
      },
    })
    await h.settle()

    expect(customFor(h, 'q1').value).toBe('first thought')
    expect(customFor(h, 'q2').value).toBe('second thought')
    expect([...h.document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(box => box.checked)).toEqual([true, true, false])
  })
})

describe('answers submitted after a refresh', () => {
  it('includes the custom text and the selection typed before the refresh', async () => {
    const h = open()
    await showQuestion(h, question())
    typeAnswer(h, 'Follow the memory plan')
    check(h, 'Option B')
    await resyncAnswer(h, question())
    h.posts.length = 0

    card(h)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    const sent = h.posts.filter(post => post.type === 'question')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      type: 'question',
      rpcId: 'rpc-1',
      answers: [{ id: 'q1', selected: ['Option B'], custom: 'Follow the memory plan' }],
    })
    // The request ended: a later rebuild of the same rpcId restores nothing.
    await resyncAnswer(h, question('rpc-1', 'The runtime re-asked after the answer.'))
    expect(card(h)).not.toBeNull()
    expect(custom(h).value).toBe('')
    expect(option(h, 'Option B').checked).toBe(false)
  })

  it('clears the stored answer once the question is resolved', async () => {
    const h = open()
    await showQuestion(h, question())
    typeAnswer(h, 'answer that must not come back')
    h.sendState({ sessionId: 'session-a', phase: 'ready', question: null })
    await h.settle()
    expect(card(h)).toBeNull()

    // A late duplicate of the resolved request must start empty, not resurrect
    // the answer the user already saw disappear.
    await resyncAnswer(h, question())
    expect(card(h)).not.toBeNull()
    expect(custom(h).value).toBe('')
  })
})

describe('a new question request starts empty', () => {
  it('does not leak the previous answer into a new rpcId', async () => {
    const h = open()
    await showQuestion(h, question())
    typeAnswer(h, 'answer belonging to rpc-1')
    check(h, 'Option B')

    await resyncAnswer(h, question('rpc-2'))

    expect(custom(h).value).toBe('')
    expect(option(h, 'Option B').checked).toBe(false)
  })

  it('does not leak into a later request after a different one was answered', async () => {
    const h = open()
    await showQuestion(h, question('rpc-1'))
    typeAnswer(h, 'first request answer')
    await resyncAnswer(h, question('rpc-2'))
    expect(custom(h).value).toBe('')

    // Going back to the old rpcId is still a new request, not a restore.
    await resyncAnswer(h, question('rpc-1'))
    expect(custom(h).value).toBe('')
  })
})
