// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
import { searchPageState } from './settings-page.fixture.js'
let h: Harness
afterEach(() => {
  h?.document.querySelector<HTMLButtonElement>('#settingsClose')?.click()
  h?.dispose(); document.body.replaceChildren()
})
function open(id = 'settings-a') {
  h.document.getElementById('openSettings')!.focus(); h.click('#openSettings')
  h.send({ type: 'settings-open', settingsId: id })
  h.send({ type: 'settings-message', settingsId: id, message: { type: 'state', state: searchPageState() } })
}
describe('DSH settings modal in chat', () => {
  it('opens within chat and addresses its reads independently of chat state', () => {
    h = harness(); open()
    expect(h.document.querySelector('.settings-overlay [role="dialog"]')).not.toBeNull()
    expect(h.document.getElementById('app')!.inert).toBe(true)
    expect(h.document.getElementById('openSettings')!.getAttribute('aria-expanded')).toBe('true')
    expect(h.posts).toContainEqual({ type: 'settings-message', settingsId: 'settings-a', message: { type: 'ready' } })
    expect((h.document.activeElement as HTMLElement).dataset.section).toBe('general')
    h.sendState({ sessionId: 'other-chat' })
    expect(h.document.querySelector('.settings-overlay')).not.toBeNull()
  })
  it('closes with Escape, restores the trigger focus, and leaves the chat draft intact', () => {
    h = harness(); const draft = h.document.getElementById('prompt') as HTMLTextAreaElement; draft.value = 'Keep this draft'; open()
    h.document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(h.document.querySelector('.settings-overlay')).toBeNull(); expect(h.document.getElementById('app')!.inert).toBe(false)
    expect(h.document.activeElement!.id).toBe('openSettings'); expect(draft.value).toBe('Keep this draft')
    expect(h.posts.at(-1)).toEqual({ type: 'settings-message', settingsId: 'settings-a', message: { type: 'close' } })
  })
  it('discards a closed secret draft and ignores delayed messages from that opening', () => {
    h = harness(); open()
    h.document.querySelector<HTMLButtonElement>('[data-section="models"]')!.click(); h.document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    const key = h.document.querySelector<HTMLInputElement>('[data-focus-key="api-key"]')!; key.value = 'synthetic-key'; key.dispatchEvent(new Event('input'))
    h.click('#settingsClose'); h.send({ type: 'settings-open', settingsId: 'settings-a' }); expect(h.document.querySelector('.settings-overlay')).toBeNull()
    open('settings-b'); h.send({ type: 'settings-message', settingsId: 'settings-a', message: { type: 'state', state: { ...searchPageState(), error: 'Stale error' } } })
    expect(h.document.body.textContent).not.toContain('Stale error'); expect(h.document.body.innerHTML).not.toContain('synthetic-key')
  })
  it('uses the mask as a close action and bounds Tab traversal to the dialog', () => {
    h = harness(); open()
    const controls = h.document.querySelectorAll<HTMLButtonElement>('#settingsRoot button'), first = controls[0]!, last = controls[controls.length - 1]!
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); expect(h.document.activeElement).toBe(first)
    h.click('.settings-overlay'); expect(h.document.querySelector('.settings-overlay')).toBeNull()
  })
})
