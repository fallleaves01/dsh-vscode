// Real Chromium settings forms, native keyboard save, and responsive layout checks.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
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

const root=new URL('../',import.meta.url)
const built=await build({stdin:{contents:"export {settingsPageHtml} from './src/settings-page-html.ts'; export {searchPageState} from './tests/settings-page.fixture.ts'",resolveDir:fileURLToPath(root)},bundle:true,platform:'node',format:'cjs',write:false})
const mod={exports:{}};new Function('module','exports','require',built.outputFiles[0].text)(mod,mod.exports,createRequire(import.meta.url))
const html=mod.exports.settingsPageHtml({cspSource:'https://assets.invalid'},{toString:()=> 'https://assets.invalid/settings.js'})
const shell=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')
const script=await readFile(new URL('dist/webview/settings-page.js',root),'utf8')
const snapshot=mod.exports.searchPageState();snapshot.version=JSON.parse(await readFile(new URL('package.json',root),'utf8')).version
const profile = await mkdtemp(join(tmpdir(), 'dsh-settings-browser-'))
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] })
const exited = once(child, 'exit')
let socket
const timeout = setTimeout(() => { console.error('Browser settings test timed out'); socket?.terminate(); child.kill(); process.exitCode = 1 }, 60_000)
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
  await evaluate(`window.sent=[];window.errors=[];window.addEventListener('error',event=>errors.push(event.message));window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));window.acquireVsCodeApi=()=>({postMessage:message=>sent.push(message)});window.show=value=>window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:value}}));window.reply=(requestId,value)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'result',requestId,...value}}));`)
  await evaluate(script)
  await evaluate('window.settingsState='+JSON.stringify(snapshot)+';show(settingsState)')
  const themes={dark:{bg:'#181818',fg:'#ddd',input:'#252526',border:'#444',muted:'#aaa'},light:{bg:'#fff',fg:'#202020',input:'#f5f5f5',border:'#ddd',muted:'#555'},contrast:{bg:'#000',fg:'#fff',input:'#000',border:'#fff',muted:'#fff'}}
  const theme=async value=>evaluate(`Object.entries(${JSON.stringify({'--vscode-font-family':'Arial','--vscode-editor-font-family':'monospace','--vscode-focusBorder':'#4d6bfe','--vscode-button-background':'#4d6bfe','--vscode-button-foreground':'#fff'})}).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));Object.entries(${JSON.stringify({'--vscode-editor-background':value.bg,'--vscode-foreground':value.fg,'--vscode-input-background':value.input,'--vscode-widget-border':value.border,'--vscode-descriptionForeground':value.muted})}).forEach(([key,value])=>document.documentElement.style.setProperty(key,value))`)
  const click=label=>evaluate(`(()=>{const name=${JSON.stringify(label)};let button=[...document.querySelectorAll('button')].find(button=>button.textContent===name);if(!button&&['Shell','Agent loop','Subagents','Web search'].includes(name)){document.querySelector('[data-section=\"plugins\"]').click();button=[...document.querySelectorAll('button')].find(button=>button.textContent===name)}if(button.closest('details'))button.closest('details').open=true;button.click()})()`)
  const input=(key,value)=>evaluate(`(()=>{const control=[...document.querySelectorAll('input')].find(input=>input.dataset.focusKey===${JSON.stringify(key)});if(control.closest('details'))control.closest('details').open=true;control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
  const capture=async name=>{if(!process.env.DSH_SETTINGS_SCREENSHOT_DIR)return;await mkdir(process.env.DSH_SETTINGS_SCREENSHOT_DIR,{recursive:true});const {data}=await page('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.DSH_SETTINGS_SCREENSHOT_DIR,name),Buffer.from(data,'base64'))}
  for(const [name,colors] of Object.entries(themes)){
    await theme(colors)
    for(const [width,height] of [[320,400],[420,800],[900,800]]){
      await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
      for(const label of ['General','Models','Built-in plugins','Shell','Agent loop','Subagents','Web search']){
        await click(label)
        if(width<620) assert.equal(await evaluate(`(()=>{const nav=document.getElementById('navigation').getBoundingClientRect(),active=document.querySelector('nav [aria-current="page"]').getBoundingClientRect();return active.left>=nav.left-1&&active.right<=nav.right+1})()`),true,`Active settings section hidden: ${label} ${width}`)
        if(label==='Models'&&!await evaluate('Boolean(document.querySelector(\'input[type="password"]\'))'))await evaluate(`document.querySelector('[data-provider="anthropic"]').click()`)
        const layout=await evaluate(`(()=>{const main=document.querySelector('main').getBoundingClientRect();return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,mainBottom:main.bottom,viewport:innerHeight,internalOverflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1}})()`)
        assert.ok(layout.width<=width&&layout.height<=height+1&&layout.mainBottom<=height+1&&!layout.internalOverflow,`${name} ${width} ${label}: ${JSON.stringify(layout)}`)
      }
    }
  }
  console.log('PASS: settings navigation and plugin views in dark, light, and high contrast at 320/420/900px')
  await theme(themes.dark);await page('Emulation.setDeviceMetricsOverride',{width:900,height:800,deviceScaleFactor:1,mobile:false})
  await click('Models');if(await evaluate('Boolean(document.querySelector(\'input[type="password"]\'))'))await evaluate(`document.querySelector('[data-provider="anthropic"]').click()`);await click('General');await capture('settings-general.png')
  await click('Shell')
  await evaluate(`document.querySelector('[data-focus-key="bash-sandbox:timeoutMs"]').focus();document.querySelector('[data-focus-key="bash-sandbox:timeoutMs"]').select()`)
  await page('Input.insertText',{text:'90000'})
  assert.equal(await evaluate('sent.filter(message=>message.type==="save-fields").length'),0)
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save changes').focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.deepEqual(await evaluate('sent.at(-1).changes'),[{ns:'bash-sandbox',revision:1,values:{timeoutMs:90000}}])
  await evaluate(`window.saveRequest=sent.at(-1);settingsState={...settingsState,forms:settingsState.forms.map(form=>form.ns==='bash-sandbox'?{...form,revision:2,fields:form.fields.map(field=>field.key==='timeoutMs'?{...field,value:90000,overridden:true}:field)}:form)};show(settingsState);reply(saveRequest.requestId,{ok:true,results:[{ns:'bash-sandbox',ok:true}]})`)
  assert.equal(await evaluate(`document.querySelector('[data-focus-key="bash-sandbox:timeoutMs"]').value`),'90000')
  await capture('settings-shell.png')
  console.log('PASS: native keyboard edits and saves exactly one shell field after an explicit Save')
  await input('bash-sandbox:timeoutMs','80000')
  await evaluate(`show({...settingsState,forms:settingsState.forms.map(form=>form.ns==='bash-sandbox'?{...form,revision:3}:form)})`)
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save changes').disabled`),true)
  assert.equal(await evaluate(`document.querySelector('[data-focus-key="bash-sandbox:timeoutMs"]').value`),'80000')
  await click('Discard')
  console.log('PASS: external revisions retain drafts and block stale settings writes')
  await click('Models');await evaluate(`document.querySelector('[data-provider="anthropic"]').click()`)
  await input('api-key','fixture-key');await capture('settings-models.png')
  await click('Get available models')
  await evaluate(`reply(sent.at(-1).requestId,{ok:true,models:[{id:'new-model',name:'New model',contextWindow:16000,maxTokens:2000,inputModalities:['text']}]})`)
  await click('Select visible');await click('Add selected')
  assert.equal(await evaluate('sent.filter(message=>message.type==="save-provider").length'),0)
  await click('Save changes')
  assert.equal(await evaluate('sent.at(-1).fields.models.some(model=>model.id==="new-model"&&model.contextWindow===16000)'),true)
  assert.equal(await evaluate('document.body.textContent.includes("fixture-key")'),false)
  await evaluate(`settingsState={...settingsState,providers:settingsState.providers.map(provider=>provider.id==='anthropic'?{...provider,revision:2}:provider)};show(settingsState);reply(sent.at(-1).requestId,{ok:false,settingsSaved:true,error:'Credential store unavailable'})`)
  await click('Save changes')
  assert.deepEqual(await evaluate('sent.at(-1).fields'),{})
  await evaluate(`reply(sent.at(-1).requestId,{ok:true})`)
  assert.equal(await evaluate(`document.querySelector('input[type="password"]').value`),'')
  console.log('PASS: model lookup stays read-only; partial saves retry only the key and clear accepted secret drafts')
  await click('Subagents');await capture('settings-subagents.png')
  assert.equal(await evaluate('document.body.textContent.includes("saved, unavailable")'),true)
  await evaluate(`document.querySelector('input[data-focus-key="allow-model-selection"]').click()`)
  await click('Save changes')
  assert.equal(await evaluate('sent.at(-1).type'),'save-allowed-models')
  await evaluate(`reply(sent.at(-1).requestId,{ok:true})`)
  console.log('PASS: subagent limits and unavailable saved model routes share a complete settings section')
  await click('Web search')
  await evaluate(`document.querySelector('[data-focus-key="search-api-mode"]').focus()`)
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32})
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32})
  assert.equal(await evaluate(`document.querySelector('[data-focus-key="search-api-mode"]').checked`),true)
  await input('web-deepseek-api:baseURL','https://search-fixture.example/v1/tools');await input('web-deepseek-api:count','25');await input('api-key','fixture-search-key')
  for(const width of [320,420,900]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))')
    if(width<620)assert.equal(await evaluate(`(()=>{const nav=document.getElementById('navigation').getBoundingClientRect(),active=document.querySelector('nav [aria-current="page"]').getBoundingClientRect();return active.left>=nav.left-1&&active.right<=nav.right+1})()`),true,'Active search section hidden after viewport resize')
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth||document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1`),false)
    await capture('settings-search-fetch-'+width+'.png')
  }
  await click('Save changes')
  assert.deepEqual(await evaluate('sent.at(-1).selection'),{enabled:true})
  assert.equal(await evaluate('sent.at(-1).keyNamespace'),'web-deepseek-api')
  await evaluate(`settingsState={...settingsState,forms:settingsState.forms.map(form=>form.ns==='web-deepseek-api'?{...form,revision:2,fields:form.fields.map(field=>field.key==='count'?{...field,value:25}:field.key==='baseURL'?{...field,value:'https://search-fixture.example/v1/tools'}:field)}:form),search:{...settingsState.search,profiles:settingsState.search.profiles.map(profile=>profile.ns==='web-deepseek-api'?{...profile,revision:2}:profile)}};show(settingsState);reply(sent.at(-1).requestId,{ok:false,keySaved:false,selectionSaved:false,results:[{ns:'web-deepseek-api',ok:true,revision:2}],error:'Fixture credential failure'})`)
  await click('Save changes')
  assert.deepEqual(await evaluate('sent.at(-1).changes'),[]);assert.equal(await evaluate('sent.at(-1).keyRevision'),2)
  await evaluate(`settingsState={...settingsState,search:{...settingsState.search,selection:{...settingsState.search.selection,revision:2,enabled:true}}};show(settingsState);reply(sent.at(-1).requestId,{ok:true,keySaved:true,selectionSaved:true,results:[]})`)
  assert.equal(await evaluate(`document.querySelector('[data-focus-key="api-key"]').value`),'')
  console.log('PASS: native Search / Fetch switch, paired routing, result limits, partial-save retry and 320/420/900px layouts')
  await click('Models');if(!await evaluate(`Boolean(document.querySelector('[data-focus-key="reasoning:0:enabled"]'))`))await evaluate(`document.querySelector('[data-provider="anthropic"]').click()`)
  await evaluate(`document.querySelector('[data-focus-key="reasoning:0:enabled"]').click()`)
  await input('reasoning:0:3:value','adaptive');await click('+ Add level')
  assert.equal(await evaluate(`document.querySelector('[aria-label="off API value"]').disabled`),true)
  for(const width of [320,420,900]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth||document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1`),false)
    await evaluate(`document.querySelector('.model-reasoning').scrollIntoView({block:'center'})`);await capture('settings-reasoning-'+width+'.png')
  }
  await click('Save changes')
  assert.deepEqual(await evaluate('sent.at(-1).fields.models[0].reasoningEfforts'),{off:null,low:'low',medium:'medium',high:'adaptive',xhigh:'xhigh'})
  await evaluate(`reply(sent.at(-1).requestId,{ok:true})`)
  console.log('PASS: reasoning table wire values, unused-level selection, disabled Off value and three viewport layouts')
  await click('Models');await evaluate(`document.querySelector('[data-provider="anthropic"]').click()`)
  // The provider may already be expanded from the previous section; reopen if needed.
  if(!await evaluate(`Boolean(document.querySelector('input[type="password"]'))`))await evaluate(`document.querySelector('[data-provider="anthropic"]').click()`)
  await input('api-key','scope-key');await click('Save changes')
  await evaluate(`window.staleRequest=sent.at(-1);settingsState={...settingsState,scope:'runtime-b'};show(settingsState);reply(staleRequest.requestId,{ok:true})`)
  assert.equal(await evaluate('document.body.textContent.includes("Saved.")'),false)
  assert.equal(await evaluate(`document.querySelector('input[type="password"]')`),null)
  assert.deepEqual(await evaluate('errors'),[])
  console.log('PASS: changing runtimes clears all secret drafts and rejects a late reply')
} finally {
  clearTimeout(timeout)
  socket?.terminate()
  child.kill()
  await exited
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
