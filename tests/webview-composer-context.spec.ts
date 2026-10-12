// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

let h: Harness
afterEach(() => { h.dispose(); document.body.replaceChildren() })
const preset = (locked = true, busy = false) => ({
  available: true, current: 'standard', locked, busy,
  options: ['standard', 'ptc', 'minimal', 'cordis'].map(id => ({ id, label: id, selected: id === 'standard', trust: 'system' })),
})
const show = async (overrides: Record<string, unknown> = {}) => {
  h = harness(); h.sendState({ agentPreset: preset(), ...overrides }); await h.settle()
}

describe('compact conversation settings', () => {
  it('keeps the fixed preset in settings without a permanent composer row', async () => {
    await show()
    expect(h.document.getElementById('modeChips')!.classList.contains('hidden')).toBe(true)
    expect(h.document.querySelector('.preset-select')).toBeNull()
    expect(h.document.getElementById('policyTrigger')!.classList.contains('hidden')).toBe(false)
    h.click('#policyTrigger')
    expect(h.document.querySelector('.policy-preset-name')!.textContent).toBe('standard')
    expect(h.document.querySelector('.policy-preset-fixed')!.getAttribute('title')).toContain('first turn')
    expect(h.document.querySelectorAll('.agent-preset-option')).toHaveLength(0)
    expect(h.document.getElementById('policyMenu')!.textContent).not.toContain('ptc')
  })

  it('still selects a new conversation preset when there is no permission catalog', async () => {
    await show({ agentPreset: preset(false), permissions: [] })
    h.click('#policyTrigger'); h.posts.length = 0
    h.click('.agent-preset-option[data-preset-id="ptc"]')
    expect(h.posts).toEqual([{ type: 'select-agent-preset', agentPreset: 'ptc' }])
    expect(h.document.getElementById('policyMenu')!.classList.contains('hidden')).toBe(true)
  })

  it.each([{ busy: true, running: false }, { busy: false, running: true }])('does not select a preset while unavailable: %j', async ({ busy, running }) => {
    await show({ agentPreset: preset(false, busy), running })
    h.click('#policyTrigger'); h.posts.length = 0
    const button = h.document.querySelector<HTMLButtonElement>('.agent-preset-option[data-preset-id="ptc"]')!
    expect(button.disabled).toBe(true)
    button.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toHaveLength(0)
  })

  it('retains the actionable Plan indicator independently of the fixed preset', async () => {
    await show({ plan: { available: true, active: true, pending: false } })
    expect(h.document.getElementById('modeChips')!.textContent).toBe('Plan×')
    h.click('.plan-chip-close')
    expect(h.posts).toContainEqual({ type: 'select-mode', mode: 'normal' })
  })
})

describe('compact editor context', () => {
  it('shows the file name, preserves the full path in its tooltip and opens that path', async () => {
    await show()
    h.send({ type: 'ide-context', state: { sessionId: 'session-a', pinned: [{ id: 'file-1', kind: 'file', path: 'deep_ep/buffers/bucket.py' }] } })
    expect(h.document.querySelector('.context-name')!.textContent).toBe('bucket.py')
    expect(h.document.querySelector('.context-chip')!.getAttribute('title')).toContain('deep_ep/buffers/bucket.py')
    h.posts.length = 0; h.click('.context-open')
    expect(h.posts).toEqual([{ type: 'open-file', path: 'deep_ep/buffers/bucket.py' }])
  })

  it('keeps selected line ranges and removes pinned context independently of opening it', async () => {
    await show()
    h.send({ type: 'ide-context', state: { pinned: [{ id: 'selection-1', kind: 'selection', path: 'deep_ep/buffers/bucket.py', startLine: 24, endLine: 38, truncated: true }] } })
    expect(h.document.querySelector('.context-name')!.textContent).toBe('bucket.py L24–38 (truncated)')
    h.posts.length = 0; h.click('.context-open'); h.click('.context-remove')
    expect(h.posts).toEqual([{ type: 'open-file', path: 'deep_ep/buffers/bucket.py', line: 24 }, { type: 'remove-context', id: 'selection-1', sessionId: 'session-a', requestId: 1 }])
  })
})

describe('explicit file picker', () => {
  const file = { kind: 'file', path: 'deep_ep/buffers/bucket.py' }
  const update = (pinned: unknown[]) => h.send({ type: 'ide-context', state: { sessionId: 'session-a', availableFile: file, pinned } })

  it('offers the current editor file without selecting it, then supports adding and removing it', async () => {
    await show(); update([])
    expect(h.document.querySelector('.context-chip')).toBeNull()
    h.click('#attach')
    const option = h.document.querySelector<HTMLButtonElement>('.context-option')!
    expect(option.getAttribute('aria-selected')).toBe('false')
    expect(option.textContent).toContain('optional')
    h.posts.length = 0; option.click()
    const add = h.posts.find(item => item.type === 'add-context')!
    expect(add).toMatchObject({ path: file.path, sessionId: 'session-a' })
    update([{ ...file, id: 'file-1' }]); h.send({ type: 'context-updated', sessionId: 'session-a', requestId: add.requestId })
    expect(h.document.querySelector('.context-remove')).not.toBeNull()
    expect(h.document.querySelector('.context-option')!.getAttribute('aria-selected')).toBe('true')
    h.click('.context-remove')
    const remove = h.posts.find(item => item.type === 'remove-context')!
    expect(remove).toMatchObject({ id: 'file-1', sessionId: 'session-a' })
    update([]); h.send({ type: 'context-updated', sessionId: 'session-a', requestId: remove.requestId })
    update([])
    expect(h.document.querySelector('.context-chip')).toBeNull()
  })

  it('waits for a file selection to finish before accepting Enter', async () => {
    await show(); update([]); h.click('#attach'); h.click('.context-option')
    const add = h.posts.find(item => item.type === 'add-context')!
    h.enter('Review this file')
    expect(h.posts.some(item => item.type === 'send')).toBe(false)
    update([{ ...file, id: 'file-1' }]); h.send({ type: 'context-updated', sessionId: 'session-a', requestId: add.requestId })
    h.enter('Review this file')
    expect(h.posts.filter(item => item.type === 'send')).toHaveLength(1)
  })

  it('ignores old search responses and old session context after navigating', async () => {
    await show(); h.click('#attach')
    const first = h.posts.find(item => item.type === 'request-context-files')!
    const search = h.document.getElementById('contextSearch') as HTMLInputElement
    search.value = 'util'; search.dispatchEvent(new Event('input', { bubbles: true }))
    const current = h.posts.filter(item => item.type === 'request-context-files').at(-1)!
    h.send({ ...first, type: 'context-files', candidates: [file] })
    expect(h.document.querySelectorAll('.context-option')).toHaveLength(0)
    h.send({ ...current, type: 'context-files', candidates: [{ kind: 'file', path: 'src/util.ts' }] })
    expect(h.document.querySelector('.context-option')!.textContent).toContain('util.ts')
    h.sendState({ sessionId: 'session-b' }); await h.settle()
    update([{ ...file, id: 'old' }])
    expect(h.document.querySelector('.context-chip')).toBeNull()
    expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(true)
  })

  it('retains image attachment and restores focus when the picker closes', async () => {
    await show(); h.click('#attach'); h.posts.length = 0; h.click('#contextImage')
    expect(h.posts).toEqual([{ type: 'attach' }])
    expect(h.document.activeElement?.id).toBe('prompt')
    expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(true)
  })
})
