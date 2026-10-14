// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
const live: Harness[] = []
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 0)); live.splice(0).forEach(h => h.dispose()); document.body.replaceChildren() })
async function open(changedFiles: unknown[]) { const h = harness(); live.push(h); h.sendState({ changedFiles, sessions: [{ id: 'session-a', title: 'Review work' }] }); await h.settle(); return h }
const groups = [
  { turn: 1, files: [{ path: 'src/runtime.ts', additions: 5, deletions: 2, canRevert: true }] },
  { turn: 2, files: [{ path: 'src/runtime.ts', additions: 3, deletions: 1, canRevert: true }, { path: 'src/webview.ts', additions: 4, deletions: 0, canRevert: false }] },
]
const menuAction = (h: Harness, label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('#sessionActions button')].find(button => button.textContent === label)!
describe('compact file change review', () => {
  it('starts collapsed and counts unique files across turns', async () => {
    const h = await open(groups)
    expect(h.document.querySelector('.changed-files-title')!.textContent).toBe('2 files changed')
    expect(h.document.querySelector('.changed-files-body')!.classList.contains('hidden')).toBe(true)
    expect(h.document.querySelector('.changed-files-head .change-additions')!.textContent).toBe('+12')
    expect(h.document.querySelector('.changed-files-head .change-deletions')!.textContent).toBe('−3')
    h.click('.changed-files-head .changed-action'); expect(h.posts.at(-1)).toEqual({ type: 'review-all', sessionId: 'session-a', cwd: '/workspace' })
  })
  it('includes the originating conversation and project in file review messages', async () => {
    const h = await open(groups)
    h.click('.changed-files-head .changed-action')
    expect(h.posts.at(-1)).toMatchObject({ type: 'review-all', sessionId: 'session-a', cwd: '/workspace' })
    h.click('.changed-files-toggle')
    h.document.querySelectorAll<HTMLButtonElement>('.changed-file-link')[1]!.click()
    expect(h.posts.at(-1)).toMatchObject({ type: 'review-file', path: 'src/runtime.ts', turn: 2, sessionId: 'session-a', cwd: '/workspace' })
    h.click('.changed-file .changed-more')
    menuAction(h, 'Revert change').click()
    expect(h.posts.at(-1)).toMatchObject({ type: 'revert-file', sessionId: 'session-a', cwd: '/workspace' })
  })
  it('opens the exact turn snapshot when the same file changed more than once', async () => {
    const h = await open(groups); h.click('.changed-files-toggle')
    h.document.querySelectorAll<HTMLButtonElement>('.changed-file-link')[1]!.click()
    expect(h.posts.at(-1)).toEqual({ type: 'review-file', path: 'src/runtime.ts', turn: 2, sessionId: 'session-a', cwd: '/workspace' })
    h.document.querySelectorAll<HTMLButtonElement>('.changed-file .changed-more')[0]!.click(); menuAction(h, 'Keep change').click()
    expect(h.posts.at(-1)).toEqual({ type: 'keep-file', path: 'src/runtime.ts', turn: 1, sessionId: 'session-a', cwd: '/workspace' })
    h.document.querySelectorAll<HTMLButtonElement>('.changed-file .changed-more')[1]!.click(); menuAction(h, 'Revert change').click()
    expect(h.posts.at(-1)).toEqual({ type: 'revert-file', path: 'src/runtime.ts', turn: 2, sessionId: 'session-a', cwd: '/workspace' })
  })
  it('disables individual and bulk reversion when a full snapshot is unavailable', async () => {
    const h = await open(groups); h.click('.changed-files-toggle'); h.document.querySelectorAll<HTMLButtonElement>('.changed-file .changed-more')[2]!.click()
    expect(menuAction(h, 'Revert change').disabled).toBe(true)
    menuAction(h, 'Open file').click(); expect(h.posts.at(-1)).toEqual({ type: 'open-file', path: 'src/webview.ts', sessionId: 'session-a', cwd: '/workspace' })
    h.click('.changed-files-head .changed-more'); expect(menuAction(h, 'Revert all').disabled).toBe(true)
    menuAction(h, 'Keep all').click(); expect(h.posts.at(-1)).toEqual({ type: 'keep-all', sessionId: 'session-a', cwd: '/workspace' })
  })
  it('keeps disclosure state per conversation and dismisses stale menus', async () => {
    const h = await open(groups); h.click('.changed-files-toggle'); h.click('.changed-file .changed-more')
    h.sendState({ sessionId: 'other', changedFiles: groups, sessions: [{ id: 'other', title: 'Other' }] }); await h.settle()
    expect(h.document.getElementById('sessionActions')!.classList.contains('hidden')).toBe(true)
    expect(h.document.querySelector('.changed-files-body')!.classList.contains('hidden')).toBe(true)
    h.sendState({ changedFiles: groups, sessions: [{ id: 'session-a', title: 'Review work' }] }); await h.settle()
    expect(h.document.querySelector('.changed-files-body')!.classList.contains('hidden')).toBe(false)
  })
  it('renders file names as text and separates directory names without losing the full path', async () => {
    const h = await open([{ turn: 0, files: [{ path: 'src/<img onerror=alert(1)>.ts', additions: 1, deletions: 0, canRevert: true }] }]); h.click('.changed-files-toggle')
    expect(h.document.querySelector('.changed-files img')).toBeNull()
    expect(h.document.querySelector('.changed-file-name')!.textContent).toBe('<img onerror=alert(1)>.ts')
    expect(h.document.querySelector('.changed-file-dir')!.textContent).toBe('src')
    expect((h.document.querySelector('.changed-file-link') as HTMLButtonElement).title).toContain('src/<img onerror=alert(1)>.ts')
  })
})
