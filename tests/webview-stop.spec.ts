// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * Cancellation is cooperative: DSH admits the request and the agent stops at its
 * next interruptible point, which can be a long tool call away. The sidebar used
 * to show nothing at all, so a click looked like it had been ignored and invited
 * repeated clicks. It now acknowledges the request on the button itself.
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

function stopButton(h: Harness): HTMLButtonElement {
  return h.document.getElementById('cancel') as HTMLButtonElement
}

async function show(h: Harness, running: boolean, stopping = false): Promise<void> {
  h.sendState({ sessionId: 'session-a', running, stopping })
  await h.settle()
}

describe('the stop button', () => {
  it('appears only while a turn is running', async () => {
    const h = open()
    await show(h, false)
    expect(stopButton(h).classList.contains('hidden')).toBe(true)
    await show(h, true)
    expect(stopButton(h).classList.contains('hidden')).toBe(false)
  })

  it('acknowledges the request and refuses a second click', async () => {
    const h = open()
    await show(h, true, true)
    const button = stopButton(h)
    expect(button.classList.contains('stopping')).toBe(true)
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Stopping…')
    expect(button.getAttribute('aria-label')).toBe('Stopping…')
    // The spinner replaces the stop glyph, so the change is visible at a glance.
    expect(h.document.querySelector('.cancel-spinner')).not.toBeNull()
  })

  it('returns to normal once the turn ends', async () => {
    const h = open()
    await show(h, true, true)
    await show(h, false, false)
    const button = stopButton(h)
    expect(button.classList.contains('stopping')).toBe(false)
    expect(button.disabled).toBe(false)
    expect(button.title).toBe('Stop')
  })

  it('never shows the acknowledgement without a running turn', async () => {
    const h = open()
    // The extension clears both together, so this is defence in depth.
    await show(h, false, true)
    expect(stopButton(h).classList.contains('stopping')).toBe(false)
    expect(stopButton(h).disabled).toBe(false)
  })

  it('asks the extension to cancel when pressed', async () => {
    const h = open()
    await show(h, true)
    h.posts.length = 0
    stopButton(h).dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'cancel' })
  })
})
