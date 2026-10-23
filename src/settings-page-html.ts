import { randomBytes } from 'node:crypto'
import type * as vscode from 'vscode'
import { webviewThemeCss } from './webview-theme.js'
import { settingsPageCss, settingsShellHtml } from './settings-ui.js'

export function settingsPageHtml(webview: vscode.Webview, script: vscode.Uri): string {
  const nonce = randomBytes(16).toString('hex')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
  html, body { height: 100%; margin: 0; min-width: 0; overflow: hidden; }
  body { display: flex; justify-content: center; align-items: center; background: var(--vscode-editor-background); }
  ${webviewThemeCss}
  ${settingsPageCss}
  </style></head><body>${settingsShellHtml()}<script nonce="${nonce}" src="${script}"></script></body></html>`
}
