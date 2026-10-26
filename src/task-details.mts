import type { ConversationMessage } from './conversation.js'
import type { ToolOutputPage } from './tool-output-page.js'
import type { MarkdownHooks } from './markdown.mjs'
import type { TaskDetailState } from './task-details-state.js'
import { createSubagentLinks, type SubagentLinkView } from './subagent-links.mjs'
import type { SubagentToolReference } from './subagent-tools.js'
interface TaskApi { postMessage(value: Record<string, unknown>): void }
declare const acquireVsCodeApi: () => TaskApi
declare global { interface Window { dshMarkdown: { renderMarkdown(text: string, hooks?: MarkdownHooks): HTMLElement; renderUserText?(text: string): HTMLElement } } }
const str = (value: unknown): string => typeof value === 'string' ? value : ''

/** DSH's Auto review denial facts attached to a tool message, if any. */
interface AutoReviewDenial { reason: string | null }
const AUTO_REVIEW_REJECTED = 'Rejected by Auto review'
const AUTO_REVIEW_REASON_FALLBACK = 'Auto review did not authorize this action'
/**
 * Read the durable denial without depending on a host type export.
 *
 * The projection owns the field; this surface renders it defensively so a
 * missing or malformed value falls back to the ordinary tool row.
 */
const autoReviewDenialOf = (message: ConversationMessage): AutoReviewDenial | undefined => {
  const value = (message as unknown as { autoReviewDenied?: unknown }).autoReviewDenied
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const reason = (value as Record<string, unknown>).reason
  return { reason: typeof reason === 'string' ? reason : null }
}
/** One display line, exactly as DSH normalizes it: no markup, no line breaks. */
const autoReviewReasonText = (reason: string | null): string => {
  if (reason === null) return AUTO_REVIEW_REASON_FALLBACK
  const normalized = reason.trim().replace(/[\r\n\u2028\u2029]+/gu, ' ')
  return normalized === '' ? AUTO_REVIEW_REASON_FALLBACK : normalized
}

