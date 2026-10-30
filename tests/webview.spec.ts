import { describe, expect, it } from 'vitest'
import type * as vscode from 'vscode'
import { chatHtml as createChatHtml } from '../src/webview.js'

function chatHtml(webview: vscode.Webview, mark: vscode.Uri): string {
  return createChatHtml(webview, mark, {
    script: { toString: () => 'vscode-resource:/dist/webview/markdown.js' } as vscode.Uri,
    style: { toString: () => 'vscode-resource:/dist/webview/katex.min.css' } as vscode.Uri,
    scroll: { toString: () => 'vscode-resource:/dist/webview/scroll.js' } as vscode.Uri,
    tail: { toString: () => 'vscode-resource:/media/deepseek-tail.png' } as vscode.Uri,
  })
}

describe('chat webview', () => {
  it('offers separate reconnect and explicit runtime restart actions', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    expect(html).toContain("'Reconnect'); retry.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' }))")
    expect(html).toContain("'Restart Runtime'); restart.addEventListener('click', () => vscode.postMessage({ type: 'restart' }))")
    expect(html).toContain('if (current.canReconnect)')
  })

  it('hardens the chat CSP and mints a cryptographic nonce', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark.svg' } as vscode.Uri)
    // Directives that take a compromised document somewhere else are closed too
    // (S2-L1 / CSP hardening): no plugin objects, frames, base rewriting or forms.
    expect(html).toContain("object-src 'none';")
    expect(html).toContain("frame-src 'none';")
    expect(html).toContain("base-uri 'none';")
    expect(html).toContain("form-action 'none';")
    // KaTeX positions every glyph with an inline style attribute, which CSP3
    // blocks unless style-src-attr allows it; without this the formulas collapse
    // (SEC-V2 M2). Scripts stay nonce-only.
    expect(html).toContain("style-src-attr 'unsafe-inline';")
    expect(html).not.toMatch(/script-src[^;]*unsafe-inline/)
    // The nonce is 16 random bytes in hex, not the Math.random alphabet.
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1]
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    const second = /script-src 'nonce-([^']+)'/.exec(chatHtml(
      { cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark.svg' } as vscode.Uri))?.[1]
    expect(second).not.toBe(nonce)
  })

  it('escapes every resource URI placed in an attribute', () => {
    const evil = 'vscode-resource:/x" onload="alert(1)\'<&>'
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => evil } as vscode.Uri)
    const escaped = 'vscode-resource:/x&quot; onload=&quot;alert(1)&#39;&lt;&amp;&gt;'
    expect(html).toContain(escaped)
    expect(html).not.toContain('onload="alert(1)')
  })

  it('loads bundled Markdown, math CSS and fonts without remote scripts or unsafe script execution', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark.svg' } as vscode.Uri)
    expect(html).toContain('src="vscode-resource:/dist/webview/markdown.js"')
    expect(html).toContain('href="vscode-resource:/dist/webview/katex.min.css"')
    expect(html).toContain('font-src vscode-webview:')
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]+';/)
    expect(html).not.toContain('unsafe-eval')
    // Inline *styles* are allowed for KaTeX's inline positioning, but inline
    // scripts are still nonce-gated.
    expect(html).toContain("style-src-attr 'unsafe-inline';")
    expect(html).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(html).toContain('dshMarkdown.renderMarkdown')
    expect(html).toContain('dshMarkdown.scanMarkdownStream')
  })
  it('emits valid browser JavaScript', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1]

    expect(script).toBeDefined()
    expect(() => new Function(script ?? '')).not.toThrow()
  })



  it('binds queue actions to the rendered conversation and blocks actions during loading', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const start = html.indexOf('function postQueueAction(')
    const end = html.indexOf('function renderQueue(', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const sent: unknown[] = []
    const state = { phase: 'ready', sessionId: 'a' }
    const post = new Function('state', 'vscode', `${html.slice(start, end)}; return postQueueAction;`)(state, { postMessage: (value: unknown) => sent.push(value) })
    post('a', 'row', 'edit', 'Updated')
    expect(sent).toEqual([{ type: 'queue-action', sessionId: 'a', itemId: 'row', action: 'edit', text: 'Updated' }])
    state.phase = 'loading'
    post('a', 'row', 'remove')
    state.phase = 'ready'
    state.sessionId = 'b'
    post('a', 'row', 'steer')
    expect(sent).toHaveLength(1)
    expect(html).toContain("postQueueAction(sessionId, item.id, 'remove')")
    expect(html).toContain("postQueueAction(sessionId, item.id, 'steer')")
    expect(html).toContain("postQueueAction(sessionId, item.id, 'edit', text)")
    expect(html).toContain('queueEditing.sessionId !== sessionId')
  })

  it('uses a searchable session center with official rename and archive actions', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('placeholder="Search titles and message history"')
    expect(html).toContain('id="viewAllSessions"')
    expect(html).toContain('id="homeSessionList"')
    expect(html).toContain('id="sessionActions"')
    expect(html).toContain('const sessionDrafts = new Map()')
    expect(html).toContain('const draftImagesBySession = new Map()')
    expect(html).toContain('const pendingDraftSends = new Map()')
    expect(html).toContain("event.data.type === 'restore-draft'")
    expect(html).not.toContain('<select id="sessions"')
  })



  it('attaches supported clipboard images without intercepting ordinary text paste', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain("elements.prompt.addEventListener('paste'")
    expect(script).toContain("if (!files.length) return;")
    expect(script).toContain("item.getAsFile()")
    expect(script).toContain("reader.readAsDataURL(file)")
    expect(script).toContain("type: 'attach-images', sessionId, requestId, images")
    const pasteHandler = script.slice(script.indexOf("elements.prompt.addEventListener('paste'"))
    expect(pasteHandler.indexOf("if (!files.length) return;")).toBeLessThan(pasteHandler.indexOf('event.preventDefault();'))
  })

  it('blocks sending until the extension acknowledges pasted attachments', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain('const pendingAttachmentRequests = new Map()')
    expect(script).toContain('pendingAttachmentRequests.set(requestId, { sessionId })')
    expect(script).toContain("if ([...pendingAttachmentRequests.values()].some(request => request.sessionId === sessionId)) return false;")
    expect(script).toContain("event.data.type === 'attachments-added'")
    expect(script).toContain('pendingAttachmentRequests.delete(event.data.requestId)')
  })

  it('holds the send gate open until a dropped file finishes uploading', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain('const pendingUploadsBySession = new Map()')
    expect(script).toContain('pendingUploadsBySession.set(sessionId, (pendingUploadsBySession.get(sessionId) || 0) + 1)')
    expect(script).toContain("event.data.type === 'draft-files'")
    // The extension's count is authoritative, so concurrent drops cannot
    // release each other's gate.
    expect(script).toContain('Number(event.data.uploads)')
    // The gate itself is asserted behaviourally in tests/webview-composer.spec.ts:
    // matching the expression's text cannot show that the gate closes.
  })

  it('offers actionable setup states instead of a generic reconnect loop', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('Open a project to get started')
    expect(html).toContain("type: 'open-workspace'")
    expect(html).toContain('Install DeepSeek Harness')
    expect(html).toContain('https://github.com/deepseek-ai/deepseek-harness')
    expect(html).toContain("type: 'configure-api-key'")
    expect(html).toContain("setup === 'runtime-auth'")
    expect(html).toContain("vscode.postMessage({ type: 'connect-existing-runtime' })")
    expect(html).toContain("vscode.postMessage({ type: 'start-managed-runtime' })")
    expect(html).not.toContain('launchUrl')
  })

  it('uses append-only output and streaming paths', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain('controller.append(event.data.page.message')
    expect(script).not.toContain('renderedMessages.delete(event.data.messageId)')
    expect(script).not.toContain('value.startsWith(stream.text)')
    expect(script).not.toContain('rendered.node.replaceWith')
    expect(script).toContain("pendingMessageAppends.set(append.id")
    expect(script).toContain("target.textContent += continuation.textContent")
  })

  it('does not restore the raw exit marker when a terminal result has an empty output body', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''
    const start = script.indexOf('function renderToolBody(')
    const end = script.indexOf('\n    function ', start + 1)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const node = (_tag: string, _class?: string, text?: string) => ({ text, children: [] as unknown[], append(...values: unknown[]) { this.children.push(...values) } })
    const render = new Function('node', 'string', 'appendPre', 'appendImages', `${script.slice(start, end)}; return renderToolBody;`)(
      node, (value: unknown) => typeof value === 'string' ? value : '',
      (parent: ReturnType<typeof node>, text: string) => { if (text) parent.append(node('pre', '', text)) },
      () => {},
    )
    const body = render({ rawResult: '\n[exit code: 2]' }, { card: 'terminal', title: 'run' }, { card: 'terminal', output: '', exitCode: 2 })
    expect(body.children).toEqual([{ text: 'Exit 2', children: [], append: expect.any(Function) }])
  })

  it('detaches tail following before loading earlier history', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''
    const historyClick = script.indexOf("button.addEventListener('click'")
    const detachTail = script.indexOf('conversationScroller.preserveHistory()', historyClick)
    const requestHistory = script.indexOf("vscode.postMessage({ type: 'load-history' })", historyClick)

    expect(historyClick).toBeGreaterThanOrEqual(0)
    expect(detachTail).toBeGreaterThan(historyClick)
    expect(detachTail).toBeLessThan(requestHistory)
  })

  it('loads the scroll controller and exposes a keyboard-accessible jump to latest', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    expect(html).toContain('src="vscode-resource:/dist/webview/scroll.js"')
    expect(html).toContain('aria-label="Jump to latest" aria-controls="scroll" hidden')
    expect(html).toContain('tabindex="0" aria-label="Conversation"')
    expect(html).toContain('dshConversationScroll.createConversationScroller(')
    expect(html).not.toContain('scheduleTailScroll(Boolean(current.approval || current.question))')
  })





  it('routes dropped resources, images and other files down separate paths', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('id="dropOverlay"')
    expect(html).toContain("getData('CodeEditors')")
    expect(html).toContain("getData('ResourceURLs')")
    expect(html).toContain("type: 'attach-resources'")
    expect(html).toContain("type: 'attach-files'")
    // An OS drop never yields a path inside a webview, so bytes are the only
    // transport this side can offer.
    expect(html).not.toContain('getPathForFile')
  })

  it('keeps an OS drop off the resource path so its client paths are never referenced', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    // A native file drag also sets the generic web URI list, whose file:// paths
    // belong to the client machine. Those must not be offered as workspace
    // references once real files are in hand.
    expect(html).toContain('function droppedResources(dataTransfer, hasOsFiles)')
    expect(html).toContain('droppedResources(dataTransfer, osFiles.length > 0)')
    expect(html).toContain("? ['application/vnd.code.uri-list']")
  })

  it('arms a job stop before it kills, and keeps a rejected stop inline', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const source = html.slice(html.indexOf('function pressJobStop(job)'), html.indexOf('function renderConversation('))

    expect(source).toContain('function pressJobStop(job)')
    // The first press only arms for three seconds: killing stays behind the
    // confirming branch, and the button is disabled while the host decides.
    expect(source).toContain("state: 'armed'")
    expect(source).toContain("state: 'pending'")
    expect(source).toContain("state: 'failed'")
    expect(source).toContain('}, 3000)')
    expect(source).toContain('}, 4000)')
    expect(source).toContain("type: 'kill-job'")
    expect(source).toContain('Stop failed')
  })
})
