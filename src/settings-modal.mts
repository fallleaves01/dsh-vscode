import { mountSettingsPage } from './settings-page.mjs'
import { settingsShellHtml } from './settings-ui.js'

/** Each opening has its own message address; closed drafts and late replies are discarded. */
export function createSettingsModal(document: Document, api: { postMessage(value: unknown): void }): { dispose(): void } {
  const window = document.defaultView!, background = document.getElementById('app')
  let current: { id: string; overlay: HTMLElement; page: ReturnType<typeof mountSettingsPage>; focus: HTMLElement | null; inert: boolean } | undefined
  const closed = new Set<string>()
  const close = (notify: boolean): void => {
    if (!current) return
    const { id, overlay, page, focus, inert } = current; current = undefined
    closed.add(id); if (closed.size > 16) closed.delete(closed.values().next().value!)
    page.dispose(); overlay.remove(); if (background) background.inert = inert
    const trigger = document.getElementById('openSettings'); trigger?.setAttribute('aria-expanded', 'false'); trigger?.removeAttribute('aria-busy')
    if (notify) api.postMessage({ type: 'settings-message', settingsId: id, message: { type: 'close' } })
    if (focus?.isConnected) focus.focus({ preventScroll: true })
  }
  const receive = (event: MessageEvent): void => {
    const value = event.data
    if (value?.type === 'settings-open' && typeof value.settingsId === 'string') {
      if (closed.has(value.settingsId)) return
      if (current?.id === value.settingsId) return
      close(false)
      const focus = document.activeElement === document.body ? document.getElementById('openSettings') : document.activeElement as HTMLElement | null, inert = background?.inert === true
      const overlay = document.createElement('div'); overlay.className = 'settings-overlay'; overlay.innerHTML = settingsShellHtml(); document.body.append(overlay)
      const root = overlay.querySelector<HTMLElement>('#settingsRoot')!
      if (background) background.inert = true
      const id: string = value.settingsId
      const page = mountSettingsPage(document, { postMessage: message => api.postMessage({ type: 'settings-message', settingsId: id, message }) }, { root, externalMessages: true, onClose: () => close(true) })
      current = { id, overlay, page, focus, inert }
      overlay.addEventListener('click', event => { if (event.target === overlay) close(true) })
      document.getElementById('openSettings')?.setAttribute('aria-expanded', 'true'); document.getElementById('openSettings')?.removeAttribute('aria-busy')
      root.focus({ preventScroll: true })
    } else if (value?.type === 'settings-message' && current?.id === value.settingsId) current?.page.receive(value.message)
  }
  window.addEventListener('message', receive)
  return { dispose(): void { window.removeEventListener('message', receive); close(false); closed.clear() } }
}
