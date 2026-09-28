// @vitest-environment jsdom
import { expect, vi } from 'vitest'
import type * as vscode from 'vscode'
import { chatHtml as createChatHtml } from '../src/webview.js'

/**
 * Runs the real Webview bundle against a jsdom document so tests can drive
 * genuine events. Source-string assertions cannot catch the ordering and
 * routing bugs this file exists to prevent.
 */

export interface Posted { type?: string; [key: string]: unknown }

export interface Harness {
  posts: Posted[]
  drop(payload: { types: string[]; data?: Record<string, string>; files?: File[] }): Event
  enter(text?: string): void
  sendState(overrides?: Record<string, unknown>): void
  send(message: Record<string, unknown>): void
  click(selector: string): void
  document: Document
  dispose(): void
}

export function chatHtml(): string {
  return createChatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview,
    { toString: () => 'vscode-resource:/media/deepseek.svg' } as vscode.Uri, {
      script: { toString: () => 'vscode-resource:/dist/webview/markdown.js' } as vscode.Uri,
      style: { toString: () => 'vscode-resource:/dist/webview/katex.min.css' } as vscode.Uri,
      scroll: { toString: () => 'vscode-resource:/dist/webview/scroll.js' } as vscode.Uri,
    })
}

export function harness(): Harness {
  const posts: Posted[] = []
  const listeners: Array<(event: MessageEvent) => void> = []
  const spies: Array<{ mockRestore(): void }> = []
  const originalAdd = window.addEventListener.bind(window)
  spies.push(vi.spyOn(window, 'addEventListener').mockImplementation(
    (type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
      if (type === 'message' && typeof handler === 'function') listeners.push(handler as (event: MessageEvent) => void)
      return originalAdd(type, handler, options)
    },
  ))
  const globals = window as unknown as Record<string, unknown>
  globals.acquireVsCodeApi = () => ({
    postMessage: (message: Posted) => { posts.push(message) },
    getState: () => undefined,
    setState: () => undefined,
  })
  // The scroll controller ships in a separate bundle; only its surface matters here.
  globals.dshConversationScroll = {
    createConversationScroller: () => ({
      intentVersion: 0, changed: () => {}, dispose: () => {}, pause: () => {},
      preserveHistory: () => {}, reset: () => {}, resume: () => {},
    }),
  }

  const html = chatHtml()
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1]
  expect(script).toBeDefined()
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  new Function(script ?? '')()

  const send = (message: Record<string, unknown>) => {
    for (const listener of [...listeners]) listener({ data: message } as MessageEvent)
  }

  const sendState = (overrides: Record<string, unknown> = {}) => {
    send({
      type: 'state',
      state: {
        phase: 'ready', statusText: '', setup: null, canReconnect: false,
        workspaceName: 'demo', cwd: '/workspace',
        sessions: [], archivedSessions: [], sessionId: 'session-a',
        messages: [], running: false, routable: true, models: [],
        approval: null, question: null, commands: [], skills: [],
        agentPreset: { available: false, locked: false, busy: false, current: '', options: [] },
        usage: { available: false, percent: 0, usedTokens: 0, contextWindow: 0 },
        permissions: [], plan: { available: false, active: false, pending: false },
        changedFiles: [], queue: [], jobs: [], imageLimits: undefined,
        hasMoreHistory: false, loadingHistory: false, ...overrides,
      },
    })
  }

  const drop = (payload: { types: string[]; data?: Record<string, string>; files?: File[] }): Event => {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        types: payload.types,
        getData: (format: string) => payload.data?.[format] ?? '',
        files: payload.files ?? [],
        dropEffect: 'none',
        items: [],
      },
    })
    document.dispatchEvent(event)
    return event
  }

  const enter = (text = 'hello') => {
    const prompt = document.getElementById('prompt') as HTMLTextAreaElement
    prompt.value = text
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  }

  const click = (selector: string) => {
    const element = document.querySelector(selector)
    if (element === null) throw new Error(`No element matches ${selector}`)
    element.dispatchEvent(new Event('click', { bubbles: true }))
  }

  return {
    posts, drop, enter, sendState, send, click, document,
    dispose() {
      for (const spy of spies) spy.mockRestore()
      delete globals.acquireVsCodeApi
      delete globals.dshConversationScroll
    },
  }
}
