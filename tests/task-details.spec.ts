// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountTaskDetails } from '../src/task-details.mjs'
import { taskDetailsHtml } from '../src/task-details-html.js'
import type { TaskDetailState } from '../src/task-details-state.js'
let dispose: () => void, posts: Record<string, any>[], state: TaskDetailState
const sendState = (patch: Partial<TaskDetailState> = {}) => { state = { ...state, ...patch }; window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state } })) }
const message = (value: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { data: value }))
const click = (id: string) => (document.getElementById(id) as HTMLButtonElement).click()
beforeEach(() => {
  const uri = { toString: () => 'vscode-resource:/asset' } as any
  document.body.innerHTML = taskDetailsHtml({ cspSource: 'vscode-webview:' } as any, { script: uri, markdown: uri, style: uri }).split('<body>')[1]!.split('</body>')[0]!
  window.dshMarkdown = { renderMarkdown: (text: string) => { const node = document.createElement('div'); node.textContent = text; return node } } as any
  posts = []; dispose = mountTaskDetails({ postMessage: value => posts.push(value) })
  state = { kind: 'subagent', sessionId: 'c', parentSessionId: 'p', title: 'Child', status: 'Idle', running: false, meta: '', readOnlyReason: null, messages: [], requests: [], chunks: [], gap: false, hasMore: true, loadingHistory: false }
  sendState()
})
afterEach(() => { dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })
describe('independent task detail interactions', () => {
  it('ignores unsolicited output pages that have no matching pending request', () => {
    message({ type: 'body', messageId: 'unknown' })
    message({ type: 'body', messageId: 'unknown', requestId: 'unknown' })
    expect(document.getElementById('notice')?.textContent).toBe('')
  })
  it('queues only one pending send, preserves edits, and clears only the acknowledged draft', () => {
    const draft = document.getElementById('draft') as HTMLTextAreaElement
    draft.value = 'First'; click('send'); click('send')
    expect(posts.filter(post => post.type === 'send')).toHaveLength(1)
    const first = posts.at(-1)!
    draft.value = 'Next draft'; message({ type: 'sent', requestId: first.requestId })
    expect(draft.value).toBe('Next draft')
    click('send'); const next = posts.at(-1)!; message({ type: 'sent', requestId: next.requestId })
    expect(draft.value).toBe('')
  })
  it('retains a failed draft and supports explicit Steer delivery', () => {
    const draft = document.getElementById('draft') as HTMLTextAreaElement, delivery = document.getElementById('delivery') as HTMLSelectElement
    delivery.value = 'steer'; draft.value = 'Change approach'; click('send')
    expect(posts.at(-1)).toEqual(expect.objectContaining({ mode: 'steer', text: 'Change approach' }))
    message({ type: 'send-failed', requestId: posts.at(-1)!.requestId })
    expect(draft.value).toBe('Change approach')
    expect((document.getElementById('send') as HTMLButtonElement).disabled).toBe(false)
  })
  it('keeps Stop when the child is read-only and routes navigation only on explicit clicks', () => {
    sendState({ running: true, readOnlyReason: 'Resume the parent first.' })
    expect((document.getElementById('draft') as HTMLTextAreaElement).disabled).toBe(true)
    expect((document.getElementById('stop') as HTMLButtonElement).disabled).toBe(false)
    click('stop'); expect(posts.at(-1)).toEqual({ type: 'stop' })
    click('owner'); expect(posts.at(-1)).toEqual({ type: 'open-chat', sessionId: 'p' })
    click('inChat'); expect(posts.at(-1)).toEqual({ type: 'open-chat', sessionId: 'c' })
  })
  it('preserves in-progress answers across streamed messages and routes the exact RPC', () => {
    const requests = [{ rpcId: 'rpc-q', event: 'user-questions/request', request: { questions: [{ id: 'q', question: 'Which file?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] } }]
    sendState({ requests })
    const area = document.querySelector<HTMLTextAreaElement>('#requests textarea')!; area.value = 'C instead'
    document.querySelector<HTMLInputElement>('#requests input')!.checked = true
    sendState({ requests, messages: [{ id: 'live', role: 'assistant', text: 'Still working', streaming: true }] })
    expect(document.querySelector('#requests textarea')).toBe(area)
    document.querySelector<HTMLButtonElement>('#requests button')!.click()
    expect(posts.at(-1)).toEqual({ type: 'answer', rpcId: 'rpc-q', answers: [{ id: 'q', selected: ['A'], custom: 'C instead' }] })
  })
  it('exposes one-use approval and rejection without injecting raw request HTML', () => {
    sendState({ requests: [{ rpcId: 'approval', event: 'approval/request', request: { description: '<img src=x onerror=bad()>' } }] })
    expect(document.querySelector('#requests img')).toBeNull()
    document.querySelector<HTMLButtonElement>('#requests button')!.click()
    expect(posts.at(-1)).toEqual({ type: 'answer', rpcId: 'approval', outcome: 'allowed-once' })
    document.querySelectorAll<HTMLButtonElement>('#requests button')[1]!.click()
    expect(posts.at(-1)).toEqual({ type: 'answer', rpcId: 'approval', outcome: 'rejected' })
  })
  it('renders channel-tagged output literally and shows retention gaps', () => {
    sendState({ kind: 'job', running: false, readOnlyReason: 'Output preview', chunks: [{ at: 1, text: '<script>bad()</script>', channel: 'stderr' }, { at: 2, text: 'phase', channel: 'log' }], gap: true })
    expect(document.querySelector('#output script')).toBeNull()
    expect(document.querySelector('#output .stderr')?.textContent).toBe('<script>bad()</script>')
    expect(document.getElementById('gap')?.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('composer')?.classList.contains('hidden')).toBe(true)
  })
  it('loads large message bodies page by page without duplicating in-flight requests', () => {
    sendState({ messages: [{ id: 'large', role: 'tool', text: 'Build', deferredBody: true, deferredBodyRevision: 'rev' }] })
    const button = document.querySelector<HTMLButtonElement>('#messages button')!; button.click(); button.click()
    expect(posts.filter(post => post.type === 'body')).toHaveLength(1)
    const read = posts.at(-1)!
    message({ type: 'body', messageId: 'large', requestId: read.requestId, page: { message: { id: 'large', role: 'tool', text: '', rawResult: 'first page' }, nextCursor: 'cursor' } })
    expect(document.getElementById('messages')?.textContent).toContain('first page')
    document.querySelector<HTMLButtonElement>('#messages button')!.click()
    expect(posts.at(-1)?.cursor).toBe('cursor')
  })
  it('does not respond to host messages after the panel has been unmounted', () => {
    dispose(); sendState({ title: 'Ignored' })
    expect(document.getElementById('title')?.textContent).toBe('Child')
  })
  it('removes control and draft listeners when unmounted, including retained buttons', () => {
    sendState({ running: true, requests: [{ rpcId: 'approval', event: 'approval/request', request: { description: 'Read file' } }] })
    const approval = document.querySelector<HTMLButtonElement>('#requests button')!
    const draft = document.getElementById('draft') as HTMLTextAreaElement
    draft.value = 'Should not send after unmount'
    dispose(); const count = posts.length
    click('stop'); click('retry'); click('owner'); approval.click()
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(posts).toHaveLength(count)
  })
})

it('preserves expanded thinking while a child streams a new answer', () => {
  sendState({ messages: [{ id: 'a', role: 'assistant', text: 'First', reasoning: 'Checking', streaming: true }] })
  document.querySelector<HTMLDetailsElement>('#messages details')!.open = true
  sendState({ messages: [{ id: 'a', role: 'assistant', text: 'First, more', reasoning: 'Checking more', streaming: true }] })
  expect(document.querySelector<HTMLDetailsElement>('#messages details')!.open).toBe(true)
})
