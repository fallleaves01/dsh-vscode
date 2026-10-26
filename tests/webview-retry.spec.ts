// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

let h: Harness | undefined
afterEach(() => { h?.dispose(); h = undefined; document.body.replaceChildren() })
const open = (): Harness => { h = harness(); return h }

const retry = (overrides: Record<string, unknown> = {}) => ({
  retryId: 'chain-1', retry: 1, maxRetries: 3, mode: 'normal', delayMs: 400,
  state: 'scheduled', detail: 'Gateway timeout', failureCode: 'TIMEOUT', ...overrides,
})
const retryMessage = (overrides: Record<string, unknown> = {}) => ({
  id: 'retry:chain-1', role: 'retry', text: '', retry: retry(overrides),
})
const LIMIT_HINT = 'The reply was cut off; earlier output is preserved in the conversation. Send "continue" to let the model resume.'

describe('model retry rows', () => {
  it('shows the scheduled attempt with its delay and failure reason', async () => {
    const view = open()
    view.sendState({ messages: [retryMessage()] }); await view.settle()
    const row = document.querySelector('.retry-row')!
    expect(row.getAttribute('data-state')).toBe('scheduled')
    expect(row.hasAttribute('data-active')).toBe(true)
    expect(row.querySelector('.retry-text')?.getAttribute('role')).toBe('status')
    expect(row.querySelector('.retry-text')?.textContent).toBe('Retrying model request (1/3) · 1s')
    expect(row.querySelector('.retry-details')?.textContent).toContain('Retry delay: 400ms')
    expect(row.querySelector('.retry-details')?.textContent).toContain('Failure reason: Gateway timeout')
  })

  it('shows started and cancelled attempts without the active marker', async () => {
    const view = open()
    view.sendState({ messages: [retryMessage({ id: 'retry:a', state: 'started', retry: 2, delayMs: 1_500 })] }); await view.settle()
    expect(document.querySelector('.retry-row')?.getAttribute('data-state')).toBe('started')
    expect(document.querySelector('.retry-row')?.hasAttribute('data-active')).toBe(false)
    expect(document.querySelector('.retry-text')?.textContent).toBe('Retried model request (2/3) · 2s')
    await view.settle()
    view.sendState({ messages: [retryMessage({ id: 'retry:a', state: 'cancelled', retry: 2, delayMs: 1_500 })] }); await view.settle()
    expect(document.querySelector('.retry-text')?.textContent).toBe('Model request retry cancelled (2/3) · 2s')
  })

  it('renders an unbounded policy as ∞ and rounds the delay up to whole seconds', async () => {
    const view = open()
    view.sendState({ messages: [retryMessage({ mode: 'always', maxRetries: 0, retry: 4, delayMs: 1 })] }); await view.settle()
    expect(document.querySelector('.retry-text')?.textContent).toBe('Retrying model request (4/∞) · 1s')
    expect(document.querySelector('.retry-details')?.textContent).toContain('Retry delay: 1ms')
  })

  it('reuses the failure copy map and keeps hostile text literal', async () => {
    const view = open()
    view.sendState({ messages: [retryMessage({ failureCode: 'AUTH', detail: 'raw auth text' })] }); await view.settle()
    expect(document.querySelector('.retry-details')?.textContent).toContain('Failure reason: API key is invalid')
    view.sendState({ messages: [retryMessage({
      failureCode: undefined, detail: '<img src=x onerror=bad()>',
    })] }); await view.settle()
    expect(document.querySelector('.retry-details')?.textContent).toContain('Failure reason: <img src=x onerror=bad()>')
    expect(document.querySelector('.retry-row img')).toBeNull()
  })

  it('redraws an existing row when the retry attempt updates', async () => {
    const view = open()
    view.sendState({ messages: [retryMessage()] }); await view.settle()
    view.send({ type: 'state-update', update: { messages: { upserts: [retryMessage({ state: 'started', retry: 2, delayMs: 900 })] } } })
    await view.settle()
    expect(document.querySelector('.retry-row')?.getAttribute('data-state')).toBe('started')
    expect(document.querySelector('.retry-text')?.textContent).toBe('Retried model request (2/3) · 1s')
  })
})

describe('output token limit notice', () => {
  it('shows the warning row with DSH wording', async () => {
    const view = open()
    view.sendState({ messages: [{ id: 'limit:1', role: 'limit', text: '' }] }); await view.settle()
    const row = document.querySelector('.turn-limit')!
    expect(row.getAttribute('role')).toBe('status')
    expect(row.querySelector('.turn-limit-dot')).not.toBeNull()
    expect(row.querySelector('.turn-limit-title')?.textContent).toBe('Output token limit reached')
    expect(row.querySelector('.turn-limit-text')?.textContent).toBe(LIMIT_HINT)
  })
})

describe('empty failed attempt', () => {
  it('renders only the failure block, not a blank reply body', async () => {
    const view = open()
    view.sendState({ messages: [{ id: 'attempt', role: 'assistant', text: '', failed: true, detail: 'Upstream failed', failureCode: 'SERVER' }] })
    await view.settle()
    expect(document.querySelector('.message-body')).toBeNull()
    expect(document.querySelector('.assistant-failure-title')?.textContent).toBe('This turn failed')
    expect(document.querySelector('.assistant-failure-code')?.textContent).toBe('SERVER')
  })
})

describe('procedural rows after a closing reply', () => {
  it('keeps the closing reply action row visible when a limit notice follows it', async () => {
    const view = open()
    view.sendState({
      messages: [
        { id: 'reply', role: 'assistant', text: 'Partial answer' },
        { id: 'limit:1', role: 'limit', text: '' },
      ],
      messageMeta: [{ id: 'reply', time: Date.now(), turnEnd: true }],
    })
    await view.settle()
    expect(document.querySelector('.message-actions')?.classList.contains('always')).toBe(true)
  })
})
