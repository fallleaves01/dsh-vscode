import type { SessionItem } from './session-center.js'
import type { SubagentToolReference } from './subagent-tools.js'

export interface SubagentLinkView {
  root: HTMLElement
  update(sessions: readonly SessionItem[]): void
  reply(value: Record<string, unknown>): void
  running(): boolean
  dispose(): void
}
const indexes = new WeakMap<readonly SessionItem[], Map<string, SessionItem>>()
let requestSerial = 0
function indexOf(items: readonly SessionItem[]): Map<string, SessionItem> {
  let index = indexes.get(items)
  if (!index) {
    index = new Map(items.map(item => [item.id, item]))
    for (const item of items) if (item.parentId && item.subagent?.mode === 'external' && item.subagent.executionId) index.set(JSON.stringify([item.parentId, item.subagent.executionId]), item)
    indexes.set(items, index)
  }
  return index
}

/** Names navigate, trailing arrows open alongside; neither action submits a prompt. */
export function createSubagentLinks(references: readonly SubagentToolReference[], parentSessionId: string,
  postMessage: (message: Record<string, unknown>) => void): SubagentLinkView {
  const root = document.createElement('div'); root.className = 'subagent-tool-links'
  let current = new Map<string, SessionItem>(), source: readonly SessionItem[] | undefined, disposed = false, running = false, second = 0
  const rows = references.slice(0, 100).map(reference => {
    const row = document.createElement('div'); row.className = 'subagent-tool-row'; row.dataset.subagentId = reference.id
    const main = document.createElement('button'); main.type = 'button'; main.className = 'subagent-tool-main'
    const glyph = document.createElement('span'); glyph.className = 'subagent-tool-glyph'; glyph.setAttribute('aria-hidden', 'true')
    const copy = document.createElement('span'); copy.className = 'subagent-tool-copy'
    const title = document.createElement('span'); title.className = 'subagent-tool-name'
    const meta = document.createElement('span'); meta.className = 'subagent-tool-meta'
    const metrics = document.createElement('span'); metrics.className = 'subagent-tool-metrics'
    const usage = document.createElement('span'); usage.className = 'subagent-tool-usage'
    const duration = document.createElement('span'); duration.className = 'subagent-tool-duration'
    metrics.append(usage, duration)
    const aside = document.createElement('button'); aside.type = 'button'; aside.className = 'subagent-tool-aside'
    aside.title = 'Open subagent details beside this chat'; aside.setAttribute('aria-label', aside.title)
    aside.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11v11M19 5 5 19"/></svg>'
    const error = document.createElement('span'); error.className = 'subagent-tool-error'; error.setAttribute('role', 'status')
    copy.append(title, meta); main.append(glyph, copy, metrics); row.append(main, aside, error); root.append(row)
    let pending: string | undefined, timer: ReturnType<typeof setTimeout> | undefined, failure = '', previous = ''
    const target = (): SessionItem | undefined => current.get(reference.id) ?? current.get(JSON.stringify([parentSessionId, reference.id]))
    const render = (): void => {
      const item = target(), external = item?.subagent?.mode === 'external'
      const label = item?.subagent?.label || reference.label || item?.title || reference.id
      const status = external ? 'External task' : pending ? 'Opening…' : item?.attention?.approvals ? 'Needs approval' : item?.attention?.questions ? 'Needs your answer'
        : item?.running ? 'Running' : item?.activity?.status === 'completed' ? 'Completed' : item?.catalogOnly || !item ? 'Open conversation' : 'Idle'
      const description = [status]
      if (!external && item?.subagent) description.push(item.subagent.mode === 'continuable' ? 'Continuable' : item.subagent.mode === 'one-shot' ? 'Read-only' : 'Unknown mode')
      let usageText = '', durationText = ''
      const total = item?.activity?.totalTokens
      if (!external && typeof total === 'number' && Number.isFinite(total) && total >= 0) {
        usageText = (total >= 1_000_000 ? Number((total / 1_000_000).toFixed(1)) + 'M' : total >= 1000 ? Number((total / 1000).toFixed(1)) + 'K' : String(total)) + ' tok'
      }
      const activity = item?.activity
      if (!external && typeof activity?.elapsedMs === 'number') {
        const end = item?.running ? Date.now() : activity.activeThrough ?? activity.activeSince
        const ms = activity.elapsedMs + (typeof activity.activeSince === 'number' && typeof end === 'number' ? Math.max(0, end - activity.activeSince) : 0)
        const seconds = Math.max(0, Math.floor(ms / 1000)); durationText = seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's'
      }
      const detail = description.join(' · '), signature = JSON.stringify([label, detail, usageText, durationText, failure, external, pending !== undefined])
      if (signature === previous) return
      previous = signature; title.textContent = label
      main.title = external ? 'External tasks have no local conversation' : 'Open conversation: ' + label
      main.setAttribute('aria-label', main.title + (external ? '' : ', ' + detail)); aside.setAttribute('aria-label', 'Open details beside this chat: ' + label)
      main.disabled = external || pending !== undefined; aside.disabled = pending !== undefined; aside.hidden = external
      row.setAttribute('aria-busy', String(pending !== undefined))
      row.dataset.activity = external ? 'external' : item?.attention?.approvals || item?.attention?.questions ? 'waiting' : item?.running ? 'running' : item?.activity?.status ?? 'idle'
      meta.textContent = detail; error.textContent = failure
      usage.textContent = usageText; usage.title = typeof total === 'number' ? total.toLocaleString() + ' tokens' : ''
      duration.textContent = durationText; metrics.hidden = !usageText && !durationText
    }
    const navigate = (placement: 'chat' | 'beside'): void => {
      if (disposed || pending !== undefined || target()?.subagent?.mode === 'external') return
      failure = ''; pending = 'subagent-open-' + Date.now().toString(36) + '-' + (++requestSerial)
      timer = setTimeout(() => { pending = undefined; failure = 'Opening timed out. Retry to reconnect to this conversation.'; render() }, 45_000)
      render()
      postMessage({ type: 'open-subagent', parentSessionId, sessionId: reference.id, placement, requestId: pending })
    }
    main.addEventListener('click', () => { navigate('chat') }); aside.addEventListener('click', () => { navigate('beside') })
    render()
    return { render, item: target, reply(value: Record<string, unknown>): void {
      if (!pending || value.requestId !== pending || value.parentSessionId !== parentSessionId) return
      if (timer !== undefined) clearTimeout(timer); pending = undefined
      failure = typeof value.error === 'string' ? value.error : ''; render()
    }, dispose(): void { if (timer !== undefined) clearTimeout(timer); pending = undefined } }
  })
  return { root,
    update(sessions) {
      const now = Math.floor(Date.now() / 1000)
      if (source === sessions && (!running || now === second)) return
      source = sessions; second = now; current = indexOf(sessions); running = rows.some(row => row.item()?.running === true)
      for (const row of rows) row.render()
    },
    reply(value) { if (!disposed) for (const row of rows) row.reply(value) },
    running: () => running,
    dispose() { disposed = true; for (const row of rows) row.dispose() },
  }
}
