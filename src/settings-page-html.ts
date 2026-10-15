import { randomBytes } from 'node:crypto'
import type * as vscode from 'vscode'
import { webviewThemeCss } from './webview-theme.js'

export function settingsPageHtml(webview: vscode.Webview, script: vscode.Uri): string {
  const nonce = randomBytes(16).toString('hex')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
  * { box-sizing: border-box; } html, body { height: 100%; margin: 0; min-width: 0; }
  body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.6 var(--vscode-font-family, sans-serif); overflow: hidden; }
  #app { display: grid; grid-template-rows: auto auto minmax(0,1fr); height: 100%; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: .5px solid var(--dsh-border); }
  h1 { font-size: 17px; margin: 0; font-weight: 600; } header .hint { margin-left: auto; }
  #banner { padding: 7px 20px; max-height: 100px; overflow-y: auto; color: var(--dsh-warning); overflow-wrap: anywhere; font-size: 12px; } #banner:empty { display: none; }
  .layout { min-height: 0; min-width: 0; display: grid; grid-template-columns: 164px minmax(0,1fr); }
  nav { padding: 14px 10px; border-right: .5px solid var(--dsh-border); overflow-y: auto; }
  nav button { display: block; width: 100%; text-align: left; border-color: transparent; margin-bottom: 3px; padding: 6px 10px; }
  nav button[aria-current="page"] { color: var(--vscode-list-activeSelectionForeground, var(--dsh-accent)); background: var(--vscode-list-activeSelectionBackground, var(--dsh-hover)); }
  main { min-width: 0; overflow-y: auto; padding: 20px 24px; } #content { max-width: 820px; margin-inline: auto; min-width: 0; }
  h2 { margin: 0 0 4px; font-size: 18px; font-weight: 600; } h3 { font-size: 13px; font-weight: 600; margin: 0; }
  p { margin: 5px 0 12px; } .hint { font-size: 11px; color: var(--dsh-muted); overflow-wrap: anywhere; }
  .card { padding: 16px 0; border-bottom: .5px solid var(--dsh-border); min-width: 0; }
  .field { display: grid; grid-template-columns: minmax(130px,1fr) minmax(130px,1fr) auto; align-items: start; gap: 10px; padding: 10px 0; min-width: 0; }
  .field-copy { min-width: 0; } .field-name { display: block; font-size: 12px; } .field .hint { display: block; margin-top: 3px; }
  input, select, button { font: inherit; color: inherit; } button { cursor: pointer; border: .5px solid var(--dsh-border); border-radius: 6px; background: transparent; padding: 4px 10px; min-height: 28px; font-size: 12px; }
  button:hover:not(:disabled) { background: var(--dsh-hover); } button:disabled { opacity: .5; cursor: default; }
  input:not([type="checkbox"]), select { min-width: 0; width: 100%; padding: 6px 8px; border: .5px solid var(--vscode-input-border, var(--dsh-border)); border-radius: 6px; background: var(--vscode-input-background, var(--dsh-surface)); font-size: 12px; }
  input[type="checkbox"] { accent-color: var(--dsh-accent); } .check { display: flex; align-items: center; gap: 7px; min-height: 28px; font-size: 12px; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; } fieldset:disabled { opacity: .65; }
  .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 12px 0; } .actions .hint { margin-right: auto; }
  .primary { color: var(--vscode-button-foreground, white); background: var(--vscode-button-background, #4d6bfe); border-color: transparent; }
  .primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #405de6); } .quiet { color: var(--dsh-muted); border-color: transparent; }
  .danger { color: var(--vscode-errorForeground, #f48771); } .error { color: var(--vscode-errorForeground, #f48771); overflow-wrap: anywhere; font-size: 12px; white-space: pre-wrap; }
  .error:empty { display: none; } .success { color: var(--dsh-success); font-size: 12px; }
  .provider { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 8px; border: 0; border-radius: 7px; }
  .provider-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsh-muted); } .dot.active { background: var(--dsh-success); }
  .model { padding: 12px; border: .5px solid var(--dsh-border); border-radius: 8px; margin: 9px 0; min-width: 0; }
  .model-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 10px; }
  .model-grid label { min-width: 0; font-size: 11px; color: var(--dsh-muted); } .model-grid input { margin-top: 4px; }
  .model .actions { margin-bottom: 0; } .model .actions button { margin-left: auto; }
  .choices { max-height: 300px; overflow-y: auto; border: .5px solid var(--dsh-border); border-radius: 7px; margin-top: 9px; padding: 5px 8px; }
  .choice-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .model-id { font-family: var(--vscode-editor-font-family, monospace); }
  .notice { padding: 9px 12px; border-radius: 7px; background: var(--dsh-hover); font-size: 12px; overflow-wrap: anywhere; }
  .empty { padding: 16px 0; color: var(--dsh-muted); font-size: 12px; } .section-save { position: sticky; bottom: -20px; padding: 12px 0 8px; background: var(--vscode-editor-background); border-top: .5px solid var(--dsh-border); }
  .hidden { display: none !important; }
  @media(max-width:620px) { .layout { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); } nav { display: flex; overflow-x: auto; padding: 7px 10px; border-right: 0; border-bottom: .5px solid var(--dsh-border); } nav button { flex: none; width: auto; white-space: nowrap; margin: 0 2px 0 0; } main { padding: 16px 14px; } .section-save { bottom: -16px; } }
  @media(max-width:380px) { header { padding-inline: 14px; gap: 8px; } header .hint { display: none; } .field { grid-template-columns: minmax(0,1fr) auto; gap: 5px 8px; } .field-copy { grid-column: 1 / -1; } .model-grid { grid-template-columns: minmax(0,1fr); } }
  ${webviewThemeCss}
  </style></head><body><div id="app"><header><h1>DeepSeek Settings</h1><span id="version" class="hint"></span><button id="refresh" type="button">Refresh</button></header><div id="banner" role="status"></div><div class="layout"><nav id="navigation" aria-label="Settings sections"></nav><main><div id="content"><p class="empty">Loading settings…</p></div></main></div></div><script nonce="${nonce}" src="${script}"></script></body></html>`
}