/** The same mounted UI is used by production and DOM regression tests. */
export function mountTaskDetails(api: TaskApi = acquireVsCodeApi()): () => void {
  const listeners = new AbortController()
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
  const scroll = element('scroll'), messages = element('messages'), requests = element('requests')
  const draft = element<HTMLTextAreaElement>('draft'), send = element<HTMLButtonElement>('send'), delivery = element<HTMLSelectElement>('delivery')
  let state: TaskDetailState | undefined; let sending: { id: string; text: string } | undefined; let serial = 0; let requestKey = ''
  const rows = new Map<string, { row: HTMLElement; key: string }>()
  const bodies = new Map<string, { revision: string | undefined; pages: ConversationMessage[]; cursor?: string; pending?: string }>()
  const subagentLinks = new Map<string, SubagentLinkView>()
  let subagentTimer: ReturnType<typeof setInterval> | undefined
  const syncLinks = (): void => {
    let running = false
    for (const [id, view] of subagentLinks) {
      if (!view.root.isConnected) { view.dispose(); subagentLinks.delete(id); continue }
      view.update(state?.subagents ?? []); running ||= view.running()
    }
    if (running && subagentTimer === undefined) subagentTimer = setInterval(syncLinks, 1000)
    if (!running && subagentTimer !== undefined) { clearInterval(subagentTimer); subagentTimer = undefined }
  }
  const node = (tag: string, text = '', className = ''): HTMLElement => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value }
  const post = (value: Record<string, unknown>): void => api.postMessage(value)
  const action = (text: string, run: () => void): HTMLButtonElement => { const button = node('button', text) as HTMLButtonElement; button.type = 'button'; button.addEventListener('click', run, { signal: listeners.signal }); return button }
  const markdown = (text: string): HTMLElement => window.dshMarkdown.renderMarkdown(text, {
    appendFileText: (parent, value) => parent.append(document.createTextNode(value)),
    inlineCode: value => node('code', value),
    link: (href, label) => action(label || href, () => post({ type: 'open-link', href })),
    fileLink: (path, line) => action(path, () => post({ type: 'open-file', path, ...(line === undefined ? {} : { line }) })),
  })
  const renderRequests = (): void => {
    const key = JSON.stringify(state?.requests ?? [])
    if (key === requestKey) return
    requestKey = key; requests.replaceChildren()
    for (const pending of state?.requests ?? []) {
      const card = node('section', '', 'request'); const req = pending.request
      if (pending.event === 'approval/request') {
        card.append(node('strong', 'Approval needed'), node('pre', str(req.description) || str(req.message) || JSON.stringify(req, null, 2)))
        const actions = node('div', '', 'actions')
        for (const [label, outcome] of [['Allow once', 'allowed-once'], ['Reject', 'rejected']]) actions.append(action(label!, () => post({ type: 'answer', rpcId: pending.rpcId, outcome })))
        card.append(actions)
      } else {
        card.append(node('strong', 'Questions need your answer'))
        const fields: Array<{ id: string; area: HTMLTextAreaElement; options: HTMLInputElement[] }> = []
        for (const raw of Array.isArray(req.questions) ? req.questions : []) {
          if (typeof raw !== 'object' || raw === null) continue
          const question = raw as Record<string, unknown>; const id = str(question.id)
          const field = node('div', '', 'question'); field.append(node('label', str(question.question)))
          const options: HTMLInputElement[] = []
          for (const rawOption of Array.isArray(question.options) ? question.options : []) {
            if (typeof rawOption !== 'object' || rawOption === null) continue
            const label = str((rawOption as Record<string, unknown>).label)
            const input = document.createElement('input'); input.type = question.multiSelect === true ? 'checkbox' : 'radio'; input.name = pending.rpcId + ':' + id; input.value = label
            const option = node('label', '', 'option'); option.append(input, document.createTextNode(' ' + label)); field.append(option); options.push(input)
          }
          const area = document.createElement('textarea'); area.placeholder = 'Your answer'; area.setAttribute('aria-label', str(question.question)); field.append(area)
          fields.push({ id, area, options }); card.append(field)
        }
        card.append(action('Submit answers', () => post({ type: 'answer', rpcId: pending.rpcId, answers: fields.map(field => ({ id: field.id,
          selected: field.options.filter(option => option.checked).map(option => option.value), ...(field.area.value.trim() ? { custom: field.area.value.trim() } : {}) })) })))
      }
      requests.append(card)
    }
  }
  /** DSH's own failure copy: the runtime code picks the title and the reason. */
  const failureTitleOf = (message: ConversationMessage): string => {
    const code = message.failureCode ?? ''
    return code === 'ACCOUNT_SIGNED_OUT' || code === 'INTERRUPTED' ? 'Task stopped' : 'This turn failed'
  }
  /** DSH's per-code failure copy, shared by turn failures and retry rows. */
  const failureReasonForCode = (code: string, detail: string): string => {
    if (code === 'AUTH') return 'API key is invalid'
    if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return 'Request quota exhausted.'
    if (code === 'ACCOUNT_SIGNED_OUT') return 'Stopped because you signed out of DeepSeek.'
    if (code === 'ACCOUNT_SIGN_IN_REQUIRED') return 'Sign in to DeepSeek and ensure the request destination supports account authentication.'
    if (code === 'INTERRUPTED') return 'The DSH process exited before this turn finished (for example, it was killed, crashed, or timed out while shutting down), so the turn was closed when DSH restarted. Unfinished tool calls have unknown outcomes.'
    return detail
  }
  const failureReasonOf = (message: ConversationMessage): string => {
    const code = message.failureCode ?? ''
    return failureReasonForCode(code, message.detail || 'Error details are not available in the loaded history.')
  }
  /** The runtime code shown beside the reason; `INTERRUPTED` has no chip. */
  const failureCodeOf = (message: ConversationMessage): string => {
    const code = message.failureCode ?? ''
    return code === '' || code === 'INTERRUPTED' ? '' : code
  }
  const retrySeconds = (delayMs: number): number => Math.max(1, Math.ceil((Number.isFinite(delayMs) ? delayMs : 0) / 1000))
  const retryLabelOf = (state: string): string => state === 'started' ? 'Retried model request'
    : state === 'cancelled' ? 'Model request retry cancelled'
      // DSH renders the scheduled state through its active branch.
      : 'Retrying model request'
  /** One collapsible process row per retry chain, showing its newest attempt. */
  const renderRetryRow = (message: ConversationMessage): HTMLElement => {
    const retry = message.retry
    const row = node('details', '', 'retry-row') as HTMLDetailsElement
    if (retry === undefined) return row
    if (retry.state === 'scheduled') row.setAttribute('data-active', '')
    row.setAttribute('data-state', retry.state)
    const summary = node('summary', '', 'retry-summary')
    const maximum = retry.mode === 'normal' ? String(retry.maxRetries) : '∞'
    const text = node('span', retryLabelOf(retry.state) + ' (' + String(retry.retry) + '/' + maximum + ') · ' + String(retrySeconds(retry.delayMs)) + 's', 'retry-text')
    text.setAttribute('role', 'status')
    summary.append(text); row.append(summary)
    const details = node('div', '', 'retry-details')
    const delay = node('div')
    delay.append(node('span', 'Retry delay: ', 'retry-detail-label'), document.createTextNode(String(Math.round(retry.delayMs)) + 'ms'))
    const failure = node('div')
    failure.append(node('span', 'Failure reason: ', 'retry-detail-label'),
      document.createTextNode(failureReasonForCode(retry.failureCode ?? '', retry.detail || 'Error details are not available in the loaded history.')))
    details.append(delay, failure); row.append(details)
    return row
  }
  const renderLimitRow = (): HTMLElement => {
    const row = node('div', '', 'turn-limit'); row.setAttribute('role', 'status')
    row.append(node('span', '', 'turn-limit-dot'))
    const copy = node('div', '', 'turn-limit-copy')
    copy.append(node('span', 'Output token limit reached', 'turn-limit-title'),
      node('span', 'The reply was cut off; earlier output is preserved in the conversation. Send "continue" to let the model resume.', 'turn-limit-text'))
    row.append(copy)
    return row
  }
  const render = (): void => {
    if (!state) return
    const follow = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 32
    const top = scroll.scrollTop, height = scroll.scrollHeight, first = messages.firstElementChild?.getAttribute('data-message-id')
    element('title').textContent = state.title; element('meta').textContent = state.meta
    element('kind').textContent = state.kind === 'job' ? 'Background job' : 'Subagent'
    const status = element('status'); status.textContent = state.status
    status.dataset.state = /^Needs /i.test(state.status) ? 'waiting' : /^Completed$/i.test(state.status) ? 'completed' : state.running ? 'running' : 'idle'
    element('notice').textContent = state.error ?? ''
    element('owner').classList.toggle('hidden', !state.parentSessionId); element('inChat').classList.toggle('hidden', state.kind === 'job')
    element<HTMLButtonElement>('stop').disabled = !state.running
    element('copy').classList.toggle('hidden', state.kind !== 'job')
    const history = element<HTMLButtonElement>('history'); history.classList.toggle('hidden', state.kind !== 'subagent' || !state.hasMore); history.disabled = state.loadingHistory; history.textContent = state.loadingHistory ? 'Loading…' : 'Load earlier messages'
    element('readOnly').textContent = state.readOnlyReason ?? ''
    element('composer').classList.toggle('hidden', state.kind !== 'subagent')
    draft.disabled = state.readOnlyReason !== null; send.disabled = draft.disabled || Boolean(sending); delivery.disabled = send.disabled
    renderRequests()
    const keep = new Set<string>()
    for (const message of state.messages) {
      keep.add(message.id)
      let body = bodies.get(message.id)
      if (body && body.revision !== message.deferredBodyRevision) { bodies.delete(message.id); body = undefined }
      let cached = rows.get(message.id)
      if (!cached) { cached = { row: node('article', '', 'message'), key: '' }; cached.row.dataset.messageId = message.id; rows.set(message.id, cached) }
      cached.row.dataset.role = message.role
      const key = JSON.stringify([message, body])
      if (cached.key !== key) {
        cached.key = key
        if (message.role === 'retry' || message.role === 'limit') {
          cached.row.replaceChildren(message.role === 'retry' ? renderRetryRow(message) : renderLimitRow())
          messages.append(cached.row)
          continue
        }
        const thinkingOpen = cached.row.querySelector('details')?.open ?? false
        const denial = autoReviewDenialOf(message)
        const label = (message.role === 'assistant' ? undefined : (denial !== undefined ? AUTO_REVIEW_REJECTED : message.detail))
          || ({ user: 'You', assistant: 'DeepSeek', tool: 'Tool', command: 'Command' } as Record<string, string>)[message.role] || message.role
        cached.key = key; cached.row.replaceChildren(node('div', label, 'role'))
        subagentLinks.get(message.id)?.dispose(); subagentLinks.delete(message.id)
        const references = new Map<string, SubagentToolReference>()
        for (const raw of [message.resultView, message.callView]) {
          const view = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined
          if (Array.isArray(view?.subagentLinks)) for (const item of view.subagentLinks) {
            if (item && typeof item.id === 'string') references.set(item.id, {id:item.id,...(typeof item.label === 'string'?{label:item.label}:{})})
          }
        }
        if (references.size && state) {
          const view = createSubagentLinks([...references.values()], state.sessionId, post)
          cached.row.append(view.root); subagentLinks.set(message.id, view)
        }
        const append = (item: ConversationMessage): void => {
          if (item.reasoning) { const thinking = node('details', '', 'thinking') as HTMLDetailsElement; thinking.open = thinkingOpen; thinking.append(node('summary', 'Thinking'), markdown(item.reasoning)); cached!.row.append(thinking) }
          if (item.text) cached!.row.append(item.role === 'user'
            ? window.dshMarkdown.renderUserText?.(item.text) ?? node('div', 'Message renderer unavailable.')
            : markdown(item.text))
          if (item.role === 'tool' || item.role === 'command') {
            // DSH reports the reviewer's refusal instead of the tool's own error
            // text: the body still exists only to say the tool never executed.
            const itemDenial = autoReviewDenialOf(item)
            if (itemDenial !== undefined) {
              cached!.row.append(node('pre', 'Tool was not executed. Reason: ' + autoReviewReasonText(itemDenial.reason), 'auto-review-body'))
            } else {
              const view = (item.resultView === undefined ? item.callView : item.resultView) as Record<string, unknown> | undefined
              const presented = Array.isArray(view?.content) ? view.content.flatMap(part => typeof part?.text === 'string' ? [part.text] : []).join('\n') : ''
              const content = item.rawResult ?? (presented || item.rawInput) ?? view
              if (content !== undefined) cached!.row.append(node('pre', typeof content === 'string' ? content : JSON.stringify(content, null, 2)))
            }
          }
          for (const image of item.images ?? []) cached!.row.append(node('div', image.error || 'Image attachment · Open in chat to view', 'hint'))
        }
        if (!message.deferredBody) append(message)
        else {
          for (const page of body?.pages ?? []) append(page)
          if (!body || body.pending || body.cursor !== undefined) {
            const button = action(body?.pending ? 'Loading…' : body?.pages.length ? 'Load more output' : 'Show full message', () => {
              const entry = bodies.get(message.id) ?? { revision: message.deferredBodyRevision, pages: [] }
              if (entry.pending) return
              entry.pending = String(++serial); bodies.set(message.id, entry)
              post({ type: 'body', requestId: entry.pending, messageId: message.id, cursor: entry.cursor }); render()
            })
            button.disabled = Boolean(body?.pending); cached.row.append(button)
          }
        }
        if (message.role === 'assistant' && message.failed === true) {
          const failure = node('div', '', 'assistant-failure'); failure.setAttribute('role', 'status')
          failure.append(node('div', failureTitleOf(message), 'assistant-failure-title'))
          const line = node('div', '', 'assistant-failure-line')
          line.append(node('div', failureReasonOf(message), 'assistant-failure-detail'))
          const code = failureCodeOf(message)
          if (code !== '') line.append(node('code', code, 'assistant-failure-code'))
          failure.append(line)
          cached.row.append(failure)
        }
      }
      messages.append(cached.row)
    }
    for (const [id, cached] of rows) if (!keep.has(id)) { cached.row.remove(); rows.delete(id); bodies.delete(id) }
    const output = element('output'); output.replaceChildren()
    for (const chunk of state.chunks) output.append(node('span', chunk.text, chunk.channel ?? 'stdout'))
    element('detailEmpty').classList.toggle('hidden', state.messages.length > 0 || state.chunks.length > 0 || state.requests.length > 0)
    element('detailEmpty').textContent = state.running ? 'Waiting for task activity…' : 'No activity recorded for this task.'
    element('gap').classList.toggle('hidden', !state.gap)
    if (follow) scroll.scrollTop = scroll.scrollHeight
    else scroll.scrollTop = top + (first && first !== messages.firstElementChild?.getAttribute('data-message-id') ? scroll.scrollHeight - height : 0)
    element('latest').classList.toggle('hidden', scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 32)
  }
  const submit = (event?: Event): void => {
    event?.preventDefault()
    if (!state || state.kind !== 'subagent' || state.readOnlyReason !== null || sending || !draft.value.trim()) return
    sending = { id: String(++serial), text: draft.value }; send.disabled = true; delivery.disabled = true
    post({ type: 'send', requestId: sending.id, text: sending.text, mode: delivery.value })
  }
  const options = { signal: listeners.signal }
  const form = element('composer'); form.addEventListener('submit', submit, options)
  draft.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) submit(event) }, options)
  element('owner').addEventListener('click', () => post({ type: 'open-chat', sessionId: state?.parentSessionId }), options)
  element('inChat').addEventListener('click', () => post({ type: 'open-chat', sessionId: state?.sessionId }), options)
  element('stop').addEventListener('click', () => post({ type: 'stop' }), options)
  element('retry').addEventListener('click', () => post({ type: 'refresh' }), options)
  element('copy').addEventListener('click', () => post({ type: 'copy' }), options)
  element('history').addEventListener('click', () => post({ type: 'history' }), options)
  element('latest').addEventListener('click', () => { scroll.scrollTop = scroll.scrollHeight; element('latest').classList.add('hidden') }, options)
  scroll.addEventListener('scroll', () => element('latest').classList.toggle('hidden', scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 32), options)
  const receive = (event: MessageEvent): void => {
    const value = event.data
    if (value?.type === 'state') { state = value.state; render(); syncLinks() }
    if (value?.type === 'open-subagent-result') for (const view of subagentLinks.values()) view.reply(value)
    if (value?.type === 'body') {
      const body = bodies.get(value.messageId)
      if (body && typeof value.requestId === 'string' && body.pending === value.requestId) {
        delete body!.pending
        if (value.error) bodies.delete(value.messageId)
        else {
          const page = value.page as ToolOutputPage
          body!.pages.push(page.message); delete body!.cursor
          if (page.nextCursor !== undefined) body!.cursor = page.nextCursor
        }
        render()
        if (value.error) element('notice').textContent = str(value.error)
      }
    }
    if ((value?.type === 'sent' || value?.type === 'send-failed') && sending && sending.id === value.requestId) {
      if (value.type === 'sent' && draft.value === sending.text) draft.value = ''
      sending = undefined; render()
    }
  }
  window.addEventListener('message', receive, { signal: listeners.signal }); post({ type: 'ready' })
  return () => { listeners.abort(); if(subagentTimer!==undefined)clearInterval(subagentTimer);for(const view of subagentLinks.values())view.dispose();subagentLinks.clear();rows.clear();bodies.clear() }
}
if (typeof acquireVsCodeApi === 'function') mountTaskDetails()
