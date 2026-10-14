// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

const live: Harness[] = []
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
function open(): Harness { const instance = harness(); live.push(instance); return instance }
const parent = { id: 'parent', title: 'Main task', updatedAt: Date.now(), childCount: 1 }
const child = { id: 'kid', title: 'Research notes', updatedAt: Date.now(), parentId: 'parent', subagent: { mode: 'continuable', label: 'Research' } }
const ids = (h: Harness, selector = '#sessionList') => [...h.document.querySelectorAll<HTMLElement>(selector + ' .session-row')].map(row => row.dataset.sessionId)
function input(h: Harness, id: string, value: string) { const element = h.document.getElementById(id) as HTMLInputElement; element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); return element }
function key(element: Element, value: string, composing = false) { element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, isComposing: composing })) }
function action(h: Harness, label: string) { [...h.document.querySelectorAll<HTMLButtonElement>('#sessionActions button')].find(button => button.textContent === label)!.click() }

describe('main conversation directory and quick switcher', () => {
  it('excludes children and orphan subagents from both lists while retaining the Tasks panel', async () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent, child, { ...child, id: 'orphan', parentId: undefined }] }); await h.settle()
    h.click('#sessionTrigger'); expect(ids(h)).toEqual(['parent']); expect(ids(h, '#homeSessionList')).toEqual(['parent'])
    expect(h.document.querySelectorAll('.session-expander')).toHaveLength(0)
    expect(h.document.querySelector('.task-child[data-session-id="kid"]')).not.toBeNull()
    h.click('.task-child[data-session-id="kid"]'); expect(h.posts.at(-1)).toEqual({ type: 'open-task-details', kind: 'subagent', sessionId: 'kid' })
  })
  it('excludes children at every delegation depth, including title and body search hits', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent, child, { ...child, id: 'leaf', parentId: 'kid' }], historySearch: { query: 'research', loading: false, items: [{ sessionId: 'kid', snippet: 'research' }, { sessionId: 'leaf', snippet: 'research' }] } })
    h.click('#sessionTrigger'); input(h, 'sessionSearch', 'research')
    expect(ids(h)).toEqual([]); expect(h.document.querySelector('#sessionList')!.textContent).toContain('No matching conversations')
  })
  it('keeps independent conversations visible and orders them by last update', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent, { id: 'fork', title: 'Independent fork', updatedAt: Date.now() + 1000 }, child] })
    h.click('#sessionTrigger'); expect(ids(h)).toEqual(['fork', 'parent'])
  })
  it('reports descendant attention on its parent and counts each other main conversation once', () => {
    const h = open(); h.sendState({ sessionId: 'other', sessions: [{ id: 'other', title: 'Current' }, parent, { ...child, running: true, attention: { approvals: 1, questions: 1 } }, { ...child, id: 'leaf', parentId: 'kid', attention: { approvals: 2, questions: 0 } }] })
    h.click('#sessionTrigger')
    expect(h.document.getElementById('sessionAttentionCount')!.textContent).toBe('1')
    expect(h.document.querySelector('.session-row[data-session-id="parent"] .session-meta')!.textContent).toBe('Awaiting approval')
    expect(h.document.querySelector('.session-row[data-session-id="parent"] .session-indicator')!.classList.contains('attention')).toBe(true)
  })
  it('opens a floating action menu without changing the selected conversation', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent] }); h.click('#sessionTrigger'); h.posts.length = 0
    h.click('#sessionList .session-more'); expect(h.posts).toEqual([])
    expect(h.document.querySelector('#sessionActions .session-action')!.textContent).toBe('Rename')
    expect(h.document.querySelector('#sessionList .session-actions')).toBeNull()
    action(h, 'Rename'); expect(h.posts.at(-1)).toEqual({ type: 'rename-session', sessionId: 'parent' })
  })
  it('archives from the action menu and exposes archived main conversations in the full directory', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent], archivedSessions: [{ id: 'archived', title: 'Completed work' }, { ...child, id: 'archived-child' }] }); h.click('#sessionTrigger'); h.click('#sessionList .session-more'); action(h, 'Archive')
    expect(h.posts.at(-1)).toEqual({ type: 'archive-session', sessionId: 'parent' })
    h.click('#conversationHome'); h.click('#homeArchiveToggle'); expect(ids(h, '#homeSessionList')).toEqual(['archived'])
    h.click('#homeSessionList .session-more'); action(h, 'Rename'); expect(h.posts.at(-1)).toEqual({ type: 'rename-session', sessionId: 'archived' })
    h.click('#homeSessionList .session-more'); action(h, 'Restore'); expect(h.posts.at(-1)).toEqual({ type: 'unarchive-session', sessionId: 'archived' })
  })
  it('filters archived body hits as well as archived title rows', () => {
    const h = open(); h.sendState({ sessions: [parent], archivedSessions: [{ id: 'archived', title: 'Completed work' }, { ...child, id: 'archived-child' }], historySearch: { query: 'needle', loading: false, items: [{ sessionId: 'archived-child', snippet: 'needle' }, { sessionId: 'archived', snippet: 'needle' }, { sessionId: 'parent', snippet: 'needle' }] } })
    h.click('#conversationHome'); h.click('#homeArchiveToggle'); input(h, 'homeSessionSearch', 'needle')
    expect(ids(h, '#homeSessionList')).toEqual(['archived'])
  })
  it('deduplicates title/body hits and renders snippets as text', () => {
    const h = open(); h.sendState({ sessions: [parent, { id: 'body', title: 'Other work' }], historySearch: { query: 'main', loading: false, items: [{ sessionId: 'parent', snippet: 'main' }, { sessionId: 'body', snippet: '<script>main</script>' }, { sessionId: 'body', snippet: 'duplicate' }], hasMore: true } })
    h.click('#sessionTrigger'); input(h, 'sessionSearch', 'main'); expect(ids(h)).toEqual(['parent', 'body'])
    expect(h.document.querySelector('#sessionList script')).toBeNull(); expect(h.document.querySelector('#sessionList')!.textContent).toContain('up to 20')
  })
  it('supports search-to-list keyboard navigation and an independent Escape for the action menu', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent, { id: 'second', title: 'Second', updatedAt: 1 }] }); h.click('#sessionTrigger')
    const search = h.document.getElementById('sessionSearch')!; search.focus(); key(search, 'ArrowDown')
    expect(h.document.activeElement!.closest('.session-row')!.getAttribute('data-session-id')).toBe('parent')
    key(h.document.activeElement!, 'ArrowDown'); expect(h.document.activeElement!.closest('.session-row')!.getAttribute('data-session-id')).toBe('second')
    key(h.document.activeElement!, 'ArrowRight'); expect(h.document.activeElement!.textContent).toBe('Rename')
    key(h.document.activeElement!, 'ArrowDown'); expect(h.document.activeElement!.textContent).toBe('Archive')
    key(h.document.activeElement!, 'Escape'); expect(h.document.activeElement!.classList.contains('session-more')).toBe(true)
    expect(h.document.getElementById('sessionMenu')!.classList.contains('hidden')).toBe(false)
    key(search, 'Escape'); expect(h.document.getElementById('sessionMenu')!.classList.contains('hidden')).toBe(true)
  })
  it('preserves list focus and an open menu across a conversation status update', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent] }); h.click('#sessionTrigger'); h.click('#sessionList .session-more')
    h.sendState({ sessionId: 'parent', sessions: [{ ...parent, running: true }] })
    expect(h.document.getElementById('sessionActions')!.classList.contains('hidden')).toBe(false)
    action(h, 'Archive'); expect(h.posts.at(-1)).toEqual({ type: 'archive-session', sessionId: 'parent' })
  })
  for (const phase of ['loading', 'error']) it(`keeps other conversations reachable during ${phase}`, async () => {
    const h = open(); h.sendState({ phase, sessionId: 'a', sessions: [{ id: 'a', title: 'Unavailable', updatedAt: 2 }, { id: 'b', title: 'Other', updatedAt: 1 }] }); await h.settle(); h.click('#sessionTrigger'); h.click('#sessionList .session-row[data-session-id="b"] .session-main')
    expect(h.posts.at(-1)).toEqual({ type: 'select-session', sessionId: 'b' })
  })
  it('disables the quick switcher when neither list contains a main conversation', async () => {
    const h = open(); h.sendState({ sessions: [child], archivedSessions: [child] }); await h.settle()
    expect((h.document.getElementById('sessionTrigger') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('conversation directory navigation and existing drafts', () => {
  it('opens View all without creating a session or copying the current conversation draft', () => {
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent] }); input(h, 'prompt', 'Draft for the current conversation'); h.posts.length = 0; h.click('#sessionTrigger'); h.click('#viewAllSessions')
    expect(h.document.getElementById('conversationHomeView')!.classList.contains('hidden')).toBe(false)
    expect(h.document.getElementById('homePrompt')).toBeNull(); expect(h.posts).toEqual([])
    h.click('#conversationHome'); expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('Draft for the current conversation')
  })
  it('blocks repeated Enter submissions until the first send is acknowledged', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent] })
    await h.settle()
    h.send({ type: 'draft-images', sessionId: 'parent', images: [{ id: 'image', name: 'image.png', mediaType: 'image/png' }] })
    h.enter('First message')
    const first = h.posts.findLast(item => item.type === 'send')!
    h.enter('Second message')
    expect(h.posts.filter(item => item.type === 'send')).toHaveLength(1)
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('Second message')
    h.send({ type: 'draft-sent', sessionId: 'parent', requestId: first.requestId })
    h.enter('Second message')
    expect(h.posts.filter(item => item.type === 'send')).toHaveLength(2)
  })
  it('keeps runtime recovery controls reachable on the directory', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent] })
    h.click('#conversationHome')
    h.sendState({ phase: 'error', setup: 'api-key', statusText: 'Configure a DeepSeek API key', sessionId: 'parent', sessions: [parent] })
    await h.settle()
    const configure = [...h.document.querySelectorAll<HTMLButtonElement>('#homeRuntime button')].find(button => button.textContent === 'Configure API Key')!
    configure.click()
    expect(h.posts.at(-1)).toEqual({ type: 'configure-api-key' })
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(true)
  })
  it('reveals an explicitly pinned editor reference without treating editor suggestions as additions', () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent] })
    h.click('#conversationHome')
    h.send({ type: 'ide-context', state: { sessionId: 'parent', pinned: [], availableFile: { path: 'src/runtime.ts' } } })
    expect(h.document.getElementById('conversationHomeView')!.classList.contains('hidden')).toBe(false)
    h.send({ type: 'ide-context', state: { sessionId: 'parent', pinned: [{ id: 'pin', kind: 'file', path: 'src/runtime.ts' }] } })
    expect(h.document.getElementById('conversationHomeView')!.classList.contains('hidden')).toBe(true)
    expect(h.document.querySelector('.context-name')!.textContent).toContain('runtime.ts')
  })
})
