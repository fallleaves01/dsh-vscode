import { createSecretRule } from './vendor/dsh-credential-matcher.mjs'
import { secretIcon, updateSecretIcon } from './secret-icon.mjs'

/** Official user-text credential rules and per-value reveal interaction. No state is persisted. */
export function renderUserText(text: string): HTMLDivElement {
  const root = document.createElement('div'); root.className = 'user-text'
  const rule = createSecretRule()
  let cursor = 0
  for (;;) {
    const match = rule.match(text, cursor)
    if (!match) { root.append(document.createTextNode(text.slice(cursor))); break }
    root.append(document.createTextNode(text.slice(cursor, match.start)))
    const raw = text.slice(match.start, match.end)
    const secret = document.createElement('span'); secret.className = 'secret-text'; secret.dataset.secret = ''
    const value = document.createElement('span'); value.className = 'secret-value'; value.textContent = match.data.masked
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'secret-toggle'
    const svg = secretIcon(document); toggle.append(svg)
    let revealed = false
    const update = (): void => {
      toggle.setAttribute('aria-pressed', String(revealed)); toggle.setAttribute('aria-label', revealed ? 'Hide secret' : 'Show secret')
      toggle.title = revealed ? 'Hide secret' : 'Show secret'; updateSecretIcon(svg, revealed)
      value.replaceChildren()
      if (revealed) value.textContent = raw
      else for (const part of match.data.masked.split(/(\*+)/u)) {
        if (!part) continue
        if (!part.startsWith('*')) value.append(document.createTextNode(part))
        else { const run = document.createElement('span'); run.className = 'secret-mask-run'; run.textContent = part; value.append(run) }
      }
    }
    toggle.addEventListener('click', () => { revealed = !revealed; update() }); update()
    secret.append(value, toggle); root.append(secret); cursor = match.end
  }
  return root
}
