import type * as vscode from 'vscode'

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let value = ''
  for (let index = 0; index < 32; index += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  return value
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function chatHtml(webview: vscode.Webview, deepseekMarkUri: vscode.Uri, markdownAssets: { script: vscode.Uri; style: vscode.Uri; scroll: vscode.Uri }): string {
  const token = nonce()
  const mark = escapeHtml(deepseekMarkUri.toString(true))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${token}'; script-src 'nonce-${token}';">
  <link rel="stylesheet" href="${escapeHtml(markdownAssets.style.toString(true))}">
  <style nonce="${token}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.5 var(--vscode-font-family); }
    button, select, textarea, input { font: inherit; color: inherit; }
    button { cursor: pointer; }
    #app { width: 100%; height: 100%; min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; position: relative; }
    .drop-overlay { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); pointer-events: none; }
    .drop-overlay.hidden { display: none; }
    .drop-card { padding: 12px 16px; border: 1px dashed var(--vscode-focusBorder, #4d6bfe); border-radius: 10px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-size: 12px; font-weight: 600; box-shadow: 0 6px 20px var(--vscode-widget-shadow); }
    .composer.drop-target { outline: 1px dashed var(--vscode-focusBorder, #4d6bfe); outline-offset: -2px; }
    .toolbar { min-width: 0; min-height: 38px; padding: 4px 8px 4px 12px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
    .session-control { min-width: 0; flex: 1; position: relative; }
    .session-trigger { width: 100%; min-width: 0; height: 28px; padding: 0 6px; display: flex; align-items: center; gap: 5px; border: 0; border-radius: 6px; background: transparent; font-weight: 600; text-align: left; }
    .session-trigger:hover, .session-trigger[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground); }
    .session-trigger-title { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .session-trigger svg { width: 13px; height: 13px; flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
    .session-menu { position: absolute; z-index: 30; top: calc(100% + 5px); left: -40px; width: calc(100vw - 16px); max-width: 360px; max-height: min(430px, 72vh); padding: 6px; display: grid; grid-template-rows: auto minmax(0, 1fr); border: 1px solid var(--vscode-widget-border); border-radius: 9px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 7px 24px var(--vscode-widget-shadow); }
    .session-search { width: 100%; height: 29px; padding: 0 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 5px; outline: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); }
    .session-list { min-height: 0; margin-top: 5px; overflow: auto; }
    .session-empty { padding: 18px 8px; color: var(--vscode-descriptionForeground); text-align: center; font-size: 11px; }
    .session-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 26px; align-items: center; border-radius: 6px; }
    .session-row.with-expander { grid-template-columns: 20px minmax(0, 1fr) 26px; }
    .session-row:hover, .session-row.active { background: var(--vscode-list-hoverBackground); }
    .session-row.active { color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); }
    .session-main { min-width: 0; min-height: 44px; padding: 5px 6px; display: grid; grid-template-columns: 9px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 7px; border: 0; background: transparent; text-align: left; }
    .session-indicator { grid-row: 1 / 3; align-self: center; width: 6px; height: 6px; border-radius: 50%; background: transparent; }
    .session-indicator.running { background: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 20%, transparent); }
    .session-indicator.unread { background: var(--vscode-notificationsInfoIcon-foreground, #4d6bfe); }
    .session-indicator.attention { background: var(--vscode-notificationsWarningIcon-foreground, #cca700); }
    .session-attention-count { flex: 0 0 auto; min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; text-align: center; }
    .session-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; font-weight: 600; }
    .session-meta { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .session-more { width: 24px; height: 24px; min-width: 24px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 5px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 17px; line-height: 1; }
    .session-more:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .session-archived-toggle { margin-top: 6px; padding: 6px 7px 4px; border: 0; border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 60%, transparent); border-radius: 0; color: var(--vscode-descriptionForeground); background: transparent; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: .3px; }
    .session-archived-toggle:hover { color: var(--vscode-foreground); }
    .session-row.archived { grid-template-columns: minmax(0, 1fr) auto; }
    .account-control { position: relative; display: flex; }
    .account-trigger { position: relative; }
    .account-dot { position: absolute; right: 3px; bottom: 3px; width: 6px; height: 6px; border-radius: 50%; background: transparent; }
    .account-trigger.signed-in .account-dot { background: var(--vscode-charts-green, #3fb950); }
    .account-trigger.working .account-dot { background: var(--vscode-charts-blue, #4d6bfe); }
    .account-trigger.failed .account-dot { background: var(--vscode-errorForeground); }
    .account-menu { position: absolute; z-index: 30; top: calc(100% + 5px); right: 0; width: min(300px, calc(100vw - 16px)); padding: 8px; display: grid; gap: 6px; border: 1px solid var(--vscode-widget-border); border-radius: 9px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 7px 24px var(--vscode-widget-shadow); }
    .account-title { padding: 2px 4px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
    .account-line { padding: 2px 4px; color: var(--vscode-foreground); font-size: 12px; }
    .account-line.failed { color: var(--vscode-errorForeground); }
    .account-meta { padding: 0 4px 2px; color: var(--vscode-descriptionForeground); font-size: 11px; word-break: break-word; }
    .account-action { min-height: 28px; padding: 4px 10px; border: 0; border-radius: 6px; color: var(--vscode-button-foreground, var(--vscode-foreground)); background: var(--vscode-button-background, var(--vscode-toolbar-hoverBackground)); text-align: left; font-size: 12px; }
    .account-action:hover { background: var(--vscode-button-hoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .account-action.secondary { color: var(--vscode-foreground); background: transparent; }
    .account-action.secondary:hover { background: var(--vscode-toolbar-hoverBackground); }
    .subagent-bar { display: flex; align-items: center; gap: 6px; padding: 5px 12px 0; font-size: 11px; }
    .subagent-bar.hidden { display: none; }
    .subagent-bar-label { flex: none; color: var(--vscode-descriptionForeground); }
    .subagent-bar-back { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 1px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; cursor: pointer; }
    .subagent-bar-back:hover { background: var(--vscode-toolbar-hoverBackground); }
    .message-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; margin-left: -6px; opacity: 0; transition: opacity 80ms; }
    .message:hover .message-actions, .message:focus-within .message-actions, .message-actions.always { opacity: 1; }
    .message-action { display: flex; align-items: center; min-height: 28px; padding: 2px 6px; border: none; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; cursor: pointer; }
    .message-action:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .message-action.usage-pill { color: var(--vscode-descriptionForeground); }
    .message-clock { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .message-duration { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .message-action.active { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .message.user .message-actions { justify-content: flex-end; margin-left: 0; }
    .routable-notice { padding: 6px 12px 2px; color: var(--vscode-errorForeground); font-size: 11px; }
    .routable-notice.hidden { display: none; }
    .session-row.session-ancestor { margin-bottom: 4px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border) 60%, transparent); border-radius: 0; grid-template-columns: minmax(0, 1fr); }
    .session-ancestor-arrow { flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
    .session-row.session-child { margin-left: 14px; position: relative; grid-template-columns: minmax(0, 1fr); }
    .session-row.session-child::before { content: ''; position: absolute; left: -9px; top: 50%; width: 7px; height: 1px; background: color-mix(in srgb, var(--vscode-widget-border) 90%, transparent); }
    .session-row.session-child .session-main { min-height: 34px; padding-top: 2px; padding-bottom: 2px; }
    .session-row.session-child .session-name { font-weight: 500; font-size: 11px; }
    .session-subagent-badge { flex: 0 0 auto; padding: 1px 5px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
    .session-subagent-badge.continuable { background: var(--vscode-charts-blue, #4d6bfe); color: #fff; }
    .session-subagent-badge.unknown { opacity: .6; }
    .session-expander { width: 20px; height: 20px; min-width: 20px; margin-right: 4px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 9px; }
    .session-expander:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }    .session-row.archived .session-name { color: var(--vscode-descriptionForeground); font-weight: 500; }
    .session-restore { margin-right: 5px; padding: 3px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; color: var(--vscode-foreground); background: transparent; font-size: 10px; white-space: nowrap; }
    .session-restore:hover { background: var(--vscode-toolbar-hoverBackground); }
    .session-actions { grid-column: 1 / -1; margin: 0 5px 5px 22px; padding: 3px; display: flex; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--vscode-editor-background); }
    .session-action { min-height: 25px; padding: 2px 7px; border: 0; border-radius: 4px; color: var(--vscode-foreground); background: transparent; font-size: 11px; }
    .session-action:hover { background: var(--vscode-toolbar-hoverBackground); }
    .session-action.danger { color: var(--vscode-errorForeground); }
    .icon-button { width: 28px; height: 28px; min-width: 28px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-icon-foreground); }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .github-star:hover { color: var(--vscode-charts-yellow, #e3b341); }
    .jobs-control { position: relative; flex: 0 0 auto; }
    .jobs-trigger { width: auto; min-width: 28px; padding: 0 7px; display: flex; gap: 5px; font-size: 11px; }
    .jobs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
    .jobs-trigger.live .jobs-dot { background: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 20%, transparent); }
    .jobs-menu { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; width: min(340px, calc(100vw - 20px)); max-height: min(420px, 70vh); padding: 6px; overflow: auto; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); }
    .jobs-title { padding: 5px 7px 7px; font-size: 11px; font-weight: 600; }
    .job-row { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 2px 7px; padding: 7px; border-radius: 5px; }
    .job-row + .job-row { border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 50%, transparent); }
    .job-kind { grid-row: 1 / 3; align-self: start; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; text-transform: uppercase; }
    .job-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; font-weight: 600; }
    .job-status { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .job-detail { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .job-duration { grid-column: 3; grid-row: 1 / 3; align-self: center; color: var(--vscode-descriptionForeground); font: 10px var(--vscode-editor-font-family); }
    .job-stop { grid-column: 4; grid-row: 1 / 3; align-self: center; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; color: var(--vscode-foreground); background: transparent; font-size: 10px; }
    .job-stop:hover { background: var(--vscode-toolbar-hoverBackground); }
    .job-stop.armed { border-color: var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-errorForeground, #f48771); font-weight: 600; }
    .icon-button:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    svg:where(:not(.katex svg)) { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .conversation-pane { position: relative; min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); }
    .scroll { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overflow-anchor: none; scroll-behavior: auto; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }
    .scroll:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .jump-latest { position: absolute; z-index: 5; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, #8886)); border-radius: 16px; background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); box-shadow: 0 2px 8px var(--vscode-widget-shadow); white-space: nowrap; font-size: 11px; }
    .jump-latest:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .jump-latest[hidden] { display: none; }
    .jump-latest svg { width: 13px; height: 13px; }
    .conversation { width: 100%; min-width: 0; max-width: 760px; margin: 0 auto; padding: 12px 14px 30px; overflow: hidden; }
    .conversation-slot, .messages { display: contents; }
    .history-loader { display: flex; justify-content: center; padding: 1px 0 9px; }
    .history-button { padding: 3px 9px; border: 0; border-radius: 5px; color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; }
    .history-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .empty { min-height: 55vh; display: grid; place-content: center; justify-items: center; text-align: center; padding: 28px 10px; }
    .deepseek-mark { background-color: #4d6bfe; -webkit-mask: url("${mark}") center / contain no-repeat; mask: url("${mark}") center / contain no-repeat; }
    .empty-logo { width: 38px; height: 38px; margin-bottom: 13px; }
    .empty h2 { margin: 0 0 7px; font-size: 15px; font-weight: 600; }
    .empty p { max-width: 280px; margin: 0; color: var(--vscode-descriptionForeground); }
    .message { width: 100%; min-width: 0; padding: 8px 0 16px; overflow: hidden; }
    .message + .message { margin-top: 8px; }
    .message-head { min-width: 0; display: flex; align-items: center; gap: 8px; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
    .avatar { width: 21px; height: 21px; flex: 0 0 21px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, #4d6bfe 78%, var(--vscode-editor-background)); color: white; font-size: 10px; }
    .assistant .avatar { border-radius: 0; background-color: #4d6bfe; }
    .message-body { width: 100%; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; font-size: 13px; line-height: 1.65; }
    .assistant .message-body { padding-left: 29px; }
    .message.user { display: flex; flex-direction: column; align-items: flex-end; padding-top: 6px; }
    .user .message-head { display: none; }
    .user .message-body { width: fit-content; max-width: 82%; margin-left: auto; padding: 8px 12px; white-space: pre-wrap; border-radius: 16px; background: color-mix(in srgb, var(--vscode-foreground) 8%, var(--vscode-editor-background)); }
    .message-images { width: 100%; display: grid; gap: 7px; margin-top: 8px; }
    .message-image { display: block; max-width: 100%; max-height: 380px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; object-fit: contain; background: var(--vscode-editor-background); }
    .thinking { margin: 0 0 8px; padding-left: 29px; }
    .thinking summary { display: flex; align-items: center; gap: 6px; min-height: 22px; padding: 1px 0; cursor: pointer; list-style: none; color: var(--vscode-descriptionForeground); }
    .thinking summary::-webkit-details-marker { display: none; }
    .thinking-icon { flex: none; font-size: 10px; opacity: .85; }
    .thinking.live .thinking-icon { opacity: 1; animation: thinking-pulse 1.4s ease-in-out infinite; }
    .thinking.live .thinking-title { color: var(--vscode-foreground); }
    .thinking.live .thinking-preview { opacity: 1; }
    @keyframes thinking-pulse { 0%, 100% { opacity: .35; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.1); } }
    @media (prefers-reduced-motion: reduce) { .thinking.live .thinking-icon { animation: none; opacity: 1; } }
    .thinking-title { flex: none; font-size: 12px; font-weight: 600; }
    .thinking-preview { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; opacity: .85; }
    .thinking-body { margin: 3px 0 2px; padding: 2px 0 2px 9px; border-left: 2px solid var(--vscode-widget-border); color: var(--vscode-descriptionForeground); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }
    .live-status { display: flex; align-items: center; gap: 6px; margin: 6px 0 3px; padding-left: 29px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .live-status-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-charts-blue, #4d6bfe); animation: live-pulse 1.6s ease-in-out infinite; }
    .live-status.stopping .live-status-dot { background: var(--vscode-descriptionForeground); }
    .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    @keyframes live-pulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .live-status-dot { animation: none; opacity: 1; } }
    .message-image-status { padding: 8px 10px; border: 1px dashed var(--vscode-widget-border); border-radius: 7px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .message-image-status.failed { color: var(--vscode-errorForeground); }
    .pending-steering { opacity: .82; }
    .pending-steering .message-body::after { content: 'Steering…'; display: block; margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .markdown > :first-child { margin-top: 0; }
    .markdown > :last-child { margin-bottom: 0; }
    .streaming-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
    .markdown p { margin: 0 0 9px; }
    .markdown h1, .markdown h2, .markdown h3 { margin: 14px 0 7px; line-height: 1.3; }
    .markdown h1 { font-size: 17px; } .markdown h2 { font-size: 15px; } .markdown h3 { font-size: 13px; }
    .markdown ul, .markdown ol { margin: 5px 0 10px; padding-left: 22px; }
    .markdown blockquote { margin: 8px 0; padding: 2px 10px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
    .markdown-table { max-width: 100%; overflow-x: auto; margin: 10px 0; border: 1px solid var(--vscode-widget-border, #8886); border-radius: 6px; }
    .markdown table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .markdown th, .markdown td { min-width: 80px; padding: 7px 10px; border: 1px solid var(--vscode-widget-border, #8886); vertical-align: top; }
    .markdown th { font-weight: 600; background: var(--vscode-textCodeBlock-background); }
    .markdown th:not([align]), .markdown td:not([align]) { text-align: left; }
    .markdown tbody tr:nth-child(even) { background: color-mix(in srgb, var(--vscode-foreground) 3%, transparent); }
    .markdown-math-inline { display: inline-block; max-width: 100%; overflow-x: auto; vertical-align: middle; padding: 2px 0; }
    .markdown-math-display { display: block; max-width: 100%; overflow-x: auto; margin: 10px 0; }
    .markdown .katex { font-size: 1.1em; overflow-wrap: normal; word-break: normal; }
    .markdown .katex-display { margin: 0; padding: 5px 2px; text-align: left; }
    .markdown .katex-display > .katex { text-align: left; }
    code { padding: 1px 4px; border-radius: 4px; font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); }
    pre { max-width: 100%; margin: 7px 0; padding: 9px 10px; overflow: auto; white-space: pre; border-radius: 6px; color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--vscode-editor-font-family); }
    pre code { padding: 0; background: transparent; }
    .cancel-spinner { display: none; width: 12px; height: 12px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: cancel-spin .8s linear infinite; }
    .cancel.stopping .cancel-spinner { display: block; }
    .cancel.stopping > svg { display: none; }
    .cancel.stopping { opacity: .8; cursor: default; }
    @keyframes cancel-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .cancel-spinner { animation-duration: 2.4s; } }
    .code-block { margin: 8px 0; border: 1px solid var(--vscode-widget-border); border-radius: 6px; overflow: hidden; background: var(--vscode-textCodeBlock-background); }
    .code-block-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 1px 4px 1px 10px; border-bottom: 1px solid var(--vscode-widget-border); }
    .code-block-language { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .code-copy { flex: none; padding: 2px 8px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 11px; cursor: pointer; }
    .code-copy:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .code-copy.copied { color: var(--vscode-charts-green, #3fb950); }
    .code-block pre { margin: 0; border-radius: 0; background: transparent; }
    /* Token colours follow the default VS Code themes; the Webview body carries
       the active theme kind as a class. */
    .hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }
    .hljs-keyword, .hljs-literal, .hljs-selector-tag, .hljs-doctag, .hljs-formula { color: #569cd6; }
    .hljs-name, .hljs-section, .hljs-selector-id, .hljs-selector-class, .hljs-tag { color: #569cd6; }
    .hljs-string, .hljs-regexp, .hljs-addition, .hljs-meta .hljs-string { color: #ce9178; }
    .hljs-title, .hljs-title.class_, .hljs-title.function_ { color: #dcdcaa; }
    .hljs-type, .hljs-class, .hljs-built_in, .hljs-symbol, .hljs-bullet { color: #4ec9b0; }
    .hljs-number, .hljs-meta .hljs-number { color: #b5cea8; }
    .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-property, .hljs-params { color: #9cdcfe; }
    .hljs-meta, .hljs-meta .hljs-keyword { color: #569cd6; }
    .hljs-operator, .hljs-punctuation { color: #d4d4d4; }
    .hljs-subst, .hljs-link { color: inherit; }
    .hljs-deletion { color: #f48771; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: 600; }
    body.vscode-light .hljs-comment, body.vscode-light .hljs-quote { color: #008000; }
    body.vscode-light .hljs-keyword, body.vscode-light .hljs-literal, body.vscode-light .hljs-selector-tag,
    body.vscode-light .hljs-doctag, body.vscode-light .hljs-name, body.vscode-light .hljs-section,
    body.vscode-light .hljs-selector-id, body.vscode-light .hljs-selector-class, body.vscode-light .hljs-tag { color: #0000ff; }
    body.vscode-light .hljs-string, body.vscode-light .hljs-regexp, body.vscode-light .hljs-addition,
    body.vscode-light .hljs-meta .hljs-string { color: #a31515; }
    body.vscode-light .hljs-title, body.vscode-light .hljs-title.class_, body.vscode-light .hljs-title.function_ { color: #795e26; }
    body.vscode-light .hljs-type, body.vscode-light .hljs-class, body.vscode-light .hljs-built_in,
    body.vscode-light .hljs-symbol, body.vscode-light .hljs-bullet { color: #267f99; }
    body.vscode-light .hljs-number, body.vscode-light .hljs-meta .hljs-number { color: #098658; }
    body.vscode-light .hljs-attr, body.vscode-light .hljs-attribute, body.vscode-light .hljs-variable,
    body.vscode-light .hljs-template-variable, body.vscode-light .hljs-property, body.vscode-light .hljs-params { color: #001080; }
    body.vscode-light .hljs-meta, body.vscode-light .hljs-meta .hljs-keyword { color: #0000ff; }
    body.vscode-light .hljs-operator, body.vscode-light .hljs-punctuation { color: #000000; }
    body.vscode-light .hljs-deletion { color: #a31515; }
    a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
    a:hover { text-decoration: underline; }
    .file-link { min-width: 0; padding: 0; border: 0; color: var(--vscode-textLink-foreground); background: transparent; text-align: left; font-family: var(--vscode-editor-font-family); cursor: pointer; overflow-wrap: anywhere; }
    .file-link:hover { text-decoration: underline; }
    .code-link { padding: 1px 4px; border-radius: 4px; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); }
    .tool { margin: 7px 0 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; overflow: hidden; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .tool.failed { border-color: var(--vscode-errorForeground); }
    .tool summary { min-height: 35px; padding: 7px 9px; display: flex; align-items: center; gap: 7px; cursor: pointer; list-style: none; }
    .tool summary::-webkit-details-marker { display: none; }
    .tool-icon { width: 18px; color: var(--vscode-descriptionForeground); text-align: center; font-family: var(--vscode-editor-font-family); }
    .tool-title { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
    .tool-detail { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .tool-body { padding: 0 10px 9px 34px; min-width: 0; overflow: hidden; color: var(--vscode-descriptionForeground); }
    .tool-body pre { color: var(--vscode-foreground); }
    .tool-output-more { margin: 5px 0 0; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; }
    .tool-output-more:hover { background: var(--vscode-toolbar-hoverBackground); }
    .command-card { margin: 7px 0 10px; padding: 8px 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .command-card.failed { border-color: var(--vscode-errorForeground); }
    .command-head { min-width: 0; display: flex; align-items: center; gap: 7px; }
    .command-name { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family); font-weight: 600; }
    .command-result { margin: 5px 0 0 25px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; overflow-wrap: anywhere; }
    .diff-path, .result-title { margin: 7px 0 4px; font-weight: 600; color: var(--vscode-foreground); }
    .diff-old { border-left: 2px solid var(--vscode-gitDecoration-deletedResourceForeground); }
    .diff-new { border-left: 2px solid var(--vscode-gitDecoration-addedResourceForeground); }
    .source { display: block; margin: 4px 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .source-line { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .tool-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
    .tool-action { min-height: 24px; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; color: var(--vscode-foreground); background: transparent; font-size: 11px; }
    .tool-action:hover { background: var(--vscode-toolbar-hoverBackground); }
    .changed-files { margin: 14px 0 4px; padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .changed-files-head { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 7px; font-weight: 600; }
    .changed-files-title { min-width: 0; flex: 1; }
    .changed-files-actions, .changed-file-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
    .changed-turn + .changed-turn { margin-top: 9px; }
    .changed-turn-title { padding: 4px 0; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .changed-file { min-width: 0; padding: 6px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 8px; border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); }
    .changed-file .file-link { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .changed-file-stats { display: flex; gap: 5px; font-family: var(--vscode-editor-font-family); font-size: 10px; }
    .change-additions { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .change-deletions { color: var(--vscode-gitDecoration-deletedResourceForeground); }
    .changed-file-actions { grid-column: 1 / -1; }
    .changed-action { min-height: 21px; padding: 1px 5px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
    .changed-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .changed-action.danger { color: var(--vscode-errorForeground); }
    .failed, .error-text { color: var(--vscode-errorForeground); }
    .streaming::after { content: ''; display: inline-block; width: 6px; height: 13px; margin-left: 2px; vertical-align: -2px; background: var(--vscode-foreground); animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .status, .interaction { margin: 10px 0; padding: 11px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; overflow-wrap: anywhere; background: var(--vscode-editor-background); }
    .status { color: var(--vscode-descriptionForeground); border: 0; background: var(--vscode-textBlockQuote-background); }
    .status.error { color: var(--vscode-errorForeground); }
    .status.setup { padding: 15px; color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border); border-radius: 10px; background: var(--vscode-editor-background); }
    .setup-title { margin-bottom: 4px; font-weight: 600; }
    .setup-detail { color: var(--vscode-descriptionForeground); }
    .interaction-title { margin-bottom: 4px; font-weight: 600; }
    .interaction-detail, .question-detail { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .primary, .secondary { min-height: 28px; padding: 4px 10px; border-radius: 5px; }
    .primary { border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .primary:hover { background: var(--vscode-button-hoverBackground); }
    .secondary { border: 1px solid var(--vscode-button-border, var(--vscode-widget-border)); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .question-item + .question-item { margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--vscode-widget-border); }
    .question-label { margin-bottom: 7px; font-weight: 600; }
    .option { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; margin: 6px 0; align-items: start; }
    .option input { margin: 3px 0 0; }
    .option-description { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .custom-answer { width: 100%; margin-top: 7px; padding: 6px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); outline: 0; border-radius: 4px; background: var(--vscode-input-background); }
    .composer-wrap { width: 100%; min-width: 0; padding: 0 10px 10px; overflow: hidden; background: linear-gradient(transparent, var(--vscode-sideBar-background) 18px); }
    .queue-dock { width: 100%; min-width: 0; max-width: 760px; margin: 0 auto 6px; padding: 7px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 9px; background: var(--vscode-editor-background); }
    .queue-head { min-width: 0; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .queue-title { min-width: 0; flex: 1; font-weight: 600; }
    .queue-row { min-width: 0; min-height: 30px; display: flex; align-items: center; gap: 6px; }
    .queue-row + .queue-row { border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); }
    .queue-preview { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .queue-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 3px; }
    .queue-action { min-height: 23px; padding: 1px 5px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
    .queue-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .queue-editor { width: 100%; min-width: 0; min-height: 30px; height: 30px; padding: 4px 6px; resize: none; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); }
    .composer { width: 100%; min-width: 0; max-width: 760px; margin: 0 auto; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 14px; background: var(--vscode-input-background); box-shadow: 0 2px 10px color-mix(in srgb, var(--vscode-widget-shadow) 75%, transparent); }
    .command-menu { max-height: 210px; padding: 5px; overflow-y: auto; border-bottom: 1px solid var(--vscode-widget-border); }
    .command-option { width: 100%; min-width: 0; padding: 7px 8px; display: block; border: 0; border-radius: 6px; text-align: left; background: transparent; }
    .command-option:hover, .command-option.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .command-option-line { min-width: 0; display: flex; align-items: baseline; gap: 7px; }
    .command-option-name { flex: 0 0 auto; font-family: var(--vscode-editor-font-family); font-weight: 600; }
    .command-option-hint { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .72; }
    .command-option-current { margin-left: auto; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-family: var(--vscode-font-family); font-size: 10px; font-weight: 500; }
    .command-option-description { margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .command-option:hover .command-option-description, .command-option.selected .command-option-description { color: inherit; opacity: .82; }
    .command-section-label { padding: 6px 8px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .policy-menu { max-height: 260px; }
    .policy-section-label { padding: 7px 8px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .context-chips, .attachments { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 10px 0; }
    .context-chip, .attachment-chip { min-width: 0; max-width: 100%; display: flex; align-items: center; gap: 5px; padding: 3px 5px 3px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); }
    .attachment-size { flex: 0 0 auto; color: var(--vscode-descriptionForeground); opacity: .8; font-size: 10px; }
    .context-chip.selection { color: var(--vscode-foreground); border-color: color-mix(in srgb, #4d6bfe 55%, var(--vscode-widget-border)); }
    .context-icon { flex: 0 0 auto; font-size: 12px; }
    .context-name, .attachment-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .context-remove, .attachment-remove { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; }
    .context-remove:hover, .attachment-remove:hover { background: var(--vscode-toolbar-hoverBackground); }
    .mode-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 10px 0; }
    .preset-chip { min-width: 0; max-width: 100%; min-height: 25px; padding: 2px 6px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); }
    .preset-chip.locked { opacity: .72; }
    .preset-icon, .preset-lock { flex: 0 0 auto; font-size: 10px; }
    .preset-select { min-width: 0; max-width: 210px; border: 0; outline: 0; color: var(--vscode-foreground); background: transparent; font-weight: 600; text-overflow: ellipsis; }
    .preset-select:disabled { color: var(--vscode-descriptionForeground); opacity: 1; }
    .plan-chip { min-height: 25px; padding: 2px 5px 2px 8px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid color-mix(in srgb, #4d6bfe 58%, var(--vscode-widget-border)); border-radius: 6px; color: var(--vscode-foreground); background: color-mix(in srgb, #4d6bfe 12%, var(--vscode-editor-background)); font-weight: 600; }
    .plan-chip-close { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; line-height: 1; }
    .plan-chip-close:hover { background: var(--vscode-toolbar-hoverBackground); }
    textarea { width: 100%; min-height: 72px; max-height: 220px; resize: none; display: block; padding: 11px 12px 4px; border: 0; outline: 0; background: transparent; color: var(--vscode-input-foreground); }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .composer-row { width: 100%; min-width: 0; min-height: 39px; padding: 4px 6px 6px; display: grid; grid-template-columns: 28px auto minmax(28px, .5fr) minmax(0, 1.2fr) minmax(46px, .55fr) auto; align-items: center; gap: 5px; }
    /* Every control keeps its own column even when one of them is hidden, and the
       permission column collapses to nothing when the runtime has no presets:
       auto-placement used to shift the model picker into the 20px project column. */
    .composer-row > #attach { grid-column: 1; }
    .composer-row > #policyTrigger { grid-column: 2; }
    .composer-row > #project { grid-column: 3; }
    .composer-row > #modelControl { grid-column: 4; }
    .composer-row > #efforts { grid-column: 5; }
    .composer-row > .run-actions { grid-column: 6; }
    .run-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
    .usage-control { position: relative; flex: 0 0 auto; }
    .usage-trigger { color: var(--vscode-descriptionForeground); }
    .usage-trigger:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .usage-track, .usage-fill { fill: none; stroke-width: 2; }
    .usage-track { stroke: var(--vscode-widget-border); }
    .usage-fill { stroke: var(--vscode-descriptionForeground); stroke-linecap: round; }
    .usage-trigger.warning .usage-fill { stroke: var(--vscode-editorWarning-foreground); }
    .usage-trigger.danger .usage-fill { stroke: var(--vscode-errorForeground); }
    .usage-panel { position: absolute; z-index: 30; right: -36px; bottom: calc(100% + 8px); width: min(264px, calc(100vw - 34px)); padding: 12px; border: 1px solid var(--vscode-widget-border); border-radius: 10px; color: var(--vscode-descriptionForeground); background: var(--vscode-menu-background); box-shadow: 0 7px 22px var(--vscode-widget-shadow); font-size: 11px; line-height: 18px; }
    .usage-header { display: flex; align-items: baseline; gap: 5px; }
    .usage-percent, .usage-figures { color: var(--vscode-foreground); font-weight: 600; }
    .usage-figures { margin-left: auto; font-variant-numeric: tabular-nums; }
    .usage-bar { height: 4px; margin: 10px 0 8px; display: flex; gap: 1px; overflow: hidden; border-radius: 999px; background: var(--vscode-toolbar-hoverBackground); }
    .usage-segment { min-width: 2px; height: 100%; border-radius: 1px; }
    .usage-system { background: var(--vscode-descriptionForeground); }
    .usage-tools { background: #a78bfa; }
    .usage-messages { background: #4d6bfe; }
    .usage-rows { margin: 0; }
    .usage-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0; }
    .usage-row dt, .usage-row dd { margin: 0; }
    .usage-row dd { color: var(--vscode-foreground); font-variant-numeric: tabular-nums; }
    .usage-swatch { width: 7px; height: 7px; margin-right: 6px; display: inline-block; border-radius: 2px; }
    .usage-stats { min-width: 0; padding: 0 12px 8px; overflow: hidden; color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .project { width: 100%; min-width: 0; height: 28px; padding: 0 4px; overflow: hidden; display: flex; align-items: center; gap: 5px; border: 0; border-radius: 6px; color: var(--vscode-descriptionForeground); background: transparent; }
    .project:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .project span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .project svg { width: 15px; height: 15px; flex: 0 0 auto; }
    .effort-select { width: 100%; min-width: 0; max-width: 100%; border: 0; outline: 0; color: var(--vscode-descriptionForeground); background: transparent; text-overflow: ellipsis; }
    .model-control { min-width: 0; }
    .model-trigger { width: 100%; min-width: 0; height: 28px; padding: 0 4px; overflow: hidden; display: flex; align-items: center; gap: 3px; border: 0; border-radius: 6px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 12px; text-align: left; }
    .model-trigger:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .model-trigger span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .model-trigger svg { width: 13px; height: 13px; flex: 0 0 auto; opacity: .8; }
    .model-menu { max-height: min(300px, 52vh); overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .model-search { width: 100%; height: 27px; padding: 0 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 5px; outline: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font-size: 12px; }
    .model-list { min-height: 0; margin-top: 5px; overflow: auto; }
    .model-group-label { padding: 7px 7px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .model-option { width: 100%; min-width: 0; padding: 6px 7px; display: flex; align-items: baseline; gap: 6px; border: 0; border-radius: 6px; color: var(--vscode-foreground); background: transparent; text-align: left; font-size: 12px; }
    .model-option:hover, .model-option.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .model-option-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .model-option-current { margin-left: auto; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 10px; }
    .model-empty { padding: 14px 8px; color: var(--vscode-descriptionForeground); text-align: center; font-size: 11px; }
    .policy-trigger.active { color: #4d6bfe; background: color-mix(in srgb, #4d6bfe 12%, transparent); }
    .policy-trigger.full-access { color: var(--vscode-editorWarning-foreground); }
    .send { border-radius: 8px; color: white; background: #4d6bfe; }
    .send:hover { background: #405de6; }
    .cancel { color: var(--vscode-errorForeground); }
    .cancel:hover { background: var(--vscode-toolbar-hoverBackground); }
    .send:disabled, textarea:disabled, button:disabled { opacity: .55; cursor: default; }
    .hidden { display: none !important; }
    @media (max-width: 330px) { .conversation { padding-inline: 10px; } .composer-row { grid-template-columns: 28px auto 20px minmax(0, 1fr) minmax(40px, .5fr) auto; } .project span { display: none; } }
  </style>
</head>
<body>
  <div id="app">
    <div id="dropOverlay" class="drop-overlay hidden"><div class="drop-card">Drop files or folders to add them</div></div>
    <header class="toolbar">
      <button id="githubStar" class="icon-button github-star" title="Star dsh-vscode on GitHub" aria-label="Star dsh-vscode on GitHub"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.6-4.4 6.3-.9z"/></svg></button>
      <div id="sessionControl" class="session-control">
        <button id="sessionTrigger" class="session-trigger" aria-label="Project conversations" aria-haspopup="dialog" aria-expanded="false"><span id="sessionTriggerTitle" class="session-trigger-title">New conversation</span><span id="sessionAttentionCount" class="session-attention-count hidden"></span><svg viewBox="0 0 24 24"><path d="m7 9.5 5 5 5-5"/></svg></button>
        <div id="sessionMenu" class="session-menu hidden" role="dialog" aria-label="Project conversations">
          <input id="sessionSearch" class="session-search" type="search" placeholder="Search conversations" aria-label="Search conversations">
          <div id="sessionList" class="session-list" role="listbox"></div>
        </div>
      </div>
      <div id="jobsControl" class="jobs-control hidden">
        <button id="jobsTrigger" class="icon-button jobs-trigger" title="Background jobs" aria-label="Background jobs" aria-haspopup="menu" aria-expanded="false"><span class="jobs-dot"></span><span id="jobsCount">0</span></button>
        <div id="jobsMenu" class="jobs-menu hidden" role="menu" aria-label="Background jobs"></div>
      </div>
      <div id="accountControl" class="account-control hidden">
        <button id="accountTrigger" class="icon-button account-trigger" title="DeepSeek account" aria-label="DeepSeek account" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg><span class="account-dot"></span></button>
        <div id="accountMenu" class="account-menu hidden" role="menu" aria-label="DeepSeek account"></div>
      </div>
      <button id="newSession" class="icon-button" title="New conversation" aria-label="New conversation"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    </header>
    <div class="conversation-pane">
      <main id="scroll" class="scroll" tabindex="0" aria-label="Conversation"><div id="conversation" class="conversation"><div id="conversationStatus" class="conversation-slot"></div><div id="conversationHistory" class="conversation-slot"></div><div id="messages" class="messages"></div><div id="conversationTail" class="conversation-slot"></div></div></main>
      <button id="jumpLatest" class="jump-latest" type="button" aria-label="Jump to latest" aria-controls="scroll" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-5-5 5 5 5-5"/></svg>Jump to latest</button>
    </div>
    <footer class="composer-wrap">
      <div id="queueDock" class="queue-dock hidden" aria-label="Queued messages"></div>
      <div class="composer">
        <div id="subagentBar" class="subagent-bar hidden" role="status"></div>
        <div id="routableNotice" class="routable-notice hidden" role="status"></div>
        <div id="modeChips" class="mode-chips hidden" aria-label="Active collaboration modes"></div>
        <div id="contextChips" class="context-chips hidden" aria-label="Editor context"></div>
        <div id="attachments" class="attachments hidden"></div>
        <div id="mentionMenu" class="command-menu hidden" role="listbox" aria-label="Files and folders"></div>
        <div id="commandMenu" class="command-menu hidden" role="listbox" aria-label="DeepSeek commands"></div>
        <div id="modelMenu" class="command-menu model-menu hidden" aria-label="Choose a model">
          <input id="modelSearch" class="model-search" type="text" placeholder="Search models" aria-label="Search models" role="combobox" aria-expanded="false" aria-controls="modelList" aria-autocomplete="list" autocomplete="off" spellcheck="false" />
          <div id="modelList" class="model-list" role="listbox" aria-label="Models"></div>
        </div>
        <div id="policyMenu" class="command-menu policy-menu hidden" role="menu" aria-label="Permissions"></div>
        <textarea id="prompt" rows="3" placeholder="Ask DeepSeek about this project" aria-label="Message DeepSeek"></textarea>
        <div class="composer-row">
          <button id="attach" class="icon-button" title="Attach image" aria-label="Attach image"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
          <button id="policyTrigger" class="icon-button policy-trigger hidden" title="Permissions" aria-label="Permissions" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6z"/><path d="m9.5 12 1.6 1.6 3.5-3.6"/></svg></button>
          <button id="project" class="project" title="Choose DeepSeek project" aria-label="Choose DeepSeek project"><svg viewBox="0 0 24 24"><path d="M3 7.5h7l2 2h9v9.5H3z"/><path d="M3 7.5V5h7l2 2h5"/></svg><span id="workspace">Workspace</span></button>
          <div id="modelControl" class="model-control">
            <button id="modelTrigger" class="model-trigger" type="button" title="Model" aria-label="Model" aria-haspopup="listbox" aria-expanded="false" disabled><span id="modelTriggerLabel">Model</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.5 5 5 5-5"/></svg></button>
            <!-- Value holder only: the trigger and its menu are what the user drives. -->
            <select id="models" class="sr-only" aria-label="Model" tabindex="-1" aria-hidden="true"></select>
          </div>
          <select id="efforts" class="effort-select" aria-label="Reasoning effort"></select>
          <div class="run-actions">
            <div id="usageControl" class="usage-control hidden">
              <button id="usageTrigger" class="icon-button usage-trigger" title="Context usage" aria-label="Context usage" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 14 14"><circle class="usage-track" cx="7" cy="7" r="5.5"/><circle id="usageFill" class="usage-fill" cx="7" cy="7" r="5.5" transform="rotate(-90 7 7)"/></svg></button>
              <div id="usagePanel" class="usage-panel hidden" role="dialog" aria-label="Context usage details"></div>
            </div>
            <button id="cancel" class="icon-button cancel hidden" title="Stop" aria-label="Stop"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg><span class="cancel-spinner"></span></button>
            <button id="send" class="icon-button send" title="Send (Enter)" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></svg></button>
          </div>
        </div>
        <div id="usageStats" class="usage-stats hidden"></div>
      </div>
    </footer>
  </div>
  <script nonce="${token}" src="${escapeHtml(markdownAssets.script.toString(true))}"></script>
  <script nonce="${token}" src="${escapeHtml(markdownAssets.scroll.toString(true))}"></script>
  <script nonce="${token}">
    const vscode = acquireVsCodeApi();
    window.addEventListener('error', event => {
      vscode.postMessage({ type: 'webview-error', message: event.message || 'Unknown webview error' });
    });
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unknown promise rejection');
      vscode.postMessage({ type: 'webview-error', message: reason });
    });
    const elements = {
      conversation: document.getElementById('conversation'), scroll: document.getElementById('scroll'),
      conversationStatus: document.getElementById('conversationStatus'), conversationHistory: document.getElementById('conversationHistory'), messages: document.getElementById('messages'), conversationTail: document.getElementById('conversationTail'),
      githubStar: document.getElementById('githubStar'), sessionControl: document.getElementById('sessionControl'), sessionTrigger: document.getElementById('sessionTrigger'), sessionTriggerTitle: document.getElementById('sessionTriggerTitle'), sessionAttentionCount: document.getElementById('sessionAttentionCount'), sessionMenu: document.getElementById('sessionMenu'), sessionSearch: document.getElementById('sessionSearch'), sessionList: document.getElementById('sessionList'), newSession: document.getElementById('newSession'), jobsControl: document.getElementById('jobsControl'), jobsTrigger: document.getElementById('jobsTrigger'), jobsCount: document.getElementById('jobsCount'), jobsMenu: document.getElementById('jobsMenu'),
      prompt: document.getElementById('prompt'), project: document.getElementById('project'), workspace: document.getElementById('workspace'),
      models: document.getElementById('models'), efforts: document.getElementById('efforts'),
      modelControl: document.getElementById('modelControl'), modelTrigger: document.getElementById('modelTrigger'),
      modelTriggerLabel: document.getElementById('modelTriggerLabel'), modelMenu: document.getElementById('modelMenu'),
      modelSearch: document.getElementById('modelSearch'), modelList: document.getElementById('modelList'),
      policyTrigger: document.getElementById('policyTrigger'), policyMenu: document.getElementById('policyMenu'),
      send: document.getElementById('send'), cancel: document.getElementById('cancel'),
      usageControl: document.getElementById('usageControl'), usageTrigger: document.getElementById('usageTrigger'), usageFill: document.getElementById('usageFill'), usagePanel: document.getElementById('usagePanel'), usageStats: document.getElementById('usageStats'),
      attach: document.getElementById('attach'), attachments: document.getElementById('attachments'),
      queueDock: document.getElementById('queueDock'), dropOverlay: document.getElementById('dropOverlay'),
      accountControl: document.getElementById('accountControl'), accountTrigger: document.getElementById('accountTrigger'), accountMenu: document.getElementById('accountMenu'),
      routableNotice: document.getElementById('routableNotice'), subagentBar: document.getElementById('subagentBar'),
      modeChips: document.getElementById('modeChips'), contextChips: document.getElementById('contextChips'), mentionMenu: document.getElementById('mentionMenu'), commandMenu: document.getElementById('commandMenu'),
    };
    let state;
    let draftImages = [];
    const draftImagesBySession = new Map();
    let draftFiles = [];
    const draftFilesBySession = new Map();
    /** Uploads handed to the extension but not yet seen settle, per session. */
    const pendingUploadsBySession = new Map();
    let ideContext = { pinned: [] };
    let commandIndex = 0;
    let mentionIndex = 0;
    let mentionRequestId = 0;
    let mentionCandidates = [];
    let queueEditing = null;
    let queueRenderSignature = '';
    let policyMenuOpen = false;
    let modelMenuOpen = false;
    /** The filtered models the menu is showing, in the order it shows them. */
    let modelChoices = [];
    /** Which of {@link modelChoices} the keyboard is on. */
    let modelIndex = 0;
    let usageOpen = false;
    let jobsOpen = false;
    let accountOpen = false;
    let sessionMenuOpen = false;
    let sessionActionId;
    let archivedOpen = false;
    /** Parents the user collapsed; subagents show by default so they are discoverable. */
    const collapsedSubagents = new Set();
    let armedJobId;
    let armedJobTimer;
    let jobsTimer;
    let historyAnchor;
    let renderFrame;
    let pendingRenderState;
    let renderedSessionId;
    let renderedStatusKey = '';
    let renderedHistoryKey = '';
    let renderedTail = {};
    let renderedChrome = {};
    const sessionDrafts = new Map();
    const pendingDraftSends = new Map();
    let draftSendRequestId = 0;
    const pendingAttachmentRequests = new Map();
    let attachmentRequestId = 0;
    const renderedMessages = new Map();
    /** Longest tail of the newest thought line kept in the collapsed summary. */
    const THINKING_PREVIEW_CHARS = 140;
    /** Elapsed label refresh while the model is thinking or a turn is running. */
    const THINKING_TICK_MS = 1000;
    /** A quiet turn reports how long it has been quiet only past this. */
    const QUIET_AFTER_MS = 15000;
    /** message id -> when the sidebar first saw it think, and its frozen total. */
    const thinkingTiming = new Map();
    let thinkingTicker;
    let liveStatusTicker;
    /** The live turn clock node, while a turn is running and the sidebar shows it. */
    let liveStatusNode;
    /** What the live turn clock was built for, so it is rebuilt only when it must. */
    let renderedLiveKey = '';
    /** What the user last chose for one tool's output, when they ever chose. */
    const toolOpenIntent = new Map();
    const loadingToolRequests = new Map();
    const toolOutputErrors = new Map();
    const toolOutputPages = new Map();
    const deferredOutputViews = new Map();
    const pendingMessageAppends = new Map();
    const pendingReasoningAppends = new Map();
    let toolOutputRequestId = 0;
    const toolOutputChunkSize = 20000;

    const conversationScroller = dshConversationScroll.createConversationScroller(elements.scroll, elements.conversation, document.getElementById('jumpLatest'));
    window.addEventListener('pagehide', () => { conversationScroller.dispose(); if (thinkingTicker !== undefined) { clearInterval(thinkingTicker); thinkingTicker = undefined; } if (liveStatusTicker !== undefined) { clearInterval(liveStatusTicker); liveStatusTicker = undefined; } }, { once: true });

    function node(tag, className, text) {
      const value = document.createElement(tag);
      if (className) value.className = className;
      if (text !== undefined) value.textContent = text;
      return value;
    }

    function relativeSessionTime(value) {
      const elapsed = Math.max(0, Date.now() - Number(value || 0));
      const minutes = Math.floor(elapsed / 60000);
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + 'h ago';
      const days = Math.floor(hours / 24);
      return days === 1 ? 'Yesterday' : days + 'd ago';
    }
    function closeSessionMenu(focusTrigger) {
      sessionMenuOpen = false; sessionActionId = undefined;
      elements.sessionSearch.value = '';
      elements.sessionMenu.classList.add('hidden'); elements.sessionTrigger.setAttribute('aria-expanded', 'false');
      if (focusTrigger) elements.sessionTrigger.focus();
    }
    function renderSessionCenter(current) {
      const sessions = array(current.sessions);
      const selected = sessions.find(session => session.id === current.sessionId);
      const waiting = sessions.filter(session => session.id !== current.sessionId && session.attention && (session.attention.approvals > 0 || session.attention.questions > 0)).length;
      const attentionCount = elements.sessionAttentionCount;
      attentionCount.textContent = String(waiting);
      attentionCount.classList.toggle('hidden', waiting === 0);
      attentionCount.title = waiting + ' other conversation(s) need your response';
      elements.sessionTriggerTitle.textContent = selected ? selected.title : 'New conversation';
      elements.sessionTrigger.title = selected ? selected.title : 'Project conversations';
      elements.sessionTrigger.setAttribute('aria-label', waiting ? 'Project conversations — ' + attentionCount.title : 'Project conversations');
      elements.sessionList.replaceChildren();
      const query = elements.sessionSearch.value.trim().toLocaleLowerCase();
      // A search flattens the tree: a matching subagent is more useful than the
      // collapsed parent it hides behind, and delegation can nest arbitrarily.
      const matching = session => !query || string(session.title).toLocaleLowerCase().includes(query)
        || string(session.subagent && session.subagent.label).toLocaleLowerCase().includes(query);
      const childrenOf = session => sessions.filter(child => child.parentId === session.id);
      const visible = query
        ? sessions.filter(matching).sort((left, right) => right.updatedAt - left.updatedAt)
        : sessions.filter(session => !session.parentId);
      const nested = query ? visible : sessions.filter(session => session.parentId);
      const archived = array(current.archivedSessions).filter(session => !query || string(session.title).toLocaleLowerCase().includes(query));
      const parentRow = current.parentSessionId ? sessions.find(session => session.id === current.parentSessionId) : undefined;
      if (parentRow) {
        const row = node('div', 'session-row session-ancestor');
        const main = node('button', 'session-main'); main.type = 'button';
        main.title = 'Back to “' + string(parentRow.title) + '”';
        main.append(node('span', 'session-ancestor-arrow', '↩'), node('span', 'session-name', string(parentRow.title)), node('span', 'session-meta', 'Owning conversation'));
        main.addEventListener('click', () => {
          closeSessionMenu(false);
          vscode.postMessage({ type: 'select-session', sessionId: parentRow.id });
        });
        row.append(main);
        elements.sessionList.append(row);
      }
      const anyRows = query ? visible.length > 0 : visible.length > 0 || nested.length > 0;
      if (!anyRows && !archived.length) {
        if (!parentRow) elements.sessionList.append(node('div', 'session-empty', query ? 'No matching conversations' : 'No conversations yet'));
        return;
      }
      const appendRow = (session, depth, ancestors) => {
        if (ancestors.has(session.id)) return;
        const seen = new Set(ancestors).add(session.id);
        const isChild = depth > 0;
        const active = session.id === current.sessionId;
        const hasChildren = session.childCount > 0;
        const row = node('div', 'session-row' + (active ? ' active' : '') + (isChild ? ' session-child' : '') + (hasChildren ? ' with-expander' : ''));
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(active));
        if (isChild) row.style.marginLeft = String(14 + (depth - 1) * 12) + 'px';
        const main = node('button', 'session-main'); main.type = 'button';
        const attention = session.attention;
        const waitingFor = attention && attention.approvals > 0 ? 'Awaiting approval' : attention && attention.questions > 0 ? 'Awaiting your answer' : '';
        const indicator = node('span', 'session-indicator' + (waitingFor ? ' attention' : session.running ? ' running' : session.unread ? ' unread' : ''));
        indicator.title = waitingFor || (session.running ? 'Running' : session.unread ? 'New activity' : '');
        if (session.subagent) {
          const mode = session.subagent.mode;
          main.append(node('span', 'session-subagent-badge ' + mode, mode === 'one-shot' ? 'One-shot' : mode === 'continuable' ? 'Subagent' : 'Subagent?'));
        }
        const title = node('span', 'session-name', string(session.subagent && session.subagent.label) || string(session.title, 'New conversation'));
        const meta = node('span', 'session-meta', waitingFor || (session.running ? 'Running' : session.unread ? 'New activity' : relativeSessionTime(session.updatedAt)));
        main.append(indicator, title, meta);
        main.addEventListener('click', () => {
          if (state && state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value);
          closeSessionMenu(false);
          if (!state || session.id !== state.sessionId) vscode.postMessage({ type: 'select-session', sessionId: session.id });
        });
        const children = childrenOf(session);
        // Subagents are shown by default: hiding them behind a disclosure is
        // what made delegated work invisible in the first place. A live or
        // waiting child outranks a manual collapse so the active row is never
        // the one that disappears.
        const mustShow = children.some(child => child.id === current.sessionId
          || child.running || (child.attention && (child.attention.approvals > 0 || child.attention.questions > 0)));
        const expanded = hasChildren && (Boolean(query) || mustShow || !collapsedSubagents.has(session.id));
        if (hasChildren) {
          const toggle = node('button', 'session-expander', expanded ? '▾' : '▸');
          toggle.type = 'button';
          // A live or waiting child pins the list open, so the control would be
          // inert; say why instead of accepting a click that does nothing.
          const pinnedOpen = expanded && mustShow && !query;
          toggle.disabled = pinnedOpen;
          toggle.title = pinnedOpen
            ? 'A subagent here is running or needs you, so its row stays visible'
            : expanded ? 'Hide subagents' : 'Show ' + String(session.childCount) + ' subagent session(s)';
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.addEventListener('click', event => {
            event.stopPropagation();
            if (expanded) collapsedSubagents.add(session.id); else collapsedSubagents.delete(session.id);
            renderSessionCenter(current);
          });
          row.append(toggle);
        }
        row.append(main);
        if (!session.blank && !isChild) {
          const more = node('button', 'session-more', '…'); more.type = 'button'; more.title = 'Conversation actions'; more.setAttribute('aria-label', 'Actions for ' + string(session.title));
          more.addEventListener('click', event => { event.stopPropagation(); sessionActionId = sessionActionId === session.id ? undefined : session.id; renderSessionCenter(current); });
          row.append(more);
          if (sessionActionId === session.id) {
            const actions = node('div', 'session-actions');
            const rename = node('button', 'session-action', 'Rename'); rename.type = 'button';
            rename.addEventListener('click', () => { closeSessionMenu(false); vscode.postMessage({ type: 'rename-session', sessionId: session.id }); });
            const archive = node('button', 'session-action danger', 'Archive'); archive.type = 'button';
            archive.addEventListener('click', () => { closeSessionMenu(false); vscode.postMessage({ type: 'archive-session', sessionId: session.id }); });
            actions.append(rename, archive); row.append(actions);
          }
        }
        elements.sessionList.append(row);
        // Delegation nests, so descend as far as the payload goes. A search
        // shows a flat list instead, because a matching grandchild is more
        // useful than the two collapsed ancestors it would hide behind.
        if (!query && hasChildren && expanded) {
          for (const child of children) appendRow(child, depth + 1, seen);
        }
      };
      for (const session of visible) appendRow(session, 0, new Set());
      if (archived.length) {
        const toggle = node('button', 'session-archived-toggle', (archivedOpen ? '▾ ' : '▸ ') + 'Archived (' + archived.length + ')');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(archivedOpen));
        toggle.title = archivedOpen ? 'Hide archived conversations' : 'Show archived conversations';
        toggle.addEventListener('click', () => { archivedOpen = !archivedOpen; renderSessionCenter(current); });
        elements.sessionList.append(toggle);
      }
      if (archivedOpen) {
        for (const session of archived) {
          const title = string(session.title, 'New conversation');
          const row = node('div', 'session-row archived');
          const main = node('button', 'session-main'); main.type = 'button';
          main.title = 'Restore “' + title + '” to the conversation list';
          main.setAttribute('aria-label', 'Restore ' + title);
          main.append(node('span', 'session-indicator'), node('span', 'session-name', title), node('span', 'session-meta', relativeSessionTime(session.updatedAt)));
          const restore = node('button', 'session-restore', 'Restore'); restore.type = 'button';
          restore.title = main.title;
          const restoreSession = () => { sessionActionId = undefined; vscode.postMessage({ type: 'unarchive-session', sessionId: session.id }); };
          main.addEventListener('click', restoreSession);
          restore.addEventListener('click', restoreSession);
          row.append(main, restore);
          elements.sessionList.append(row);
        }
      }
    }

    function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined; }
    function array(value) { return Array.isArray(value) ? value : []; }
    function string(value, fallback) { return typeof value === 'string' ? value : (fallback || ''); }
    function pretty(value) {
      if (typeof value === 'string') {
        try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
      }
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }
    function contentText(content) {
      return array(content).map(part => {
        const item = record(part);
        if (!item) return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        if (Array.isArray(item.content)) return contentText(item.content);
        return '';
      }).filter(Boolean).join('\\n');
    }
    function link(href, label) {
      const anchor = node('a', '', label || href);
      anchor.href = href;
      anchor.addEventListener('click', event => { event.preventDefault(); vscode.postMessage({ type: 'open-link', href }); });
      return anchor;
    }

    function fileReference(value) {
      const match = /^((?:[A-Za-z]:[\\\\/]|\\/)?(?:[A-Za-z0-9_@.+~-]+[\\\\/])*[A-Za-z0-9_@.+~-]+\\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\\d+))?(?::\\d+)?$/.exec(value);
      if (!match) return undefined;
      return { path: match[1], ...(match[2] ? { line: Number(match[2]) } : {}) };
    }
    function fileButton(path, line, label, className) {
      const button = node('button', 'file-link' + (className ? ' ' + className : ''), label || path);
      button.type = 'button'; button.title = 'Open ' + path + (line ? ':' + String(line) : '');
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); vscode.postMessage({ type: 'open-file', path, ...(line ? { line } : {}) }); });
      return button;
    }
    function appendFileText(parent, text) {
      const pattern = /(?:[A-Za-z]:[\\\\/]|\\/)?(?:[A-Za-z0-9_@.+~-]+[\\\\/])*[A-Za-z0-9_@.+~-]+\\.[A-Za-z][A-Za-z0-9]{0,9}(?::\\d+)?(?::\\d+)?/g;
      let last = 0;
      for (const match of text.matchAll(pattern)) {
        const index = match.index || 0;
        const reference = fileReference(match[0]);
        if (!reference) continue;
        if (index > last) parent.append(document.createTextNode(text.slice(last, index)));
        parent.append(fileButton(reference.path, reference.line, match[0]));
        last = index + match[0].length;
      }
      if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
    }

    function renderMarkdown(text) {
      return dshMarkdown.renderMarkdown(String(text || ''), {
        appendFileText, link,
        inlineCode(value) {
          const reference = fileReference(value);
          return reference ? fileButton(reference.path, reference.line, value, 'code-link') : node('code', '', value);
        },
      });
    }

    function createMarkdownStream(text) {
      const stream = {
        root: node('div', 'markdown'), text: '', committedOffset: 0, ...dshMarkdown.createMarkdownScanState(),
        tailNode: undefined, marker: document.createComment('stream-end'),
      };
      stream.root.append(stream.marker);
      appendMarkdownStream(stream, String(text || ''), true);
      return stream;
    }
    function appendMarkdownNodes(parent, text, before) {
      if (!text) return [];
      const parsed = text.length > toolOutputChunkSize ? node('div', 'streaming-plain', text) : renderMarkdown(text);
      const children = parsed.classList && parsed.classList.contains('streaming-plain') ? [parsed] : [...parsed.childNodes];
      for (const child of children) parent.insertBefore(child, before || null);
      return children;
    }
    function appendMarkdownStream(stream, delta, streaming) {
      const previousBoundary = stream.safeBoundary;
      stream.text += String(delta || '');
      dshMarkdown.scanMarkdownStream(stream, stream.text);
      const boundary = streaming ? stream.safeBoundary : stream.text.length;
      if (boundary > stream.committedOffset) {
        if (stream.tailNode) stream.tailNode.remove();
        stream.tailNode = undefined;
        appendMarkdownNodes(stream.root, stream.text.slice(stream.committedOffset, boundary), stream.marker);
        stream.committedOffset = boundary;
      }
      if (streaming && boundary < stream.text.length) {
        if (stream.tailNode && boundary === previousBoundary && stream.tailNode.firstChild) stream.tailNode.firstChild.appendData(String(delta || ''));
        else {
          if (stream.tailNode) stream.tailNode.remove();
          stream.tailNode = node('div', 'streaming-plain'); stream.tailNode.append(document.createTextNode(stream.text.slice(boundary)));
          stream.root.insertBefore(stream.tailNode, stream.marker);
        }
      } else if (stream.tailNode) {
        stream.tailNode.remove(); stream.tailNode = undefined;
      }
    }

    function toolTitle(message, callView, resultView) {
      return string(resultView && resultView.title) || string(callView && callView.title) || message.text || 'Tool';
    }
    function appendImages(parent, images) {
      if (!Array.isArray(images) || !images.length) return;
      const gallery = node('div', 'message-images');
      for (const value of images) {
        const image = record(value); if (!image) continue;
        if (typeof image.data === 'string' && typeof image.mediaType === 'string') {
          const element = document.createElement('img');
          element.className = 'message-image'; element.alt = string(image.name, 'DeepSeek image');
          element.width = Number(image.width) || 0; element.height = Number(image.height) || 0;
          element.src = 'data:' + image.mediaType + ';base64,' + image.data; gallery.append(element);
        } else {
          gallery.append(node('div', 'message-image-status' + (image.error ? ' failed' : ''), image.error || 'Loading image…'));
        }
      }
      if (gallery.childNodes.length) parent.append(gallery);
    }
    function appendPre(parent, text, className) {
      if (!text) return;
      parent.append(node('pre', className || '', String(text)));
    }
    function appendPrefixedPre(parent, text, prefix, className, continuation) {
      const value = String(text || '');
      if (!value) return;
      const element = node('pre', className || '', (continuation ? '' : prefix) + value.replace(/\\n/g, '\\n' + prefix));
      if (continuation) element.dataset.diffContinuation = 'true';
      parent.append(element);
    }
    function appendMarkdownPage(parent, text) {
      const value = String(text || '');
      if (!value) return;
      parent.append(renderMarkdown(value));
    }
    function appendItems(parent, values, appendItem) {
      if (!values.length) return;
      const container = node('div');
      for (const value of values) appendItem(container, value);
      parent.append(container);
    }
    function renderToolBody(message, callView, resultView) {
      const body = node('div', 'tool-body');
      const view = resultView || callView;
      const card = string(view && view.card, 'generic');
      if (card === 'terminal') {
        const cwd = string(callView && callView.cwd);
        if (cwd) body.append(node('div', 'result-title', cwd));
        const output = resultView && typeof resultView.output === 'string' ? resultView.output : message.rawResult || string(callView && callView.title);
        appendPre(body, output);
        if (resultView && (typeof resultView.exitCode === 'number' || resultView.signal)) body.append(node('div', '', resultView.signal ? 'Signal ' + resultView.signal : 'Exit ' + resultView.exitCode));
      } else if (card === 'diff') {
        const paths = [];
        for (const diffValue of array(view.diffs)) {
          const diff = record(diffValue); if (!diff) continue;
          const filePath = string(diff.path, 'File change');
          const continuation = diff.continuation === true;
          if (!continuation) {
            if (filePath !== 'File change' && !paths.includes(filePath)) paths.push(filePath);
            const pathRow = node('div', 'diff-path');
            pathRow.append(filePath === 'File change' ? document.createTextNode(filePath) : fileButton(filePath, undefined, filePath));
            body.append(pathRow);
          }
          if (typeof diff.oldText === 'string') appendPrefixedPre(body, diff.oldText, '- ', 'diff-old', continuation);
          appendPrefixedPre(body, string(diff.newText), '+ ', 'diff-new', continuation);
        }
        for (const filePath of paths) {
          const actions = node('div', 'tool-actions');
          const open = node('button', 'tool-action', paths.length === 1 ? 'Open File' : 'Open ' + filePath);
          open.type = 'button'; open.addEventListener('click', () => vscode.postMessage({ type: 'open-file', path: filePath })); actions.append(open);
          if (!message.streaming && !message.failed) {
            const review = node('button', 'tool-action', paths.length === 1 ? 'Review Changes' : 'Review ' + filePath);
            review.type = 'button'; review.addEventListener('click', () => vscode.postMessage({ type: 'review-file', path: filePath })); actions.append(review);
          }
          body.append(actions);
        }
      } else if (card === 'read') {
        const filePath = string(view.path, 'File'); const title = node('div', 'result-title');
        title.append(filePath === 'File' ? document.createTextNode(filePath) : fileButton(filePath, Number(view.offset) || undefined, filePath)); body.append(title);
        const lines = array(view.lines);
        if (lines.length) appendItems(body, lines, (container, value) => {
          const line = record(value); if (line) container.append(node('div', 'source-line', String(line.number).padStart(4, ' ') + '  ' + string(line.text)));
        });
        else appendPre(body, message.rawResult);
      } else if (card === 'search') {
        if (view.shape === 'paths') appendItems(body, array(view.paths), (container, pathValue) => {
          const filePath = string(pathValue); const row = node('div', 'source'); if (filePath) row.append(fileButton(filePath, undefined, filePath)); container.append(row);
        });
        if (view.shape === 'matches') {
          const matches = [];
          for (const fileValue of array(view.files)) {
            const file = record(fileValue); if (!file) continue; const filePath = string(file.path);
            matches.push({ kind: 'file', path: filePath });
            for (const matchValue of array(file.matches)) matches.push({ kind: 'match', path: filePath, value: matchValue });
          }
          appendItems(body, matches, (container, entry) => {
            if (entry.kind === 'file') { const title = node('div', 'result-title'); if (entry.path) title.append(fileButton(entry.path, undefined, entry.path)); container.append(title); return; }
            const match = record(entry.value); if (!match) return; const line = Number(match.lineNumber) || undefined; const row = node('div', 'source');
            if (entry.path) row.append(fileButton(entry.path, line, String(match.lineNumber) + ': ' + string(match.line))); container.append(row);
          });
        }
        if (view.truncated === true) body.append(node('div', '', 'Showing a limited result set (' + String(view.total || '') + ' total).'));
      } else if (card === 'web') {
        if (typeof view.answer === 'string') {
          if (view.plainText === true) body.append(node('div', 'streaming-plain', view.answer));
          else appendMarkdownPage(body, view.answer);
        }
        appendItems(body, array(view.sources), (container, sourceValue) => { const source = record(sourceValue); if (source && typeof source.url === 'string') container.append(link(source.url, string(source.title) || source.url)); });
        if (typeof view.url === 'string') body.append(link(view.url, view.url));
      } else {
        const presented = contentText(view && view.content);
        const raw = presented || message.rawResult || message.rawInput || (view && view.rawInput !== undefined ? view.rawInput : '');
        if (raw) appendPre(body, typeof raw === 'string' && raw.length > toolOutputChunkSize ? raw : pretty(raw));
        for (const locationValue of array(callView && callView.locations)) {
          const location = record(locationValue); if (!location) continue; const filePath = string(location.path); const line = Number(location.line) || undefined; const row = node('div', 'source');
          if (filePath) row.append(fileButton(filePath, line, filePath + (line ? ':' + String(line) : ''))); body.append(row);
        }
      }
      appendImages(body, message.images);
      return body;
    }
    function cancelDeferredRequest(messageId) {
      const request = loadingToolRequests.get(messageId);
      if (request) clearTimeout(request.timer);
      loadingToolRequests.delete(messageId);
    }
    function resetDeferredOutput(messageId) {
      cancelDeferredRequest(messageId); toolOutputPages.delete(messageId); toolOutputErrors.delete(messageId); deferredOutputViews.delete(messageId);
    }
    function prepareDeferredOutput(message) {
      const loaded = toolOutputPages.get(message.id);
      if (loaded && loaded.revision !== message.deferredBodyRevision) resetDeferredOutput(message.id);
    }
    function appendDeferredPage(parent, page, renderPage) {
      const rendered = renderPage(page);
      const continuation = rendered.querySelector('pre[data-diff-continuation="true"]');
      if (continuation) {
        const selector = continuation.classList.contains('diff-old') ? 'pre.diff-old' : 'pre.diff-new';
        const candidates = parent.querySelectorAll(selector);
        const target = candidates[candidates.length - 1];
        if (target) { target.textContent += continuation.textContent; return; }
      }
      parent.append(rendered);
    }
    function attachDeferredOutput(message, parent, renderPage, autoLoad, initialLabel) {
      prepareDeferredOutput(message);
      const pages = node('div'); const controls = node('div'); parent.append(pages, controls);
      const loaded = toolOutputPages.get(message.id) || { pages: [], nextCursor: undefined, revision: message.deferredBodyRevision };
      toolOutputPages.set(message.id, loaded);
      for (const page of loaded.pages) appendDeferredPage(pages, page, renderPage);
      function load(cursor) {
        if (loadingToolRequests.has(message.id)) return;
        const requestId = ++toolOutputRequestId;
        const timer = setTimeout(() => {
          const pending = loadingToolRequests.get(message.id);
          if (!pending || pending.requestId !== requestId) return;
          loadingToolRequests.delete(message.id); toolOutputErrors.set(message.id, { message: 'Output took too long to load.', cursor }); controller.renderControls();
        }, 15000);
        loadingToolRequests.set(message.id, { requestId, cursor, timer }); toolOutputErrors.delete(message.id); controller.renderControls();
        vscode.postMessage({ type: 'load-tool-output', messageId: message.id, sessionId: state && state.sessionId, requestId, ...(cursor ? { cursor } : {}) });
      }
      const controller = {
        revision: message.deferredBodyRevision,
        append(page, nextCursor) {
          appendDeferredPage(pages, page, renderPage); loaded.pages.push(page); loaded.nextCursor = nextCursor; controller.renderControls();
        },
        renderControls() {
          controls.replaceChildren();
          const error = toolOutputErrors.get(message.id);
          if (error) {
            controls.append(node('div', 'status error', error.message));
            const retry = node('button', 'tool-output-more', 'Retry'); retry.type = 'button'; retry.addEventListener('click', () => load(error.cursor)); controls.append(retry); return;
          }
          if (loadingToolRequests.has(message.id)) { controls.append(node('div', 'tool-output-loading', 'Loading output…')); return; }
          if (loaded.pages.length === 0) {
            if (autoLoad !== false) load(undefined);
            else {
              const show = node('button', 'tool-output-more', initialLabel || 'Show output'); show.type = 'button'; show.addEventListener('click', () => load(undefined)); controls.append(show);
            }
            return;
          }
          if (loaded.nextCursor) {
            const more = node('button', 'tool-output-more', 'Show more'); more.type = 'button'; more.addEventListener('click', () => load(loaded.nextCursor)); controls.append(more);
          }
        },
      };
      deferredOutputViews.set(message.id, controller); controller.renderControls();
    }
    /**
     * Whether one tool's output is expanded when it is (re)rendered.
     *
     * A running or failed tool opens itself so its progress is visible, but that
     * is not a choice the user made. Assigning the open property queues a toggle
     * event that is dispatched *after* the listener below is attached, so treating
     * every toggle as intent recorded the self-opened state as if the user had
     * clicked: every tool stayed expanded for the rest of the conversation, and
     * only a model slow enough to paint its running state first made it obvious.
     */
    function toolStartsOpen(message) {
      const intent = toolOpenIntent.get(message.id);
      if (intent !== undefined) return intent;
      return message.streaming === true || message.failed === true;
    }
    function renderTool(message) {
      const callView = record(message.callView);
      const resultView = record(message.resultView);
      const item = document.createElement('details');
      item.className = 'tool' + (message.failed ? ' failed' : '');
      item.open = toolStartsOpen(message);
      const summary = document.createElement('summary');
      summary.append(node('span', 'tool-icon', message.streaming ? '●' : (message.failed ? '!' : '✓')));
      summary.append(node('span', 'tool-title', toolTitle(message, callView, resultView)));
      summary.append(node('span', 'tool-detail', message.detail || ''));
      summary.addEventListener('click', () => { if (!item.open) conversationScroller.pause(); });
      item.append(summary);
      let contentInitialized = false;
      const initializeContent = () => {
        if (contentInitialized) return;
        contentInitialized = true;
        if (message.deferredBody === true) {
          const body = node('div', 'tool-body'); item.append(body); attachDeferredOutput(message, body, page => renderToolBody(page, record(page.callView), record(page.resultView)));
        } else item.append(renderToolBody(message, callView, resultView));
      };
      if (item.open) initializeContent();
      // What this code chose, so the queued echo of it is not read as a click.
      let chosen = item.open;
      item.addEventListener('toggle', () => {
        if (item.open === chosen) return;
        chosen = item.open;
        toolOpenIntent.set(message.id, item.open);
        if (item.open) initializeContent();
      });
      return item;
    }
    function renderCommand(message) {
      const item = node('div', 'command-card' + (message.failed ? ' failed' : ''));
      const head = node('div', 'command-head');
      head.append(node('span', 'tool-icon', message.streaming ? '●' : (message.failed ? '!' : '✓')));
      head.append(node('span', 'command-name', message.text));
      head.append(node('span', 'tool-detail', message.detail || ''));
      item.append(head);
      if (message.deferredBody === true) {
        const result = node('div', 'command-result'); item.append(result); attachDeferredOutput(message, result, page => renderToolBody(page, record(page.callView), record(page.resultView)), false, 'Show command output');
      } else if (message.rawResult) { const result = node('div', 'command-result'); appendPre(result, message.rawResult); item.append(result); }
      return item;
    }
    function renderChangedFiles(groups) {
      const box = node('section', 'changed-files'); const head = node('div', 'changed-files-head');
      head.append(node('span', 'changed-files-title', 'Changed Files'));
      const allFiles = groups.flatMap(group => group.files || []); const allRevertible = allFiles.length > 0 && allFiles.every(file => file.canRevert === true);
      const actions = node('div', 'changed-files-actions');
      const reviewAll = node('button', 'changed-action', 'Open All'); reviewAll.type = 'button'; reviewAll.addEventListener('click', () => vscode.postMessage({ type: 'review-all' })); actions.append(reviewAll);
      const keepAll = node('button', 'changed-action', 'Keep All'); keepAll.type = 'button'; keepAll.addEventListener('click', () => vscode.postMessage({ type: 'keep-all' })); actions.append(keepAll);
      const revertAll = node('button', 'changed-action danger', 'Revert All'); revertAll.type = 'button'; revertAll.disabled = !allRevertible; if (!allRevertible) revertAll.title = 'Full snapshots are unavailable for one or more files'; revertAll.addEventListener('click', () => vscode.postMessage({ type: 'revert-all' })); actions.append(revertAll); head.append(actions); box.append(head);
      for (const group of groups) {
        const section = node('div', 'changed-turn'); section.append(node('div', 'changed-turn-title', group.turn > 0 ? 'Turn ' + String(group.turn) : 'Earlier changes'));
        for (const file of group.files || []) {
          const row = node('div', 'changed-file'); row.append(fileButton(file.path, undefined, file.path));
          const stats = node('span', 'changed-file-stats'); stats.append(node('span', 'change-additions', '+' + String(file.additions || 0)), node('span', 'change-deletions', '−' + String(file.deletions || 0))); row.append(stats);
          const fileActions = node('div', 'changed-file-actions');
          const review = node('button', 'changed-action', 'Open Diff'); review.type = 'button'; review.addEventListener('click', () => vscode.postMessage({ type: 'review-file', path: file.path, turn: group.turn })); fileActions.append(review);
          const keep = node('button', 'changed-action', 'Keep'); keep.type = 'button'; keep.addEventListener('click', () => vscode.postMessage({ type: 'keep-file', path: file.path, turn: group.turn })); fileActions.append(keep);
          const revert = node('button', 'changed-action danger', 'Revert'); revert.type = 'button'; revert.disabled = file.canRevert !== true; if (revert.disabled) revert.title = 'Full snapshot unavailable after reloading this session'; revert.addEventListener('click', () => vscode.postMessage({ type: 'revert-file', path: file.path, turn: group.turn })); fileActions.append(revert); row.append(fileActions); section.append(row);
        }
        box.append(section);
      }
      return box;
    }
    function renderPendingSteering(item) {
      const bubble = node('article', 'message user pending-steering');
      const body = node('div', 'message-body', item.preview || 'Steering message');
      bubble.append(body); return bubble;
    }
    function renderAssistantPage(page) {
      // Always markdown: the plainText flag describes an opaque tool result,
      // while an assistant page is the model's answer even when it arrives in pages.
      const body = renderMarkdown(page.text);
      body.classList.add('assistant-page'); appendImages(body, page.images); return body;
    }
    function hasThinking(message) { return typeof message.reasoning === 'string' && message.reasoning !== ''; }
    /**
     * The newest line of thinking, which is what keeps the summary moving.
     * Showing the first characters instead made a live turn look frozen: the
     * preview stopped changing the moment the model passed 140 characters.
     * Long lines keep their tail, because that is where writing continues.
     */
    function thinkingPreview(text) {
      const lines = String(text || '').split('\\n');
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].replace(/\\s+/g, ' ').trim();
        if (line === '') continue;
        return line.length > THINKING_PREVIEW_CHARS ? '…' + line.slice(-THINKING_PREVIEW_CHARS) : line;
      }
      return '';
    }

    function thinkingElapsed(message) {
      const id = message.id;
      const live = message.streaming === true;
      if (id === undefined) return live ? 0 : undefined;
      let entry = thinkingTiming.get(id);
      if (entry === undefined) { entry = { startedAt: Date.now(), frozen: undefined }; thinkingTiming.set(id, entry); }
      // Freeze on settle so a finished turn stops counting up.
      if (!live && entry.frozen === undefined) entry.frozen = Date.now() - entry.startedAt;
      return live ? Date.now() - entry.startedAt : entry.frozen;
    }

    function thinkingLabel(message) {
      const elapsed = thinkingElapsed(message);
      const live = message.streaming === true;
      const title = live ? 'Thinking' : 'Thought';
      if (elapsed === undefined || elapsed < 1000) return title;
      return title + ' · ' + formatLiveDuration(elapsed);
    }

    /**
     * DSH's live run clock: 12s, 2m 5s, 1h 02m 05s.
     *
     * One formatter for every duration the sidebar ticks, so the thinking
     * summary and the turn clock cannot read the same wait two different ways.
     */
    function formatLiveDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const seconds = total % 60;
      const minutes = Math.floor(total / 60) % 60;
      const hours = Math.floor(total / 3600);
      if (hours > 0) return hours + 'h ' + (minutes < 10 ? '0' : '') + minutes + 'm ' + (seconds < 10 ? '0' : '') + seconds + 's';
      if (minutes > 0) return minutes + 'm ' + seconds + 's';
      return seconds + 's';
    }

    /**
     * The live turn clock, the sidebar's answer to DSH's "Deep diving for 12s".
     *
     * A running turn that has sent nothing for a while looked exactly like one
     * that had died, because the sidebar showed no state at all while it waited.
     * The clock ticks either way, so the age of the newest runtime event is what
     * separates a quiet turn from a stalled one.
     */
    function liveStatusText(current) {
      if (current.stopping === true) return 'Stopping…';
      const startedAt = Number(current.turnStartedAt) || 0;
      const activityAt = Number(current.turnActivityAt) || 0;
      const label = startedAt === 0 ? 'Deep diving…' : 'Deep diving for ' + formatLiveDuration(Date.now() - startedAt);
      if (activityAt === 0) return label;
      const quiet = Date.now() - activityAt;
      return quiet < QUIET_AFTER_MS ? label : label + ' · no new output for ' + formatLiveDuration(quiet);
    }
    function renderLiveStatus(current) {
      const box = node('div', 'live-status' + (current.stopping === true ? ' stopping' : ''));
      // The announcement is a separate, constant string: the visible clock
      // rewrites itself every second, and a live region would read all of it.
      const announced = node('span', 'sr-only', current.stopping === true ? 'Stopping' : 'Deep diving');
      announced.setAttribute('role', 'status');
      box.append(node('span', 'live-status-dot'), node('span', 'live-status-text', liveStatusText(current)), announced);
      return box;
    }
    /** Refresh the live text in place; the ticking clock must not rebuild the DOM. */
    function syncLiveStatus(current) {
      if (liveStatusNode === undefined) return;
      const text = liveStatusText(current);
      const label = liveStatusNode.querySelector('.live-status-text');
      if (label === null || label.textContent === text) return;
      // The label grows as the duration lengthens and the quiet note appears, and
      // a wrapped label makes the turn taller without a state change; the
      // scroller's own ResizeObserver on the content is what re-pins a reader.
      label.textContent = text;
    }
    function syncLiveStatusTicker() {
      const live = state !== undefined && state.phase === 'ready' && state.running === true;
      if (live && liveStatusTicker === undefined) {
        liveStatusTicker = setInterval(() => { if (state !== undefined) syncLiveStatus(state); }, THINKING_TICK_MS);
      } else if (!live && liveStatusTicker !== undefined) {
        clearInterval(liveStatusTicker); liveStatusTicker = undefined;
      }
    }
    /** One timer drives every live summary, and stops as soon as none is live. */
    function syncThinkingTicker() {
      let live = false;
      for (const rendered of renderedMessages.values()) {
        if (rendered.thinking !== undefined && rendered.thinking.message.streaming === true) { live = true; break; }
      }
      if (live && thinkingTicker === undefined) {
        thinkingTicker = setInterval(() => {
          for (const rendered of renderedMessages.values()) {
            if (rendered.thinking !== undefined && rendered.thinking.message.streaming === true) syncThinking(rendered.thinking, rendered.message);
          }
        }, THINKING_TICK_MS);
      } else if (!live && thinkingTicker !== undefined) {
        clearInterval(thinkingTicker); thinkingTicker = undefined;
      }
    }
    /** Collapsed-by-default model thinking, folded above the answer. */
    function renderThinking(message) {
      const root = document.createElement('details');
      root.className = 'thinking';
      const summary = document.createElement('summary');
      const title = node('span', 'thinking-title', thinkingLabel(message));
      const preview = node('span', 'thinking-preview', thinkingPreview(message.reasoning));
      summary.append(node('span', 'thinking-icon', '✦'), title, preview);
      const body = node('div', 'thinking-body');
      root.append(summary, body);
      const thinking = { root, title, preview, body, message };
      applyThinkingState(thinking, message);
      // A collapsed body is never materialized, so long thinking stays cheap.
      root.addEventListener('toggle', () => { if (root.open) body.textContent = thinking.message.reasoning || ''; });
      if (root.open) body.textContent = message.reasoning || '';
      return thinking;
    }
    /** One place decides what a thinking summary shows, for render and refresh. */
    function applyThinkingState(thinking, message) {
      thinking.message = message;
      const live = message.streaming === true;
      thinking.root.classList.toggle('live', live);
      thinking.title.textContent = thinkingLabel(message);
      thinking.preview.textContent = thinkingPreview(message.reasoning);
      if (thinking.root.open) thinking.body.textContent = message.reasoning || '';
    }
    function syncThinking(thinking, message) {
      applyThinkingState(thinking, message);
    }
    // Indexed once per published batch: a conversation with a thousand messages
    // would otherwise scan the whole table for every message on every render,
    // and renders happen on every streamed chunk.
    let metaIndex = { source: null, byId: new Map() };
    function messageMetaFor(id) {
      const list = (state && state.messageMeta) || [];
      if (metaIndex.source !== list) {
        const byId = new Map();
        for (const entry of list) if (entry && typeof entry.id === 'string') byId.set(entry.id, entry);
        metaIndex = { source: list, byId };
      }
      return metaIndex.byId.get(id);
    }
    /** The clock DSH shows: time alone on the same day, date above it otherwise. */
    function formatMessageClock(time) {
      if (typeof time !== 'number' || !Number.isFinite(time)) return '';
      const at = new Date(time);
      if (Number.isNaN(at.getTime())) return '';
      const pad = value => (value < 10 ? '0' : '') + String(value);
      const clock = pad(at.getHours()) + ':' + pad(at.getMinutes());
      const now = new Date();
      if (at.toDateString() === now.toDateString()) return clock;
      if (at.getFullYear() === now.getFullYear()) return (at.getMonth() + 1) + '/' + at.getDate() + ' ' + clock;
      return at.getFullYear() + '-' + (at.getMonth() + 1) + '-' + at.getDate() + ' ' + clock;
    }
    function compactTokens(count) {
      if (typeof count !== 'number' || !Number.isFinite(count)) return '0';
      if (count < 1000) return String(count);
      const scaled = count < 1000000 ? count / 1000 : count / 1000000;
      const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
      return String(rounded) + (count < 1000000 ? 'K' : 'M');
    }
    function exactTokens(count) { return Number(count || 0).toLocaleString('en-US'); }
    /** The fields the usage panel lists, in DSH's order. */
    function usageLines(turnUsage) {
      const lines = [];
      if (turnUsage.routes && turnUsage.routes.length) lines.push('Provider / model: ' + turnUsage.routes.join(', '));
      const cached = turnUsage.cacheReadTokens;
      const uncached = Number(turnUsage.uncachedInputTokens || 0);
      if (cached !== undefined) {
        const input = cached + uncached;
        lines.push('Cache hit: ' + (input > 0 ? String(Math.round((cached / input) * 100)) : '0') + '%');
      }
      lines.push('Uncached input: ' + exactTokens(uncached));
      if (cached !== undefined) lines.push('Cached input: ' + exactTokens(cached));
      if (turnUsage.cacheWriteTokens !== undefined) lines.push('Cache write: ' + exactTokens(turnUsage.cacheWriteTokens));
      lines.push('Output: ' + exactTokens(turnUsage.outputTokens)
        + (turnUsage.reasoningTokens === undefined ? '' : ' (' + exactTokens(turnUsage.reasoningTokens) + ' reasoning)'));
      return lines;
    }
    function copyMessageText(message, button) {
      const text = typeof message.text === 'string' ? message.text : '';
      const restore = () => window.setTimeout(() => {
        button.textContent = '⧉'; button.title = 'Copy'; button.setAttribute('aria-label', 'Copy');
      }, 1000);
      const confirm = () => {
        button.textContent = '✓'; button.title = 'Copied'; button.setAttribute('aria-label', 'Copied');
        restore();
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(confirm, () => { vscode.postMessage({ type: 'copy-text', text }); confirm(); });
        return;
      }
      vscode.postMessage({ type: 'copy-text', text });
      confirm();
    }
    function feedbackFor(messageId) {
      const list = (state && state.messageFeedback) || [];
      for (const entry of list) if (entry && entry.messageId === messageId) return entry;
      return undefined;
    }
    function feedbackButton(glyph, rating, messageId, current) {
      const active = current === rating;
      const button = node('button', 'message-action message-' + rating + (active ? ' active' : ''), glyph);
      button.type = 'button';
      // The recorded rating says "Remove rating", which is what clicking it does.
      const label = active ? 'Remove rating' : (rating === 'positive' ? 'Good response' : 'Bad response');
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.addEventListener('click', () => vscode.postMessage({
        type: 'message-feedback', sessionId: state && state.sessionId, messageId, rating,
      }));
      return button;
    }
    function branchButton(meta) {
      const button = node('button', 'message-action message-branch', '⑂');
      button.type = 'button';
      button.title = 'Branch into a new conversation';
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => vscode.postMessage({
        type: 'fork-conversation', sessionId: state && state.sessionId, atSeq: meta.seq,
      }));
      return button;
    }
    /**
     * A user message's row: the clock and a copy, with the clock first, and no
     * rating or branch — DSH gives those to the reply only.
     */
    function renderUserActions(message, meta) {
      const row = node('div', 'message-actions user-actions');
      const list = (state && state.messages) || [];
      if (list.length > 0 && list[list.length - 1].id === message.id) row.classList.add('always');
      const clock = formatMessageClock(meta.time);
      if (clock !== '') row.append(node('span', 'message-clock', clock));
      const copy = node('button', 'message-action message-copy', '⧉');
      copy.type = 'button'; copy.title = 'Copy'; copy.setAttribute('aria-label', 'Copy');
      copy.addEventListener('click', () => copyMessageText(message, copy));
      row.append(copy);
      return row;
    }
    /**
     * Whether one term matches a field, the way DSH's picker does it: every
     * character of the term has to appear in order, so "fsh" finds "Flash"
     * while "hsf" does not.
     */
    function fuzzyMatch(haystack, term) {
      let index = 0;
      for (const character of term) {
        index = haystack.indexOf(character, index);
        if (index === -1) return false;
        index += 1;
      }
      return true;
    }
    /**
     * The models the search box admits, in the provider order DSH sorts them in.
     *
     * Each term has to match one field on its own rather than a joined haystack:
     * joined fields let a term span two of them through a provider id, so an
     * unrelated model matched on letters that were never adjacent, and the query
     * stopped meaning anything.
     */
    function modelMatches(query) {
      const models = (state && state.models) || [];
      const terms = String(query || '').toLowerCase().split(/\\s+/).filter(term => term !== '');
      if (terms.length === 0) return models.slice();
      return models.filter(model => {
        const fields = [model.label, model.providerLabel, model.provider, model.model]
          .filter(value => typeof value === 'string').map(value => value.toLowerCase());
        return terms.every(term => fields.some(field => fuzzyMatch(field, term)));
      });
    }
    function modelChoiceLabel(model) {
      return typeof model.label === 'string' && model.label !== '' ? model.label : model.model;
    }
    function modelChoiceProvider(model) {
      return typeof model.providerLabel === 'string' && model.providerLabel !== '' ? model.providerLabel : model.provider;
    }
    /** The value the hidden select carries for one model, built in one place. */
    function modelValue(model) {
      return JSON.stringify({ provider: model.provider, model: model.model });
    }
    function highlightModel() {
      const options = [...elements.modelList.querySelectorAll('.model-option')];
      for (const [index, option] of options.entries()) option.classList.toggle('selected', index === modelIndex);
      const current = options[modelIndex];
      // The focus stays in the search box, so the highlighted option has to be
      // named for a screen reader rather than moved to.
      if (current === undefined) elements.modelSearch.removeAttribute('aria-activedescendant');
      else elements.modelSearch.setAttribute('aria-activedescendant', current.id);
      if (current !== undefined && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest' });
    }
    /** The provider groups, filtered by the search box and marked with the current choice. */
    function renderModelMenu() {
      // A catalog change can arrive while the menu is open; keep the highlight on
      // the model the user put it on rather than on whatever lands in that slot.
      const highlighted = modelChoices[modelIndex];
      elements.modelList.replaceChildren();
      modelChoices = modelMatches(elements.modelSearch.value);
      const moved = highlighted === undefined ? -1 : modelChoices.indexOf(highlighted);
      modelIndex = moved === -1 ? 0 : moved;
      const groups = new Map();
      for (const [choiceIndex, model] of modelChoices.entries()) {
        const provider = model.provider;
        let section = groups.get(provider);
        if (section === undefined) {
          section = node('div', 'model-group');
          section.setAttribute('role', 'group');
          section.setAttribute('aria-label', modelChoiceProvider(model));
          const heading = node('div', 'model-group-label', modelChoiceProvider(model));
          heading.setAttribute('role', 'presentation');
          section.append(heading);
          elements.modelList.append(section);
          groups.set(provider, section);
        }
        const option = node('button', 'model-option');
        option.type = 'button';
        option.id = 'model-option-' + String(choiceIndex);
        option.setAttribute('role', 'option');
        // The search box keeps the focus and names the highlight, so an option
        // must not be a tab stop: one Tab would land on it and kill the arrows.
        option.tabIndex = -1;
        option.append(node('span', 'model-option-label', modelChoiceLabel(model)));
        if (model.selected === true) {
          option.setAttribute('aria-selected', 'true');
          const badge = node('span', 'model-option-current', 'Current');
          // The option's own label already says it is selected.
          badge.setAttribute('aria-hidden', 'true');
          option.append(badge);
        }
        option.addEventListener('click', () => chooseModel(model));
        option.addEventListener('mousemove', () => {
          if (choiceIndex === modelIndex) return;
          modelIndex = choiceIndex; highlightModel();
        });
        section.append(option);
      }
      if (modelChoices.length === 0) {
        const empty = node('div', 'model-empty', 'No model matches');
        // A listbox may only hold options, so the empty state says so as one.
        empty.setAttribute('role', 'option');
        empty.setAttribute('aria-disabled', 'true');
        elements.modelList.append(empty);
      }
      if (modelIndex >= modelChoices.length) modelIndex = 0;
      highlightModel();
    }
    function openModelMenu() {
      if (elements.models.disabled) return;
      policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false');
      elements.commandMenu.classList.add('hidden'); elements.mentionMenu.classList.add('hidden');
      modelMenuOpen = true; modelIndex = 0; modelChoices = []; elements.modelSearch.value = '';
      elements.modelMenu.classList.remove('hidden');
      elements.modelTrigger.setAttribute('aria-expanded', 'true');
      elements.modelSearch.setAttribute('aria-expanded', 'true');
      renderModelMenu();
      elements.modelSearch.focus();
    }
    function closeModelMenu(focusTrigger) {
      if (!modelMenuOpen) return;
      modelMenuOpen = false;
      elements.modelMenu.classList.add('hidden');
      elements.modelTrigger.setAttribute('aria-expanded', 'false');
      elements.modelSearch.setAttribute('aria-expanded', 'false');
      if (focusTrigger) elements.modelTrigger.focus();
    }
    /** Pick one model, then let the effort picker follow it, exactly as the select did. */
    function chooseModel(model) {
      closeModelMenu(true);
      const value = modelValue(model);
      // Re-picking the model that is already chosen must not undo an effort the
      // user set afterwards, which is what a native select did by staying silent.
      if (value === elements.models.value) return;
      applyModelSelection(value);
    }
    function applyModelSelection(value) {
      if (!value) return;
      const selected = JSON.parse(value);
      const model = ((state && state.models) || []).find(item => item.provider === selected.provider && item.model === selected.model);
      if (model === undefined) return;
      // The hidden select stays the value holder, and the effort control reads it
      // to know which model it is setting an effort for: a choice made from the
      // menu has to land there too, or the next effort change would name the
      // previous model.
      elements.models.value = value;
      renderEfforts(model);
      const effort = model.defaultReasoningEffort || (model.reasoningEfforts && model.reasoningEfforts[0] && model.reasoningEfforts[0].id);
      if (effort) elements.efforts.value = effort;
      elements.efforts.disabled = !model.reasoningEfforts || !model.reasoningEfforts.length;
      vscode.postMessage({ type: 'select-model', selection: selectionFor(model, effort) });
    }
    /**
     * The row DSH shows once per completed turn, under that turn's closing reply:
     * copy the whole message, the turn's usage, and the clock.
     */
    function renderMessageActions(message, meta) {
      const row = node('div', 'message-actions');
      const list = (state && state.messages) || [];
      // Only the newest turn's row stays visible; the rest reveal on hover, as
      // DSH does, so a long transcript is not a wall of buttons.
      if (list.length > 0 && list[list.length - 1].id === message.id) row.classList.add('always');
      const copy = node('button', 'message-action message-copy', '⧉');
      copy.type = 'button'; copy.title = 'Copy'; copy.setAttribute('aria-label', 'Copy');
      copy.addEventListener('click', () => copyMessageText(message, copy));
      row.append(copy);
      const current = feedbackFor(message.id);
      const rating = current === undefined ? undefined : current.rating;
      row.append(feedbackButton('👍', 'positive', message.id, rating));
      row.append(feedbackButton('👎', 'negative', message.id, rating));
      row.append(branchButton(meta));
      if (meta.turnUsage !== undefined) {
        const usage = meta.turnUsage;
        const pill = node('button', 'message-action usage-pill', 'Usage ' + compactTokens(usage.totalTokens) + ' tok');
        pill.type = 'button';
        const detail = usageLines(usage).join('\\n');
        pill.title = detail; pill.setAttribute('aria-label', 'Turn usage: ' + detail);
        row.append(pill);
      }
      // What DSH's turn process row calls "Took 2m 3s": the wait the user sat
      // through, measured from the prompt that opened the turn.
      if (typeof meta.turnDurationMs === 'number' && meta.turnDurationMs >= 1000) {
        row.append(node('span', 'message-duration', 'Took ' + formatLiveDuration(meta.turnDurationMs)));
      }
      const clock = formatMessageClock(meta.time);
      if (clock !== '') row.append(node('span', 'message-clock', clock));
      return row;
    }
    function renderMessage(message) {
      if (message.role === 'tool') return { message, node: renderTool(message) };
      if (message.role === 'command') return { message, node: renderCommand(message) };
      if (message.role === 'notice') return { message, node: node('div', 'status' + (message.failed ? ' error' : ''), message.text) };
      const item = node('article', 'message ' + message.role);
      const head = node('div', 'message-head');
      head.append(node('span', 'avatar' + (message.role === 'assistant' ? ' deepseek-mark' : ''), message.role === 'user' ? 'Y' : ''));
      head.append(node('span', '', message.role === 'user' ? 'You' : 'DeepSeek'));
      const markdown = message.role === 'assistant' && message.streaming === true ? createMarkdownStream(message.text) : undefined;
      const thinking = message.role === 'assistant' && hasThinking(message) ? renderThinking(message) : undefined;
      const body = message.role === 'assistant'
        ? message.deferredBody === true ? node('div', 'markdown') : (markdown ? markdown.root : renderMarkdown(message.text))
        : node('div', '', message.text);
      body.classList.add('message-body');
      if (message.streaming) body.classList.add('streaming');
      if (message.deferredBody === true) attachDeferredOutput(message, body, renderAssistantPage, false, 'Show full response' + (message.bodyLength ? ' · ' + String(message.bodyLength) + ' characters' : ''));
      else appendImages(body, message.images);
      item.append(head);
      if (thinking) item.append(thinking.root);
      item.append(body);
      const meta = messageMetaFor(message.id);
      if (meta !== undefined && message.role === 'assistant' && meta.turnEnd === true) item.append(renderMessageActions(message, meta));
      else if (meta !== undefined && message.role === 'user') item.append(renderUserActions(message, meta));
      return { message, node: item, ...(markdown ? { markdown } : {}), ...(thinking ? { thinking } : {}) };
    }
    function messageNode(message) {
      const rendered = renderedMessages.get(message.id);
      if (rendered && rendered.message === message) return rendered.node;
      if (rendered && rendered.message.deferredBodyRevision !== message.deferredBodyRevision) resetDeferredOutput(message.id);
      const appended = pendingMessageAppends.get(message.id);
      // Thinking that shows up after the node was built needs a fresh render.
      const thinkingAppeared = hasThinking(message) && rendered !== undefined && rendered.thinking === undefined;
      if (rendered && rendered.markdown && appended !== undefined && !thinkingAppeared && message.role === 'assistant' && message.images === rendered.message.images) {
        pendingMessageAppends.delete(message.id); pendingReasoningAppends.delete(message.id);
        // Always run this: an empty delta with streaming=false is what flushes
        // the settled markdown and drops the streaming tail node.
        appendMarkdownStream(rendered.markdown, appended, message.streaming === true);
        if (rendered.thinking !== undefined) syncThinking(rendered.thinking, message);
        rendered.message = message;
        rendered.markdown.root.classList.toggle('streaming', message.streaming === true);
        syncThinkingTicker();
        return rendered.node;
      }
      if (rendered) deferredOutputViews.delete(message.id);
      pendingMessageAppends.delete(message.id);
      pendingReasoningAppends.delete(message.id);
      const next = renderMessage(message);
      // reconcileMessages owns node placement. Replacing a connected node here
      // invalidates its cursor before insertBefore can finish reconciling the list.
      renderedMessages.set(message.id, next);
      return next.node;
    }
    function reconcileMessages(messages, current) {
      if (!messages.length) {
        renderedMessages.clear(); elements.messages.replaceChildren(renderEmpty(current)); syncThinkingTicker(); return;
      }
      const ids = new Set(messages.map(message => message.id));
      for (const [id, rendered] of renderedMessages) {
        if (!ids.has(id)) {
          rendered.node.remove(); renderedMessages.delete(id); toolOpenIntent.delete(id); resetDeferredOutput(id); pendingMessageAppends.delete(id); pendingReasoningAppends.delete(id);
        }
      }
      let cursor = elements.messages.firstChild;
      for (const message of messages) {
        const desired = messageNode(message);
        desired.dataset.scrollId = message.id;
        if (desired === cursor) cursor = cursor.nextSibling;
        else elements.messages.insertBefore(desired, cursor);
      }
      while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
      syncThinkingTicker();
    }
    function renderStatus(current) {
      const setup = current.setup;
      const box = node('div', 'status' + (setup ? ' setup' : (current.phase === 'error' ? ' error' : '')));
      if (setup === 'workspace') {
        box.append(node('div', 'setup-title', 'Open a project to get started'), node('div', 'setup-detail', 'DeepSeek Harness works inside a trusted VS Code project folder.'));
      } else if (setup === 'dsh') {
        box.append(node('div', 'setup-title', 'Install DeepSeek Harness'), node('div', 'setup-detail', current.statusText || 'The dsh executable was not found.'));
      } else if (setup === 'api-key') {
        box.append(node('div', 'setup-title', 'Configure your DeepSeek API key'), node('div', 'setup-detail', current.statusText || 'DeepSeek Harness needs an API key before it can run tasks.'));
      } else if (setup === 'runtime-auth') {
        box.append(node('div', 'setup-title', 'Connect to your running DSH'), node('div', 'setup-detail', current.statusText || 'An existing runtime needs its launch URL. Connect to it, or start a separate runtime managed by this extension.'));
      } else {
        box.append(document.createTextNode(current.statusText || 'Starting DeepSeek Harness…'));
      }
      if (current.phase === 'error') {
        const actions = node('div', 'actions');
        if (setup === 'workspace') {
          const open = node('button', 'primary', 'Open Project'); open.addEventListener('click', () => vscode.postMessage({ type: 'open-workspace' })); actions.append(open);
        } else if (setup === 'dsh') {
          const install = node('button', 'primary', 'View Installation'); install.addEventListener('click', () => vscode.postMessage({ type: 'open-link', href: 'https://github.com/deepseek-ai/deepseek-harness' })); actions.append(install);
        } else if (setup === 'api-key') {
          const configure = node('button', 'primary', 'Configure API Key'); configure.addEventListener('click', () => vscode.postMessage({ type: 'configure-api-key' })); actions.append(configure);
        } else if (setup === 'runtime-auth') {
          const connect = node('button', 'primary', 'Connect Existing Runtime'); connect.addEventListener('click', () => vscode.postMessage({ type: 'connect-existing-runtime' })); actions.append(connect);
          const managed = node('button', 'secondary', 'Start Managed Runtime'); managed.addEventListener('click', () => vscode.postMessage({ type: 'start-managed-runtime' })); actions.append(managed);
        } else {
          if (current.canReconnect) {
            const retry = node('button', 'secondary', 'Reconnect'); retry.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' })); actions.append(retry);
          }
          const restart = node('button', 'secondary', 'Restart Runtime'); restart.addEventListener('click', () => vscode.postMessage({ type: 'restart' })); actions.append(restart);
        }
        if (setup !== 'workspace') { const output = node('button', 'secondary', 'Show Output'); output.addEventListener('click', () => vscode.postMessage({ type: 'output' })); actions.append(output); }
        box.append(actions);
      }
      return box;
    }
    function renderEmpty(current) {
      const empty = node('div', 'empty'); empty.append(node('div', 'empty-logo deepseek-mark'), node('h2', '', 'Build with DeepSeek'));
      empty.append(node('p', '', 'Ask questions, explore code, and make changes in ' + current.workspaceName + '.')); return empty;
    }
    function renderApproval(approval) {
      const box = node('section', 'interaction approval');
      box.append(node('div', 'interaction-title', 'Allow ' + approval.toolName + '?'));
      if (approval.reason) box.append(node('div', 'interaction-detail', approval.reason));
      const actions = node('div', 'actions');
      const allow = node('button', 'primary', 'Allow once'); const reject = node('button', 'secondary', 'Reject');
      allow.addEventListener('click', () => vscode.postMessage({ type: 'approval', rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'allowed-once' }));
      reject.addEventListener('click', () => vscode.postMessage({ type: 'approval', rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'rejected' }));
      actions.append(allow, reject); box.append(actions); return box;
    }
    function renderQuestions(request) {
      const box = node('form', 'interaction question'); box.append(node('div', 'interaction-title', 'DeepSeek needs your input'));
      for (const question of request.questions) {
        const item = node('div', 'question-item'); item.dataset.questionId = question.id;
        item.append(node('div', 'question-label', question.header || question.question));
        if (question.header) item.append(node('div', 'question-detail', question.question));
        if (question.detail) item.append(node('div', 'question-detail', question.detail));
        for (const option of question.options || []) {
          const label = node('label', 'option');
          const input = document.createElement('input'); input.type = question.multiSelect ? 'checkbox' : 'radio'; input.name = 'question-' + question.id; input.value = option.label;
          const copy = node('span', '', option.label); if (option.description) copy.append(node('span', 'option-description', option.description));
          label.append(input, copy); item.append(label);
        }
        const custom = document.createElement('input'); custom.className = 'custom-answer'; custom.placeholder = question.options && question.options.length ? 'Other answer (optional)' : 'Type your answer'; custom.dataset.custom = 'true';
        item.append(custom); box.append(item);
      }
      const submit = node('button', 'primary', 'Submit'); submit.type = 'submit';
      const actions = node('div', 'actions'); actions.append(submit); box.append(actions);
      box.addEventListener('submit', event => {
        event.preventDefault(); const answers = []; let valid = true;
        for (const question of request.questions) {
          const item = box.querySelector('[data-question-id="' + CSS.escape(question.id) + '"]');
          const selected = Array.from(item.querySelectorAll('input[type=radio]:checked,input[type=checkbox]:checked')).map(input => input.value);
          const custom = item.querySelector('[data-custom=true]').value.trim();
          if (!selected.length && !custom) { item.classList.add('error-text'); valid = false; } else item.classList.remove('error-text');
          answers.push({ id: question.id, selected, ...(custom ? { custom } : {}) });
        }
        if (valid) vscode.postMessage({ type: 'question', rpcId: request.rpcId, answers });
      });
      return box;
    }
    function renderEfforts(model) {
      elements.efforts.replaceChildren(); const efforts = model && model.reasoningEfforts || [];
      for (const effort of efforts) elements.efforts.append(new Option(effort.label, effort.id, false, effort.selected === true));
      if (!efforts.length) elements.efforts.append(new Option('Default', ''));
      elements.efforts.title = efforts.length ? 'Reasoning effort' : 'This model has no reasoning effort setting';
    }
    function renderAttachments() {
      elements.attachments.replaceChildren(); elements.attachments.classList.toggle('hidden', draftImages.length === 0 && draftFiles.length === 0);
      for (const image of draftImages) {
        const chip = node('div', 'attachment-chip'); chip.append(node('span', '', '▧'), node('span', 'attachment-name', image.name || 'Image'));
        const remove = node('button', 'attachment-remove', '×'); remove.title = 'Remove attachment'; remove.addEventListener('click', () => vscode.postMessage({ type: 'remove-attachment', id: image.id, sessionId: state && state.sessionId }));
        chip.append(remove); elements.attachments.append(chip);
      }
      for (const file of draftFiles) {
        const chip = node('div', 'attachment-chip');
        chip.append(node('span', '', '📄'), node('span', 'attachment-name', file.name), node('span', 'attachment-size', formatBytes(file.bytes)));
        const remove = node('button', 'attachment-remove', '×'); remove.title = 'Remove attachment'; remove.addEventListener('click', () => vscode.postMessage({ type: 'remove-attachment', id: file.id, sessionId: state && state.sessionId }));
        chip.append(remove); elements.attachments.append(chip);
      }
      updateSend();
    }
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
      return (Math.round((bytes / (1024 * 1024)) * 10) / 10) + ' MB';
    }
    function effectivePlanMode(plan) { return Boolean(plan && (plan.pending ? !plan.active : plan.active)); }
    function policyMenuOption(label, description, selected, disabled, onSelect) {
      const option = node('button', 'command-option' + (selected ? ' selected' : ''));
      option.type = 'button'; option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(selected)); option.disabled = disabled;
      const line = node('span', 'command-option-line'); line.append(node('span', 'command-option-name', label));
      if (selected) line.append(node('span', 'command-option-current', 'Current'));
      option.append(line, node('span', 'command-option-description', description));
      option.addEventListener('click', () => { if (selected) return; policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); onSelect(); });
      return option;
    }
    function renderPolicyState(current) {
      const plan = current.plan || { available: false, active: false, pending: false };
      const planActive = effectivePlanMode(plan);
      const permissions = current.permissions || [];
      const selectedPermission = permissions.find(permission => permission.selected) || permissions[0];
      // Permission presets are the safety-relevant choice, so they keep the
      // control. Plan mode is entered and left with the slash command, as in DSH.
      const available = permissions.length > 0;
      elements.modeChips.replaceChildren();
      const preset = current.agentPreset || { available: false, current: '', locked: true, busy: false, options: [] };
      if (preset.available && preset.options.length) {
        const selectedPreset = preset.options.find(option => option.selected) || preset.options[0];
        const chip = node('div', 'preset-chip' + (preset.locked ? ' locked' : ''));
        chip.append(node('span', 'preset-icon', '◇'));
        const select = node('select', 'preset-select'); select.setAttribute('aria-label', 'Agent preset');
        for (const option of preset.options) {
          const label = option.label + (option.trust === 'user' ? ' · User' : '');
          select.append(new Option(label, option.id, false, option.selected === true));
        }
        select.disabled = preset.locked || preset.busy || current.running === true || current.phase !== 'ready';
        select.title = preset.locked
          ? 'Agent preset is fixed after the first turn'
          : ((selectedPreset && selectedPreset.description) || 'Choose the agent composition for this new conversation');
        select.addEventListener('change', () => vscode.postMessage({ type: 'select-agent-preset', agentPreset: select.value }));
        chip.append(select);
        if (preset.locked) chip.append(node('span', 'preset-lock', 'Locked'));
        elements.modeChips.append(chip);
      }
      if (planActive) {
        const chip = node('span', 'plan-chip');
        chip.append(node('span', '', plan.pending ? 'Plan…' : 'Plan'));
        const close = node('button', 'plan-chip-close', '×'); close.type = 'button'; close.title = 'Exit Plan mode'; close.setAttribute('aria-label', 'Exit Plan mode'); close.disabled = current.running === true || plan.pending === true;
        close.addEventListener('click', () => vscode.postMessage({ type: 'select-mode', mode: 'normal' })); chip.append(close); elements.modeChips.append(chip);
      }
      elements.modeChips.classList.toggle('hidden', elements.modeChips.childElementCount === 0);
      elements.policyTrigger.classList.toggle('hidden', !available);
      elements.policyTrigger.classList.remove('active');
      elements.policyTrigger.classList.toggle('full-access', selectedPermission !== undefined && selectedPermission.value === 'danger-full-access');
      elements.policyTrigger.disabled = current.phase !== 'ready';
      const status = selectedPermission === undefined ? '' : selectedPermission.label;
      elements.policyTrigger.title = status === '' ? 'Permissions' : 'Permissions: ' + status;
      elements.policyTrigger.setAttribute('aria-label', elements.policyTrigger.title);
      elements.policyTrigger.setAttribute('aria-expanded', String(policyMenuOpen && available));

      elements.policyMenu.replaceChildren();
      if (permissions.length > 0) {
        elements.policyMenu.append(node('div', 'policy-section-label', 'Permissions'));
        for (const permission of permissions) {
          elements.policyMenu.append(policyMenuOption(
            permission.label,
            permission.description || permission.label,
            permission.selected === true,
            current.running === true,
            () => vscode.postMessage({ type: 'select-permission', permission: permission.value }),
          ));
        }
      }
      if (!available) policyMenuOpen = false;
      elements.policyMenu.classList.toggle('hidden', !policyMenuOpen || !available);
    }
    function formatTokens(value) {
      if (!Number.isFinite(value)) return '0';
      if (value < 1000) return String(Math.round(value));
      if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0).replace(/\\.0$/, '') + 'K';
      return (value / 1000000).toFixed(value < 10000000 ? 1 : 0).replace(/\\.0$/, '') + 'M';
    }
    function formatDuration(value) {
      if (!Number.isFinite(value) || value <= 0) return '0ms';
      if (value < 1000) return Math.round(value) + 'ms';
      if (value < 60000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 's';
      return (value / 60000).toFixed(1) + 'm';
    }
    function usageStatsLine(usage) {
      const groups = [];
      const stats = usage && usage.sessionStats;
      if (stats && stats.steps > 0) {
        groups.push(stats.turns + (stats.turns === 1 ? ' turn' : ' turns') + ' · ' + stats.steps + (stats.steps === 1 ? ' step' : ' steps'));
        const durations = [];
        if (stats.llmMs > 0) durations.push('LLM ' + formatDuration(stats.llmMs));
        if (stats.toolMs > 0) durations.push('tools ' + formatDuration(stats.toolMs));
        if (durations.length) groups.push(durations.join(' · '));
        const speeds = [];
        if (stats.ttftSteps > 0) speeds.push('TTFT avg ' + formatDuration(stats.ttftMs / stats.ttftSteps));
        if (stats.decodeMs > 0) speeds.push((stats.decodeTokens / (stats.decodeMs / 1000)).toFixed(1) + ' tok/s');
        if (speeds.length) groups.push(speeds.join(' · '));
      }
      const tokens = usage && usage.tokenUsage;
      if (tokens) {
        const input = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
        if (input > 0 || tokens.outputTokens > 0) {
          if (input > 0) groups.push('cache ' + Math.round(tokens.cacheReadTokens / input * 100) + '%');
          groups.push('in ' + formatTokens(input) + ' · out ' + formatTokens(tokens.outputTokens));
        }
      }
      return groups.join('  |  ');
    }
    function usageStatsSummary(usage) {
      const groups = [];
      const stats = usage && usage.sessionStats;
      if (stats && stats.steps > 0) {
        groups.push(stats.turns + (stats.turns === 1 ? ' turn' : ' turns'));
        groups.push(stats.steps + (stats.steps === 1 ? ' step' : ' steps'));
      }
      const tokens = usage && usage.tokenUsage;
      if (tokens) {
        const total = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens;
        if (total > 0) groups.push(formatTokens(total) + ' tokens');
      }
      return groups.join(' · ');
    }
    function renderUsage(current) {
      const usage = current.usage || { available: false, percent: 0, usedTokens: 0, contextWindow: 0 };
      const stats = usageStatsSummary(usage);
      elements.usageStats.textContent = stats;
      elements.usageStats.title = usageStatsLine(usage);
      elements.usageStats.classList.toggle('hidden', stats === '');
      elements.usageControl.classList.toggle('hidden', usage.available !== true);
      if (usage.available !== true) {
        usageOpen = false;
        elements.usagePanel.classList.add('hidden');
        elements.usageTrigger.setAttribute('aria-expanded', 'false');
        return;
      }
      const percent = Math.max(0, Math.min(100, Number(usage.percent) || 0));
      const circumference = 2 * Math.PI * 5.5;
      elements.usageFill.setAttribute('stroke-dasharray', (circumference * percent / 100) + ' ' + circumference);
      elements.usageTrigger.classList.toggle('warning', percent >= 75 && percent < 90);
      elements.usageTrigger.classList.toggle('danger', percent >= 90);
      elements.usageTrigger.title = 'Context ' + percent + '% used';
      elements.usageTrigger.setAttribute('aria-label', elements.usageTrigger.title);
      elements.usageTrigger.setAttribute('aria-expanded', String(usageOpen));
      elements.usagePanel.replaceChildren();
      if (usageOpen) {
        const header = node('div', 'usage-header');
        header.append(node('span', '', 'Context'), node('span', 'usage-percent', percent + '% used'), node('span', 'usage-figures', '~' + formatTokens(usage.usedTokens) + ' / ' + formatTokens(usage.contextWindow)));
        const bar = node('div', 'usage-bar');
        const breakdown = usage.breakdown;
        const parts = breakdown ? [
          { key: 'systemTokens', label: 'System prompt', className: 'usage-system' },
          { key: 'toolsTokens', label: 'Tools', className: 'usage-tools' },
          { key: 'messageTokens', label: 'Messages', className: 'usage-messages' },
        ] : [];
        const total = parts.reduce((sum, part) => sum + Number(breakdown[part.key] || 0), 0);
        if (total > 0) {
          for (const part of parts) {
            const width = percent * Number(breakdown[part.key] || 0) / total;
            if (width <= 0) continue;
            const segment = node('span', 'usage-segment ' + part.className); segment.style.width = width + '%'; bar.append(segment);
          }
        } else {
          const segment = node('span', 'usage-segment usage-messages'); segment.style.width = percent + '%'; bar.append(segment);
        }
        elements.usagePanel.append(header, bar);
        if (breakdown) {
          const rows = node('dl', 'usage-rows');
          for (const part of parts) {
            const row = node('div', 'usage-row');
            const term = node('dt', ''); term.append(node('span', 'usage-swatch ' + part.className), document.createTextNode(part.label));
            row.append(term, node('dd', '', '~' + formatTokens(breakdown[part.key]))); rows.append(row);
          }
          elements.usagePanel.append(rows);
        }
      }
      elements.usagePanel.classList.toggle('hidden', !usageOpen);
    }
    function sameSelection(left, right) {
      return left && right && left.path === right.path && left.startLine === right.startLine && left.endLine === right.endLine;
    }
    function contextLabel(reference) {
      const range = reference.startLine === undefined ? ''
        : ' ' + (reference.startLine === reference.endLine ? 'L' + reference.startLine : 'L' + reference.startLine + '–' + reference.endLine);
      return reference.path + range + (reference.truncated ? ' (truncated)' : '');
    }
    function contextTitle(reference) {
      if (reference.kind === 'folder') return 'Folder included with this prompt';
      if (reference.kind === 'selection') return 'Selected editor lines included with this prompt';
      if (reference.kind === 'problem' || reference.kind === 'problems') return 'Workspace diagnostic included with this prompt';
      return reference.startLine === undefined
        ? 'File included with this prompt'
        : 'Dropped editor range included with this prompt';
    }
    function renderIdeContext() {
      elements.contextChips.replaceChildren();
      const pinned = ideContext.pinned || [];
      const references = [];
      if (ideContext.activeFile) references.push(ideContext.activeFile);
      if (ideContext.selection && !pinned.some(item => sameSelection(item, ideContext.selection))) references.push(ideContext.selection);
      references.push(...pinned);
      elements.contextChips.classList.toggle('hidden', references.length === 0);
      for (const reference of references) {
        const chip = node('div', 'context-chip' + (reference.kind === 'selection' ? ' selection' : ''));
        chip.title = contextTitle(reference);
        const icon = reference.kind === 'folder' ? '🗀' : reference.kind === 'selection' ? '§' : '▧';
        chip.append(node('span', 'context-icon', icon), node('span', 'context-name', contextLabel(reference)));
        if (reference.id) {
          const remove = node('button', 'context-remove', '×'); remove.title = 'Remove pinned context';
          remove.addEventListener('click', () => vscode.postMessage({ type: 'remove-context', id: reference.id })); chip.append(remove);
        }
        elements.contextChips.append(chip);
      }
    }
    function currentMentionQuery() {
      const cursor = elements.prompt.selectionStart || 0;
      const prefix = elements.prompt.value.slice(0, cursor);
      const match = /(?:^|[\\s(])@(?:\\{([^}]*)|([^\\s@{}]*))$/.exec(prefix);
      if (!match) return undefined;
      const start = prefix.lastIndexOf('@');
      return start < 0 ? undefined : { start, cursor, query: match[1] || match[2] || '' };
    }
    function requestMentions() {
      const mention = currentMentionQuery();
      if (!mention) { mentionCandidates = []; elements.mentionMenu.classList.add('hidden'); return; }
      const requestId = ++mentionRequestId;
      vscode.postMessage({ type: 'request-mentions', requestId, query: mention.query });
    }
    function renderMentionMenu() {
      const mention = currentMentionQuery();
      elements.mentionMenu.replaceChildren();
      if (!mention || !mentionCandidates.length) { elements.mentionMenu.classList.add('hidden'); return; }
      elements.commandMenu.classList.add('hidden');
      mentionIndex = Math.min(mentionIndex, mentionCandidates.length - 1);
      elements.mentionMenu.classList.remove('hidden');
      mentionCandidates.forEach((candidate, index) => {
        const option = node('button', 'command-option' + (index === mentionIndex ? ' selected' : ''));
        option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === mentionIndex));
        const line = node('div', 'command-option-line');
        if (candidate.kind === 'problems') {
          line.append(node('span', 'command-option-name', '@problems'), node('span', 'command-option-hint', 'Workspace diagnostics'));
          option.append(line, node('div', 'command-option-description', 'Include all current errors and warnings'));
        } else if (candidate.kind === 'problem') {
          const location = candidate.path + ':' + candidate.startLine + ':' + candidate.startCharacter;
          line.append(node('span', 'command-option-name', location), node('span', 'command-option-hint', candidate.severity === 'error' ? 'Error' : 'Warning'));
          option.append(line, node('div', 'command-option-description', (candidate.source ? candidate.source + ' · ' : '') + candidate.message));
        } else {
          line.append(node('span', 'command-option-name', candidate.path + (candidate.kind === 'folder' ? '/' : '')));
          line.append(node('span', 'command-option-hint', candidate.kind === 'folder' ? 'Folder' : 'File'));
          option.append(line);
        }
        option.addEventListener('mousedown', event => { event.preventDefault(); pickMention(candidate); });
        elements.mentionMenu.append(option);
      });
    }
    function pickMention(candidate) {
      const mention = currentMentionQuery(); if (!mention) return;
      const path = candidate.kind === 'problem'
        ? candidate.path + ':' + candidate.startLine + ':' + candidate.startCharacter
        : candidate.path + (candidate.kind === 'folder' ? '/' : '');
      const encoded = candidate.kind === 'problems' ? '@problems' : (path.includes(' ') || candidate.kind === 'problem' ? '@{' + path + '}' : '@' + path);
      const suffix = elements.prompt.value.slice(mention.cursor);
      const insertion = encoded + (suffix.startsWith(' ') ? '' : ' ');
      elements.prompt.value = elements.prompt.value.slice(0, mention.start) + insertion + suffix;
      const cursor = mention.start + insertion.length;
      elements.prompt.setSelectionRange(cursor, cursor);
      mentionCandidates = []; mentionIndex = 0; elements.mentionMenu.classList.add('hidden');
      resizePrompt(); elements.prompt.focus();
    }
    function menuCandidates() {
      if (!state) return [];
      const raw = elements.prompt.value;
      if (raw.includes('\\n')) return [];
      if (raw.toLowerCase().startsWith('/permission ')) {
        const query = raw.slice('/permission '.length).trim().toLowerCase();
        if (query.includes(' ')) return [];
        return (state.permissions || [])
          .filter(permission => permission.value.toLowerCase().includes(query) || permission.label.toLowerCase().includes(query))
          .map(permission => ({ kind: 'permission', permission }));
      }
      const text = raw.trim();
      if (!text.startsWith('/') || text.includes(' ')) return [];
      const query = text.slice(1).toLowerCase();
      const commands = (state.commands || [])
        .filter(command => command.name.toLowerCase().includes(query))
        .map(command => ({ kind: 'command', command }));
      const commandNames = new Set((state.commands || []).map(command => command.name));
      const skills = (state.skills || [])
        .filter(skill => !commandNames.has(skill.name) && skill.name.toLowerCase().includes(query))
        .map(skill => ({ kind: 'skill', skill }));
      return [...commands, ...skills];
    }
    function renderCommandMenu() {
      const candidates = menuCandidates();
      elements.commandMenu.replaceChildren();
      // Hide the mention listbox whenever the command menu is empty: the two
      // share this function, and returning first left a stale list open.
      if (!candidates.length) { elements.commandMenu.classList.add('hidden'); elements.mentionMenu.classList.add('hidden'); return; }
      commandIndex = Math.min(commandIndex, candidates.length - 1);
      elements.commandMenu.classList.remove('hidden');
      let section = '';
      candidates.forEach((candidate, index) => {
        const nextSection = candidate.kind === 'permission' ? '' : (candidate.kind === 'command' ? 'Commands' : 'Skills');
        if (nextSection && nextSection !== section) {
          elements.commandMenu.append(node('div', 'command-section-label', nextSection)); section = nextSection;
        }
        const option = node('button', 'command-option' + (index === commandIndex ? ' selected' : ''));
        option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === commandIndex));
        const line = node('div', 'command-option-line');
        if (candidate.kind === 'permission') {
          const permission = candidate.permission;
          line.append(node('span', 'command-option-name', permission.label));
          if (permission.label !== permission.value) line.append(node('span', 'command-option-hint', permission.value));
          if (permission.selected) line.append(node('span', 'command-option-current', 'Current'));
          option.append(line, node('div', 'command-option-description', permission.description || 'Use this permission preset'));
        } else if (candidate.kind === 'command') {
          const command = candidate.command;
          line.append(node('span', 'command-option-name', '/' + command.name));
          if (command.input && command.input.hint) line.append(node('span', 'command-option-hint', command.input.hint));
          option.append(line, node('div', 'command-option-description', command.description));
        } else {
          const skill = candidate.skill;
          line.append(node('span', 'command-option-name', '/' + skill.name));
          line.append(node('span', 'command-option-hint', skill.modelInvocable ? 'Skill' : 'User only'));
          const description = skill.whenToUse ? skill.description + ' · ' + skill.whenToUse : skill.description;
          option.append(line, node('div', 'command-option-description', description)); option.title = description;
        }
        option.addEventListener('mousedown', event => { event.preventDefault(); pickCandidate(candidate); });
        elements.commandMenu.append(option);
      });
    }
    /**
     * Send a slash command the user picked.
     *
     * A command never reaches a model, so the composer's routability gate does not
     * apply to it. It does need the session and request ids, though: without them
     * the extension's send path drops the message without a word, which is what
     * made every command from the menu look dead.
     */
    function sendPickedCommand(text) {
      if (!state || state.phase !== 'ready' || !state.sessionId) return;
      const sessionId = state.sessionId;
      const requestId = ++draftSendRequestId;
      pendingDraftSends.set(requestId, { sessionId, text, scrollVersion: conversationScroller.intentVersion });
      vscode.postMessage({ type: 'send', sessionId, requestId, text, mode: 'queue' });
      elements.prompt.value = ''; sessionDrafts.set(sessionId, ''); commandIndex = 0; resetPrompt();
    }
    function pickCandidate(candidate) {
      if (candidate.kind === 'permission') {
        sendPickedCommand('/permission ' + candidate.permission.value); return;
      }
      if (candidate.kind === 'skill') {
        elements.prompt.value = '/' + candidate.skill.name + ' ';
        elements.prompt.placeholder = candidate.skill.whenToUse || candidate.skill.description || 'Skill instructions';
        commandIndex = 0; resizePrompt(); renderCommandMenu(); elements.prompt.focus(); return;
      }
      pickCommand(candidate.command);
    }
    function pickCommand(command) {
      if (command.input) {
        elements.prompt.value = '/' + command.name + ' ';
        elements.prompt.placeholder = command.input.hint || 'Command arguments';
        commandIndex = 0; resizePrompt(); renderCommandMenu(); elements.prompt.focus(); return;
      }
      sendPickedCommand('/' + command.name);
    }
    function resetPrompt() { elements.prompt.placeholder = 'Ask DeepSeek about this project'; resizePrompt(); renderCommandMenu(); renderMentionMenu(); }
    function postQueueAction(sessionId, itemId, action, text) {
      if (!state || state.phase !== 'ready' || state.sessionId !== sessionId) return;
      vscode.postMessage({ type: 'queue-action', sessionId, itemId, action, ...(text === undefined ? {} : { text }) });
    }
    function renderQueue(force) {
      const sessionId = state && state.sessionId;
      const queue = (state && state.phase === 'ready' && state.queue || []).filter(item => item.placement === 'queued');
      if (queueEditing && (queueEditing.sessionId !== sessionId || !queue.some(item => item.id === queueEditing.id))) queueEditing = null;
      const signature = JSON.stringify({ sessionId, queue, running: state && state.running, editing: queueEditing });
      if (!force && signature === queueRenderSignature) return;
      queueRenderSignature = signature; elements.queueDock.replaceChildren(); elements.queueDock.classList.toggle('hidden', queue.length === 0);
      if (!queue.length) return;
      const head = node('div', 'queue-head'); head.append(node('span', '', '≡'), node('span', 'queue-title', queue.length === 1 ? '1 queued message' : queue.length + ' queued messages')); elements.queueDock.append(head);
      for (const item of queue) {
        const row = node('div', 'queue-row');
        if (queueEditing && queueEditing.id === item.id) {
          const editor = node('textarea', 'queue-editor'); editor.value = queueEditing.text; editor.rows = 1; editor.setAttribute('aria-label', 'Edit queued message');
          editor.addEventListener('input', () => {
            queueEditing = { sessionId, id: item.id, text: editor.value };
            queueRenderSignature = JSON.stringify({ sessionId, queue, running: state && state.running, editing: queueEditing });
            save.disabled = editor.value.trim() === '';
          });
          editor.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); queueEditing = null; renderQueue(true); return; }
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault(); const text = editor.value.trim(); if (!text) return; queueEditing = null; postQueueAction(sessionId, item.id, 'edit', text); renderQueue(true);
            }
          });
          const actions = node('div', 'queue-actions'); const save = node('button', 'queue-action', 'Save'); const cancelEdit = node('button', 'queue-action', 'Cancel');
          save.type = cancelEdit.type = 'button'; save.disabled = queueEditing.text.trim() === ''; save.addEventListener('click', () => { const text = editor.value.trim(); if (!text) return; queueEditing = null; postQueueAction(sessionId, item.id, 'edit', text); renderQueue(true); });
          cancelEdit.addEventListener('click', () => { queueEditing = null; renderQueue(true); }); actions.append(save, cancelEdit); row.append(editor, actions);
          requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); });
        } else {
          row.append(node('span', 'queue-preview', item.preview || 'Queued message'));
          const actions = node('div', 'queue-actions');
          const edit = node('button', 'queue-action', 'Edit'); edit.type = 'button'; edit.disabled = item.text === null; edit.title = item.text === null ? 'Messages with attachments cannot be edited' : 'Edit queued message'; edit.addEventListener('click', () => { if (item.text !== null) { queueEditing = { sessionId, id: item.id, text: item.text }; renderQueue(true); } });
          const remove = node('button', 'queue-action', 'Delete'); remove.type = 'button'; remove.addEventListener('click', () => postQueueAction(sessionId, item.id, 'remove'));
          const steer = node('button', 'queue-action', 'Steer'); steer.type = 'button'; steer.disabled = !state.running; steer.title = state.running ? 'Apply this message to the current task now' : 'Steering is available only while DeepSeek is running'; steer.addEventListener('click', () => postQueueAction(sessionId, item.id, 'steer'));
          actions.append(edit, remove, steer); row.append(actions);
        }
        elements.queueDock.append(row);
      }
    }
    function liveJob(job) { return job.status === 'running' || job.status === 'stopping'; }
    function jobDuration(job) {
      const end = liveJob(job) ? Date.now() : (Number(job.finishedAt) || Number(job.startedAt));
      const seconds = Math.max(0, Math.floor((end - Number(job.startedAt)) / 1000));
      if (seconds < 60) return seconds + 's';
      const minutes = Math.floor(seconds / 60); if (minutes < 60) return minutes + 'm ' + (seconds % 60) + 's';
      return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
    }
    /** Copy one code block, confirming on the button that was pressed. */
    function copyCodeBlock(button) {
      const code = button.closest('.code-block')?.querySelector('code');
      if (!code) return;
      const text = code.textContent || '';
      const confirm = () => {
        button.textContent = 'Copied';
        button.classList.add('copied');
        setTimeout(() => { if (button.isConnected) { button.textContent = 'Copy'; button.classList.remove('copied'); } }, 1500);
      };
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        // The extension is the fallback: the clipboard API rejects while the
        // Webview has not been focused yet, which is common right after a render.
        clipboard.writeText(text).then(confirm, () => { vscode.postMessage({ type: 'copy-text', text }); confirm(); });
        return;
      }
      vscode.postMessage({ type: 'copy-text', text });
      confirm();
    }
    function armJob(jobId) {
      armedJobId = jobId;
      if (armedJobTimer) { clearTimeout(armedJobTimer); armedJobTimer = undefined; }
      if (jobId !== undefined) armedJobTimer = setTimeout(() => { armedJobId = undefined; armedJobTimer = undefined; renderJobs(); }, 3000);
    }
    function renderAccount(current) {
      const account = record(current.account);
      // A runtime without the account controller simply shows no account UI,
      // rather than a disabled button that explains nothing.
      if (!account || account.available !== true) {
        accountOpen = false;
        elements.accountControl.classList.add('hidden');
        elements.accountMenu.classList.add('hidden');
        return;
      }
      elements.accountControl.classList.remove('hidden');
      const phase = string(account.phase);
      const working = phase === 'initializing' || phase === 'waiting-browser' || phase === 'exchanging' || phase === 'committing';
      const failed = current.accountFailed === true;
      elements.accountTrigger.classList.toggle('signed-in', account.signedIn === true);
      elements.accountTrigger.classList.toggle('working', working);
      elements.accountTrigger.classList.toggle('failed', failed);
      const notice = current.accountNotice;
      elements.accountTrigger.title = typeof notice === 'string' && notice !== '' ? notice
        : account.signedIn === true ? 'DeepSeek account' : 'Sign in to DeepSeek';
      elements.accountMenu.classList.toggle('hidden', !accountOpen);
      elements.accountTrigger.setAttribute('aria-expanded', String(accountOpen));
      if (!accountOpen) return;

      elements.accountMenu.replaceChildren();
      const title = node('div', 'account-title', account.signedIn === true ? 'DeepSeek account' : 'Sign in');
      elements.accountMenu.append(title);
      const profile = record(account.profile);
      const name = profile ? (string(profile.name) || string(profile.id)) : '';
      if (account.signedIn === true && name !== '') elements.accountMenu.append(node('div', 'account-line', name));
      if (typeof notice === 'string' && notice !== '') {
        elements.accountMenu.append(node('div', 'account-line' + (failed ? ' failed' : ''), notice));
      }
      const wallets = array(account.wallets);
      if (account.signedIn === true && wallets.length > 0) {
        const text = wallets.map(wallet => (string(wallet.currency) === 'CNY' ? '¥' : '$') + string(wallet.balance)).join(' · ');
        elements.accountMenu.append(node('div', 'account-meta', 'Balance ' + text));
      }

      const addAction = (label, className, run) => {
        const button = node('button', 'account-action' + (className ? ' ' + className : ''), label);
        button.type = 'button'; button.setAttribute('role', 'menuitem');
        button.addEventListener('click', () => { accountOpen = false; elements.accountMenu.classList.add('hidden'); elements.accountTrigger.setAttribute('aria-expanded', 'false'); run(); });
        elements.accountMenu.append(button);
      };
      if (account.signedIn === true) {
        const usage = string(account.usageUrl);
        const topUp = string(account.topUpUrl);
        if (usage !== '') addAction('Usage', 'secondary', () => vscode.postMessage({ type: 'open-link', href: usage }));
        if (topUp !== '') addAction('Top up', 'secondary', () => vscode.postMessage({ type: 'open-link', href: topUp }));
        addAction('Sign out', 'secondary', () => vscode.postMessage({ type: 'sign-out' }));
        return;
      }
      if (working) {
        if (typeof account.authorizeUrl === 'string' && account.authorizeUrl !== '') {
          addAction('Open the sign-in page again', '', () => vscode.postMessage({ type: 'open-link', href: account.authorizeUrl }));
        }
        addAction('Cancel sign-in', 'secondary', () => vscode.postMessage({ type: 'cancel-sign-in' }));
        return;
      }
      addAction('Sign in with DeepSeek', '', () => vscode.postMessage({ type: 'sign-in' }));
    }

    function renderJobs() {
      const jobs = array(state && state.jobs);
      const live = jobs.filter(liveJob).length;
      if (!jobsOpen && armedJobId !== undefined) { armedJobId = undefined; if (armedJobTimer) { clearTimeout(armedJobTimer); armedJobTimer = undefined; } }
      elements.jobsControl.classList.toggle('hidden', jobs.length === 0);
      elements.jobsTrigger.classList.toggle('live', live > 0);
      elements.jobsCount.textContent = String(live || jobs.length);
      elements.jobsTrigger.title = live > 0 ? live + ' background ' + (live === 1 ? 'job' : 'jobs') + ' running' : jobs.length + ' background ' + (jobs.length === 1 ? 'job' : 'jobs');
      if (!jobs.length) { jobsOpen = false; elements.jobsMenu.classList.add('hidden'); elements.jobsTrigger.setAttribute('aria-expanded', 'false'); }
      elements.jobsMenu.replaceChildren();
      if (jobs.length) {
        elements.jobsMenu.append(node('div', 'jobs-title', live > 0 ? 'Background jobs · ' + live + ' running' : 'Background jobs'));
        const ordered = [...jobs].sort((a, b) => liveJob(a) !== liveJob(b) ? (liveJob(a) ? -1 : 1) : (liveJob(a) ? Number(a.startedAt) - Number(b.startedAt) : Number(b.finishedAt || b.startedAt) - Number(a.finishedAt || a.startedAt)));
        for (const job of ordered) {
          const row = node('div', 'job-row'); const status = string(job.detail) || string(job.status);
          row.title = status; row.append(node('span', 'job-kind', string(job.kind, 'job')), node('span', 'job-label', string(job.label, 'Background job')), node('span', 'job-detail', status), node('span', 'job-duration', jobDuration(job)));
          if (liveJob(job)) {
            // DSH web arms first and confirms on a second press within three seconds.
            const armed = armedJobId === job.id;
            const stop = node('button', 'job-stop' + (armed ? ' armed' : ''), armed ? 'Confirm' : 'Stop');
            stop.type = 'button';
            stop.title = armed ? 'Click again within 3 seconds to stop this job' : 'Stop this background job';
            stop.setAttribute('aria-label', (armed ? 'Confirm stopping ' : 'Stop ') + string(job.label, 'background job'));
            stop.addEventListener('click', event => {
              event.stopPropagation();
              if (armed) { armJob(undefined); vscode.postMessage({ type: 'kill-job', sessionId: state.sessionId, jobId: job.id }); }
              else armJob(job.id);
              renderJobs();
            });
            row.append(stop);
          }
          elements.jobsMenu.append(row);
        }
      }
      if (jobsTimer) { clearInterval(jobsTimer); jobsTimer = undefined; }
      if (jobsOpen && live > 0) jobsTimer = setInterval(renderJobs, 1000);
    }
    function renderConversation(current) {
      if (renderedSessionId !== current.sessionId) {
        if (renderedSessionId) sessionDrafts.set(renderedSessionId, elements.prompt.value);
        renderedSessionId = current.sessionId; renderedMessages.clear(); thinkingTiming.clear(); syncThinkingTicker(); elements.messages.replaceChildren();
        // A candidate list belongs to the prompt that asked for it. The menu is
        // the only thing that makes one reachable (menuCandidates never reads the
        // mention list), so hiding it is what has to happen here.
        elements.mentionMenu.classList.add('hidden'); elements.commandMenu.classList.add('hidden');
        // The catalog is runtime-wide, but the menu belongs to the conversation
        // the user was in; leaving it open carries a filter across the switch.
        closeModelMenu(false);
        elements.prompt.value = sessionDrafts.get(current.sessionId) || ''; resizePrompt();
        draftImages = draftImagesBySession.get(current.sessionId) || [];
        draftFiles = draftFilesBySession.get(current.sessionId) || []; renderAttachments();
        historyAnchor = undefined; conversationScroller.reset();
        renderedHistoryKey = ''; renderedTail = {}; toolOpenIntent.clear();
        for (const request of loadingToolRequests.values()) clearTimeout(request.timer);
        loadingToolRequests.clear(); toolOutputErrors.clear(); toolOutputPages.clear(); deferredOutputViews.clear(); pendingMessageAppends.clear();
      }
      const statusKey = current.phase + '::' + current.statusText + '::' + current.setup;
      if (statusKey !== renderedStatusKey) {
        renderedStatusKey = statusKey;
        elements.conversationStatus.replaceChildren();
        if (current.phase !== 'ready') elements.conversationStatus.append(renderStatus(current));
      }
      if (current.phase !== 'ready') {
        elements.conversationHistory.replaceChildren(); elements.messages.replaceChildren(); elements.conversationTail.replaceChildren();
        // The message nodes are gone, so the thinking ticker must not keep
        // writing into them; it only stops when no live entry remains.
        renderedMessages.clear(); thinkingTiming.clear(); syncThinkingTicker();
        renderedHistoryKey = ''; renderedTail = {};
        // The turn clock is gone with the tail, and a dead runtime must not keep
        // ticking it.
        renderedLiveKey = ''; liveStatusNode = undefined; syncLiveStatusTicker();
        return;
      }

      const historyKey = String(current.hasMoreHistory) + '::' + String(current.loadingHistory);
      if (historyKey !== renderedHistoryKey) {
        renderedHistoryKey = historyKey; elements.conversationHistory.replaceChildren();
        if (current.hasMoreHistory || current.loadingHistory) {
          const loader = node('div', 'history-loader'); const button = node('button', 'history-button', current.loadingHistory ? 'Loading earlier messages…' : 'Load earlier messages'); button.type = 'button'; button.disabled = current.loadingHistory === true;
          button.addEventListener('click', () => {
            historyAnchor = { sessionId: current.sessionId, restore: conversationScroller.preserveHistory() };
            button.disabled = true; button.textContent = 'Loading earlier messages…';
            vscode.postMessage({ type: 'load-history' });
          });
          loader.append(button); elements.conversationHistory.append(loader);
        }
      }
      reconcileMessages(array(current.messages), current);

      if (renderedTail.queue !== current.queue || renderedTail.changedFiles !== current.changedFiles || renderedTail.approval !== current.approval || renderedTail.question !== current.question) {
        renderedTail = { queue: current.queue, changedFiles: current.changedFiles, approval: current.approval, question: current.question };
        elements.conversationTail.replaceChildren();
        // The turn clock is not one of these cards but it lives in the same slot,
        // and the user must not lose the one signal that a turn is still alive
        // because a queued message arrived.
        if (liveStatusNode !== undefined) elements.conversationTail.append(liveStatusNode);
        for (const item of current.queue || []) if (item.placement === 'steering') elements.conversationTail.append(renderPendingSteering(item));
        if (current.changedFiles && current.changedFiles.length) elements.conversationTail.append(renderChangedFiles(current.changedFiles));
        if (current.approval) elements.conversationTail.append(renderApproval(current.approval));
        if (current.question) elements.conversationTail.append(renderQuestions(current.question));
      }
      // The turn clock is its own slot: it ticks once a second, and rebuilding
      // the changed-files and approval cards on every tick would be absurd.
      const liveKey = current.running === true ? current.sessionId + '::' + String(current.stopping === true) : '';
      if (liveKey !== renderedLiveKey) {
        renderedLiveKey = liveKey;
        if (liveStatusNode !== undefined) { liveStatusNode.remove(); liveStatusNode = undefined; }
        if (liveKey !== '') {
          liveStatusNode = renderLiveStatus(current);
          elements.conversationTail.prepend(liveStatusNode);
        }
      } else syncLiveStatus(current);
      syncLiveStatusTicker();
    }
    function render(current) {
      const preservingHistory = historyAnchor && historyAnchor.sessionId === current.sessionId;
      state = current;
      if (renderedChrome.workspaceName !== current.workspaceName || renderedChrome.cwd !== current.cwd) {
        elements.workspace.textContent = current.workspaceName || 'Workspace'; elements.project.title = current.cwd ? 'DeepSeek project: ' + current.cwd : 'Choose DeepSeek project';
      }
      if (renderedChrome.sessions !== current.sessions || renderedChrome.sessionId !== current.sessionId) renderSessionCenter(current);
      if (renderedChrome.models !== current.models) {
        elements.models.replaceChildren();
        // Group by provider, the way DSH's own picker does: two providers can
        // offer a model under the same name, and the provider is what decides
        // where the request is routed.
        const providers = new Map();
        let currentModel;
        for (const model of current.models || []) {
          if (model.selected === true && currentModel === undefined) currentModel = model;
          const named = typeof model.providerLabel === 'string' && model.providerLabel !== '';
          let group = providers.get(model.provider);
          if (group === undefined) {
            group = document.createElement('optgroup');
            group.label = named ? model.providerLabel : model.provider;
            elements.models.append(group);
            providers.set(model.provider, group);
          }
          group.append(new Option(model.label, modelValue(model), false, model.selected === true));
        }
        if (!elements.models.childElementCount) elements.models.append(new Option('Default model', ''));
        // The closed picker shows only the model, so name the provider in the
        // tooltip: it is the half of the choice that routing depends on.
        const route = currentModel === undefined
          ? 'Model'
          : 'Model: ' + modelChoiceLabel(currentModel) + ' — ' + modelChoiceProvider(currentModel);
        elements.models.title = route;
        elements.models.setAttribute('aria-label', route);
        // The trigger is what the user reads: the model alone, with the provider
        // in the tooltip, because the provider is what routing depends on.
        elements.modelTriggerLabel.textContent = currentModel === undefined ? 'Default model' : modelChoiceLabel(currentModel);
        elements.modelTrigger.title = route;
        elements.modelTrigger.setAttribute('aria-label', route);
        if (modelMenuOpen) renderModelMenu();
        renderEfforts((current.models || []).find(model => model.selected) || (current.models || [])[0]);
      }
      const policyChanged = renderedChrome.agentPreset !== current.agentPreset || renderedChrome.permissions !== current.permissions || renderedChrome.plan !== current.plan || renderedChrome.running !== current.running || renderedChrome.phase !== current.phase;
      if (policyChanged) renderPolicyState(current);
      if (renderedChrome.usage !== current.usage) renderUsage(current);
      if (renderedChrome.jobs !== current.jobs) renderJobs();
      if (renderedChrome.account !== current.account || renderedChrome.accountNotice !== current.accountNotice || renderedChrome.accountFailed !== current.accountFailed) renderAccount(current);
      if (renderedChrome.parentSessionId !== current.parentSessionId
        || renderedChrome.subagentOwnerTitle !== subagentOwnerTitle(current)) renderSubagentBar(current);
      renderRoutableNotice(current);
      renderConversation(current);
      const enabled = current.phase === 'ready' && current.routable !== false && Boolean(current.sessionId);
      elements.prompt.disabled = !enabled; elements.attach.disabled = !enabled; elements.project.disabled = current.running === true; elements.newSession.disabled = current.phase !== 'ready'; elements.sessionTrigger.disabled = current.phase !== 'ready';
      // The picker answers a different question from the composer. When the
      // selected model is unavailable but another provider can route, disabling
      // the picker would leave the user with no way back: they cannot send and
      // cannot switch. So it follows "any provider", not "this one".
      const canPickModel = current.phase === 'ready' && current.anyRoutable !== false && Boolean(current.sessionId);
      elements.models.disabled = !canPickModel || !(current.models || []).length;
      elements.modelTrigger.disabled = elements.models.disabled;
      if (elements.models.disabled && modelMenuOpen) {
        // The menu is about to disappear under the focused search box; the prompt
        // is the next thing the user would type into.
        const focused = document.activeElement === elements.modelSearch;
        closeModelMenu(false);
        if (focused && !elements.prompt.disabled) elements.prompt.focus();
      }
      elements.efforts.disabled = !enabled || !elements.efforts.options.length || elements.efforts.value === '';
      const stopping = current.stopping === true && current.running === true;
      elements.cancel.classList.toggle('hidden', current.running !== true);
      elements.cancel.classList.toggle('stopping', stopping);
      elements.cancel.disabled = stopping;
      elements.cancel.title = stopping ? 'Stopping…' : 'Stop';
      elements.cancel.setAttribute('aria-label', stopping ? 'Stopping…' : 'Stop');
      elements.send.title = current.running ? 'Queue message (Enter) · Steer now (Cmd/Ctrl+Enter)' : 'Send (Enter)'; updateSend(); renderQueue();
      if (renderedChrome.commands !== current.commands || renderedChrome.skills !== current.skills || renderedChrome.permissions !== current.permissions) renderCommandMenu();
      renderedChrome = {
        workspaceName: current.workspaceName, cwd: current.cwd, sessions: current.sessions, sessionId: current.sessionId, models: current.models,
        agentPreset: current.agentPreset, permissions: current.permissions, plan: current.plan, running: current.running,
        account: current.account, accountNotice: current.accountNotice, accountFailed: current.accountFailed,
        parentSessionId: current.parentSessionId, subagentOwnerTitle: subagentOwnerTitle(current),
        phase: current.phase, usage: current.usage, jobs: current.jobs, commands: current.commands, skills: current.skills,
      };
      if (preservingHistory && current.loadingHistory !== true) {
        const anchor = historyAnchor; historyAnchor = undefined;
        anchor.restore();
      }
      conversationScroller.changed();
    }
    function scheduleRender(current) {
      state = current; pendingRenderState = current;
      if (renderFrame !== undefined) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = undefined;
        const pending = pendingRenderState; pendingRenderState = undefined;
        if (pending) render(pending);
      });
    }
    function applyMessagesPatch(current, patch) {
      if (Array.isArray(patch && patch.reset)) { pendingMessageAppends.clear(); return patch.reset; }
      const messages = Array.isArray(current) ? [...current] : [];
      const indexes = new Map(messages.map((message, index) => [message.id, index]));
      for (const message of array(patch && patch.upserts)) {
        pendingMessageAppends.delete(message.id);
        const index = indexes.get(message.id);
        if (index === undefined) { indexes.set(message.id, messages.length); messages.push(message); }
        else messages[index] = message;
      }
      for (const append of array(patch && patch.appends)) {
        const index = indexes.get(append.id); const message = index === undefined ? undefined : messages[index];
        if (!message || message.role !== 'assistant') continue;
        const text = string(append.text);
        const reasoning = string(append.reasoning);
        pendingMessageAppends.set(append.id, string(pendingMessageAppends.get(append.id)) + text);
        if (reasoning !== '') pendingReasoningAppends.set(append.id, string(pendingReasoningAppends.get(append.id)) + reasoning);
        messages[index] = {
          ...message,
          text: message.text + text,
          ...(reasoning === '' ? {} : { reasoning: string(message.reasoning) + reasoning }),
          streaming: append.streaming === true,
        };
      }
      return messages;
    }
    function applyStateUpdate(update) {
      if (!state) return;
      const patch = record(update && update.patch) || {};
      const messages = update && update.messages
        ? applyMessagesPatch(state.messages, update.messages)
        : state.messages;
      scheduleRender({ ...state, ...patch, messages });
    }
    /**
     * Show whose subagent this conversation is, and offer the way back.
     * Opening a child is otherwise a one-way door: the owner is only reachable
     * from the session picker.
     */
    /** Title the subagent bar shows for its owner, or '' when it has none. */
    function subagentOwnerTitle(current) {
      const parentId = current.parentSessionId;
      if (typeof parentId !== 'string' || parentId === '') return '';
      const parent = array(current.sessions).find(session => session.id === parentId);
      return parent === undefined ? '' : string(parent.title);
    }
    function renderSubagentBar(current) {
      const parentId = current.parentSessionId;
      if (typeof parentId !== 'string' || parentId === '') {
        elements.subagentBar.classList.add('hidden');
        elements.subagentBar.replaceChildren();
        return;
      }
      const parent = array(current.sessions).find(session => session.id === parentId);
      const title = parent === undefined ? '' : string(parent.title);
      elements.subagentBar.classList.remove('hidden');
      const back = node('button', 'subagent-bar-back', '↩ ' + (title || 'Owning conversation'));
      back.type = 'button';
      back.title = 'Back to the conversation that started this subagent';
      back.setAttribute('aria-label', back.title);
      back.addEventListener('click', () => vscode.postMessage({ type: 'select-session', sessionId: parentId }));
      elements.subagentBar.replaceChildren(node('span', 'subagent-bar-label', 'Subagent of'), back);
    }
    function renderRoutableNotice(current) {
      const text = current.routableNotice;
      const show = current.phase === 'ready' && current.routable === false && typeof text === 'string' && text !== '';
      elements.routableNotice.textContent = show ? text : '';
      elements.routableNotice.classList.toggle('hidden', !show);
    }
    /**
     * Whether the composer may submit at all. The button and Enter must agree:
     * an unroutable conversation disables typing, so it must also refuse to
     * send a draft that was typed before it became unroutable.
     */
    function composerReady() {
      return Boolean(state) && state.phase === 'ready' && state.routable !== false;
    }
    function updateSend() {
      const pendingSend = state && [...pendingDraftSends.values()].some(draft => draft.sessionId === state.sessionId);
      const pendingAttachment = state && [...pendingAttachmentRequests.values()].some(request => request.sessionId === state.sessionId);
      const pendingUpload = state && (pendingUploadsBySession.get(state.sessionId) || 0) > 0;
      elements.send.disabled = !composerReady() || pendingSend || pendingAttachment || pendingUpload
        || (elements.prompt.value.trim() === '' && draftImages.length === 0 && draftFiles.length === 0);
    }
    function releaseUpload(sessionId) {
      const remaining = (pendingUploadsBySession.get(sessionId) || 1) - 1;
      if (remaining <= 0) pendingUploadsBySession.delete(sessionId);
      else pendingUploadsBySession.set(sessionId, remaining);
      updateSend();
    }
    function resizePrompt() { elements.prompt.style.height = 'auto'; elements.prompt.style.height = Math.min(elements.prompt.scrollHeight, 220) + 'px'; updateSend(); }
    function selectionFor(model, reasoningEffort) { return { provider: model.provider, model: model.model, ...(reasoningEffort ? { reasoningEffort } : {}) }; }
    function canSend() {
      if (!composerReady()) return false;
      const sessionId = state.sessionId;
      if ([...pendingAttachmentRequests.values()].some(request => request.sessionId === sessionId)) return false;
      // Enter must honour the same gate the button uses, or a message can leave
      // before its file is staged and the file then rides the NEXT prompt.
      return (pendingUploadsBySession.get(sessionId) || 0) === 0;
    }
    function send(mode) {
      const text = elements.prompt.value.trim(); if (!text && !draftImages.length && !draftFiles.length) return;
      if (!canSend()) return;
      const sessionId = state.sessionId;
      const requestId = ++draftSendRequestId;
      pendingDraftSends.set(requestId, { sessionId, text, scrollVersion: conversationScroller.intentVersion });
      vscode.postMessage({ type: 'send', sessionId, requestId, text, mode: mode || 'queue' }); elements.prompt.value = ''; sessionDrafts.set(sessionId, ''); commandIndex = 0; resetPrompt();
    }
    function clipboardImage(file, index) {
      const mediaType = String(file.type || '').toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const separator = result.indexOf(',');
          if (separator < 0) { reject(new Error('The pasted image could not be read.')); return; }
          resolve({ mediaType, data: result.slice(separator + 1), name: file.name || ('pasted-image-' + String(index + 1)) });
        });
        reader.addEventListener('error', () => reject(new Error('The pasted image could not be read.')));
        reader.readAsDataURL(file);
      });
    }
    function clipboardImageFiles(event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return [];
      const itemFiles = Array.from(clipboard.items || [])
        .filter(item => item.kind === 'file' && String(item.type || '').toLowerCase().startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (itemFiles.length) return itemFiles;
      return Array.from(clipboard.files || []).filter(file => String(file.type || '').toLowerCase().startsWith('image/'));
    }
    // A drop carries three unrelated payloads. VS Code resources arrive as
    // URIs this extension host can resolve on its own machine, so they become
    // context references. Anything the OS handed over exists only as bytes in
    // this webview, so it is read here and staged through the runtime upload.
    const IMAGE_DROP_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    // Deliberately excludes the generic text/uri-list: a dragged hyperlink sets
    // it, and swallowing that would break inserting a URL into the composer.
    const DROP_URI_TYPES = ['CodeEditors', 'ResourceURLs', 'application/vnd.code.uri-list'];
    /** Schemes this extension host can actually resolve to a project path. */
    const RESOURCE_SCHEMES = ['file:', 'vscode-remote:', 'vscode-vfs:'];
    // Mirrors the extension's limit so an oversized file is refused before its
    // bytes cross the webview boundary; the extension still re-checks.
    const MAX_DROP_FILE_BYTES = 32 * 1024 * 1024;
    function safeJson(text) { if (typeof text !== 'string' || text === '') return undefined; try { return JSON.parse(text); } catch { return undefined; } }
    function selectionOf(fragment) {
      const match = /^L?(\\d+)(?:,(\\d+))?(?:-L?(\\d+)(?:,(\\d+))?)?/.exec(String(fragment || ''));
      if (!match) return {};
      return { startLine: parseInt(match[1], 10), endLine: match[3] ? parseInt(match[3], 10) : parseInt(match[1], 10) };
    }
    function droppedResources(dataTransfer, hasOsFiles) {
      const found = [];
      const seen = new Set();
      const push = (uri, selection) => {
        const value = String(uri || '').trim();
        if (value === '' || seen.has(value)) return;
        if (!RESOURCE_SCHEMES.some(scheme => value.startsWith(scheme))) return;
        seen.add(value); found.push({ uri: value, ...(selection || {}) });
      };
      const editors = safeJson(dataTransfer.getData('CodeEditors'));
      if (Array.isArray(editors)) for (const entry of editors) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.resource === 'string') push(entry.resource, selectionOf(entry.options && entry.options.selection && entry.options.selection.fragment));
      }
      if (found.length === 0) {
        const resources = safeJson(dataTransfer.getData('ResourceURLs'));
        if (Array.isArray(resources)) for (const value of resources) {
          if (typeof value !== 'string') continue;
          const hash = value.indexOf('#');
          if (hash < 0) push(value);
          else push(value.slice(0, hash), selectionOf(value.slice(hash + 1)));
        }
      }
      if (found.length === 0) {
        // The generic web URI list also carries file:// entries for an OS
        // drag, where those paths belong to the client machine rather than this
        // host. Only the VS Code-internal list is trusted once real files are
        // in hand; the system files themselves take the upload path instead.
        const mimes = hasOsFiles
          ? ['application/vnd.code.uri-list']
          : ['application/vnd.code.uri-list', 'text/uri-list'];
        for (const mime of mimes) {
          const text = dataTransfer.getData(mime);
          if (typeof text !== 'string' || text === '') continue;
          for (const line of text.split(/\\r?\\n/)) {
            const value = line.trim();
            if (value === '' || value.startsWith('#')) continue;
            const hash = value.indexOf('#');
            if (hash < 0) push(value);
            else push(value.slice(0, hash), selectionOf(value.slice(hash + 1)));
          }
          if (found.length > 0) break;
        }
      }
      return found;
    }
    function readDroppedFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const separator = result.indexOf(',');
          if (separator < 0) { reject(new Error('The dropped file could not be read.')); return; }
          resolve(result.slice(separator + 1));
        });
        reader.addEventListener('error', () => reject(new Error('The dropped file could not be read.')));
        reader.readAsDataURL(file);
      });
    }
    async function acceptDrop(event) {
      if (!state || state.phase !== 'ready' || !state.sessionId) {
        vscode.postMessage({ type: 'attachment-error', message: 'Wait for DeepSeek to reconnect before adding files.' });
        return;
      }
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;
      const sessionId = state.sessionId;
      const osFiles = Array.from(dataTransfer.files || []);
      // Resources first: an Explorer drop carries only URIs, while an OS drop
      // carries bytes and must not be mistaken for a workspace path.
      const resources = droppedResources(dataTransfer, osFiles.length > 0);
      const imageFiles = osFiles.filter(file => IMAGE_DROP_TYPES.includes(String(file.type || '').toLowerCase()));
      const otherFiles = osFiles.filter(file => !IMAGE_DROP_TYPES.includes(String(file.type || '').toLowerCase()));
      if (resources.length > 0) vscode.postMessage({ type: 'attach-resources', sessionId, uris: resources });
      if (imageFiles.length > 0) {
        const requestId = ++attachmentRequestId;
        pendingAttachmentRequests.set(requestId, { sessionId }); updateSend();
        try {
          const images = (await Promise.all(imageFiles.map(clipboardImage))).filter(Boolean);
          if (images.length === 0) {
            pendingAttachmentRequests.delete(requestId); updateSend();
            vscode.postMessage({ type: 'attachment-error', message: 'Paste a PNG, JPEG, WebP, or GIF image.' });
          } else {
            vscode.postMessage({ type: 'attach-images', sessionId, requestId, images });
          }
        } catch (error) {
          pendingAttachmentRequests.delete(requestId); updateSend();
          vscode.postMessage({ type: 'attachment-error', message: error && error.message || 'The dropped image could not be read.' });
        }
      }
      if (otherFiles.length > 0) {
        // A folder arrives as a zero-byte entry with no media type, and its
        // bytes are unreadable here, so it must go through the Explorer route.
        const folders = otherFiles.filter(file => file.size === 0 && !file.type);
        // The extension owns the authoritative limit; this only avoids hauling
        // an obviously oversized file through the webview boundary first.
        const oversized = otherFiles.filter(file => !(file.size === 0 && !file.type) && file.size > MAX_DROP_FILE_BYTES);
        const plain = otherFiles.filter(file => !(file.size === 0 && !file.type) && file.size <= MAX_DROP_FILE_BYTES);
        if (folders.length > 0) {
          vscode.postMessage({
            type: 'attachment-error',
            message: 'Drop folders from the Explorer so DeepSeek can read them in place.',
          });
        }
        if (oversized.length > 0) {
          vscode.postMessage({
            type: 'attachment-error',
            message: '“' + oversized[0].name + '” is larger than the ' + Math.round(MAX_DROP_FILE_BYTES / (1024 * 1024)) + ' MB attachment limit.',
          });
        }
        if (plain.length > 0) {
          pendingUploadsBySession.set(sessionId, (pendingUploadsBySession.get(sessionId) || 0) + 1); updateSend();
          try {
            const files = [];
            for (const file of plain) files.push({ name: file.name || 'attachment', data: await readDroppedFile(file) });
            if (files.length > 0) vscode.postMessage({ type: 'attach-files', sessionId, files });
            else { releaseUpload(sessionId); }
          } catch (error) {
            releaseUpload(sessionId);
            vscode.postMessage({ type: 'attachment-error', message: error && error.message || 'The dropped file could not be read.' });
          }
        }
      }
    }
    const composer = elements.prompt.parentElement;
    let dropDepth = 0;
    function setDropActive(active) {
      elements.dropOverlay.classList.toggle('hidden', !active);
      if (composer) composer.classList.toggle('drop-target', active);
    }
    // Chromium lowercases the type strings a drag exposes (the HTML standard
    // requires ASCII lowercase), so the ResourceURLs type VS Code sets arrives
    // as resourceurls and an exact comparison never matched: neither dragenter
    // nor dragover called preventDefault, and an Explorer drop was never
    // handled at all. Compare without case, which also accepts the Files
    // spelling the platform uses for a drag from the file manager.
    const DROP_URI_TYPES_LOWER = DROP_URI_TYPES.map(type => type.toLowerCase());
    function dragCarriesPayload(event) {
      const types = Array.from((event.dataTransfer && event.dataTransfer.types) || [])
        .map(type => String(type).toLowerCase());
      return types.some(type => DROP_URI_TYPES_LOWER.includes(type) || type === 'files');
    }
    document.addEventListener('dragenter', event => {
      if (!dragCarriesPayload(event)) return;
      event.preventDefault(); dropDepth += 1; setDropActive(true);
    });
    document.addEventListener('dragover', event => {
      if (!dragCarriesPayload(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', event => {
      if (!dragCarriesPayload(event)) return;
      event.preventDefault();
      // A drag that leaves the window may never deliver every matching
      // dragleave, so a null relatedTarget ends the gesture outright.
      if (event.relatedTarget === null) dropDepth = 0;
      else dropDepth = Math.max(0, dropDepth - 1);
      if (dropDepth === 0) setDropActive(false);
    });
    document.addEventListener('drop', event => {
      if (!dragCarriesPayload(event)) return;
      event.preventDefault(); dropDepth = 0; setDropActive(false);
      void acceptDrop(event);
    });
    elements.prompt.addEventListener('input', () => { if (state && state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value); policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); commandIndex = 0; mentionIndex = 0; elements.prompt.placeholder = 'Ask DeepSeek about this project'; resizePrompt(); renderCommandMenu(); requestMentions(); });
    elements.prompt.addEventListener('click', () => { policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); requestMentions(); });
    elements.prompt.addEventListener('paste', event => {
      const files = clipboardImageFiles(event);
      if (!files.length) return;
      event.preventDefault();
      if (!state || state.phase !== 'ready' || !state.sessionId) return;
      const sessionId = state.sessionId;
      const requestId = ++attachmentRequestId;
      pendingAttachmentRequests.set(requestId, { sessionId });
      updateSend();
      Promise.all(files.map(clipboardImage)).then(values => {
        const images = values.filter(Boolean);
        if (!images.length) {
          pendingAttachmentRequests.delete(requestId);
          updateSend();
          vscode.postMessage({ type: 'attachment-error', message: 'Paste a PNG, JPEG, WebP, or GIF image.' });
          return;
        }
        vscode.postMessage({ type: 'attach-images', sessionId, requestId, images });
      }).catch(error => {
        pendingAttachmentRequests.delete(requestId);
        updateSend();
        vscode.postMessage({ type: 'attachment-error', message: error && error.message || 'The pasted image could not be read.' });
      });
    });
    elements.prompt.addEventListener('keydown', event => {
      if (policyMenuOpen && event.key === 'Escape') { event.preventDefault(); policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); return; }
      const mentionOpen = !elements.mentionMenu.classList.contains('hidden') && mentionCandidates.length > 0;
      if (mentionOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); mentionIndex = (mentionIndex + (event.key === 'ArrowDown' ? 1 : mentionCandidates.length - 1)) % mentionCandidates.length; renderMentionMenu(); return;
      }
      if (mentionOpen && event.key === 'Escape') { event.preventDefault(); mentionCandidates = []; elements.mentionMenu.classList.add('hidden'); return; }
      if (mentionOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.isComposing))) { event.preventDefault(); pickMention(mentionCandidates[mentionIndex]); return; }
      const candidates = menuCandidates(); const menuOpen = !elements.commandMenu.classList.contains('hidden') && candidates.length > 0;
      if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length; renderCommandMenu(); return;
      }
      if (menuOpen && event.key === 'Escape') { event.preventDefault(); elements.commandMenu.classList.add('hidden'); return; }
      if (menuOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.isComposing))) { event.preventDefault(); pickCandidate(candidates[commandIndex]); return; }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(state && state.running && (event.metaKey || event.ctrlKey) ? 'steer' : 'queue'); }
    });
    elements.send.addEventListener('click', () => send('queue')); elements.cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' })); elements.attach.addEventListener('click', () => vscode.postMessage({ type: 'attach' }));
    elements.usageTrigger.addEventListener('click', event => {
      event.stopPropagation(); usageOpen = !usageOpen; policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); if (state) renderUsage(state);
    });
    elements.policyTrigger.addEventListener('click', event => {
      event.stopPropagation(); policyMenuOpen = !policyMenuOpen; usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false'); elements.commandMenu.classList.add('hidden'); elements.mentionMenu.classList.add('hidden'); if (state) renderPolicyState(state);
    });
    elements.messages.addEventListener('click', event => {
      const target = event.target;
      const button = target instanceof Element ? target.closest('.code-copy') : null;
      if (button) copyCodeBlock(button);
    });
    elements.accountTrigger.addEventListener('click', event => {
      event.stopPropagation();
      accountOpen = !accountOpen;
      jobsOpen = false; elements.jobsMenu.classList.add('hidden'); elements.jobsTrigger.setAttribute('aria-expanded', 'false');
      if (state) renderAccount(state);
    });
    elements.jobsTrigger.addEventListener('click', event => {
      event.stopPropagation(); jobsOpen = !jobsOpen; accountOpen = false; elements.accountMenu.classList.add('hidden'); elements.accountTrigger.setAttribute('aria-expanded', 'false'); elements.jobsMenu.classList.toggle('hidden', !jobsOpen); elements.jobsTrigger.setAttribute('aria-expanded', String(jobsOpen)); renderJobs();
    });
    elements.project.addEventListener('click', () => vscode.postMessage({ type: 'choose-workspace' }));
    elements.githubStar.addEventListener('click', () => vscode.postMessage({ type: 'open-link', href: 'https://github.com/Lixxx1/dsh-vscode' }));
    elements.sessionTrigger.addEventListener('click', event => {
      event.stopPropagation();
      if (sessionMenuOpen) { closeSessionMenu(false); return; }
      sessionMenuOpen = true; sessionActionId = undefined; elements.sessionMenu.classList.remove('hidden'); elements.sessionTrigger.setAttribute('aria-expanded', 'true');
      renderSessionCenter(state || { sessions: [] }); requestAnimationFrame(() => elements.sessionSearch.focus());
    });
    elements.sessionSearch.addEventListener('input', () => { sessionActionId = undefined; if (state) renderSessionCenter(state); });
    elements.sessionMenu.addEventListener('click', event => event.stopPropagation());
    elements.newSession.addEventListener('click', () => { if (state && state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value); closeSessionMenu(false); vscode.postMessage({ type: 'new-session' }); });
    elements.models.addEventListener('change', () => { applyModelSelection(elements.models.value); });
    elements.modelTrigger.addEventListener('click', event => {
      event.stopPropagation();
      if (modelMenuOpen) closeModelMenu(false); else openModelMenu();
    });
    elements.modelMenu.addEventListener('click', event => event.stopPropagation());
    elements.modelSearch.addEventListener('input', () => { modelIndex = 0; renderModelMenu(); });
    elements.modelSearch.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (modelChoices.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        modelIndex = (modelIndex + step + modelChoices.length) % modelChoices.length;
        highlightModel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = modelChoices[modelIndex];
        if (chosen !== undefined) chooseModel(chosen);
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); closeModelMenu(true); }
    });
    elements.efforts.addEventListener('change', () => { if (!elements.models.value) return; const selected = JSON.parse(elements.models.value); const model = (state.models || []).find(item => item.provider === selected.provider && item.model === selected.model); if (model) vscode.postMessage({ type: 'select-model', selection: selectionFor(model, elements.efforts.value) }); });
    document.addEventListener('click', event => {
      if (policyMenuOpen && !elements.policyMenu.contains(event.target) && !elements.policyTrigger.contains(event.target)) {
        policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false');
      }
      if (modelMenuOpen && !elements.modelControl.contains(event.target) && !elements.modelMenu.contains(event.target)) closeModelMenu(false);
      if (accountOpen && !elements.accountMenu.contains(event.target) && !elements.accountTrigger.contains(event.target)) {
        accountOpen = false; if (state) renderAccount(state);
      }
      if (usageOpen && !elements.usagePanel.contains(event.target) && !elements.usageTrigger.contains(event.target)) {
        usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false');
      }
      if (jobsOpen && !elements.jobsMenu.contains(event.target) && !elements.jobsTrigger.contains(event.target)) {
        jobsOpen = false; elements.jobsMenu.classList.add('hidden'); elements.jobsTrigger.setAttribute('aria-expanded', 'false'); renderJobs();
      }
      if (sessionMenuOpen && !elements.sessionControl.contains(event.target)) closeSessionMenu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && sessionMenuOpen) {
        event.preventDefault(); closeSessionMenu(true);
      } else if (event.key === 'Escape' && modelMenuOpen) {
        event.preventDefault(); closeModelMenu(true);
      } else if (event.key === 'Escape' && usageOpen) {
        usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false'); elements.usageTrigger.focus();
      }
    });
    window.addEventListener('message', event => {
      if (!event.data) return;
      if (event.data.type === 'state') { pendingMessageAppends.clear(); scheduleRender(event.data.state); }
      if (event.data.type === 'state-update') applyStateUpdate(event.data.update);
      if (event.data.type === 'tool-output' && state && event.data.sessionId === state.sessionId && typeof event.data.messageId === 'string') {
        const request = loadingToolRequests.get(event.data.messageId);
        if (!request || request.requestId !== event.data.requestId) return;
        clearTimeout(request.timer); loadingToolRequests.delete(event.data.messageId);
        if (typeof event.data.error === 'string') {
          toolOutputErrors.set(event.data.messageId, { message: event.data.error, cursor: request.cursor });
          const controller = deferredOutputViews.get(event.data.messageId); if (controller) controller.renderControls(); return;
        }
        toolOutputErrors.delete(event.data.messageId);
        if (event.data.page && event.data.page.message) {
          const controller = deferredOutputViews.get(event.data.messageId);
          if (controller) controller.append(event.data.page.message, event.data.page.nextCursor);
          else {
            const message = array(state.messages).find(candidate => candidate.id === event.data.messageId);
            const loaded = toolOutputPages.get(event.data.messageId) || { pages: [], nextCursor: undefined, revision: message && message.deferredBodyRevision };
            loaded.pages.push(event.data.page.message); loaded.nextCursor = event.data.page.nextCursor; toolOutputPages.set(event.data.messageId, loaded);
          }
        }
      }
      if (event.data.type === 'draft-images' && typeof event.data.sessionId === 'string') {
        const images = event.data.images || []; draftImagesBySession.set(event.data.sessionId, images);
        if (state && event.data.sessionId === state.sessionId) { draftImages = images; renderAttachments(); }
      }
      if (event.data.type === 'draft-files' && typeof event.data.sessionId === 'string') {
        const files = event.data.files || []; draftFilesBySession.set(event.data.sessionId, files);
        // The extension reports how many uploads are still outstanding, so two
        // concurrent drops cannot release each other's send gate early.
        const outstanding = Math.max(0, Number(event.data.uploads) || 0);
        if (outstanding === 0) pendingUploadsBySession.delete(event.data.sessionId);
        else pendingUploadsBySession.set(event.data.sessionId, outstanding);
        if (state && event.data.sessionId === state.sessionId) { draftFiles = files; renderAttachments(); } else updateSend();
      }
      if (event.data.type === 'attachments-added' && typeof event.data.requestId === 'number') {
        const pending = pendingAttachmentRequests.get(event.data.requestId);
        if (pending && pending.sessionId === event.data.sessionId) {
          pendingAttachmentRequests.delete(event.data.requestId);
          updateSend();
        }
      }
      if ((event.data.type === 'draft-sent' || event.data.type === 'restore-draft') && typeof event.data.requestId === 'number') {
        const pending = pendingDraftSends.get(event.data.requestId);
        if (!pending || pending.sessionId !== event.data.sessionId) return;
        pendingDraftSends.delete(event.data.requestId);
        if (event.data.type === 'draft-sent' && state && state.sessionId === pending.sessionId
          && renderedSessionId === pending.sessionId && conversationScroller.intentVersion === pending.scrollVersion) conversationScroller.resume();
        if (event.data.type === 'restore-draft') {
          const existing = sessionDrafts.get(pending.sessionId) || '';
          const restored = existing === '' || existing === pending.text ? pending.text : pending.text + '\\n' + existing;
          sessionDrafts.set(pending.sessionId, restored);
          if (state && state.sessionId === pending.sessionId) {
            elements.prompt.value = restored; resizePrompt(); requestMentions(); renderCommandMenu();
          }
        }
        updateSend();
      }
      if (event.data.type === 'ide-context') { ideContext = event.data.state || { pinned: [] }; renderIdeContext(); }
      if (event.data.type === 'mention-suggestions' && event.data.requestId === mentionRequestId) {
        const mention = currentMentionQuery();
        if (mention && mention.query === event.data.query) { mentionCandidates = event.data.candidates || []; mentionIndex = 0; renderMentionMenu(); }
      }
      if (event.data.type === 'focus-prompt') elements.prompt.focus();
      if (event.data.type === 'set-prompt' && typeof event.data.text === 'string') {
        elements.prompt.value = event.data.text; if (state && state.sessionId) sessionDrafts.set(state.sessionId, event.data.text); resizePrompt(); requestMentions(); renderCommandMenu(); elements.prompt.focus();
        const cursor = elements.prompt.value.length; elements.prompt.setSelectionRange(cursor, cursor);
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
}
