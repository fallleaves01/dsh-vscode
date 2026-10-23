import * as vscode from 'vscode'
import type { DshChatController } from './extension.js'
import type { DshClient, DshFrame, HistoryEntry } from './dsh-client.js'
import { ConversationProjector } from './conversation.js'
import { jobsSnapshotOf } from './jobs.js'
import { JobOutputTail } from './task-features.js'
import { messageForWebview } from './chat-state-patch.js'
import { pageConversationMessage } from './tool-output-page.js'
import { wireRecord } from './dsh-streams.js'
import { taskDetailsHtml } from './task-details-html.js'
import type { TaskDetailState } from './task-details-state.js'
import { redactDshSecrets } from './runtime-output.js'

export type TaskPanelAddress = { kind: 'subagent'; sessionId: string } | { kind: 'job'; sessionId: string; jobId: string }
type TaskPanelHost = Pick<DshChatController, 'state' | 'onDidChangeState' | 'taskClient' | 'childReadOnlyReason' | 'sendToChild' | 'stopChild' | 'answerTaskRequest' | 'selectSession' | 'killJob' | 'openFile' | 'adoptTaskSnapshot' | 'resolveSubagent'>
const errorText = (value: unknown): string => redactDshSecrets(value instanceof Error ? value.message : String(value))

