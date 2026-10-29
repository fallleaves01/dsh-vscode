// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

const live: Harness[] = []
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
function open(): Harness { const h = harness(); live.push(h); return h }

const sessionList = (count: number) => Array.from({ length: count }, (_value, index) => ({
  id: 'session-' + String(index), title: 'Conversation ' + String(index), updatedAt: 1_700_000_000_000 + index,
  blank: false,
}))
const rows = (h: Harness, list: string) => [...h.document.querySelectorAll<HTMLElement>('#' + list + ' .session-row')]
const row = (h: Harness, list: string, id: string) =>
  h.document.querySelector<HTMLElement>('#' + list + ' .session-row[data-session-id="' + id + '"]')

/**
 * The optimizations in this batch are invisible by nature: they remove work.
 * These tests therefore pin the observable consequences — which DOM is built,
 * which nodes survive, and that no update is silently swallowed.
 */

describe('the hidden conversation directory', () => {
  it('is not built until it opens', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-0', sessions: sessionList(40) })
    await h.settle()
    // The quick switcher keeps its existing top-12 slice; the full directory
    // has nothing to draw yet.
    expect(rows(h, 'sessionList')).toHaveLength(12)
    expect(rows(h, 'homeSessionList')).toHaveLength(0)

    h.click('#conversationHome')
    await h.settle()
    expect(rows(h, 'sessionList')).toHaveLength(12)
    expect(rows(h, 'homeSessionList')).toHaveLength(40)
    expect(h.document.activeElement?.id).toBe('homeSessionSearch')
  })

  it('rebuilds stale rows the next time it opens', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-0', sessions: sessionList(3) })
    await h.settle()
    h.click('#conversationHome')
    await h.settle()
    const before = row(h, 'homeSessionList', 'session-1')!
    expect(before.textContent).toContain('Conversation 1')

    h.click('#conversationHome')
    await h.settle()
    const renamed = sessionList(3).map((session, index) => index === 1 ? { ...session, title: 'Renamed while hidden' } : session)
    h.send({ type: 'state-update', update: { patch: { sessions: renamed } } })
    await h.settle()
    // Hidden: the directory keeps its old nodes instead of paying a rebuild.
    expect(row(h, 'homeSessionList', 'session-1')).toBe(before)
    expect(before.textContent).toContain('Conversation 1')

    h.click('#conversationHome')
    await h.settle()
    expect(row(h, 'homeSessionList', 'session-1')!.textContent).toContain('Renamed while hidden')
  })
})

describe('the directory rows', () => {
  it('survive a republished array that still holds the same sessions', async () => {
    const h = open()
    const sessions = sessionList(5)
    h.sendState({ sessionId: 'session-0', sessions })
    await h.settle()
    const before = row(h, 'sessionList', 'session-1')!
    // The Host can publish a new array for the same values; rebuilding would
    // drop focus and the action-menu anchor for no visible change.
    h.send({ type: 'state-update', update: { patch: { sessions: [...sessions] } } })
    await h.settle()
    expect(row(h, 'sessionList', 'session-1')).toBe(before)

    // A real change still repaints the row.
    h.send({ type: 'state-update', update: { patch: {
      sessions: sessions.map((session, index) => index === 1 ? { ...session, title: 'Renamed' } : session),
    } } })
    await h.settle()
    expect(row(h, 'sessionList', 'session-1')!.textContent).toContain('Renamed')
  })
})

describe('the transcript', () => {
  const messages = [
    { id: 'u1', role: 'user', text: 'hello' },
    { id: 'a1', role: 'assistant', text: 'first answer' },
    { id: 'a2', role: 'assistant', text: 'second answer' },
  ]

  it('is not reconciled for a patch that cannot change it', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', messages })
    await h.settle()
    const node = h.document.querySelector('.message')
    // A foreign node is the canary: the reconciler sweeps everything that is
    // not a message, so it survives only while the transcript is left alone.
    const canary = h.document.createElement('div')
    canary.id = 'render-canary'
    h.document.getElementById('messages')!.append(canary)

    h.send({ type: 'state-update', update: { patch: { account: { signedIn: true } } } })
    await h.settle()
    expect(h.document.getElementById('render-canary')).not.toBeNull()
    h.send({ type: 'state-update', update: { patch: { usage: {
      available: true, percent: 1, usedTokens: 1, contextWindow: 100,
    } } } })
    await h.settle()
    expect(h.document.getElementById('render-canary')).not.toBeNull()
    expect(h.document.querySelector('.message')).toBe(node)

    // A message patch must still reconcile; the canary is swept.
    h.send({ type: 'state-update', update: { messages: { upserts: [{ id: 'a3', role: 'assistant', text: 'third' }] } } })
    await h.settle()
    expect(h.document.getElementById('render-canary')).toBeNull()
    expect(h.document.querySelectorAll('#messages .message')).toHaveLength(4)
  })

  it('keeps untouched rows when one message streams', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', messages })
    await h.settle()
    const first = h.document.querySelector('.message')
    const second = h.document.querySelectorAll('.message')[1]
    h.send({ type: 'state-update', update: { messages: { appends: [{ id: 'a2', text: ' and more' }] } } })
    await h.settle()
    expect(h.document.querySelector('.message')).toBe(first)
    expect(h.document.querySelectorAll('.message')[1]).toBe(second)
    expect(h.document.querySelectorAll('.message')[2]!.textContent).toContain('second answer and more')
  })

  it('still applies a rating and turn metadata that arrive after the row was drawn', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      messages: [{ id: 'm1', role: 'assistant', text: 'the answer' }],
      messageMeta: [{ id: 'm1', seq: 42, time: Date.now(), turnEnd: true }],
      messageFeedback: [],
    })
    await h.settle()
    expect(h.document.querySelector('.message-positive path')!.getAttribute('fill')).toBe('none')

    h.send({ type: 'state-update', update: { patch: { messageFeedback: [{ messageId: 'm1', rating: 'positive', version: 4 }] } } })
    await h.settle()
    expect(h.document.querySelector('.message-positive path')!.getAttribute('fill')).toBe('currentColor')

    h.send({ type: 'state-update', update: { patch: { messageMeta: [{ id: 'm1', seq: 42, time: Date.now(), turnEnd: true, turnDurationMs: 125_000 }] } } })
    await h.settle()
    expect(h.document.querySelector('.message-duration')?.textContent).toBe('Completed in 2m 5s')
  })
})
