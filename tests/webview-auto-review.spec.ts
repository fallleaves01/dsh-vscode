// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * A tool the Auto reviewer refused never ran: the card must show DSH's refusal
 * copy, not the tool's own (usually technical) failure text.
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

function deniedTool(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tool:auto', role: 'tool', text: 'bash', failed: true, detail: 'Rejected by Auto review',
    autoReviewDenied: { reason: 'Deleting the build directory was not authorized.' },
    callView: { card: 'terminal', title: 'bash' }, rawInput: 'rm -rf build',
    resultView: { card: 'generic', content: [{ type: 'text', text: 'SECRET raw tool error text' }] },
    rawResult: 'SECRET raw tool error text',
    ...extra,
  }
}

async function show(h: Harness, message: Record<string, unknown>): Promise<void> {
  h.sendState({ sessionId: 'session-a', messages: [message] })
  await h.settle()
}

const detail = (h: Harness) => h.document.querySelector<HTMLElement>('.tool-detail')?.textContent ?? ''
const body = (h: Harness) => h.document.querySelector<HTMLElement>('.auto-review-body')?.textContent ?? ''

describe('Auto review denied tool cards', () => {
  it('shows the refusal summary and the reviewer reason instead of the raw error', async () => {
    const h = open()
    await show(h, deniedTool())
    const card = h.document.querySelector<HTMLElement>('.tool')
    expect(card).not.toBeNull()
    expect(card!.classList.contains('failed')).toBe(true)
    expect(card!.querySelector('.tool-icon')!.textContent).toBe('!')
    expect(detail(h)).toBe('Rejected by Auto review')
    // A failed tool opens by default, so the dedicated body is already there.
    expect(card!.open).toBe(true)
    expect(body(h)).toBe('Tool was not executed. Reason: Deleting the build directory was not authorized.')
    expect(h.document.querySelector('.auto-review-body img')).toBeNull()
    expect(h.document.querySelector('.tool')!.textContent).not.toContain('SECRET raw tool error text')
  })

  it.each([
    ['a null reason', null],
    ['a blank reason', '   '],
  ])('falls back to DSH copy for %s', async (_case, reason) => {
    const h = open()
    await show(h, deniedTool({ autoReviewDenied: { reason } }))
    expect(body(h)).toBe('Tool was not executed. Reason: Auto review did not authorize this action')
  })

  it('normalizes a multi-line reason onto one displayed line', async () => {
    const h = open()
    await show(h, deniedTool({ autoReviewDenied: { reason: 'First line.\r\nSecond line.\n' } }))
    expect(body(h)).toBe('Tool was not executed. Reason: First line. Second line.')
  })

  it('renders a hostile reason as text, never as markup', async () => {
    const h = open()
    const reason = '<img src=x onerror="window.pwned=1">'
    await show(h, deniedTool({ autoReviewDenied: { reason } }))
    expect(h.document.querySelector('.auto-review-body img')).toBeNull()
    expect(body(h)).toBe('Tool was not executed. Reason: ' + reason)
    expect(h.document.querySelector('.auto-review-body script, .auto-review-body img')).toBeNull()
  })

  it('repaints when the denial reason arrives late', async () => {
    const h = open()
    await show(h, deniedTool({ autoReviewDenied: { reason: null } }))
    expect(body(h)).toContain('Auto review did not authorize this action')
    // The projection fills the reason in a later patch for the same message.
    h.send({ type: 'state-update', update: { messages: {
      upserts: [deniedTool({ autoReviewDenied: { reason: 'Arrived later.' } })],
    } } })
    await h.settle()
    expect(detail(h)).toBe('Rejected by Auto review')
    expect(body(h)).toBe('Tool was not executed. Reason: Arrived later.')
  })

  it('leaves ordinary failed and successful tool cards unchanged', async () => {
    const h = open()
    await show(h, {
      id: 'tool:plain', role: 'tool', text: 'bash', failed: true, detail: 'Command failed',
      callView: { card: 'terminal', title: 'bash' }, rawInput: 'make',
      resultView: { card: 'terminal', output: 'boom', exitCode: 2 },
    })
    expect(detail(h)).toBe('Command failed')
    expect(h.document.querySelector('.auto-review-body')).toBeNull()
    expect(h.document.querySelector('.tool-body')!.textContent).toContain('boom')

    await show(h, {
      id: 'tool:ok', role: 'tool', text: 'read', detail: 'Completed',
      callView: { card: 'generic', title: 'Read a.ts' }, resultView: { card: 'generic', title: 'Read a.ts' },
    })
    expect(detail(h)).toBe('Completed')
    expect(h.document.querySelector('.auto-review-body')).toBeNull()
  })
})
