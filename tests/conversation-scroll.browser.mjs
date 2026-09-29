// Real Chromium layout/event-order regression tests. Run after `pnpm build`.
// Set DSH_TEST_BROWSER if Chrome/Chromium is installed at a nonstandard path.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const [{ outputFiles }, markdown, scrollBundle, tailPng] = await Promise.all([
  build({ entryPoints: [fileURLToPath(new URL('src/webview.ts', root))], bundle: true, platform: 'node', format: 'cjs', write: false }),
  readFile(new URL('dist/webview/markdown.js', root), 'utf8'),
  readFile(new URL('dist/webview/scroll.js', root), 'utf8'),
  readFile(new URL('media/deepseek-tail.png', root)),
])
const module = { exports: {} }
new Function('module', 'exports', outputFiles[0].text)(module, module.exports)
const uri = name => ({ toString: () => `https://assets.invalid/${name}` })
const html = module.exports.chatHtml({ cspSource: 'https://assets.invalid' }, uri('mark.svg'), {
  script: uri('markdown.js'), style: uri('katex.css'), scroll: uri('scroll.js'),
  // The real asset, inline: the point of this one is that it animates.
  tail: { toString: () => 'data:image/png;base64,' + tailPng.toString('base64') },
})
const inline = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1]
// Load the same built scripts explicitly; no external network or VS Code API.
const shell = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '')
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
  await evaluate(`window.sent = []; window.acquireVsCodeApi = () => ({postMessage: message => sent.push(message)});
    document.documentElement.style.cssText = '--vscode-foreground:#cccccc;--vscode-sideBar-background:#181818;--vscode-editor-background:#202020;--vscode-font-family:Arial;--vscode-editor-font-family:monospace;--vscode-descriptionForeground:#999;--vscode-widget-border:#454545;--vscode-focusBorder:#4d6bfe;--vscode-button-secondaryBackground:#333;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#454545;--vscode-widget-shadow:#0006;--vscode-textLink-foreground:#65aaff';`)
  await evaluate(markdown); await evaluate(scrollBundle); await evaluate(inline)
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
    thoughtRow: 24,
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

  if (process.env.DSH_SCROLL_SCREENSHOT) {
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.DSH_SCROLL_SCREENSHOT, Buffer.from(data, 'base64'))
  }
} finally {
  clearTimeout(timeout)
  socket?.terminate()
  child.kill()
  await exited
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
