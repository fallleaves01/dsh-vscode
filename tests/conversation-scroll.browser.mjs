// Real Chromium layout/event-order regression tests. Run after `pnpm build`.
// Set DSH_TEST_BROWSER if Chrome/Chromium is installed at a nonstandard path.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import WebSocket from 'ws'

const candidates = [process.env.DSH_TEST_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
]
const browser = candidates.find(path => path && existsSync(path))
assert.ok(browser, 'Set DSH_TEST_BROWSER to a Chrome/Chromium executable.')
const root = new URL('../', import.meta.url)
const [{ outputFiles }, markdown, scrollBundle, tailPng, markSvg, settingsBundle] = await Promise.all([
  build({ entryPoints: [fileURLToPath(new URL('src/webview.ts', root))], bundle: true, platform: 'node', format: 'cjs', write: false }),
  readFile(new URL('dist/webview/markdown.js', root), 'utf8'),
  readFile(new URL('dist/webview/scroll.js', root), 'utf8'),
  readFile(new URL('media/deepseek-tail.png', root)),
  readFile(new URL('media/deepseek.svg', root)),
  readFile(new URL('dist/webview/settings-page.js', root), 'utf8'),
])
const module = { exports: {} }
new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, createRequire(import.meta.url))
const uri = name => ({ toString: () => `https://assets.invalid/${name}` })
const html = module.exports.chatHtml({ cspSource: 'https://assets.invalid' }, { toString: () => 'data:image/svg+xml;base64,' + markSvg.toString('base64') }, {
  script: uri('markdown.js'), style: uri('katex.css'), scroll: uri('scroll.js'),
  // The real asset, inline: the point of this one is that it animates.
  tail: { toString: () => 'data:image/png;base64,' + tailPng.toString('base64') },
})
const inline = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1]
// Load the same built scripts explicitly; no external network or VS Code API.
const shell = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '')
const [taskCompiled, taskScript] = await Promise.all([
  build({ entryPoints: [fileURLToPath(new URL('src/task-details-html.ts', root))], bundle: true, platform: 'node', format: 'cjs', write: false }),
  readFile(new URL('dist/webview/task-details.js', root), 'utf8'),
])
const taskModule = { exports: {} }
new Function('module', 'exports', 'require', taskCompiled.outputFiles[0].text)(taskModule, taskModule.exports, createRequire(import.meta.url))
const taskShell = taskModule.exports.taskDetailsHtml({ cspSource: 'https://assets.invalid' }, { script: uri('task.js'), markdown: uri('markdown.js'), style: uri('katex.css') })
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '')
const profile = await mkdtemp(join(tmpdir(), 'dsh-scroll-browser-'))
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] })
const exited = once(child, 'exit')
let socket
const timeout = setTimeout(() => { console.error('Browser scroll test timed out'); socket?.terminate(); child.kill(); process.exitCode = 1 }, 60_000)
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''
    child.stderr.on('data', chunk => {
      output += chunk
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) resolve(match[1])
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Browser exited: ${code}`)))
  })
  socket = new WebSocket(endpoint)
  await once(socket, 'open')
  const pending = new Map()
  let id = 0
  socket.on('message', raw => {
    const response = JSON.parse(raw)
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.error) request.reject(new Error(JSON.stringify(response.error)))
    else request.resolve(response.result)
  })
  socket.on('close', () => { for (const request of pending.values()) request.reject(new Error('Browser disconnected')); pending.clear() })
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => call(method, params, sessionId)
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 410, height: 720, deviceScaleFactor: 1, mobile: false })
  await page('Page.enable')
  await page('Page.bringToFront')
  const { frameTree } = await page('Page.getFrameTree')
  await page('Page.setDocumentContent', { frameId: frameTree.frame.id, html: shell })
  await evaluate(`window.sent = []; window.webviewErrors = []; window.addEventListener('error', event => webviewErrors.push(event.message)); window.addEventListener('unhandledrejection', event => webviewErrors.push(String(event.reason))); window.acquireVsCodeApi = () => ({postMessage: message => sent.push(message)});
    document.documentElement.style.cssText = '--vscode-foreground:#cccccc;--vscode-sideBar-background:#181818;--vscode-editor-background:#202020;--vscode-font-family:Arial;--vscode-editor-font-family:monospace;--vscode-descriptionForeground:#999;--vscode-widget-border:#454545;--vscode-focusBorder:#4d6bfe;--vscode-button-secondaryBackground:#333;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#454545;--vscode-widget-shadow:#0006;--vscode-textLink-foreground:#65aaff';`)
  await evaluate(markdown); await evaluate(scrollBundle); await evaluate(settingsBundle); await evaluate(inline)
  await evaluate(`window.tick = (ms = 90) => new Promise(resolve => setTimeout(resolve, ms));
    window.ensure = (value, message) => { if (!value) throw new Error(message); };
    window.gap = () => elements.scroll.scrollHeight - elements.scroll.scrollTop - elements.scroll.clientHeight;
    window.baseline = {phase:'ready',sessionId:'a',workspaceName:'scroll-demo',cwd:'/demo',sessions:[{id:'a',title:'Auto-scroll regression'}],models:[],permissions:[],commands:[],skills:[],queue:[],changedFiles:[],messages:[{id:'reply',role:'assistant',text:'# Streaming reply\\n\\n' + 'Paragraph of output.\\n\\n'.repeat(40),streaming:true}]};
    window.showState = value => window.dispatchEvent(new MessageEvent('message', {data:{type:'state',state:value}}));
    showState(baseline);`)
  await evaluate('tick()')
  assert.equal(await evaluate('gap() <= 2 && conversationScroller.following'), true)

  // The actual production controller, with two renders bracketing its rAF write.
  await evaluate(`(async () => {
    const append = () => { const row = document.createElement('div'); row.style.height='160px'; elements.messages.append(row); };
    await new Promise(resolve => requestAnimationFrame(() => {
      append(); conversationScroller.changed();
      requestAnimationFrame(() => { append(); conversationScroller.changed(); resolve(); });
    }));
    await tick(); ensure(conversationScroller.following && gap() <= 2, 'issue #30: lost follow intent');
  })()`)
  console.log('PASS: programmatic scroll + overlapping streamed layout (#30)')

  // Browser-dispatched wheel input, not a synthetic scroll callback.
  await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 220, deltaX: 0, deltaY: -220 })
  await evaluate('tick()')
  assert.equal(await evaluate('!conversationScroller.following && gap() > 100'), true)
  await evaluate(`window.readingTop = elements.scroll.scrollTop; showState({...baseline,messages:[...baseline.messages,{id:'table',role:'assistant',text:'| Item | Value |\\n| --- | --- |\\n' + '| Result | 123 |\\n'.repeat(30)}]});`)
  await evaluate('tick()')
  assert.equal(await evaluate('!conversationScroller.following && Math.abs(elements.scroll.scrollTop-readingTop)<2 && !document.getElementById("jumpLatest").hidden'), true)
  console.log('PASS: native upward wheel + large Markdown table keeps the reader in place')

  await evaluate(`document.getElementById('jumpLatest').focus()`)
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await evaluate('tick()')
  assert.deepEqual(await evaluate('({following:conversationScroller.following, atBottom:gap()<=2, focus:document.activeElement.id})'), {following:true,atBottom:true,focus:'scroll'})
  console.log('PASS: keyboard-activated Jump to latest restores following and focus')

  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
  await evaluate('tick(200)')
  assert.equal(await evaluate('!conversationScroller.following && gap() > 20'), true)
  console.log('PASS: native keyboard navigation pauses following')

  await evaluate(`(async () => {
    showState({...baseline,sessionId:'tools',messages:[...baseline.messages,{id:'tool',role:'tool',text:'Read file',rawResult:'output\\n'.repeat(30)}]}); await tick();
    const tool = document.querySelector('details.tool'); tool.querySelector('summary').click(); await tick();
    ensure(!conversationScroller.following && tool.open, 'manual expansion must preserve reading');
    conversationScroller.resume(); await tick();
    showState({...state,messages:[...state.messages,{id:'auto-tool',role:'tool',text:'Running',streaming:true,rawResult:'running\\n'.repeat(20)}]}); await tick();
    ensure(conversationScroller.following && gap() <= 2, 'automatic expansion lost follow');
    const canvas = document.createElement('canvas'); canvas.width=100; canvas.height=240;
    const image = new Image(); const loaded = new Promise(resolve => { image.onload=resolve; });
    elements.messages.append(image); image.src=canvas.toDataURL(); await loaded; await tick();
    ensure(conversationScroller.following && gap() <= 2, 'image decode lost follow');
    elements.prompt.style.height='200px'; await tick();
    ensure(conversationScroller.following && gap() <= 2, 'composer resize lost follow');
    elements.prompt.style.height='';
    elements.prompt.value = 'A new message'; send('queue'); const request = sent.findLast(message => message.type === 'send');
    conversationScroller.pause();
    window.dispatchEvent(new MessageEvent('message',{data:{type:'draft-sent',requestId:request.requestId,sessionId:state.sessionId}})); await tick();
    ensure(!conversationScroller.following, 'late send receipt overrode user intent');
    elements.prompt.value = 'Follow this reply'; send('queue'); const next = sent.findLast(message => message.type === 'send');
    window.dispatchEvent(new MessageEvent('message',{data:{type:'draft-sent',requestId:next.requestId,sessionId:state.sessionId}})); await tick();
    ensure(conversationScroller.following && gap() <= 2, 'accepted send did not resume following');
    conversationScroller.pause(); elements.scroll.scrollTop -= 200; await tick(); const reading = elements.scroll.scrollTop;
    showState({...state,approval:{rpcId:'approval',approvalId:'one',toolName:'Write',reason:'Review this change'},question:{rpcId:'question',questions:[{id:'q',question:'Continue?'}]}}); await tick();
    showState({...state,usage:{available:false}}); await tick();
    ensure(!conversationScroller.following && Math.abs(elements.scroll.scrollTop-reading)<2, 'approval/question refresh stole scroll position');
    showState({...baseline,sessionId:'history',hasMoreHistory:true}); await tick();
    elements.scroll.scrollTop=150; await tick(); document.querySelector('.history-button').click();
    const before = document.querySelector('[data-scroll-id="reply"]').getBoundingClientRect().top;
    showState({...state,hasMoreHistory:false,loadingHistory:false,messages:[{id:'older',role:'assistant',text:'Older message\\n\\n'.repeat(20)},...state.messages,{id:'new-tail',role:'assistant',text:'New output\\n\\n'.repeat(10)}]}); await tick();
    ensure(Math.abs(document.querySelector('[data-scroll-id="reply"]').getBoundingClientRect().top-before)<2, 'history anchor drifted');
    ensure(!conversationScroller.following, 'history restore resumed following');
    showState({...baseline,sessionId:'final'}); await tick(); ensure(conversationScroller.following && gap()<=2, 'session reset failed');
    ensure(!sent.some(message => message.type==='webview-error'), JSON.stringify(sent.filter(message => message.type==='webview-error')));
  })()`)
  console.log('PASS: tools, image decode, composer resize, send receipts, approvals, history and session switching')
  await page('Emulation.setDeviceMetricsOverride', { width: 300, height: 550, deviceScaleFactor: 1, mobile: false })
  await evaluate('tick()')
  assert.equal(await evaluate('conversationScroller.following && gap() <= 2'), true)
  await evaluate('conversationScroller.pause(); elements.scroll.scrollTop -= 180;')
  await evaluate('tick()')
  assert.equal(await evaluate(`(() => { const b=document.getElementById('jumpLatest').getBoundingClientRect(), s=elements.scroll.getBoundingClientRect(); return b.width>0 && b.left>=s.left && b.right<=s.right && b.bottom<=s.bottom; })()`), true)
  console.log('PASS: narrow sidebar resize and visible, in-bounds button')

  // The running-turn clock rewrites its own label once a second, and that label
  // grows: the duration lengthens, and past the quiet threshold a note is
  // appended. A wrapped label makes the turn taller without a state change, so
  // the clock itself must tell the scroller or a reader at the bottom is left
  // behind by a timer.
  await evaluate(`showState({...baseline, messages:[...baseline.messages], turnStartedAt: Date.now() - 96000, turnActivityAt: Date.now(), running: true});`)
  await evaluate('tick()')
  assert.equal(await evaluate('document.querySelector(".live-status-text").textContent'), 'Deep diving for 1m 36s')
  assert.equal(await evaluate('conversationScroller.following && gap() <= 2'), true)
  const shortHeight = await evaluate('document.querySelector(".live-status").offsetHeight')
  // Past the quiet threshold the label grows; make it long enough to wrap, so
  // this covers the height change rather than assuming one line always fits.
  await evaluate(`syncLiveStatus({...state, turnStartedAt: Date.now() - 13000000, turnActivityAt: Date.now() - 900000})`)
  await evaluate('tick()')
  const clock = await evaluate('({text: document.querySelector(".live-status-text").textContent, height: document.querySelector(".live-status").offsetHeight})')
  assert.match(clock.text, /^Deep diving for 3h 3[0-9]m 4[0-9]s · no new output for 15m 0s$/)
  assert.ok(clock.height > shortHeight, `the clock label should wrap at 300px: ${shortHeight} -> ${clock.height}`)
  assert.equal(await evaluate('conversationScroller.following && gap() <= 2'), true)
  await evaluate('syncLiveStatus({...state, turnStartedAt: 0, turnActivityAt: 0})')
  await evaluate('tick()')
  assert.equal(await evaluate('document.querySelector(".live-status-text").textContent'), 'Deep diving…')
  assert.equal(await evaluate('conversationScroller.following && gap() <= 2'), true)
  await evaluate(`showState({...baseline, sessionId:'settled', messages:[...baseline.messages]});`)
  await evaluate('tick()')
  assert.equal(await evaluate('document.querySelector(".live-status") === null'), true)
  console.log('PASS: the live turn clock ticks without losing a reader at the bottom')

  // The model picker: DSH's picker searches a long catalog, and this one has to
  // stay visible and in bounds in the narrowest sidebar the layout supports.
  await evaluate(`(() => {
    const names = ['Flash Preview','Pro','Mini','Base','Turbo','Lite','Plus','Edge','Core','Nano','Max','Ultra'];
    const models = names.map((label, index) => ({ provider: 'gateway', providerLabel: 'Local gateway', model: 'm' + String(index), label, selected: index === 0, reasoningEfforts: [] }));
    showState({...baseline, models});
  })()`)
  await evaluate('tick()')
  const labelWidth = await evaluate(`Math.round(document.getElementById('modelTriggerLabel').getBoundingClientRect().width)`)
  await evaluate(`document.getElementById('modelTrigger').click()`)
  await evaluate('tick()')
  const opened = await evaluate(`(() => {
    const list = document.querySelector('.model-list');
    const menu = document.getElementById('modelMenu').getBoundingClientRect();
    const app = document.getElementById('app').getBoundingClientRect();
    return { options: document.querySelectorAll('.model-option').length, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
      menuHeight: Math.round(menu.height), menuTop: Math.round(menu.top), menuBottom: Math.round(menu.bottom),
      appTop: Math.round(app.top), appBottom: Math.round(app.bottom), focused: document.activeElement.id };
  })()`)
  assert.ok(labelWidth > 40, `the model control must show its model, got ${labelWidth}px`)
  assert.equal(opened.focused, 'modelSearch')
  assert.equal(opened.options, 12)
  assert.ok(opened.scrollHeight > opened.clientHeight, `the list must scroll, got ${opened.scrollHeight}/${opened.clientHeight}`)
  assert.ok(opened.menuTop >= opened.appTop && opened.menuBottom <= opened.appBottom, 'the menu must stay inside the sidebar')
  await evaluate(`(() => { const search = document.getElementById('modelSearch'); search.value = 'tbo'; search.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await evaluate('tick()')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.model-option-label')].map(node => node.textContent)`), ['Turbo'])
  await evaluate(`document.getElementById('modelSearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
  await evaluate('tick()')
  const selected = await evaluate(`({ chosen: window.sent.filter(message => message.type === 'select-model').map(message => message.selection.model), closed: document.getElementById('modelMenu').classList.contains('hidden') })`)
  assert.deepEqual(selected.chosen, ['m4'])
  assert.equal(selected.closed, true)
  console.log('PASS: the model picker searches a long catalog inside a narrow sidebar')

  // DSH's typography and its post-turn row are a set of measurements, and jsdom
  // cannot resolve a single one of them. They are asserted here against real
  // layout, because "it reads like DSH" is exactly a claim about numbers.
  // Twice the device pixels: DSH's hairlines are 0.5px, and a 1x device cannot
  // report one back.
  await page('Emulation.setDeviceMetricsOverride', { width: 410, height: 720, deviceScaleFactor: 2, mobile: false })
  await evaluate(`showState({...baseline, sessionId:'typography', running:false,
    usage:{available:true,percent:12,usedTokens:1000,contextWindow:8000,
      sessionStats:{turns:2,steps:5,llmMs:30000,toolMs:4000,ttftSteps:5,ttftMs:5000,decodeMs:10000,decodeTokens:240},
      tokenUsage:{uncachedInputTokens:1000,cacheReadTokens:9000,cacheWriteTokens:0,outputTokens:500}},
    messages:[
      {id:'q1',role:'user',text:'Lay this out the way DSH does.'},
      {id:'t1',role:'tool',text:'Read src/webview.ts',detail:'412 lines'},
      {id:'t2',role:'tool',text:'Ran the suite',detail:'exit 0'},
      {id:'r1',role:'assistant',reasoning:'Measuring the transcript against DSH.',text:'# Heading one\\n\\n## Heading two\\n\\nA paragraph with \`inline code\` in it.\\n\\n- first item\\n- second item\\n\\n> a quoted line\\n\\n\`\`\`ts\\nconst answer = 42\\n\`\`\`\\n\\n| Name | Value |\\n| --- | --- |\\n| a | b |\\n\\n| One | Two | Three | Four |\\n| --- | --- | --- | --- |\\n| 1 | 2 | 3 | 4 |\\n'}
    ],
    messageMeta:[
      {id:'q1',seq:1,time:Date.now()},
      {id:'r1',seq:2,time:Date.now(),turnEnd:true,turnDurationMs:65000,turnUsage:{uncachedInputTokens:12000,outputTokens:300,totalTokens:12300,routes:[]}}
    ]});`)
  await evaluate('tick()')
  const type = await evaluate(`(() => {
    const round = value => Math.round(parseFloat(value) * 100) / 100;
    const metric = (selector, property) => { const node = document.querySelector(selector); ensure(node, 'missing ' + selector); return round(getComputedStyle(node)[property]); };
    const rows = [...document.querySelectorAll('#messages > *')];
    const tools = [...document.querySelectorAll('#messages > .tool')];
    ensure(tools.length === 2, 'expected two tool rows, got ' + tools.length);
    const answer = document.querySelector('#messages > .message.assistant');
    const edge = (node, side) => round(node.getBoundingClientRect()[side]);
    const secondTh = document.querySelectorAll('.markdown th')[1];
    return {
      bodySize: metric('body', 'fontSize'), bodyLine: metric('body', 'lineHeight'),
      paragraphMargin: metric('.markdown p', 'marginTop'),
      listIndent: metric('.markdown ul', 'paddingLeft'),
      listGap: metric('.markdown li:nth-child(2)', 'marginTop'),
      h1: metric('.markdown h1', 'fontSize'), h2: metric('.markdown h2', 'fontSize'),
      h1Weight: metric('.markdown h1', 'fontWeight'),
      inlineCode: metric('.markdown :not(pre) > code', 'fontSize'),
      codeRadius: metric('.code-block', 'borderRadius'),
      codePadding: metric('.code-block pre', 'paddingTop'),
      codeSize: metric('.code-block pre', 'fontSize'),
      narrowFills: (() => {
        const wrapper = document.querySelectorAll('.markdown-table')[0];
        return Math.abs(wrapper.querySelector('table').getBoundingClientRect().width - wrapper.getBoundingClientRect().width) < 2;
      })(),
      // A four-column table keeps its natural width and scrolls inside its own
      // wrapper instead of stretching the transcript.
      wideScrolls: (() => {
        const wrapper = document.querySelectorAll('.markdown-table')[1];
        return wrapper.scrollWidth > wrapper.clientWidth;
      })(),
      headPadFirst: metric('.markdown th', 'paddingLeft'),
      headPadSecond: round(parseFloat(getComputedStyle(secondTh).paddingLeft)),
      // Chromium snaps every border width up to at least one device pixel, so
      // the half-pixel hairline is read from the token that declares it.
      hairline: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-hairline')),
      headRuleIsHairline: metric('.markdown th', 'borderBottomWidth') <= 1,
      bubbleRadius: metric('.message.user .message-body', 'borderRadius'),
      bubblePad: metric('.message.user .message-body', 'paddingTop'),
      bubbleInset: metric('.message.user .message-body', 'paddingLeft'),
      flowWork: round(edge(tools[1], 'top') - edge(tools[0], 'bottom')),
      userRowGap: round(edge(document.querySelector('#messages .user-actions'), 'top') - edge(document.querySelector('.message.user .message-body'), 'bottom')),
      flowAnswer: round(edge(answer, 'top') - edge(tools[1], 'bottom')),
      toolRow: round(document.querySelector('.tool summary').getBoundingClientRect().height),
      toolLeading: metric('.tool-icon', 'width'),
      toolGlyphMargin: metric('.tool-icon', 'marginRight'),
      toolTitleSize: metric('.tool-title', 'fontSize'),
      thoughtRow: round(document.querySelector('.thinking summary').getBoundingClientRect().height),
      // The label is its own span, so the wait needs a gap of its own; without
      // the margin the row reads "Thought7s". The text is forced because the
      // clock only starts counting once the row exists.
      thinkingGap: (() => {
        const duration = document.querySelector('.thinking-duration');
        const title = document.querySelector('.thinking-title');
        ensure(duration && title, 'no thinking row to measure');
        duration.hidden = false; duration.textContent = '7s';
        return round(duration.getBoundingClientRect().left - title.getBoundingClientRect().right);
      })(),
      actionsHeight: round(document.querySelector('.message-actions.end').getBoundingClientRect().height),
      actionsGap: metric('.message-actions.end', 'gap'),
      actionsTop: metric('.message-actions.end', 'marginTop'),
      actionsLeft: metric('.message-actions.end', 'marginLeft'),
      actionIcon: round(document.querySelector('.message-actions.end .message-copy svg').getBoundingClientRect().width),
      pillRadius: round(parseFloat(getComputedStyle(document.querySelector('.usage-pill')).borderRadius)),
      pillPad: metric('.usage-pill', 'paddingLeft'),
      pillIcon: round(document.querySelector('.usage-pill svg').getBoundingClientRect().width),
      clockSize: metric('#messages .message-clock', 'fontSize'),
      dockCentered: (() => {
        const dock = document.getElementById('usageStats').getBoundingClientRect();
        const app = document.getElementById('app').getBoundingClientRect();
        return Math.abs((dock.left + dock.right) / 2 - (app.left + app.right) / 2) < 2;
      })(),
      dockGap: metric('#usageStats', 'gap'),
      dockSize: metric('.stat-pill', 'fontSize'),
      dockPills: document.querySelectorAll('#usageStats .stat-pill').length,
      dockAboveComposer: document.getElementById('usageStats').getBoundingClientRect().bottom <= document.querySelector('.composer').getBoundingClientRect().top + 1,
    };
  })()`)
  assert.deepEqual(type, {
    bodySize: 14, bodyLine: 24,
    paragraphMargin: 16,
    listIndent: 18,
    listGap: 6,
    h1: 21, h2: 19, h1Weight: 700,
    inlineCode: 12.25,
    codeRadius: 16, codePadding: 16, codeSize: 11,
    narrowFills: true, wideScrolls: true,
    headPadFirst: 0, headPadSecond: 16, hairline: 0.5, headRuleIsHairline: true,
    bubbleRadius: 20, bubblePad: 10, bubbleInset: 16,
    flowWork: 6, flowAnswer: 16, userRowGap: 6,
    toolRow: 24, toolLeading: 16, toolGlyphMargin: 6, toolTitleSize: 14,
    thoughtRow: 24, thinkingGap: 4,
    actionsHeight: 28, actionsGap: 8, actionsTop: 16, actionsLeft: -6,
    actionIcon: 16, pillRadius: 999, pillPad: 8, pillIcon: 14, clockSize: 12,
    dockCentered: true, dockGap: 12, dockSize: 12, dockPills: 2, dockAboveComposer: true,
  })
  // A design-review hook: the same fixture, rendered for a human to look at.
  if (process.env.DSH_LAYOUT_SCREENSHOT) {
    await page('Emulation.setDeviceMetricsOverride', { width: 400, height: 1000, deviceScaleFactor: 2, mobile: false })
    await evaluate('tick()')
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.DSH_LAYOUT_SCREENSHOT, Buffer.from(data, 'base64'))
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 410, height: 720, deviceScaleFactor: 2, mobile: false })

  // And the wide table still scrolls, rather than pushing the sidebar sideways.
  await page('Emulation.setDeviceMetricsOverride', { width: 300, height: 720, deviceScaleFactor: 2, mobile: false })
  await evaluate('tick()')
  assert.equal(await evaluate(`(() => { const w = document.querySelectorAll('.markdown-table')[1]; return w.scrollWidth > w.clientWidth && w.getBoundingClientRect().right <= document.getElementById('app').getBoundingClientRect().right + 1; })()`), true)
  console.log('PASS: the transcript is laid out at DSH’s own measurements')

  // The running mark and the streaming sweep are CSS: jsdom cannot see either,
  // and reduced motion has to switch both off.
  await evaluate(`showState({...baseline, running: true, turnStartedAt: Date.now() - 12000, turnActivityAt: Date.now()});`)
  await evaluate('tick()')
  const motion = await evaluate(`(() => {
    const text = document.querySelector('.live-status-text');
    const mark = document.querySelector('.live-status-mark');
    const sweep = getComputedStyle(text);
    const markStyle = getComputedStyle(mark);
    const tail = mark.querySelector('path');
    return { animation: sweep.animationName, duration: sweep.animationDuration, timing: sweep.animationTimingFunction,
      clip: sweep.webkitBackgroundClip || sweep.backgroundClip, fill: sweep.webkitTextFillColor,
      position: sweep.backgroundPosition, tail: tail === null ? null : tail.getAttribute('d')?.slice(0, 6),
      stroke: tail === null ? null : tail.getAttribute('stroke'), color: markStyle.color,
      swim: getComputedStyle(mark.querySelector('.live-status-swim')).webkitMaskImage, label: text.textContent };
  })()`)
  assert.equal(motion.animation, 'shimmer-sweep')
  assert.equal(motion.duration, '1.5s')
  // Chromium reports the default step position without its keyword.
  assert.match(motion.timing, /^steps\(48(, end)?\)$/)
  assert.match(motion.label, /^Deep diving for 1[0-9]s$/)
  // The words are painted once, so the sweep can never show misaligned glyphs.
  assert.equal(motion.clip, 'text')
  assert.notEqual(motion.fill, 'rgb(204, 204, 204)')
  // The gradient has to cover the box at every step of its travel: the glyphs
  // are filled by it, so a gap would render invisible text.
  const covered = await evaluate(`(() => {
    const text = document.querySelector('.live-status-text');
    const before = getComputedStyle(text).backgroundPosition;
    return { repeat: getComputedStyle(text).backgroundRepeat, size: getComputedStyle(text).backgroundSize, before };
  })()`)
  assert.equal(covered.repeat, 'repeat')
  assert.equal(covered.size, '200% 100%')
  // DSH's own running mark: its animated tail masked over the accent colour,
  // with the still outline underneath as the fallback.
  assert.equal(motion.tail, 'M8.844')
  assert.equal(motion.stroke, 'currentColor')
  // The mask is the shipped PNG (read from media/ and inlined here): a PNG magic
  // in the URL means the asset reached the layer, and the packaging test checks
  // that this PNG really is DSH's multi-frame tail.
  assert.match(String(motion.swim), /url\("?data:image\/png;base64,iVBORw0KGgo/)
  // The tail is DSH's own APNG: prove it moves, rather than that a file loaded.
  const markBox = await evaluate(`(() => { const r = document.querySelector('.live-status-mark').getBoundingClientRect(); return { x: Math.round(r.left) - 2, y: Math.round(r.top) - 2, width: Math.round(r.width) + 4, height: Math.round(r.height) + 4, scale: 4 }; })()`)
  const markShot = async () => Buffer.from((await page('Page.captureScreenshot', { format: 'png', clip: markBox })).data, 'base64')
  const tailFirst = await markShot()
  await evaluate('tick(260)')
  const tailSecond = await markShot()
  assert.equal(tailFirst.equals(tailSecond), false, 'the swimming tail must move between frames')

  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await evaluate('tick()')
  const reduced = await evaluate(`({ sweep: getComputedStyle(document.querySelector('.live-status-text')).animationName, swim: getComputedStyle(document.querySelector('.live-status-swim')).display })`)
  assert.equal(reduced.sweep, 'none')
  assert.equal(reduced.swim, 'none')
  const stillFirst = await markShot()
  await evaluate('tick(260)')
  const stillSecond = await markShot()
  assert.equal(stillFirst.equals(stillSecond), true, 'reduced motion must freeze the tail')
  await page('Emulation.setEmulatedMedia', { features: [] })
  console.log('PASS: the running mark and the streaming sweep animate, and stop for reduced motion')

  // The tail is the only answer to "is it still working": the streaming reply
  // used to end in a blinking block, which said the same thing twice and read as
  // a text caret in an answer the user cannot type into.
  const caret = await evaluate(`(() => {
    const body = document.querySelector('.message.assistant .message-body');
    ensure(body, 'no assistant body on screen');
    const after = getComputedStyle(body, '::after');
    return { content: after.content, animation: after.animationName,
      tail: getComputedStyle(document.querySelector('.live-status-swim')).display };
  })()`)
  assert.equal(caret.content, 'none', `a streaming reply must draw no caret, saw ${caret.content}`)
  assert.equal(caret.animation, 'none')
  assert.notEqual(caret.tail, 'none')
  console.log('PASS: no caret under a streaming reply — the swimming tail is the only live mark')

  // Task rows must remain reachable above the composer in a narrow sidebar.
  await evaluate(`window.taskDemo = {...baseline, running:false, messages:[{id:'task-reply',role:'assistant',text:'I am checking the runtime lifecycle and task navigation.'}],
    todos:[{content:'Inspect runtime lifecycle',status:'completed'},{content:'Improve child task navigation',status:'in_progress'}],
    sessions:[{id:'a',title:'Maintain DSH Sidebar',childCount:2},
      {id:'child-check',parentId:'a',title:'Check runtime lifecycle',running:true,subagent:{mode:'continuable',label:'Runtime review'},attention:{approvals:1,questions:0},activity:{status:'running',elapsedMs:9000,activeSince:Date.now()-13000,totalTokens:5420}},
      {id:'child-ui',parentId:'a',title:'Improve child task navigation',running:false,subagent:{mode:'one-shot',label:'Task UI review'},activity:{status:'completed',elapsedMs:65000,totalTokens:1250}},
      {id:'nested',parentId:'child-ui',title:'Check narrow sidebar layout',running:false,subagent:{mode:'one-shot',label:'Narrow sidebar layout'},activity:{status:'idle',elapsedMs:5000,totalTokens:250}}]};
    showState(taskDemo);`)
  for (const width of [320, 420, 650]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await evaluate('tick()')
    const layout = await evaluate(`(() => {
      const panel = document.getElementById('taskPanel').getBoundingClientRect();
      const prompt = document.getElementById('prompt').getBoundingClientRect();
      return { count:document.querySelectorAll('.task-child').length,
        overflow:document.documentElement.scrollWidth>innerWidth,
        aboveComposer:panel.bottom<=prompt.top, visible:panel.height>0,
        status:document.querySelector('.task-child').textContent };
    })()`)
    assert.equal(layout.count, 3)
    assert.equal(layout.overflow, false, `task panel overflow at ${width}px`)
    assert.equal(layout.aboveComposer && layout.visible, true)
    assert.match(layout.status, /Needs approval/)
    if (process.env.DSH_TASK_SCREENSHOT_DIR) {
      const { data } = await page('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR, `tasks-panel-${width}.png`), Buffer.from(data, 'base64'))
    }
  }
  await evaluate(`document.querySelector('.task-child[data-session-id="child-check"]').click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'), {type:'select-session',sessionId:'child-check'})
  await evaluate(`document.querySelector('.task-child[data-session-id="child-check"]').closest('.task-entry').querySelector('.task-open').click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'), {type:'open-task-details',kind:'subagent',sessionId:'child-check'})
  await evaluate(`showState({...taskDemo,sessionId:'child-ui',parentSessionId:'a'});`)
  await evaluate('tick()')
  assert.equal(await evaluate('document.getElementById("prompt").disabled'), true)
  await evaluate(`document.querySelector('.subagent-bar-back').click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'), {type:'select-session',sessionId:'a'})
  await evaluate(`showState(taskDemo);`)
  await evaluate('tick()')
  await evaluate(`document.getElementById('taskToggle').click()`)
  assert.equal(await evaluate('document.getElementById("taskList").classList.contains("hidden")'), true)
  console.log('PASS: subagent details navigation, read-only child, collapse and 320/420/650px task layouts')

  // Open both sections in a short sidebar: the composer must stay reachable.
  await evaluate(`(async()=>{showState({...taskDemo,
    goal:{available:true,loading:false,busy:false,value:{id:'g',revision:2,objective:'Repair task inspection and lifecycle',phase:'active',maxGoalRounds:20,roundsStarted:5,activation:'armed'}},
    schedules:{available:true,loading:false,items:[{id:'r',sessionId:'a',title:'Daily review',prompt:'Check background jobs',kind:'daily',status:'active',scheduledAt:'2026-10-05T01:00:00Z'}]},
    workflows:[{id:'w',name:'Audit',members:[{seq:1,label:'Runtime review',phase:'Verify',childId:'child-check',outcome:'success'}],stopReason:'finished'}]}); await tick();
    document.getElementById('taskFeatures').open=true; document.getElementById('taskToggle').click();})()`)
  for (const width of [320, 420, 650]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 400, deviceScaleFactor: 1, mobile: false })
    await evaluate('tick()')
    const layout = await evaluate(`({ overflow:document.documentElement.scrollWidth>innerWidth, prompt:document.getElementById('prompt').getBoundingClientRect().bottom, send:document.getElementById('send').getBoundingClientRect().bottom })`)
    assert.equal(layout.overflow, false); assert.ok(layout.prompt <= 400 && layout.send <= 400, 'short sidebar must keep composer visible')
  }
  await page('Emulation.setDeviceMetricsOverride', { width:420,height:800,deviceScaleFactor:1,mobile:false })
  await evaluate('tick()')
  if (process.env.DSH_TASK_SCREENSHOT_DIR) {
    const {data}=await page('Page.captureScreenshot',{format:'png'}); await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'task-features.png'),Buffer.from(data,'base64'))
  }
  console.log('PASS: Goal, reminders and workflow layout keeps composer visible at 320/420/650px and 400px height')

  if (process.env.DSH_SCROLL_SCREENSHOT) {
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.DSH_SCROLL_SCREENSHOT, Buffer.from(data, 'base64'))
  }  // A separate renderer uses the real independent detail HTML and production bundle.
  const detailTarget=await call('Target.createTarget',{url:'about:blank'})
  const detailSession=await call('Target.attachToTarget',{targetId:detailTarget.targetId,flatten:true})
  const detailPage=(method,params)=>call(method,params,detailSession.sessionId)
  const detailEvaluate=async expression=>{const result=await detailPage('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value}
  await detailPage('Page.enable'); const detailTree=await detailPage('Page.getFrameTree')
  await detailPage('Page.setDocumentContent',{frameId:detailTree.frameTree.frame.id,html:taskShell})
  await detailEvaluate(`window.sent=[];window.acquireVsCodeApi=()=>({postMessage:value=>sent.push(value)});document.documentElement.style.cssText='--vscode-foreground:#ddd;--vscode-editor-background:#202020;--vscode-font-family:Arial;--vscode-editor-font-family:monospace;--vscode-descriptionForeground:#aaa;--vscode-widget-border:#444;--vscode-button-secondaryBackground:#333;--vscode-button-background:#4d6bfe;--vscode-button-foreground:#fff;--vscode-input-background:#181818;--vscode-textLink-foreground:#65aaff';`)
  await detailEvaluate(markdown); await detailEvaluate(taskScript)
  await detailEvaluate(`window.taskState={kind:'subagent',sessionId:'child-check',parentSessionId:'a',title:'Runtime review',status:'Needs your answer',meta:'5,420 tokens · 22s',readOnlyReason:null,running:true,hasMore:true,loadingHistory:false,chunks:[],gap:false,
    requests:[{rpcId:'q',event:'user-questions/request',request:{questions:[{id:'approach',question:'Which approach should I verify?',options:[{label:'Clean restart'},{label:'Reconnect'}]}]}}],
    messages:[{id:'user',role:'user',text:'Inspect the runtime restart lifecycle.'},{id:'reply',role:'assistant',text:'## Findings\\n\\nThe previous runtime must finish before its replacement starts. I am checking timeout and cancellation paths.',reasoning:'Checking ownership and process termination.'},...Array.from({length:30},(_,i)=>({id:'msg-'+i,role:'assistant',text:'Progress '+i+'\\n\\n'+ 'Verification details. '.repeat(15)}))]};
    window.showTask=patch=>{taskState={...taskState,...patch};window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:taskState}}))};showTask({});`)
  for(const width of [320,420,650]) {
    await detailPage('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    assert.equal(await detailEvaluate('document.documentElement.scrollWidth>innerWidth'),false)
    assert.ok(await detailEvaluate("document.getElementById('send').getBoundingClientRect().bottom<=800"))
  }
  await detailEvaluate(`document.getElementById('scroll').scrollTop=100; document.getElementById('scroll').dispatchEvent(new Event('scroll')); window.readingTop=document.getElementById('scroll').scrollTop;showTask({messages:[...taskState.messages,{id:'extra',role:'assistant',text:'New streamed content',streaming:true}]});`)
  assert.equal(await detailEvaluate("document.getElementById('scroll').scrollTop"),await detailEvaluate('readingTop'))
  await detailEvaluate(`document.querySelector('#requests textarea').value='Reconnect first';showTask({meta:'5,421 tokens · 23s'});`)
  assert.equal(await detailEvaluate("document.querySelector('#requests textarea').value"),'Reconnect first')
  await detailEvaluate(`document.getElementById('draft').value='Check the cleanup path';document.getElementById('draft').focus()`)
  await detailPage('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await detailPage('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.equal(await detailEvaluate('sent.at(-1).type'),'send'); assert.equal(await detailEvaluate('sent.at(-1).mode'),'queue')
  await detailEvaluate(`const receipt=sent.at(-1);window.dispatchEvent(new MessageEvent('message',{data:{type:'sent',requestId:receipt.requestId}}));document.getElementById('scroll').scrollTop=0;`)
  if(process.env.DSH_TASK_SCREENSHOT_DIR) {
    await detailPage('Emulation.setDeviceMetricsOverride',{width:650,height:800,deviceScaleFactor:1,mobile:false}); const {data}=await detailPage('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'subagent-details.png'),Buffer.from(data,'base64'))
    await detailEvaluate(`showTask({kind:'job',title:'Build output',requests:[],messages:[],hasMore:false,status:'Completed',meta:'Build finished',running:false,readOnlyReason:'Live output preview',gap:true,chunks:[{at:1,text:'▸ Verify runtime lifecycle\\n',channel:'log'},{at:2,text:'PASS: cleanup and cancellation\\n',channel:'stdout'},{at:3,text:'Warning: earlier output was trimmed\\n',channel:'stderr'}]})`)
    const shot=await detailPage('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'job-output.png'),Buffer.from(shot.data,'base64'))
  }
  console.log('PASS: independent task pane layout, reading position, answer drafts and native Enter delivery')

  // Theme and viewport coverage uses the actual chat/detail markup and bundles.
  const themes = {
    dark: { foreground:'#ddd', sideBar:'#181818', editor:'#202020', muted:'#aaa', input:'#202020', border:'#454545', link:'#80b6ff', button:'#4d6bfe', contrast:'' },
    light: { foreground:'#262626', sideBar:'#fafafa', editor:'#fff', muted:'#666', input:'#fff', border:'#d4d4d4', link:'#2856c9', button:'#4d6bfe', contrast:'' },
    contrast: { foreground:'#fff', sideBar:'#000', editor:'#000', muted:'#fff', input:'#000', border:'#fff', link:'#54bfff', button:'#084e99', contrast:'#fff' },
  }
  const applyTheme = async (run, theme) => run(`(() => {
    const theme=${JSON.stringify(theme)}, style=document.documentElement.style;
    for(const [key,value] of Object.entries({foreground:theme.foreground,'sideBar-background':theme.sideBar,'editor-background':theme.editor,
      descriptionForeground:theme.muted,'input-background':theme.input,'input-foreground':theme.foreground,'input-placeholderForeground':theme.muted,
      'widget-border':theme.border,'textLink-foreground':theme.link,'button-background':theme.button,'button-foreground':'#fff',
      'button-hoverBackground':theme.button,'editorWarning-foreground':theme.contrast?'#ffff00':'#b38400',errorForeground:'#e45454',
      'testing-iconPassed':theme.editor==='#fff'?'#22863a':'#73c991',
      'textCodeBlock-background':theme.editor,'list-hoverBackground':theme.input,'list-activeSelectionBackground':theme.input,
      'list-activeSelectionForeground':theme.foreground,'icon-foreground':theme.muted,'toolbar-hoverBackground':theme.input}))style.setProperty('--vscode-'+key,value);
    if(theme.contrast)style.setProperty('--vscode-contrastBorder',theme.contrast);else style.removeProperty('--vscode-contrastBorder');
  })()`)
  // The detail tab is foreground after its input checks; restore the chat so
  // Chromium runs its scheduled render before inspecting welcome actions.
  await page('Page.bringToFront')
  await evaluate(`showState({...baseline,sessionId:'welcome',messages:[],sessions:[{id:'welcome',title:'New conversation'}]})`)
  await evaluate('tick()')
  await evaluate(`window.beforeSuggestions=sent.filter(item=>item.type==='send').length;document.querySelector('.empty-action').click()`)
  assert.equal(await evaluate("elements.prompt.value.includes('main entry points') && document.activeElement.id==='prompt' && sent.filter(item=>item.type==='send').length===beforeSuggestions"),true)
  await evaluate("elements.prompt.value='';resizePrompt();elements.prompt.blur()")
  await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false})
  await evaluate('tick()')
  if(process.env.DSH_TASK_SCREENSHOT_DIR) {
    const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'welcome.png'),Buffer.from(data,'base64'))
  }
  for(const [name,theme] of Object.entries(themes)) {
    await page('Page.bringToFront')
    await applyTheme(evaluate,theme);await applyTheme(detailEvaluate,theme)
    await evaluate(`showState({...taskDemo,models:[{provider:'deepseek',providerLabel:'DeepSeek',model:'deepseek-v4',label:'DeepSeek V4',selected:true,reasoningEfforts:['low','high'],reasoningEffort:'high'}]})`)
    await detailEvaluate(`showTask({kind:'subagent',title:'Runtime review',running:true,status:'Needs your answer',meta:'5,420 tokens · 22s',readOnlyReason:null,chunks:[],gap:false,
      requests:[{rpcId:'theme-q',event:'user-questions/request',request:{questions:[{id:'approach',question:'Which approach should I verify?',options:[{label:'Clean restart'},{label:'Reconnect'}]}]}}],
      messages:[{id:'theme-user',role:'user',text:'Inspect the runtime restart lifecycle.'},{id:'theme-reply',role:'assistant',text:'## Findings\\n\\nThe previous runtime must finish before its replacement starts. I am checking timeout and cancellation paths.',reasoning:'Checking ownership and process termination.'}]});document.getElementById('scroll').scrollTop=0`)
    for(const [width,height] of [[320,400],[420,800],[650,800]]) {
      const metrics={width,height,deviceScaleFactor:1,mobile:false}
      await page('Emulation.setDeviceMetricsOverride',metrics);await detailPage('Emulation.setDeviceMetricsOverride',metrics)
      await evaluate('tick()')
      for(const [run,label] of [[evaluate,'chat'],[detailEvaluate,'detail']]) {
        const layout=await run(`(() => {const button=document.getElementById('send'),r=button.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,send:r.bottom,visible:r.width>0&&r.height>0&&r.top>=0}})()`)
        assert.equal(layout.overflow,false,`${label} overflow: ${name} ${width}x${height}`)
        assert.ok(layout.visible && layout.send<=height,`${label} send hidden: ${name} ${width}x${height}`)
      }
    }
    await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
    await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
    await evaluate(`elements.newSession.focus()`)
    assert.equal(await evaluate("getComputedStyle(elements.newSession).outlineStyle"),'solid')
    await evaluate(`elements.newSession.blur();document.getElementById('sessionTrigger').click()`)
    const bounds=await evaluate("(() => {const r=elements.sessionMenu.getBoundingClientRect();return {left:r.left,right:r.right}})()")
    assert.ok(bounds.left>=0 && bounds.right<=420,`session menu clipped in ${name}`)
    await evaluate(`document.getElementById('sessionTrigger').click()`)
    if(process.env.DSH_TASK_SCREENSHOT_DIR) {
      const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,`chat-${name}.png`),Buffer.from(data,'base64'))
      await detailPage('Emulation.setDeviceMetricsOverride',{width:650,height:800,deviceScaleFactor:1,mobile:false})
      await detailPage('Page.bringToFront')
      await detailEvaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const shot=await detailPage('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,`details-${name}.png`),Buffer.from(shot.data,'base64'))
    }
  }
  console.log('PASS: dark/light/high contrast, keyboard focus, session menu bounds, welcome drafts and 18 theme/viewport layouts')

  // Reproduce the ordinary composer state reported by the user, including the
  // fixed standard/ptc/minimal/cordis catalog and the actual editor file path.
  await page('Page.bringToFront')
  await applyTheme(evaluate,themes.dark)
  await evaluate(`document.documentElement.style.setProperty('--vscode-font-size','18px');
    window.contextDemo={...baseline,workspaceName:'DeepEP',cwd:'/demo/DeepEP',sessionId:'context-review',sessions:[{id:'context-review',title:'Review buffer lifecycle'}],
      messages:[{id:'context-reply',role:'assistant',text:'I am reviewing the buffer lifecycle in deep_ep/buffers/bucket.py.'}],
      agentPreset:{available:true,locked:true,busy:false,current:'standard',options:['standard','ptc','minimal','cordis'].map(id=>({id,label:id,selected:id==='standard',trust:'system'}))}};
    showState(contextDemo);window.dispatchEvent(new MessageEvent('message',{data:{type:'ide-context',state:{sessionId:'context-review',availableFile:{kind:'file',path:'deep_ep/buffers/bucket.py'},pinned:[{id:'bucket-ref',kind:'file',path:'deep_ep/buffers/bucket.py'}]}}}));`)
  for(const [width,height] of [[320,400],[420,800],[650,800]]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    await evaluate('tick()')
    const layout=await evaluate(`(() => {const chips=elements.contextChips,r=chips.getBoundingClientRect(),send=elements.send.getBoundingClientRect();return {
      font:getComputedStyle(document.querySelector('.context-name')).fontSize,height:r.height,label:document.querySelector('.context-name').textContent,
      fixedRowHidden:elements.modeChips.classList.contains('hidden'),overflow:document.documentElement.scrollWidth>innerWidth,send:send.bottom,visible:send.height>0}})()`)
    assert.equal(layout.font,'11px');assert.equal(layout.label,'bucket.py');assert.ok(layout.height<=30)
    assert.equal(layout.fixedRowHidden,true);assert.equal(layout.overflow,false);assert.ok(layout.visible && layout.send<=height)
  }
  await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false})
  await evaluate("document.documentElement.style.removeProperty('--vscode-font-size');tick()")
  await evaluate(`sent.length=0;document.querySelector('.context-open').click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'),{type:'open-file',path:'deep_ep/buffers/bucket.py'})
  if(process.env.DSH_TASK_SCREENSHOT_DIR) {
    const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'composer-context.png'),Buffer.from(data,'base64'))
  }
  await evaluate(`elements.policyTrigger.click()`)
  assert.equal(await evaluate("document.querySelector('.policy-preset-name').textContent"),'standard')
  assert.equal(await evaluate("document.querySelectorAll('.agent-preset-option').length"),0)
  if(process.env.DSH_TASK_SCREENSHOT_DIR) {
    const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'composer-settings.png'),Buffer.from(data,'base64'))
  }
  await evaluate(`showState({...contextDemo,agentPreset:{...contextDemo.agentPreset,locked:false}})`);await evaluate('tick()')
  await evaluate(`document.querySelector('.agent-preset-option[data-preset-id="ptc"]').click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'),{type:'select-agent-preset',agentPreset:'ptc'})
  console.log('PASS: fixed agent preset stays in settings; 11px editor context fits three viewports even with 18px chat text, file navigation and preset switching')

  // The open editor is only a suggestion. The file picker supports multiple
  // explicit choices, and sending waits for the host to finish each mutation.
  await evaluate(`window.publishContext=pinned=>window.dispatchEvent(new MessageEvent('message',{data:{type:'ide-context',state:{sessionId:'context-review',availableFile:{kind:'file',path:'deep_ep/buffers/bucket.py'},pinned}}}));
    window.finishContext=request=>window.dispatchEvent(new MessageEvent('message',{data:{type:'context-updated',sessionId:request.sessionId,requestId:request.requestId}}));
    window.answerFileSearch=()=>{const request=sent.filter(item=>item.type==='request-context-files').at(-1);
      window.dispatchEvent(new MessageEvent('message',{data:{...request,type:'context-files',candidates:[{kind:'file',path:'deep_ep/buffers/bucket.py'},{kind:'file',path:'deep_ep/buffers/runtime.py'},{kind:'file',path:'tests/test_bucket.py'},{kind:'folder',path:'deep_ep/buffers'}]}}));};
    publishContext([]);elements.attach.click();answerFileSearch();`)
  assert.equal(await evaluate("document.querySelector('.context-chip')"),null)
  assert.equal(await evaluate('document.activeElement.id'),'contextSearch')
  assert.equal(await evaluate("document.querySelector('.context-option').getAttribute('aria-selected')"),'false')
  assert.equal(await evaluate("document.querySelectorAll('.context-option').length"),4)
  for(const [width,height] of [[320,400],[420,800],[650,800]]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    const layout=await evaluate(`(() => {const send=elements.send.getBoundingClientRect(),search=elements.contextSearch.getBoundingClientRect(),done=elements.contextDone.getBoundingClientRect(),menu=elements.contextMenu.getBoundingClientRect();return {
      overflow:document.documentElement.scrollWidth>innerWidth,send:send.bottom,sendHeight:send.height,searchHeight:search.height,doneHeight:done.height,menuTop:menu.top,menuBottom:menu.bottom,footerBottom:done.bottom}})()`)
    assert.equal(layout.overflow,false,`file picker overflow ${width}x${height}`)
    assert.ok(layout.sendHeight>0 && layout.send<=height,`file picker hides Send ${width}x${height}`)
    assert.ok(layout.searchHeight>0 && layout.doneHeight>0 && layout.menuTop>=0 && layout.footerBottom<=layout.menuBottom,`file picker controls clipped ${width}x${height}`)
  }
  await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
  if(process.env.DSH_TASK_SCREENSHOT_DIR) {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'file-picker.png'),Buffer.from(data,'base64'))
  }
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40})
  assert.equal(await evaluate('document.activeElement.dataset.path'),'deep_ep/buffers/bucket.py')
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await evaluate(`window.addBucket=sent.filter(item=>item.type==='add-context').at(-1);elements.prompt.value='Review the buffer lifecycle';elements.prompt.dispatchEvent(new Event('input',{bubbles:true}));elements.prompt.focus()`)
  assert.deepEqual(await evaluate('({type:addBucket.type,path:addBucket.path,sessionId:addBucket.sessionId})'),{type:'add-context',path:'deep_ep/buffers/bucket.py',sessionId:'context-review'})
  const beforeSend=await evaluate("sent.filter(item=>item.type==='send').length")
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.equal(await evaluate("sent.filter(item=>item.type==='send').length"),beforeSend)
  await evaluate(`publishContext([{id:'bucket-ref',kind:'file',path:addBucket.path}]);finishContext(addBucket);elements.attach.click();answerFileSearch();
    document.querySelector('.context-option[data-path="deep_ep/buffers/runtime.py"]').click();window.addRuntime=sent.filter(item=>item.type==='add-context').at(-1);
    publishContext([{id:'bucket-ref',kind:'file',path:addBucket.path},{id:'runtime-ref',kind:'file',path:addRuntime.path}]);finishContext(addRuntime);elements.contextDone.click();`)
  assert.equal(await evaluate("document.querySelectorAll('.context-chip').length"),2)
  assert.equal(await evaluate('elements.send.disabled'),false)
  assert.equal(await evaluate('document.activeElement.id'),'prompt')
  assert.equal(await evaluate('elements.sessionTriggerTitle.textContent'),'Review buffer lifecycle')
  assert.equal(await evaluate("elements.messages.textContent.includes('buffer lifecycle')"),true)
  if(process.env.DSH_TASK_SCREENSHOT_DIR) {
    // Headless Chrome can retain a clipped surface after the flex menu closes;
    // a viewport resize makes the screenshot repaint the full chat surface.
    await page('Emulation.setDeviceMetricsOverride',{width:421,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'files-selected.png'),Buffer.from(data,'base64'))
  }
  await evaluate(`document.querySelector('.context-remove').click();window.removeBucket=sent.filter(item=>item.type==='remove-context').at(-1);
    publishContext([{id:'runtime-ref',kind:'file',path:addRuntime.path}]);finishContext(removeBucket);publishContext([{id:'runtime-ref',kind:'file',path:addRuntime.path}]);`)
  assert.deepEqual(await evaluate('({type:removeBucket.type,id:removeBucket.id,sessionId:removeBucket.sessionId})'),{type:'remove-context',id:'bucket-ref',sessionId:'context-review'})
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.context-name')].map(item=>item.textContent)"),['runtime.py'])
  await evaluate('elements.attach.click()')
  assert.equal(await evaluate("document.querySelector('.context-option[data-path=\"deep_ep/buffers/bucket.py\"]').getAttribute('aria-selected')"),'false')
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  assert.equal(await evaluate('elements.contextMenu.classList.contains("hidden") && document.activeElement.id==="prompt"'),true)
  console.log('PASS: explicit file picker, three viewport layouts, native keyboard add, send receipt gating, multiple removable files and optional editor context')

  // Main conversations use a full directory and a compact recent switcher.
  await page('Page.bringToFront'); await applyTheme(evaluate, themes.dark)
  await evaluate(`document.documentElement.style.setProperty('--vscode-font-size','18px');
    window.directoryDemo={...baseline,sessionId:'hub-a',workspaceName:'DSH Sidebar',cwd:'/demo/dsh-sidebar',running:false,
      messages:[{id:'hub-reply',role:'assistant',text:'The runtime lifecycle review is complete. The implementation now preserves conversation ownership and validates shutdown before restarting.'}],
      sessions:[{id:'hub-a',title:'Review runtime lifecycle',updatedAt:Date.now(),childCount:1},
      {id:'hub-child',parentId:'hub-a',title:'Internal child review',subagent:{mode:'continuable',label:'Runtime tests'},running:false},
      ...Array.from({length:15},(_,i)=>({id:'hub-'+i,title:['Improve task navigation','Inspect queue behavior','Review the file picker','Check startup handling'][i%4]+' '+(i+1),updatedAt:Date.now()-(i+1)*3600000,blank:false}))],
      archivedSessions:[{id:'archived-main',title:'Completed conversation',updatedAt:Date.now()-86400000},
        {id:'archived-child',parentId:'archived-main',title:'Archived child',subagent:{mode:'one-shot'}}],
      models:[{provider:'deepseek',model:'deepseek-v4',label:'DeepSeek V4',selected:true,reasoningEffort:'high'}], changedFiles:[]};
    showState(directoryDemo);`)
  await evaluate('tick()')
  await evaluate('elements.sessionTrigger.focus()')
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await evaluate('tick()')
  assert.equal(await evaluate('document.activeElement.id'), 'sessionSearch')
  assert.equal(await evaluate('elements.sessionList.querySelectorAll(".session-row").length'),12)
  assert.equal(await evaluate('elements.sessionList.textContent.includes("Internal child review")'),false)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40})
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  assert.equal(await evaluate('document.activeElement.textContent'),'Rename')
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  assert.equal(await evaluate('elements.sessionMenu.classList.contains("hidden")'),false)
  await evaluate('elements.viewAllSessions.click()'); await evaluate('tick()')
  assert.equal(await evaluate('elements.homeSessionList.querySelectorAll(".session-row").length'),16)
  assert.equal(await evaluate('elements.composerFooter.classList.contains("hidden") && document.activeElement.id==="homeSessionSearch"'),true)
  for(const [name,theme] of Object.entries(themes)) {
    await applyTheme(evaluate,theme)
    for(const [width,height] of [[320,400],[420,800],[650,800]]) {
      await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
      const layout=await evaluate(`(() => {const view=elements.conversationHomeView.getBoundingClientRect(),list=elements.homeSessionList.getBoundingClientRect(),create=elements.newSession.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,viewBottom:view.bottom,listHeight:list.height,createVisible:create.width>0&&create.top>=0&&create.bottom<=innerHeight,composerCount:elements.conversationHomeView.querySelectorAll('textarea,form,select').length}})()`)
      assert.equal(layout.overflow,false,`conversation directory overflow: ${name} ${width}`)
      assert.equal(layout.composerCount,0);assert.ok(layout.createVisible && layout.viewBottom<=height && layout.listHeight>=150,`directory controls or list clipped: ${name} ${width} ${JSON.stringify(layout)}`)
      await evaluate(`elements.homeSessionList.querySelector('.session-more').click()`)
      const bounds=await evaluate(`(() => {const r=elements.sessionActions.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`)
      assert.ok(bounds.left>=0 && bounds.right<=width && bounds.top>=0 && bounds.bottom<=height,`conversation action menu clipped: ${name} ${width}`)
      await evaluate('closeSessionActions(false)')
    }
  }
  await applyTheme(evaluate,themes.dark);await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
  if(process.env.DSH_TASK_SCREENSHOT_DIR) { const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'conversation-directory.png'),Buffer.from(data,'base64')) }
  await evaluate('elements.homeArchiveToggle.click()')
  assert.equal(await evaluate('elements.homeSessionList.querySelectorAll(".session-row").length'),1)
  assert.equal(await evaluate('elements.homeSessionList.textContent.includes("Archived child")'),false)
  await evaluate(`elements.homeSessionList.querySelector('.session-more').click();[...elements.sessionActions.querySelectorAll('button')].find(button=>button.textContent==='Restore').click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'),{type:'unarchive-session',sessionId:'archived-main'})
  await evaluate('elements.homeArchiveToggle.click()')
  console.log('PASS: full conversation directory, recent/archived main sessions, native keyboard actions and 9 theme/viewport layouts')

  // New conversation opens the full composer only after matching state and receipt.
  await evaluate(`window.newSendBefore=sent.filter(item=>item.type==='send').length;elements.newSession.focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.equal(await evaluate('sent.filter(item=>item.type==="send").length'),await evaluate('newSendBefore'))
  await evaluate(`window.newRequest=sent.findLast(item=>item.type==='create-conversation');window.newConversationDemo={...directoryDemo,sessionId:'new-chat',messages:[],sessions:[...directoryDemo.sessions,{id:'new-chat',title:'New conversation',blank:true}],changedFiles:[],
    models:[{provider:'deepseek',model:'deepseek-v4',label:'DeepSeek V4',selected:true,reasoningEffort:'high',reasoningEfforts:[{id:'low',label:'Low',selected:false},{id:'high',label:'High',selected:true}]}],
    permissions:[{value:'read-only',label:'Read Only',selected:false},{value:'workspace-write',label:'Workspace',selected:true}],
    agentPreset:{available:true,locked:false,busy:false,current:'standard',options:[{id:'standard',label:'Standard',selected:true},{id:'ptc',label:'Programmatic Tool Calling',selected:false}]}};
    showState(newConversationDemo);`)
  await evaluate('tick()')
  assert.equal(await evaluate('elements.composerFooter.classList.contains("hidden")'),true)
  assert.equal(await evaluate('sent.filter(item=>item.type==="send").length'),await evaluate('newSendBefore'))
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'conversation-created',requestId:newRequest.requestId,cwd:newRequest.cwd,sessionId:'new-chat'}}))`)
  assert.deepEqual(await evaluate('({directory:!elements.conversationHomeView.classList.contains("hidden"),composer:!elements.composerFooter.classList.contains("hidden"),promptDisabled:elements.prompt.disabled,modelDisabled:elements.modelTrigger.disabled,effortDisabled:elements.efforts.disabled,permissionDisabled:elements.policyTrigger.disabled,effort:elements.efforts.value})'),
    {directory:false,composer:true,promptDisabled:false,modelDisabled:false,effortDisabled:false,permissionDisabled:false,effort:'high'})
  await evaluate(`elements.policyTrigger.click()`)
  assert.equal(await evaluate('elements.policyMenu.textContent.includes("Read Only") && elements.policyMenu.textContent.includes("Programmatic Tool Calling")'),true)
  await evaluate(`elements.policyTrigger.click()`)
  if(process.env.DSH_TASK_SCREENSHOT_DIR) { const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'new-conversation-composer.png'),Buffer.from(data,'base64')) }
  await evaluate(`elements.prompt.value='Review a separate task with all options';elements.prompt.dispatchEvent(new Event('input',{bubbles:true}));elements.prompt.focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.deepEqual(await evaluate('({type:sent.at(-1).type,sessionId:sent.at(-1).sessionId,text:sent.at(-1).text})'),{type:'send',sessionId:'new-chat',text:'Review a separate task with all options'})
  await evaluate(`const delivery=sent.at(-1);window.dispatchEvent(new MessageEvent('message',{data:{type:'draft-sent',requestId:delivery.requestId,sessionId:'new-chat'}}));`)
  console.log('PASS: new conversation waits for a matching receipt and exposes the full composer with model, effort, permissions and agent composition')

  // Compact change review retains per-turn snapshots and remains small with 18px chat text.
  await evaluate(`window.changesDemo={...directoryDemo,sessionId:'hub-a',changedFiles:[
    {turn:1,files:[{path:'src/runtime.ts',additions:12,deletions:4,canRevert:true}]},
    {turn:2,files:[{path:'src/runtime.ts',additions:3,deletions:1,canRevert:true},{path:'src/webview.ts',additions:18,deletions:6,canRevert:false},{path:'tests/webview-sessions.spec.ts',additions:32,deletions:12,canRevert:true}]}]};showState(changesDemo);`)
  await evaluate('tick()')
  for(const [width,height] of [[320,400],[420,800],[650,800]]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    const compact=await evaluate(`(() => {const box=document.querySelector('.changed-files'),head=box.querySelector('.changed-files-head');return {height:box.getBoundingClientRect().height,font:getComputedStyle(head).fontSize,collapsed:box.querySelector('.changed-files-toggle').getAttribute('aria-expanded'),overflow:box.scrollWidth>box.clientWidth}})()`)
    assert.equal(compact.collapsed,'false');assert.ok(compact.height<=40 && !compact.overflow,`change summary too large at ${width}: ${JSON.stringify(compact)}`)
  }
  await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
  if(process.env.DSH_TASK_SCREENSHOT_DIR) { const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'changed-files-summary.png'),Buffer.from(data,'base64')) }
  await evaluate(`document.querySelector('.changed-files-toggle').click()`)
  const rows=await evaluate(`[...document.querySelectorAll('.changed-file')].map(row=>({height:row.getBoundingClientRect().height,overflow:row.scrollWidth>row.clientWidth}))`)
  assert.ok(rows.every(row=>row.height<=34&&!row.overflow),JSON.stringify(rows))
  await evaluate(`document.querySelectorAll('.changed-file-link')[1].click()`)
  assert.deepEqual(await evaluate('sent.at(-1)'),{type:'review-file',path:'src/runtime.ts',turn:2,sessionId:'hub-a',cwd:'/demo/dsh-sidebar'})
  await evaluate(`document.querySelectorAll('.changed-file .changed-more')[2].click()`)
  assert.equal(await evaluate('[...elements.sessionActions.querySelectorAll("button")].find(button=>button.textContent==="Revert change").disabled'),true)
  await evaluate('closeSessionActions(false)')
  if(process.env.DSH_TASK_SCREENSHOT_DIR) { const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'changed-files-expanded.png'),Buffer.from(data,'base64')) }
  console.log('PASS: collapsed change summary, compact file rows, per-turn diffs and guarded reversion at three viewport sizes')

  // Failed settlements retain the received body and expose the provider reason.
  const retainedReply={id:'failed-reply',role:'assistant',text:'## Warp cooperation\n\nEach warp processes one assigned chunk.\n\n```cpp\nwhile (iterator.next()) {\n    process_chunk();\n}\n```\n\nThis output was received before the provider ended the request.'}
  await evaluate(`document.documentElement.style.setProperty('--vscode-errorForeground','#f48771');showState({...baseline,sessionId:'failure-review',messages:[{id:'question',role:'user',text:'Explain the chunk iteration.'},{...${JSON.stringify(retainedReply)},streaming:true}],messageMeta:[{id:'failed-reply',time:Date.now(),turnEnd:true,turnDurationMs:65000}]});`)
  await evaluate('tick()')
  const failedReply={...retainedReply,streaming:false,failed:true,detail:'PI_AI_ERROR: Provider finish_reason: content_filter'}
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'state-update',update:{messages:{upserts:[${JSON.stringify(failedReply)}]}}}}));`)
  await evaluate('tick()')
  for(const width of [320,420,650]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
    assert.equal(await evaluate(`document.querySelector('.assistant-failure-detail').textContent`),failedReply.detail)
    assert.equal(await evaluate(`document.querySelector('.message-duration').textContent`),'Failed after 1m 5s')
    assert.equal(await evaluate(`document.querySelector('[data-scroll-id="failed-reply"] .message-body').textContent.includes('process_chunk();')`),true)
  }
  if(process.env.DSH_FAILURE_SCREENSHOT_DIR) {
    await page('Emulation.setDeviceMetricsOverride',{width:420,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_FAILURE_SCREENSHOT_DIR,'failed-response.png'),Buffer.from(data,'base64'))
  }
  console.log('PASS: failed streaming response retains Markdown and displays the precise error and failed duration at three widths')

  await detailEvaluate(`document.documentElement.style.setProperty('--vscode-errorForeground','#f48771');showTask({kind:'subagent',status:'Failed',running:false,requests:[],chunks:[],messages:[${JSON.stringify(failedReply)}],readOnlyReason:null,hasMore:false});`)
  for(const width of [320,420,650]) {
    await detailPage('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    assert.equal(await detailEvaluate('document.documentElement.scrollWidth>innerWidth'),false)
    assert.equal(await detailEvaluate(`document.querySelector('.assistant-failure-detail').textContent`),failedReply.detail)
    assert.equal(await detailEvaluate(`document.getElementById('messages').textContent.includes('process_chunk();')`),true)
  }
  if(process.env.DSH_FAILURE_SCREENSHOT_DIR) {
    const {data}=await detailPage('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_FAILURE_SCREENSHOT_DIR,'failed-subagent.png'),Buffer.from(data,'base64'))
  }
  console.log('PASS: independent subagent details retain failed output and show the same error without horizontal overflow')

  // Official external executions remain informational, while local children open normally.
  await page('Page.bringToFront')
  await evaluate(`showState({...taskDemo,sessions:[...taskDemo.sessions,{id:'external:a:fixture',parentId:'a',title:'External review',subagent:{mode:'external',executionId:'fixture',label:'External review'},agentAvailable:false,running:false}]});`)
  await evaluate('tick()')
  await evaluate(`if(document.getElementById('taskList').classList.contains('hidden'))document.getElementById('taskToggle').click();window.beforeExternal=sent.length;document.querySelector('[data-session-id="external:a:fixture"]').click()`)
  assert.equal(await evaluate('sent.length===beforeExternal'),true)
  assert.deepEqual(await evaluate(`(()=>{const row=document.querySelector('[data-session-id="external:a:fixture"]');return {disabled:row.getAttribute('aria-disabled'),tabIndex:row.tabIndex,label:row.textContent.includes('External task'),fabricated:/Idle|Completed|Running/.test(row.textContent)}})()`),{disabled:'true',tabIndex:-1,label:true,fabricated:false})
  console.log('PASS: external execution rows are visible, non-routable and do not invent runtime activity')

  const syntheticSecret='sk-'+'A1'.repeat(16)
  await evaluate(`showState({...baseline,sessionId:'secret-review',messages:[{id:'secret-user',role:'user',text:'Inspect this credential: '+${JSON.stringify(syntheticSecret)}}]})`)
  await evaluate('tick()')
  await detailEvaluate(`showTask({kind:'subagent',title:'Credential handling',running:false,status:'Idle',requests:[],messages:[{id:'secret-user',role:'user',text:'Inspect this credential: '+${JSON.stringify(syntheticSecret)}}]})`)
  for(const width of [320,420,650]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    await detailPage('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
    for(const run of [evaluate,detailEvaluate]) {
      assert.equal(await run(`document.getElementById('messages').innerHTML.includes(${JSON.stringify(syntheticSecret)})`),false)
      assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false)
      assert.equal(await run(`getComputedStyle(document.querySelector('.secret-mask-run')).webkitMaskImage.startsWith('url(')`),true)
    }
  }
  await evaluate(`document.querySelector('.secret-toggle').focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.equal(await evaluate(`document.querySelector('.secret-value').textContent`),syntheticSecret)
  await evaluate(`document.querySelector('.secret-toggle').click()`)
  if(process.env.DSH_TASK_SCREENSHOT_DIR){const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'masked-user-message.png'),Buffer.from(data,'base64'))}
  console.log('PASS: main and child user messages mask recognized credentials, support native keyboard reveal and fit three widths')

  // Deferred tool cards retain navigation before their request or result is loaded.
  const subagentCard={id:'tool:subagent-card',role:'tool',text:'subagent',detail:'Completed',deferredBody:true,deferredBodyRevision:'subagent-navigation',
    callView:{card:'generic',subagentLabel:'Review runtime ownership'},resultView:{card:'generic',subagentLinks:[{id:'card-child',label:'Review runtime ownership'}]}}
  const subagentSessions=[{id:'card-parent',title:'Runtime review',updatedAt:1,childCount:1},{id:'card-child',parentId:'card-parent',title:'Runtime ownership audit',subagent:{mode:'continuable',label:'Review runtime ownership'},running:true,activity:{status:'running',elapsedMs:65000,totalTokens:2450}}]
  await evaluate(`showState({...baseline,sessionId:'card-parent',sessions:${JSON.stringify(subagentSessions)},messages:[${JSON.stringify(subagentCard)}]});`);await evaluate('tick()')
  assert.equal(await evaluate(`document.querySelector('.subagent-tool-card details').open`),false)
  assert.equal(await evaluate(`document.querySelector('.subagent-tool-meta').textContent.includes('Running')`),true)
  for(const [name,theme] of Object.entries(themes)) {
    await applyTheme(evaluate,theme);await evaluate(`document.body.className=${JSON.stringify('vscode-'+name)}`)
    for(const width of [320,420,650]) {
      await page('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await evaluate('tick()')
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.subagent-tool-name')).fontSize`),'12px')
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.subagent-tool-card .tool-title')).fontSize`),'11px')
      assert.ok(await evaluate(`document.querySelector('.subagent-tool-main').getBoundingClientRect().height>=28`))
      if(process.env.DSH_TASK_SCREENSHOT_DIR){
        const{data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,`subagent-card-${name}-${width}.png`),Buffer.from(data,'base64'))
        if(name==='dark'&&width===420){
          const clip=await evaluate(`(()=>{const r=document.querySelector('.subagent-tool-card').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
          const shot=await page('Page.captureScreenshot',{format:'png',clip});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'subagent-card-preview.png'),Buffer.from(shot.data,'base64'))
        }
      }
    }
  }
  await evaluate(`document.querySelector('.subagent-tool-main').focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.deepEqual(await evaluate(`(()=>{const p=sent.at(-1);return{type:p.type,parentSessionId:p.parentSessionId,sessionId:p.sessionId,placement:p.placement}})()`),{type:'open-subagent',parentSessionId:'card-parent',sessionId:'card-child',placement:'chat'})
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{...sent.at(-1),type:'open-subagent-result',error:'This task is unavailable. Retry.'}}))`)
  assert.equal(await evaluate(`document.querySelector('.subagent-tool-error').textContent`),'This task is unavailable. Retry.')
  await evaluate(`document.querySelector('.subagent-tool-aside').click()`)
  assert.equal(await evaluate(`sent.at(-1).placement`),'beside')
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{...sent.at(-1),type:'open-subagent-result'}}));showState({...baseline,sessionId:'card-parent',sessions:${JSON.stringify(subagentSessions.map(s=>s.id==='card-child'?{...s,running:false,activity:{status:'completed',elapsedMs:65000,totalTokens:2900}}:s))},messages:[${JSON.stringify(subagentCard)}]})`);await evaluate('tick()')
  assert.equal(await evaluate(`document.querySelector('.subagent-tool-meta').textContent.includes('Completed')`),true)
  await evaluate(`document.querySelector('.subagent-tool-card summary').focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await evaluate('tick()')
  assert.equal(await evaluate(`sent.at(-1).type`),'load-tool-output')
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{...sent.at(-1),type:'tool-output',page:{message:{id:'tool:subagent-card',role:'tool',text:'subagent',rawResult:'started subagent card-child'}}}}))`)
  assert.equal(await evaluate(`document.querySelector('.subagent-tool-card .tool-body').textContent.includes('started subagent card-child')`),true)
  await detailEvaluate(`showTask({kind:'subagent',sessionId:'card-parent',title:'Nested task review',status:'Running',running:true,requests:[],subagents:${JSON.stringify(subagentSessions)},messages:[${JSON.stringify(subagentCard)}]})`)
  assert.equal(await detailEvaluate(`document.querySelector('.subagent-tool-name').textContent`),'Review runtime ownership')
  console.log('PASS: subagent tool cards navigate before loading raw output, support native keyboard and side details, update live status and fit three themes and widths')

  // Settings is the same page mounted as a fenced modal inside the chat.
  await page('Page.bringToFront')
  const modalState={scope:'modal-runtime',version:JSON.parse(await readFile(new URL('package.json',root),'utf8')).version,phase:'ready',writable:true,reason:'',loading:false,forms:[],providers:[],availableProviders:[],protocols:[],catalog:[],signedIn:false,inventory:[{label:'Global runtime',rows:[{name:'@deepseek-ai/dsh-tool-fs',status:'Active'}]}]}
  await evaluate(`elements.openSettings.focus();elements.openSettings.click();window.dispatchEvent(new MessageEvent('message',{data:{type:'settings-open',settingsId:'browser-settings'}}));window.dispatchEvent(new MessageEvent('message',{data:{type:'settings-message',settingsId:'browser-settings',message:{type:'state',state:${JSON.stringify(modalState)}}}}))`)
  assert.equal(await evaluate(`document.getElementById('app').inert&&elements.openSettings.getAttribute('aria-expanded')==='true'`),true)
  for(const [name,theme] of Object.entries(themes)) {
    await applyTheme(evaluate,theme)
    for(const [width,height] of [[320,400],[420,800],[900,850]]) {
      await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
      await evaluate('tick()')
      const bounds=await evaluate(`(()=>{const r=document.getElementById('settingsRoot').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
      assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.top>=0&&bounds.bottom<=height+1&&!bounds.overflow,JSON.stringify(bounds))
      if(process.env.DSH_TASK_SCREENSHOT_DIR&&width===900){const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'settings-in-chat-'+name+'.png'),Buffer.from(data,'base64'))}
    }
  }
  await evaluate(`document.querySelector('#settingsRoot [data-section="plugins"]').click()`)
  assert.equal(await evaluate(`document.querySelector('#settingsRoot .inventory-name').textContent`),'tool-fs')
  await evaluate(`document.querySelector('#settingsRoot button:last-of-type');document.getElementById('settingsClose').focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  assert.equal(await evaluate(`!document.querySelector('.settings-overlay')&&!document.getElementById('app').inert&&document.activeElement.id==='openSettings'`),true)
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'settings-message',settingsId:'browser-settings',message:{type:'state',state:${JSON.stringify(modalState)}}}}))`)
  assert.equal(await evaluate(`document.querySelector('.settings-overlay')===null`),true)
  console.log('PASS: settings opens in chat, fits three themes and viewports, isolates messages, and restores focus on native Escape')

  // Shared-instance identity remains compact; loading stages expose diagnostics.
  for (const width of [320,420,650]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    await evaluate(`showState({...baseline,runtimeConnection:{ownership:'adopted',pid:43210}});tick()`)
    assert.equal(await evaluate(`elements.runtimeConnectionLabel.textContent`),'Shared')
    assert.equal(await evaluate(`elements.runtimeConnection.title.includes('PID 43210')`),true)
    assert.equal(await evaluate(`elements.newSession.getBoundingClientRect().right<=innerWidth`),true)
    assert.equal(await evaluate(`elements.runtimeConnection.getBoundingClientRect().height>=24`),true)
    if(process.env.DSH_TASK_SCREENSHOT_DIR&&width===320){const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'shared-connection-320.png'),Buffer.from(data,'base64'))}
  }
  await evaluate(`elements.runtimeConnection.click()`)
  assert.equal(await evaluate(`sent.at(-1).type`),'reconnect')
  await page('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false})
  await evaluate(`showState({...baseline,phase:'loading',runtimeConnection:null,statusText:'Connecting to the existing shared DSH runtime (PID 43210)…'});tick()`)
  assert.equal(await evaluate(`elements.runtimeConnection.disabled`),true)
  assert.equal(await evaluate(`elements.newSession.getBoundingClientRect().right<=innerWidth`),true)
  assert.equal(await evaluate(`elements.conversationStatus.textContent.includes('Show Output')`),true)
  if(process.env.DSH_TASK_SCREENSHOT_DIR){const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_TASK_SCREENSHOT_DIR,'shared-connecting-320.png'),Buffer.from(data,'base64'))}
  console.log('PASS: shared connection displays PID, retries without restart, fits narrow sidebars, and exposes loading-stage diagnostics')

  assert.deepEqual(await evaluate('webviewErrors'),[], 'The production webview emitted an uncaught error')

} finally {
  clearTimeout(timeout)
  socket?.terminate()
  child.kill()
  await exited
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