/** Each address gets an independent observation; opening it never selects the main chat. */
export class TaskPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; dispose: () => void }>()
  constructor(private readonly host: TaskPanelHost, private readonly extensionUri: vscode.Uri) {}
  open(address: TaskPanelAddress): void {
    this.host.taskClient()
    const projectCwd = this.host.state.cwd
    const child = [...this.host.state.sessions, ...(address.kind === 'job' ? this.host.state.archivedSessions : [])].find(item => item.id === address.sessionId)
    if (!child) throw new Error('This conversation is not in the current project.')
    if (address.kind === 'subagent' && (!child.parentId || !child.subagent)) throw new Error('This conversation is not a delegated child.')
    if (address.kind === 'subagent' && child.subagent?.mode === 'external') throw new Error('External tasks have no local conversation. View their results in the owning conversation.')
    const key = address.kind + ':' + address.sessionId + (address.kind === 'job' ? ':' + address.jobId : '')
    const existing = this.panels.get(key)
    if (existing) { existing.panel.reveal(vscode.ViewColumn.Beside, false); return }
    const title = address.kind === 'subagent' ? child.subagent?.label ?? child.title : this.host.state.projectJobs.find(job => job.id === address.jobId)?.label ?? 'Background task'
    const panel = vscode.window.createWebviewPanel('deepseekHarness.taskDetails', title, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true })
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    panel.webview.options = { enableScripts: true, localResourceRoots: [assets] }
    panel.webview.html = taskDetailsHtml(panel.webview, { script: panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'task-details.js')),
      markdown: panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'markdown.js')), style: panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'katex.min.css')) })
    let state: TaskDetailState = { kind: address.kind, title, sessionId: address.sessionId,
      ...(address.kind === 'subagent' ? { parentSessionId: child.parentId! } : { parentSessionId: address.sessionId }),
      status: 'Loading…', running: false, readOnlyReason: 'Loading task details…', meta: '', messages: [], requests: [], hasMore: false, loadingHistory: false, chunks: [], gap: false }
    let ready = false, disposed = false, timer: NodeJS.Timeout | undefined, revision = 0, boundClient: DshClient | undefined
    let cancel: (() => void) | undefined, observer: ReturnType<DshClient['observeSession']> | undefined
    let entries: HistoryEntry[] = []
    const projector = new ConversationProjector(), tail = new JobOutputTail()
    const post = (): void => {
      if (!ready || disposed || timer !== undefined) return
      timer = setTimeout(() => { timer = undefined; if (!disposed) void panel.webview.postMessage({ type: 'state', state: { ...state,
        subagents: this.host.state.cwd === projectCwd ? this.host.state.sessions : [], messages: state.messages.map(messageForWebview) } }) }, 50)
    }
    const update = (patch: Partial<TaskDetailState>): void => { state = { ...state, ...patch }; post() }
    const refreshContext = (): void => {
      const current = this.host.state.sessions.find(item => item.id === address.sessionId)
      if (address.kind === 'job') {
        const job = this.host.state.projectJobs.find(item => item.id === address.jobId)
        if (job && !(state.job && state.job.status !== 'running' && state.job.status !== 'stopping' && (job.status === 'running' || job.status === 'stopping'))) update({ job, running: job.status === 'running' || job.status === 'stopping', status: job.detail || job.status })
      } else {
        if (!current) { update({ readOnlyReason: 'This child is unavailable in the current project.', running: false }); return }
        const activity = current.activity
        const meta = [activity?.totalTokens === undefined ? '' : activity.totalTokens.toLocaleString() + ' tokens',
          activity?.elapsedMs === undefined ? '' : Math.floor((activity.elapsedMs + (activity.activeSince === undefined ? 0 : Math.max(0, (current.running ? Date.now() : activity.activeThrough ?? activity.activeSince) - activity.activeSince))) / 1000) + 's'].filter(Boolean).join(' · ')
        const status = current.attention?.approvals ? 'Needs approval' : current.attention?.questions ? 'Needs your answer' : current.running ? 'Running' : activity?.status === 'completed' ? 'Completed' : 'Idle'
        let requests: TaskDetailState['requests'] = []
        try { requests = this.host.taskClient(false).pendingRequests(address.sessionId) } catch { /* disconnected */ }
        update({ title: current.subagent?.label ?? current.title, running: current.running, status, meta, requests, readOnlyReason: this.host.childReadOnlyReason(address.sessionId) })
      }
    }
    const stopObservation = (): void => { revision++; cancel?.(); cancel = undefined; observer?.dispose(); observer = undefined }
    const start = (): void => {
      if (disposed) return
      stopObservation()
      let nextClient: DshClient
      try { nextClient = this.host.taskClient(false) } catch (error) { boundClient = undefined; update({ error: errorText(error), running: false, readOnlyReason: 'Reconnect the runtime to continue.' }); return }
      if (this.host.state.cwd !== projectCwd || ![...this.host.state.sessions, ...(address.kind === 'job' ? this.host.state.archivedSessions : [])].some(item => item.id === address.sessionId)) {
        boundClient = undefined; update({ error: 'This task is unavailable in the current project.', running: false, readOnlyReason: 'Reopen task details from its project.' }); return
      }
      boundClient = nextClient; const generation = revision
      update({ error: null, status: 'Loading…' })
      const valid = (): boolean => !disposed && generation === revision && boundClient === nextClient
      if (address.kind === 'job') {
        let terminalSeen = false
        cancel = nextClient.observeJob(address.sessionId, address.jobId, tail.next, frame => {
          if (!valid()) return
          if (frame.type === 'opened' || frame.type === 'status') {
            const job = jobsSnapshotOf([frame.job])[0]
            if (!job || job.id !== address.jobId) throw new Error('The runtime returned another background task.')
            if (frame.type === 'opened') {
              if (!Number.isSafeInteger(frame.from) || (frame.from as number) < 0) throw new Error('Invalid background output cursor.')
              tail.opened(frame.from as number)
            }
            const raw = wireRecord(frame.job) ? frame.job : {}
            if (job.status !== 'running' && job.status !== 'stopping') terminalSeen = true
            update({ job, title: job.label, status: job.detail || job.status, meta: typeof raw.progress === 'string' ? raw.progress : job.kind,
              running: job.status === 'running' || job.status === 'stopping', readOnlyReason: 'Live output preview', chunks: [...tail.chunks], gap: tail.gap, error: null })
          } else if (frame.type === 'output') {
            tail.output(frame); update({ chunks: [...tail.chunks], gap: tail.gap })
          } else throw new Error('Unknown background output frame.')
        }, error => {
          if (valid() && !terminalSeen) update({ error: 'Output observation stopped: ' + error.message + ' Refresh to retry.' })
        })
      } else {
        nextClient.watchRequests(address.sessionId)
        observer = nextClient.observeSession(address.sessionId, state.parentSessionId, (frame: DshFrame) => {
          if (!valid()) return
          const payload = frame.payload
          if (payload.type === 'session/event' && wireRecord(payload.event)) {
            const event = payload.event as unknown as HistoryEntry['event']
            entries.push({ event, view: payload.view }); projector.apply(event, payload.view); update({ messages: projector.messages() })
          } else if (payload.type === 'session/assistant-stream') {
            projector.applyStream(payload.update as Parameters<ConversationProjector['applyStream']>[0]); update({ messages: projector.messages() })
          } else if (payload.type === 'host/agent-error') update({ error: String(payload.message ?? 'Task observation failed.') })
        }, error => { if (valid()) update({ error: 'Task observation stopped: ' + error.message, readOnlyReason: 'Refresh task details to reconnect.' }) })
        const opening = observer.opening
        void opening.then(snapshot => {
          if (!valid() || !snapshot.isCurrent()) return
          if (typeof snapshot.asOfSeq === 'number') this.host.adoptTaskSnapshot(address.sessionId, snapshot.asOfSeq, snapshot.projections)
          entries = snapshot.events; projector.reset(entries)
          update({ messages: projector.messages(), hasMore: snapshot.hasMore, loadingHistory: false, error: null })
          refreshContext(); snapshot.activate()
        }).catch(error => { if (valid()) update({ error: errorText(error), readOnlyReason: 'Refresh task details to reconnect.' }) })
      }
      refreshContext()
    }
    const stateSubscription = this.host.onDidChangeState(next => {
      if (disposed) return
      if (next.cwd !== projectCwd) {
        stopObservation(); boundClient = undefined
        update({ error: 'The project changed. Reopen task details from that project.', running: false, readOnlyReason: 'Return to the original project to continue.' }); return
      }
      let current: DshClient
      try { current = this.host.taskClient(false) } catch {
        stopObservation(); boundClient = undefined
        update({ error: 'Runtime disconnected. Reconnect in the main chat.', running: false, readOnlyReason: 'Reconnect the runtime to continue.' }); return
      }
      if (boundClient !== current) start()
      else refreshContext()
    })
    const receive = panel.webview.onDidReceiveMessage(value => {
      if (!wireRecord(value) || typeof value.type !== 'string' || disposed) return
      void (async () => {
        switch (value.type) {
          case 'ready': ready = true; post(); return
          case 'refresh': start(); return
          case 'open-subagent': {
            if (value.parentSessionId !== address.sessionId || typeof value.sessionId !== 'string' || typeof value.requestId !== 'string') return
            const reply = { type: 'open-subagent-result', requestId: value.requestId, parentSessionId: address.sessionId }
            try {
              if (this.host.state.cwd !== projectCwd || this.host.taskClient(false) !== boundClient) throw new Error('The task connection changed. Refresh task details before opening its children.')
              const client = boundClient, target = await this.host.resolveSubagent(address.sessionId, value.sessionId)
              if (disposed || this.host.state.cwd !== projectCwd || this.host.taskClient(false) !== client) throw new Error('The task connection changed while opening its child.')
              if (value.placement === 'beside' && target.subagent) this.open({ kind: 'subagent', sessionId: target.id })
              else { await this.host.selectSession(target.id); await vscode.commands.executeCommand('deepseekHarness.openChat') }
              await panel.webview.postMessage(reply)
            } catch (error) { await panel.webview.postMessage({ ...reply, error: errorText(error) }) }
            return
          }
          case 'open-chat': {
            if (value.sessionId !== address.sessionId && value.sessionId !== state.parentSessionId) throw new Error('Invalid conversation target.')
            await this.host.selectSession(String(value.sessionId)); await vscode.commands.executeCommand('deepseekHarness.openChat'); return
          }
          case 'stop':
            if (address.kind === 'job') {
              const confirmation = await vscode.window.showWarningMessage('Stop this background task?', { modal: true }, 'Stop')
              if (confirmation === 'Stop') await this.host.killJob(address.sessionId, address.jobId)
            } else await this.host.stopChild(address.sessionId)
            return
          case 'copy': await vscode.env.clipboard.writeText(tail.chunks.map(chunk => chunk.text).join('')); return
          case 'body': {
            if (typeof value.messageId !== 'string' || typeof value.requestId !== 'string') return
            const message = projector.messages().find(item => item.id === value.messageId)
            await panel.webview.postMessage({ type: 'body', messageId: value.messageId, requestId: value.requestId,
              ...(message ? { page: pageConversationMessage(message, typeof value.cursor === 'string' ? value.cursor : undefined) } : { error: 'This message is no longer available.' }) }); return
          }
          case 'open-link':
            if (typeof value.href === 'string' && /^https?:\/\//i.test(value.href)) await vscode.env.openExternal(vscode.Uri.parse(value.href))
            return
          case 'open-file':
            if (this.host.state.cwd !== projectCwd) throw new Error('Return to the original project before opening its files.')
            if (typeof value.path === 'string') await this.host.openFile(value.path, Number.isSafeInteger(value.line) && (value.line as number) > 0 ? value.line as number : undefined)
            return
          case 'send':
            if (address.kind !== 'subagent' || typeof value.text !== 'string' || typeof value.requestId !== 'string') return
            try { await this.host.sendToChild(address.sessionId, value.text, value.mode === 'steer' ? 'steer' : 'queue'); await panel.webview.postMessage({ type: 'sent', requestId: value.requestId }) }
            catch (error) { update({ error: errorText(error) }); await panel.webview.postMessage({ type: 'send-failed', requestId: value.requestId }) }
            return
          case 'answer':
            if (address.kind === 'subagent' && typeof value.rpcId === 'string') await this.host.answerTaskRequest(address.sessionId, value.rpcId, value)
            refreshContext(); return
          case 'history': {
            if (!observer || !state.hasMore || state.loadingHistory) return
            const active = observer, generation = revision, before = entries[0]?.event.seq
            if (before === undefined) return
            update({ loadingHistory: true })
            try {
              const page = await active.page(before)
              if (disposed || observer !== active || generation !== revision) return
              const merged = new Map([...page.events, ...entries].map(entry => [entry.event.seq, entry]))
              entries = [...merged.values()].sort((a, b) => a.event.seq - b.event.seq); projector.reset(entries, true)
              update({ messages: projector.messages(), hasMore: page.hasMore, loadingHistory: false })
            } catch (error) { if (!disposed && observer === active) update({ error: errorText(error), loadingHistory: false }) }
            return
          }
        }
      })().catch(error => update({ error: errorText(error) }))
    })
    const dispose = (): void => { if (disposed) return; disposed = true; stopObservation(); if (timer !== undefined) clearTimeout(timer); receive.dispose(); stateSubscription.dispose(); this.panels.delete(key) }
    panel.onDidDispose(dispose); this.panels.set(key, { panel, dispose }); start()
  }
  dispose(): void { for (const entry of [...this.panels.values()]) { entry.dispose(); entry.panel.dispose() } }
}
