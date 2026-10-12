import { randomBytes } from 'node:crypto'
import type * as vscode from 'vscode'
import { webviewThemeCss } from './webview-theme.js'

export function taskDetailsHtml(webview: vscode.Webview, assets: { script: vscode.Uri; markdown: vscode.Uri; style: vscode.Uri }): string {
  const nonce = randomBytes(16).toString('hex')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${assets.style}"><style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; min-width: 0; }
  body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.6 var(--vscode-font-family); display: grid; grid-template-rows: auto auto minmax(0,1fr) auto; overflow: hidden; }
  header { grid-row: 1; padding: 18px 20px 12px; border-bottom: .5px solid var(--dsh-border); }
  .heading { display: flex; align-items: flex-start; gap: 12px; }
  .heading-copy { flex: 1; min-width: 0; }
  .eyebrow { color: var(--dsh-muted); font-size: 11px; margin-bottom: 4px; }
  h1 { font-size: 19px; font-weight: 600; line-height: 1.4; margin: 0 0 5px; overflow-wrap: anywhere; }
  .meta { color: var(--dsh-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  #status { flex: none; max-width: 45%; padding: 3px 8px; margin-top: 4px; border: .5px solid var(--dsh-border); border-radius: 999px; color: var(--dsh-muted); font-size: 11px; overflow-wrap: anywhere; }
  #status[data-state="running"] { color: var(--dsh-accent); }
  #status[data-state="waiting"] { color: var(--dsh-warning); }
  #status[data-state="completed"] { color: var(--dsh-success); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; border: .5px solid var(--dsh-border); border-radius: 7px; padding: 4px 10px; background: transparent; font-size: 12px; min-height: 28px; }
  button:hover:not(:disabled) { background: var(--dsh-hover); }
  button:disabled { opacity: .5; cursor: default; }
  header button { border-color: transparent; color: var(--dsh-muted); }
  header button:hover:not(:disabled) { color: var(--vscode-foreground); }
  #owner { padding-left: 0; color: var(--dsh-accent); }
  #stop:not(:disabled) { color: var(--vscode-errorForeground); }
  .primary { background: var(--vscode-button-background, #4d6bfe); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
  .primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #405de6); }
  #notice { grid-row: 2; padding: 8px 20px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsh-warning); background: color-mix(in srgb, var(--dsh-warning) 6%, transparent); }
  #notice:empty { display: none; }
  #scroll { grid-row: 3; overflow: auto; padding: 20px; min-height: 0; overflow-anchor: none; }
  #messages, #requests { max-width: 760px; margin-inline: auto; }
  .message { margin-bottom: 24px; min-width: 0; overflow-wrap: anywhere; }
  .role { font-size: 11px; color: var(--dsh-muted); margin-bottom: 8px; }
  .message[data-role="user"] { margin-left: 12%; padding: 12px 16px; border-radius: 16px; background: color-mix(in srgb, #4d6bfe 10%, var(--dsh-surface)); }
  .message[data-role="tool"], .message[data-role="command"] { padding: 12px; border: .5px solid var(--dsh-border); border-radius: 10px; }
  .message p { margin: 0 0 12px; }
  .message h1, .message h2, .message h3 { margin: 20px 0 10px; line-height: 1.4; }
  .message h2 { font-size: 18px; } .message h3 { font-size: 16px; }
  .message pre { overflow: auto; max-width: 100%; padding: 12px; border-radius: 10px; background: var(--vscode-textCodeBlock-background, var(--dsh-hover)); font: 12px/1.65 var(--vscode-editor-font-family); }
  .message code { font-family: var(--vscode-editor-font-family); }
  .message img { max-width: 100%; } .message table { border-collapse: collapse; display: block; overflow: auto; }
  .message td, .message th { padding: 7px 10px; border-bottom: .5px solid var(--dsh-border); }
  .thinking { color: var(--dsh-muted); margin-bottom: 12px; } .thinking summary { cursor: pointer; }
  a, .message button { color: var(--dsh-accent); } .message button { padding: 2px 6px; }
  #output { max-width: 960px; margin: 0 auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 var(--vscode-editor-font-family); }
  #output:not(:empty) { padding: 16px; border: .5px solid var(--dsh-border); border-radius: 12px; background: var(--vscode-textCodeBlock-background, var(--dsh-hover)); }
  .stderr { color: var(--vscode-editorError-foreground, #f48771); } .log { color: var(--dsh-accent); }
  .gap { color: var(--dsh-warning); font-size: 11px; margin: 0 auto 12px; max-width: 960px; }
  .request { border: .5px solid color-mix(in srgb, var(--dsh-warning) 35%, var(--dsh-border)); border-radius: 12px; padding: 14px; margin-bottom: 20px; background: color-mix(in srgb, var(--dsh-warning) 4%, transparent); }
  .request pre { white-space: pre-wrap; font-size: 11px; } .question { display: grid; gap: 6px; margin: 12px 0; }
  .question textarea { min-height: 52px; } .option { display: flex; align-items: baseline; gap: 6px; }
  .hint { font-size: 11px; color: var(--dsh-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
  footer { grid-row: 4; padding: 12px 20px 16px; border-top: .5px solid var(--dsh-border); }
  footer:has(#composer.hidden):has(#readOnly:empty) { display: none; }
  footer > * { max-width: 760px; margin-inline: auto; }
  #composer { padding: 4px 10px 8px; border: 1px solid var(--dsh-border); border-radius: 16px; background: var(--vscode-input-background, var(--dsh-surface)); }
  #composer:focus-within { border-color: var(--vscode-focusBorder, #4d6bfe); }
  #composer .actions { margin-top: 2px; } #composer .hint { margin-right: auto; }
  textarea { display: block; width: 100%; resize: vertical; min-height: 65px; max-height: min(180px, 25vh); padding: 10px; background: var(--vscode-input-background, var(--dsh-surface)); border: .5px solid var(--dsh-border); border-radius: 8px; }
  #draft { resize: none; border: 0; outline: 0; background: transparent; padding-inline: 2px; }
  #readOnly:not(:empty) { padding-bottom: 8px; }
  select { min-width: 0; background: var(--vscode-input-background, var(--dsh-surface)); border: 0; border-radius: 6px; padding: 4px; }
  option { background: var(--vscode-input-background, var(--dsh-surface)); color: var(--vscode-foreground); }
  .hidden { display: none !important; }
  #latest { position: sticky; bottom: 8px; float: right; background: var(--dsh-surface); border-radius: 999px; box-shadow: 0 2px 10px var(--vscode-widget-shadow); }
  .empty { color: var(--dsh-muted); padding: 32px 0; text-align: center; }
  @media (max-width: 380px) { header, footer { padding-inline: 12px; } #scroll { padding: 16px 12px; } h1 { font-size: 17px; } .heading { gap: 8px; } #composer .hint { display: none; } #composer .actions { justify-content: flex-end; } }
  @media (max-height: 500px) { header { padding-block: 8px; } header .actions { margin-top: 4px; } footer { padding-block: 6px; } #draft { min-height: 44px; } }
  ${webviewThemeCss}
  </style></head><body><header><div class="heading"><div class="heading-copy"><div id="kind" class="eyebrow">Subagent</div><h1 id="title">Task details</h1><div id="meta" class="meta"></div></div><span id="status" role="status"></span></div><nav class="actions" aria-label="Task actions"><button id="owner" title="Return to the owning conversation">← Conversation</button><button id="inChat">Open in chat</button><button id="stop">Stop</button><button id="retry">Refresh</button><button id="copy">Copy output</button></nav></header>
  <div id="notice" role="status"></div><main id="scroll" tabindex="0" aria-label="Task conversation and output"><button id="history" class="hidden">Load earlier messages</button><section id="requests"></section><section id="messages"></section><div id="detailEmpty" class="empty hidden">Waiting for task activity…</div><div id="gap" class="gap hidden">Earlier output is unavailable or was trimmed. This is a live preview.</div><pre id="output"></pre><button id="latest" class="hidden">Jump to latest</button></main>
  <footer><div id="readOnly" class="hint"></div><form id="composer"><textarea id="draft" placeholder="Message this child agent" aria-label="Message this child agent"></textarea><div class="actions"><span class="hint">Enter to send · Shift+Enter for a new line</span><select id="delivery" aria-label="Delivery"><option value="queue">Queue</option><option value="steer">Steer</option></select><button id="send" class="primary" type="submit">Send ↑</button></div></form></footer>
  <script nonce="${nonce}" src="${assets.markdown}"></script><script nonce="${nonce}" src="${assets.script}"></script></body></html>`
}
