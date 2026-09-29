// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * A tool row opens itself while it runs and when it fails, which is not a choice
 * the user made. Assigning the open property queues a toggle event that arrives
 * after the listener is attached, so recording every toggle as user intent made
 * the self-opened disclosure look clicked: every tool stayed expanded for the
 * rest of the conversation.
 *
 * It was reported as model-specific because it needs the running state to reach
 * the screen: a tool that finishes inside one render batch never shows it, which
 * is what a fast model usually does and a slow one does not.
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

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function runningTool(detail = 'Running…'): Record<string, unknown> {
  return {
    id: 'tool:1', role: 'tool', text: 'bash', detail, streaming: true,
    callView: { card: 'terminal', title: 'bash' }, rawInput: 'ls',
  }
}

function finishedTool(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tool:1', role: 'tool', text: 'bash', detail: 'Completed',
    callView: { card: 'terminal', title: 'bash' }, rawInput: 'ls',
    resultView: { card: 'terminal', output: 'ok' }, ...extra,
  }
}

async function show(h: Harness, message: Record<string, unknown>): Promise<void> {
  h.sendState({ sessionId: 'session-a', messages: [message] })
  await h.settle(); await tick()
}

function tool(h: Harness): HTMLDetailsElement {
  const element = h.document.querySelector('details.tool')
  if (element === null) throw new Error('no tool row rendered')
  return element as HTMLDetailsElement
}

/** jsdom only runs the details activation behaviour for a real MouseEvent. */
function clickSummary(h: Harness): void {
  const summary = h.document.querySelector('details.tool > summary')
  if (summary === null) throw new Error('no tool summary rendered')
  summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('tool output disclosure', () => {
  it('opens while the tool runs and closes again once it has finished', async () => {
    const h = open()
    await show(h, runningTool())
    expect(tool(h).open).toBe(true)

    await show(h, finishedTool())
    expect(tool(h).open).toBe(false)
  })

  it('keeps a tool the user opened open across re-renders', async () => {
    const h = open()
    await show(h, finishedTool())
    expect(tool(h).open).toBe(false)

    clickSummary(h); await tick()
    expect(tool(h).open).toBe(true)

    await show(h, finishedTool())
    expect(tool(h).open).toBe(true)
  })

  it('keeps a tool the user collapsed collapsed while it keeps running', async () => {
    const h = open()
    await show(h, runningTool())
    expect(tool(h).open).toBe(true)

    clickSummary(h); await tick()
    expect(tool(h).open).toBe(false)

    await show(h, runningTool('Running… 2s'))
    expect(tool(h).open).toBe(false)
  })

  it('opens a failed tool by itself, and lets the user close it for good', async () => {
    const h = open()
    await show(h, finishedTool({ failed: true, detail: 'Failed' }))
    expect(tool(h).open).toBe(true)

    clickSummary(h); await tick()
    expect(tool(h).open).toBe(false)

    await show(h, finishedTool({ failed: true, detail: 'Failed' }))
    expect(tool(h).open).toBe(false)
  })
})
