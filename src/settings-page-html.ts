import { randomBytes } from 'node:crypto'
import type * as vscode from 'vscode'
import { webviewThemeCss } from './webview-theme.js'
import { settingsPageCss, settingsShellHtml } from './settings-ui.js'

/** Escape a value placed inside an HTML attribute. */
function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function settingsPageHtml(webview: vscode.Webview, script: vscode.Uri): string {
  const nonce = randomBytes(16).toString('hex')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none';">
  <style>
  html, body { height: 100%; margin: 0; min-width: 0; overflow: hidden; }
  body { display: flex; justify-content: center; align-items: center; background: var(--vscode-editor-background); }
  ${webviewThemeCss}
  ${settingsPageCss}
  </style></head><body>${settingsShellHtml()}<script nonce="${nonce}" src="${escapeAttr(String(script))}"></script></body></html>`
}
