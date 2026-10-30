// Real Chromium CSP/computed-style regression for KaTeX output. Run after `pnpm build`.
// Set DSH_TEST_BROWSER if Chrome/Chromium is installed at a nonstandard path.
// CI: DSH_TEST_BROWSER=... node tests/markdown-csp.browser.mjs (Linux Chrome job).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import WebSocket from 'ws'

/**
 * SEC-V2 M2: the chat Webview renders KaTeX with inline style attributes.
 * Under CSP3 those are governed by style-src-attr, not style-src: without
 * `style-src-attr 'unsafe-inline'` every strut height and mspace margin is
 * dropped and formulas collapse (headless Chrome measured strut 0px vs 34.7px).
 *
 * The production CSP is read from the real `chatHtml()` output, so this script
 * fails when the directive is removed from src/webview.ts. A control page with
 * the directive stripped proves the measurement can detect the regression.
 * Both documents are served over loopback with the CSP as an HTTP header, which
 * Chromium enforces for the navigation itself (a meta tag set through
 * Page.setDocumentContent is not reliably re-evaluated between documents).
 */

const candidates = [process.env.DSH_TEST_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
]
const browser = candidates.find(path => path && existsSync(path))
assert.ok(browser, 'Set DSH_TEST_BROWSER to a Chrome/Chromium executable.')
const root = new URL('../', import.meta.url)
const require = createRequire(import.meta.url)

// The one source of truth: the production document builder.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('src/webview.ts', root))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
})
const module = { exports: {} }
new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, require)
const uri = name => ({ toString: () => `https://assets.invalid/${name}` })
const html = module.exports.chatHtml(
  { cspSource: 'https://assets.invalid' },
  uri('deepseek.svg'),
  { script: uri('markdown.js'), style: uri('katex.css'), scroll: uri('scroll.js'), tail: uri('tail.png') },
)
const productionCsp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1]
assert.ok(productionCsp, 'the chat document has no Content-Security-Policy meta tag')
assert.match(productionCsp, /style-src-attr 'unsafe-inline';/, "CSP is missing style-src-attr 'unsafe-inline' (M2 regression)")
assert.match(productionCsp, /script-src 'nonce-[0-9a-f]{32}';/, 'script-src must stay nonce-gated')
assert.doesNotMatch(productionCsp, /script-src[^;]*unsafe-inline/, 'script-src must not allow inline scripts')
const nonce = /style-src [^;]*'nonce-([0-9a-f]+)'/.exec(productionCsp)?.[1]
assert.ok(nonce, 'the chat document has no style nonce')
const controlCsp = productionCsp.replace("style-src-attr 'unsafe-inline';", '')
assert.notEqual(controlCsp, productionCsp)

// Real KaTeX output (the library itself) plus its real stylesheet: the inline
// styles measured below are exactly what the renderer writes at runtime.
const katexCss = readFileSync(join(dirname(require.resolve('katex/package.json')), 'dist/katex.min.css'), 'utf8')
const katex = require('katex')
const formula = katex.renderToString('\\frac{a}{b} = x^{2} + 1', { throwOnError: false, displayMode: true, output: 'htmlAndMathml' })
const documentFor = headerCsp => `<!doctype html><html><head><meta charset="utf-8">`
  + `<meta http-equiv="Content-Security-Policy" content="${productionCsp}">`
  + `<style nonce="${nonce}">${katexCss}</style></head><body>${formula}</body></html>`

// Loopback documents carrying each CSP as a response header.
const pages = new Map([['/production', productionCsp], ['/control', controlCsp]])
const server = createServer((request, response) => {
  const csp = pages.get(request.url ?? '')
  if (csp === undefined) { response.writeHead(404); response.end(); return }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': csp,
    'cache-control': 'no-store',
  })
  response.end(documentFor(csp))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${String(server.address().port)}`

const profile = await mkdtemp(join(tmpdir(), 'dsh-markdown-csp-browser-'))
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] })
let socket
const timeout = setTimeout(() => { console.error('Markdown CSP browser test timed out'); socket?.terminate(); child.kill(); process.exitCode = 1 }, 60_000)
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

  const measure = async path => {
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
    try {
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
      const page = (method, params) => call(method, params, sessionId)
      const evaluate = async expression => {
        const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
        return result.result.value
      }
      await page('Page.enable')
      await page('Page.navigate', { url: origin + path })
      let ready = false
      for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20))
        try { ready = (await evaluate('document.readyState')) === 'complete' } catch { /* context is still being created */ }
      }
      assert.ok(ready, `the browser page ${path} did not finish loading`)
      return await evaluate(`(() => {
        const heights = selector => Math.max(0, ...[...document.querySelectorAll(selector)]
          .map(element => parseFloat(getComputedStyle(element).height) || 0));
        const margins = Math.max(0, ...[...document.querySelectorAll('.mspace')]
          .map(element => parseFloat(getComputedStyle(element).marginRight) || 0));
        return { strut: heights('.katex-strut'), margin: margins, styleSheets: document.styleSheets.length };
      })()`)
    } finally {
      await call('Target.closeTarget', { targetId }).catch(() => {})
    }
  }

  const production = await measure('/production')
  console.log(`INFO: production CSP KaTeX layout strut=${production.strut}px margin=${production.margin}px sheets=${production.styleSheets}`)
  assert.ok(production.strut > 0, `strut height collapsed under the production CSP: ${production.strut}`)
  assert.ok(production.margin > 0, `mspace margin collapsed under the production CSP: ${production.margin}`)
  console.log('PASS: production CSP keeps KaTeX inline layout (style-src-attr)')

  const control = await measure('/control')
  console.log(`INFO: control CSP (no style-src-attr) strut=${control.strut}px margin=${control.margin}px`)
  assert.ok(control.strut <= 0, `the control page unexpectedly keeps inline styles (strut=${control.strut})`)
  assert.ok(control.margin <= 0, `the control page unexpectedly keeps inline styles (margin=${control.margin})`)
  console.log('PASS: the control CSP demonstrates inline-style blocking (regression is detectable)')
  process.exitCode = 0
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  socket?.terminate()
  child.kill()
  await once(child, 'exit').catch(() => {})
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
