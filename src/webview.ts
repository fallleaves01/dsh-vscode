import { randomBytes } from 'node:crypto'
import type * as vscode from 'vscode'
import { webviewThemeCss } from './webview-theme.js'
import { userTextCss } from './user-text-style.js'
import { settingsPageCss, settingsIcon } from './settings-ui.js'
import { subagentLinkCss } from './subagent-link-style.js'

function nonce(): string {
  // A CSP nonce must be unpredictable; `Math.random` is not a cryptographic
  // source (S2-L1). settings-page-html.ts already salts its nonce this way.
  return randomBytes(16).toString('hex')
}

/** Escape a value placed inside an HTML attribute. */
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function chatHtml(webview: vscode.Webview, deepseekMarkUri: vscode.Uri, markdownAssets: { script: vscode.Uri; style: vscode.Uri; scroll: vscode.Uri; tail: vscode.Uri; settings?: vscode.Uri }): string {
  const token = nonce()
  const mark = escapeHtml(deepseekMarkUri.toString(true))
  const tail = escapeHtml(markdownAssets.tail.toString(true))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${token}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${token}'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
  <link rel="stylesheet" href="${escapeHtml(markdownAssets.style.toString(true))}">
  <style nonce="${token}">
    /**
     * DSH's content axis, ported: one body size that everything in the
     * transcript scales from, a secondary tier one step under it, and the line
     * heights DSH derives from the same delta. The base follows VS Code's own UI
     * font size, so the sidebar keeps matching the editor it lives in while the
     * proportions stay DSH's.
     */
    :root {
      color-scheme: light dark;
      --dsh-content-font-size: var(--vscode-font-size, 14px);
      --dsh-content-font-delta: calc(var(--dsh-content-font-size) - 14px);
      --dsh-content-font-size-secondary: min(calc(var(--dsh-content-font-size) - 1px), max(13px, calc(var(--dsh-content-font-size) - 2px)));
      --dsh-content-font-delta-secondary: calc(var(--dsh-content-font-size-secondary) - 13px);
      --dsh-line: calc(24px + var(--dsh-content-font-delta));
      --dsh-line-secondary: calc(20px + var(--dsh-content-font-delta-secondary));
      /* DSH's radii, by their own names. */
      --dsh-radius-xs: 4px; --dsh-radius-sm: 8px; --dsh-radius-md: 12px;
      --dsh-radius-lg: 16px; --dsh-radius-xl: 20px;
      --dsh-code-font: var(--vscode-editor-font-family);
      /* The user bubble: DSH paints it with the brand's own light blue; over a
         VS Code theme the same tint keeps it distinguishable in both kinds. */
      --dsh-bubble: color-mix(in srgb, #4d6bfe 12%, var(--vscode-editor-background));
      --dsh-hover: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
      /* DSH draws every separator as a half-pixel hairline. */
      --dsh-hairline: .5px;
      --dsh-hairline-l1: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
      --dsh-hairline-l2: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      --dsh-hairline-l3: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: var(--dsh-content-font-size)/var(--dsh-line) var(--vscode-font-family); }
    button, select, textarea, input { font: inherit; color: inherit; }
    button { cursor: pointer; }
    #app { width: 100%; height: 100%; min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; position: relative; }
    .drop-overlay { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); pointer-events: none; }
    .drop-overlay.hidden { display: none; }
    .drop-card { padding: 12px 16px; border: 1px dashed var(--vscode-focusBorder, #4d6bfe); border-radius: 10px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-size: 12px; font-weight: 600; box-shadow: 0 6px 20px var(--vscode-widget-shadow); }
    .composer.drop-target { outline: 1px dashed var(--vscode-focusBorder, #4d6bfe); outline-offset: -2px; }
    .toolbar { min-width: 0; min-height: 48px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; border-bottom: .5px solid var(--dsh-border); }
    .brand-mark { flex: none; width: 24px; height: 24px; }
    .runtime-indicator { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsh-muted); }
    .runtime-indicator[data-phase="ready"] { background: var(--dsh-success); }
    .runtime-indicator[data-phase="error"] { background: var(--vscode-errorForeground); }
    .runtime-indicator[data-phase="loading"] { background: var(--dsh-warning); }
    .runtime-connection { flex: none; display: flex; align-items: center; gap: 4px; padding: 4px; border: 0; border-radius: 4px; background: transparent; color: var(--dsh-muted); font-size: 10px; line-height: 18px; }
    .runtime-connection:hover:not(:disabled) { background: var(--dsh-hover); color: var(--vscode-foreground); }
    .runtime-connection:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .session-control { min-width: 0; flex: 1; }
    .session-trigger { width: 100%; min-width: 0; height: 28px; padding: 0 6px; display: flex; align-items: center; gap: 5px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; line-height: 18px; font-weight: 500; text-align: left; }
    .session-trigger:hover, .session-trigger[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground); }
    .session-trigger-title { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .session-trigger svg { width: 13px; height: 13px; flex: 0 0 auto; color: var(--vscode-descriptionForeground); }
    .session-menu { position: absolute; z-index: 30; top: 48px; left: 8px; width: calc(100% - 16px); max-width: 440px; max-height: min(480px, calc(100% - 64px)); padding: 6px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; border: 1px solid var(--dsh-border); border-radius: 10px; background: var(--vscode-menu-background, var(--dsh-surface)); box-shadow: 0 8px 24px var(--vscode-widget-shadow); font-size: 12px; line-height: 18px; }
    .session-menu-footer { margin-top: 5px; padding-top: 4px; border-top: .5px solid var(--dsh-border); }
    .session-directory-link { width: 100%; min-height: 28px; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; border: 0; border-radius: 5px; background: transparent; color: var(--dsh-muted); text-align: left; font-size: 11px; }
    .session-directory-link:hover { color: var(--vscode-foreground); background: var(--dsh-hover); }
    .session-search { width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; outline: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font-size: 12px; }
    .session-list { min-height: 0; margin-top: 5px; overflow: auto; overscroll-behavior: contain; }
    .session-empty { padding: 16px 8px; color: var(--dsh-muted); text-align: center; font-size: 11px; }
    .session-group { padding: 10px 8px 4px; color: var(--dsh-muted); font-size: 10px; font-weight: 500; }
    .session-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 26px; align-items: center; border-radius: 6px; }
    .session-row:hover, .session-row.active { background: var(--vscode-list-hoverBackground); }
    .session-row.active { background: var(--vscode-list-inactiveSelectionBackground, var(--dsh-hover)); }
    .session-row.active .session-name { font-weight: 500; }
    .session-main { min-width: 0; min-height: 34px; padding: 6px 8px; display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; font-size: 12px; line-height: 18px; }
    .session-indicator { width: 5px; height: 5px; border-radius: 50%; background: transparent; }
    .session-indicator.running { background: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 20%, transparent); }
    .session-indicator.unread { background: var(--vscode-notificationsInfoIcon-foreground, #4d6bfe); }
    .session-indicator.attention { background: var(--vscode-notificationsWarningIcon-foreground, #cca700); }
    .session-attention-count { flex: 0 0 auto; min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; text-align: center; }
    .session-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; font-weight: 400; }
    .session-meta { min-width: 0; max-width: 104px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsh-muted); font-size: 10px; }
    .session-more { width: 24px; height: 24px; min-width: 24px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 5px; color: var(--dsh-muted); background: transparent; font-size: 17px; line-height: 1; opacity: 0; }
    .session-row:hover .session-more, .session-row:focus-within .session-more, .session-more[aria-expanded="true"] { opacity: 1; }
    .session-more:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .session-snippet { grid-column: 2 / -1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsh-muted); font-size: 11px; padding-top: 2px; }
    .conversation-home { min-width: 0; min-height: 0; padding: 10px 12px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 8px; font-size: 12px; line-height: 18px; }
    .home-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .home-error { margin: 6px 0 0; color: var(--vscode-errorForeground); font-size: 11px; }
    .home-runtime .status { font-size: 11px; line-height: 16px; }
    .home-list-heading { font-size: 11px; color: var(--dsh-muted); }
    .home-archive-toggle { min-height: 24px; padding: 3px 6px; border: 0; border-radius: 5px; background: transparent; color: inherit; font-size: 11px; }
    .home-archive-toggle:hover, .home-archive-toggle[aria-pressed="true"] { background: var(--dsh-hover); color: var(--vscode-foreground); }
    .home-directory { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 5px; }
    .home-list { min-height: 0; overflow: auto; overscroll-behavior: contain; }
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
    /**
     * DSH's turn action row, at DSH's metrics: 28px tall, 8px apart, pulled 6px
     * left so the first mark lines up with the text above it, and 16px below the
     * answer it belongs to.
     */
    .message-actions { display: flex; align-items: center; gap: 8px; height: calc(28px + var(--dsh-content-font-delta)); margin-top: 16px; margin-left: -6px; opacity: 0; transition: opacity 80ms; }
    .message:hover .message-actions, .message:focus-within .message-actions, .message-actions.always { opacity: 1; }
    .message-action { display: inline-flex; align-items: center; justify-content: center; padding: 6px; border: none; border-radius: var(--dsh-radius-sm); background: transparent; color: var(--vscode-descriptionForeground); font-size: var(--dsh-content-font-size-secondary); cursor: pointer; }
    .message-action:hover { background: var(--dsh-hover); color: var(--vscode-foreground); }
    /* The icon buttons carry DSH's own artwork at DSH's own size, so the row reads
       as one control group instead of emoji next to text. */
    .message-action.message-icon { flex: none; width: calc(28px + var(--dsh-content-font-delta)); height: calc(28px + var(--dsh-content-font-delta)); }
    .message-action.message-icon svg { width: calc(15px + var(--dsh-content-font-delta)); height: calc(15px + var(--dsh-content-font-delta)); }
    /* A finished turn's marks are a size up, as DSH draws the end-of-turn row.
       DSH asks for 17px there, but its button is a 28px box with 6px of padding
       — a 16px content box — so the artwork paints at 16 and only shrinks
       unpredictably. Asking for the size it actually renders keeps it crisp. */
    .message-actions.end .message-action.message-icon svg { flex: none; width: calc(16px + var(--dsh-content-font-delta)); height: calc(16px + var(--dsh-content-font-delta)); }
    /* DSH's stat pill: a rounded chip at the secondary size, tabular figures. */
    .message-action.usage-pill { flex: none; gap: 6px; padding: 1px 8px; border-radius: 999px; font-size: calc(var(--dsh-content-font-size-secondary) - 1px); line-height: var(--dsh-line-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .message-action.usage-pill svg { flex: none; width: 14px; height: 14px; }
    .usage-pill-sep { margin: 0 6px; color: color-mix(in srgb, currentColor 55%, transparent); }
    /* What the turn cost and when it landed, grouped 8px clear of the marks. */
    .message-end { display: inline-flex; align-items: center; gap: 8px; margin-left: 8px; color: inherit; }
    .message-clock { color: inherit; font-size: calc(var(--dsh-content-font-size-secondary) - 1px); line-height: var(--dsh-line); white-space: nowrap; font-variant-numeric: tabular-nums; }
    /* The wait, in DSH's duration face: code, tabular, so it never jitters. */
    .message-duration { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; color: inherit; font-size: calc(var(--dsh-content-font-size-secondary) - 1px); line-height: var(--dsh-line-secondary); white-space: nowrap; }
    .message-duration .duration-number { font-family: var(--dsh-code-font); font-variant-numeric: tabular-nums; }
    /* A user row leads with its own clock, 12px clear of the copy beside it, and
       DSH's user row sits the actions 6px under the bubble rather than the 16px
       a finished reply gets. */
    .message.user .message-actions { margin-top: 6px; }
    .user-actions .message-clock { padding-right: 12px; }
    /* A recorded rating shows the filled mark, as DSH's row does, and keeps the
       quiet colour: the fill is the state, not a highlight. */
    .message-action.active { color: var(--vscode-descriptionForeground); background: transparent; }
    .message-action.active:hover { color: var(--vscode-foreground); background: var(--dsh-hover); }
    .message-copy.copied svg { display: none; }
    .message-copy.copied::after { content: '✓'; font-size: 12px; }
    .message-copy.copied { color: var(--vscode-charts-green, #3fb950); }
    .message.user .message-actions { justify-content: flex-end; margin-left: 0; }
    .routable-notice { padding: 6px 12px 2px; color: var(--vscode-errorForeground); font-size: 11px; }
    .routable-notice.hidden { display: none; }
    .held-notice { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; padding: 6px 12px 2px; font-size: 11px; color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
    .held-notice.hidden { display: none; }
    .held-notice-text { flex: 1 1 220px; }
    .held-action { padding: 0 6px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); font-size: 11px; cursor: pointer; }
    .session-row.archived .session-name { color: var(--dsh-muted); }
    .session-actions { position: absolute; z-index: 50; width: 170px; max-width: calc(100% - 16px); padding: 4px; display: grid; gap: 2px; border: 1px solid var(--dsh-border); border-radius: 8px; background: var(--vscode-menu-background, var(--dsh-surface)); box-shadow: 0 6px 20px var(--vscode-widget-shadow); font-size: 12px; line-height: 18px; }
    .session-action { width: 100%; min-height: 28px; padding: 5px 8px; border: 0; border-radius: 4px; color: var(--vscode-foreground); background: transparent; text-align: left; font-size: 12px; }
    .session-action:hover { background: var(--dsh-hover); }
    .session-action:disabled { opacity: .5; }
    .session-notice { position: absolute; z-index: 51; top: 8px; left: 50%; transform: translateX(-50%); padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsh-border); background: var(--vscode-menu-background, var(--dsh-surface)); color: var(--vscode-foreground); font-size: 11px; box-shadow: 0 4px 14px var(--vscode-widget-shadow); }
    .session-notice.hidden { display: none; }
    .icon-button { width: 28px; height: 28px; min-width: 28px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-icon-foreground); }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    #openSettings { width: 36px; min-width: 36px; height: 36px; border-radius: 12px; }
    #openSettings svg { width: 18px; height: 18px; stroke-width: 1.3; }
    .github-star:hover { color: var(--vscode-charts-yellow, #e3b341); }
    .jobs-control { position: relative; flex: 0 0 auto; }
    .task-panel { min-width: 0; border: .5px solid var(--dsh-border); border-radius: 12px; overflow: hidden; background: var(--dsh-surface); line-height: 18px; }
    .task-toggle { width: 100%; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 9px 10px; background: transparent; border: 0; text-align: left; font-size: 11px; color: var(--dsh-muted); }
    .task-toggle-title { color: var(--vscode-foreground); font-size: 12px; font-weight: 600; }
    .task-toggle-count { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .task-attention { flex: none; padding: 0 5px; border-radius: 5px; color: var(--dsh-warning); background: color-mix(in srgb, var(--dsh-warning) 12%, transparent); font-size: 10px; }
    .task-chevron { flex: none; width: 12px; height: 12px; transition: transform 120ms; }
    .task-toggle[aria-expanded="true"] .task-chevron { transform: rotate(90deg); }
    .task-toggle:hover, .task-child:not([aria-disabled="true"]):hover { background: var(--vscode-toolbar-hoverBackground); }
    .task-child[aria-disabled="true"] { cursor: default; }
    .task-list { max-height: min(210px, 27vh); overflow-y: auto; padding: 0 5px 6px; }
    .task-section { margin: 7px 5px 4px; font-size: 10px; color: var(--dsh-muted); }
    .task-child { display: flex; width: 100%; min-width: 0; align-items: center; gap: 9px; border: 0; border-radius: 8px; padding: 8px; background: transparent; text-align: left; font-size: 12px; line-height: 18px; }
    .task-glyph { flex: none; width: 22px; height: 22px; display: grid; place-items: center; border: .5px solid var(--dsh-border); border-radius: 7px; color: var(--dsh-muted); }
    .task-glyph svg { width: 14px; height: 14px; }
    .task-glyph.waiting { color: var(--dsh-warning); border-color: color-mix(in srgb, var(--dsh-warning) 30%, transparent); }
    .task-glyph.running { color: var(--dsh-accent); }
    .task-glyph.completed { color: var(--dsh-success); }
    .task-copy { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .task-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .task-meta { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 3px 7px; color: var(--dsh-muted); font-size: 10px; line-height: 15px; font-variant-numeric: tabular-nums; }
    .task-entry { display:flex; align-items:center; min-width:0; }
    .task-entry .task-child { width:auto; flex:1; }
    .task-open { flex: none; width: 28px; height: 28px; padding:6px; border:0; border-radius:6px; background:transparent; color: var(--dsh-muted); cursor:pointer; }
    .task-open svg { width:14px; height:14px; }
    .task-open:hover { background:var(--dsh-hover); }
    .task-status { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .task-status.running { color: var(--vscode-textLink-foreground); }
    .task-status.waiting { color: var(--vscode-editorWarning-foreground, #cca700); }
    .task-status.completed { color: var(--vscode-testing-iconPassed, #73c991); }
    .task-todo { display: flex; align-items: baseline; gap: 7px; padding: 4px 7px; font-size: 11px; }
    .task-todo.completed { color: var(--vscode-descriptionForeground); }
    /* Shared Team tasks are read-only rows: the durable projection is the authority. */
    .team-task { display: grid; gap: 2px; padding: 4px 7px; font-size: 11px; line-height: 17px; }
    .team-task + .team-task { border-top: .5px solid var(--vscode-widget-border); }
    .team-task-head { min-width: 0; display: flex; align-items: baseline; gap: 7px; }
    .team-task-subject { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .team-task-note { min-width: 0; overflow-wrap: anywhere; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .team-member-note { margin: 0 8px 2px; overflow-wrap: anywhere; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .task-features { order: 2; background: transparent; border-color: transparent; }
    .task-features summary { cursor: pointer; padding: 5px 9px; font-size: 11px; color: var(--dsh-muted); }
    .task-features[open] { background: var(--dsh-surface); border-color: var(--dsh-border); }
    .feature-body { max-height: min(260px, 35vh); overflow: auto; padding: 5px 10px 9px; font-size: 11px; line-height: 17px; }
    .feature-title { font-weight: 600; margin: 5px 0; }
    .feature-copy { white-space: pre-wrap; overflow-wrap: anywhere; }
    .feature-actions { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0; }
    .feature-action, .job-details { border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: transparent; padding: 2px 6px; font-size: 11px; line-height: 16px; }
    .feature-action:hover, .job-details:hover { background: var(--vscode-toolbar-hoverBackground); }
    .feature-hint, .search-snippet { color: var(--vscode-descriptionForeground); font-size: 10px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .reminder-row, .workflow-run { padding: 5px 0; border-top: 1px solid var(--vscode-widget-border); }
    .workflow-member { display: block; width: 100%; padding: 3px 7px; border: 0; background: transparent; text-align: left; font-size: 11px; line-height: 16px; }
    .workflow-member:hover { background: var(--vscode-toolbar-hoverBackground); }
    .session-search-hit { padding: 5px 8px; border: 0; background: transparent; width: 100%; text-align: left; }
    .session-search-hit:hover { background: var(--vscode-toolbar-hoverBackground); }
    .jobs-trigger { width: auto; min-width: 28px; padding: 0 7px; display: flex; gap: 5px; font-size: 11px; }
    .jobs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
    .jobs-trigger.live .jobs-dot { background: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 20%, transparent); }
    .jobs-menu { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; width: min(340px, calc(100vw - 20px)); max-height: min(420px, 70vh); padding: 6px; overflow: auto; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); }
    .jobs-section { display: flex; align-items: center; gap: 4px; padding: 5px 7px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .jobs-section-toggle { display: flex; align-items: center; gap: 3px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
    .jobs-section-toggle:hover { color: var(--vscode-foreground); }
    .jobs-section-chevron { display: inline-block; transition: transform 100ms ease; }
    .jobs-section-chevron.open { transform: rotate(90deg); }
    .jobs-clear { margin-left: auto; padding: 0 3px; border: 0; background: transparent; color: var(--vscode-textLink-foreground); font: inherit; letter-spacing: normal; text-transform: none; cursor: pointer; }
    .jobs-clear:hover { text-decoration: underline; }
    .job-item { border-radius: 5px; }
    .job-item + .job-item { border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 50%, transparent); }
    .job-row { min-width: 0; display: flex; align-items: center; gap: 6px; padding: 7px; border-radius: 5px; }
    .job-chevron { flex: none; width: 14px; padding: 0; border: 0; background: transparent; color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 14px; text-align: center; cursor: pointer; transition: transform 100ms ease; }
    .job-chevron:hover { color: var(--vscode-foreground); }
    .job-chevron.expanded { transform: rotate(90deg); }
    .job-chevron.empty { visibility: hidden; cursor: default; }
    .job-kind { flex: none; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; text-transform: uppercase; }
    .job-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
    .job-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-foreground); font: 11px var(--vscode-editor-font-family); }
    .job-detail { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .job-duration { flex: none; color: var(--vscode-descriptionForeground); font: 10px var(--vscode-editor-font-family); }
    .job-stop { flex: none; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; color: var(--vscode-foreground); background: transparent; font-size: 10px; }
    .job-stop:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
    .job-stop:disabled { opacity: .55; cursor: default; }
    .job-stop.armed { border-color: var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-errorForeground, #f48771); font-weight: 600; }
    .job-stop.failed { border-color: var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-errorForeground, #f48771); }
    .job-output { margin: 0 7px 7px 27px; padding: 6px 7px; border-radius: 5px; background: color-mix(in srgb, var(--vscode-textCodeBlock-background, #000000) 55%, transparent); }
    .job-output-notice { padding: 1px 0; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .job-output-notice.error { color: var(--vscode-errorForeground, #f48771); }
    .job-output-pre { margin: 3px 0 0; max-height: 190px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 10px/1.5 var(--vscode-editor-font-family); color: var(--vscode-foreground); }
    .job-output-pre .stderr { color: var(--vscode-errorForeground, #f48771); }
    .job-output-pre .log { color: var(--vscode-descriptionForeground); }
    .job-output-empty { color: var(--vscode-descriptionForeground); }
    .job-output-actions { display: flex; gap: 5px; margin-top: 5px; }
    .icon-button:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    svg:where(:not(.katex svg)) { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .conversation-pane { position: relative; min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); }
    .scroll { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overflow-anchor: none; scroll-behavior: auto; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }
    .scroll:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .jump-latest { position: absolute; z-index: 5; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, #8886)); border-radius: 16px; background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); box-shadow: 0 2px 8px var(--vscode-widget-shadow); white-space: nowrap; font-size: 11px; }
    .jump-latest:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .jump-latest[hidden] { display: none; }
    .jump-latest svg { width: 13px; height: 13px; }
    .conversation { width: 100%; min-width: 0; max-width: 748px; margin: 0 auto; padding: 16px 14px 30px; overflow: hidden; }
    .conversation-slot, .messages { display: contents; }
    .history-loader { display: flex; justify-content: center; padding: 1px 0 9px; }
    .history-button { padding: 3px 9px; border: 0; border-radius: 5px; color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; }
    .history-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .empty { min-height: 55vh; display: grid; place-content: center; justify-items: center; text-align: center; padding: 28px 10px; }
    .deepseek-mark { background-color: #4d6bfe; -webkit-mask: url("${mark}") center / contain no-repeat; mask: url("${mark}") center / contain no-repeat; }
    .empty-logo { width: 48px; height: 48px; margin-bottom: 18px; }
    .empty h2 { margin: 0 0 9px; font-size: 20px; line-height: 28px; font-weight: 600; }
    .empty p { max-width: 280px; margin: 0; color: var(--dsh-muted); font-size: 12px; line-height: 20px; }
    .empty-actions { width: 100%; max-width: 280px; display: grid; gap: 8px; margin-top: 24px; }
    .empty-action { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: .5px solid var(--dsh-border); border-radius: 10px; padding: 10px 12px; background: var(--dsh-surface); text-align: left; font-size: 12px; line-height: 18px; }
    .empty-action:hover { border-color: var(--dsh-accent); background: var(--dsh-hover); }
    .empty-action svg { width: 14px; height: 14px; color: var(--dsh-muted); flex: none; }
    /**
     * DSH's flow rhythm: the rows of one turn's working sit 6px apart so a run
     * of tool rows reads as one block, 12px follows a finished response, and 16px
     * of air stands where the answer follows the working.
     *
     * Not a message-adjacent-sibling rule: the rows of a transcript are different
     * elements (a message is an article, a tool a disclosure row), so the gap is
     * settled here, after every row has set its own margins.
     */
    #messages > * { margin-top: 0; }
    #messages > * + * { margin-top: 6px; }
    #messages > .message.assistant + * { margin-top: 12px; }
    #messages > .tool + .message.assistant,
    #messages > .command-card + .message.assistant { margin-top: 16px; }
    .message { width: 100%; min-width: 0; overflow: hidden; }
    .message-body { width: 100%; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; font-size: var(--dsh-content-font-size); line-height: var(--dsh-line); }
    /* DSH's user side is the bubble and nothing else: no name, no avatar. */
    .message.user { display: flex; flex-direction: column; align-items: flex-end; }
    .user .message-body { width: fit-content; max-width: 82%; padding: 10px 16px; white-space: pre-wrap; border-radius: var(--dsh-radius-xl); background: var(--dsh-bubble); line-height: calc(22px + var(--dsh-content-font-delta)); }
    .message-images { width: 100%; display: grid; gap: 7px; margin-top: 8px; }
    .message-image { display: block; max-width: 100%; max-height: 380px; border: 1px solid var(--vscode-widget-border); border-radius: var(--dsh-radius-sm); object-fit: contain; background: var(--vscode-editor-background); }
    /**
     * DSH's disclosure header, ported: a 16px leading box holding a 14px glyph,
     * 6px of air, then the label at the secondary size on the body line.
     */
    .thinking { margin: 0 0 8px; }
    .thinking summary { display: flex; align-items: center; height: var(--dsh-line); min-width: 0; cursor: pointer; list-style: none; color: var(--vscode-descriptionForeground); transition: color 100ms ease; }
    .thinking summary:hover { color: var(--vscode-foreground); }
    .thinking summary::-webkit-details-marker { display: none; }
    .thinking-icon { position: relative; flex: none; width: 16px; height: 16px; margin-right: 6px; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
    .thinking-icon svg { width: 14px; height: 14px; }
    .thinking.live .thinking-icon { color: var(--vscode-foreground); animation: thinking-pulse 1.4s ease-in-out infinite; }
    .thinking.live .thinking-title { color: var(--vscode-foreground); }
    @keyframes thinking-pulse { 0%, 100% { opacity: .35; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.1); } }
    @media (prefers-reduced-motion: reduce) { .thinking.live .thinking-icon { animation: none; opacity: 1; } .thinking summary { transition: none; } }
    .thinking-title { flex: none; font-size: var(--dsh-content-font-size-secondary); line-height: var(--dsh-line); font-weight: 400; color: inherit; }
    /* DSH separates the label from its summary with a 2px dot, not a dash. */
    .thinking-sep { flex: none; width: 2px; height: 2px; margin: 0 8px; border-radius: 1px; background: color-mix(in srgb, var(--vscode-foreground) 45%, transparent); }
    .thinking-sep[hidden] { display: none; }
    /* DSH sets a duration apart in the code face with tabular figures. The 4px
       keeps "Thought" and "42s" from reading as one word: the label is a span of
       its own now, so it carries no trailing space. */
    .thinking-duration { flex: none; margin-left: 4px; font-family: var(--dsh-code-font); font-variant-numeric: tabular-nums; font-size: var(--dsh-content-font-size-secondary); line-height: var(--dsh-line); color: inherit; }
    .thinking-duration[hidden] { display: none; }
    .thinking-preview { min-width: 0; flex: auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--dsh-content-font-size-secondary); line-height: var(--dsh-line-secondary); }
    .thinking-body { margin: 0; padding: 4px 0 4px 22px; border: 0; color: var(--vscode-descriptionForeground); white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--dsh-content-font-size-secondary); line-height: calc(20px + var(--dsh-content-font-delta-secondary)); }
    /* DSH cot-translation: translated fragments replace the original text in the
       same measured body, with a compact toolbar above them. The pending spinner
       and the failure sentence share the toolbar so the body never jumps. */
    .thinking-translation { display: grid; gap: 4px; min-width: 0; }
    .thinking-translation-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 22px; }
    .thinking-translation-toggle, .thinking-translation-retry { flex: none; padding: 1px 7px; border: 1px solid var(--vscode-widget-border, var(--dsh-border)); border-radius: 5px; background: transparent; color: var(--vscode-textLink-foreground); font-size: 11px; line-height: 16px; cursor: pointer; }
    .thinking-translation-toggle:hover:not(:disabled), .thinking-translation-retry:hover { background: var(--vscode-toolbar-hoverBackground); }
    .thinking-translation-toggle:disabled { opacity: .55; cursor: default; }
    .thinking-translation-spinner { flex: none; width: 10px; height: 10px; border: 1.5px solid color-mix(in srgb, var(--vscode-foreground) 25%, transparent); border-top-color: var(--vscode-textLink-foreground); border-radius: 50%; animation: thinking-translation-spin .8s linear infinite; }
    .thinking-translation-spinner[hidden], .thinking-translation-failure[hidden], .thinking-translation-retry[hidden] { display: none; }
    .thinking-translation-failure { min-width: 0; flex: 1 1 auto; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
    .thinking-translation-text { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    @keyframes thinking-translation-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .thinking-translation-spinner { animation: none; } }
    .live-status { display: flex; align-items: center; gap: 6px; margin: 6px 0 3px; color: var(--vscode-descriptionForeground); font-size: calc(var(--dsh-content-font-size) - 2px); line-height: calc(22px + var(--dsh-content-font-delta)); }
    .live-status-mark { position: relative; flex: none; width: 14px; height: 14px; display: inline-flex; color: var(--vscode-charts-blue, #4d6bfe); }
    .live-status-mark svg { display: block; width: 100%; height: 100%; }
    /**
     * DSH's own swimming tail: a 28px APNG it uses as a mask, so the animation
     * paints in the theme's colour instead of whatever colour the asset carries.
     * The still outline underneath is the fallback: if the asset cannot load, the
     * mark is a stationary tail rather than nothing.
     */
    .live-status-swim { position: absolute; inset: 0; background-color: currentColor; -webkit-mask: url("${tail}") 50% / 100% 100% no-repeat; mask: url("${tail}") 50% / 100% 100% no-repeat; }
    .live-status.stopping .live-status-mark { color: var(--vscode-descriptionForeground); }
    .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    /* DSH keeps the numbers from jittering as the clock ticks. */
    .live-status-text { font-variant-numeric: tabular-nums; }
    /**
     * DSH's streaming highlight: the live words are painted once, with a moving
     * gradient standing in for their colour, so a brighter band crosses the line
     * while every glyph stays exactly where it was.
     *
     * DSH gets the same effect from a masked second copy of the text plus a
     * counter-transform that holds the copy in place. One copy and a gradient is
     * the same picture with nothing left that can drift out of alignment, which is
     * the failure worth designing out: a copy that moves shows doubled glyphs.
     */
    .shimmer {
      --shimmer-base: var(--vscode-descriptionForeground);
      /* Tiled, because a non-repeating gradient leaves the box uncovered at the
         ends of its travel, and an unpainted background here means invisible
         text: the glyphs are filled by this image. */
      background-image: linear-gradient(100deg, var(--shimmer-base) 0 40%, var(--vscode-foreground) 46% 54%, var(--shimmer-base) 60% 100%);
      background-size: 200% 100%;
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: shimmer-sweep 1.5s steps(48, end) .3s infinite;
    }
    .tool-title.shimmer { --shimmer-base: var(--vscode-foreground); }
    @keyframes shimmer-sweep { 0% { background-position: 0 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .live-status-swim { display: none; }
      .shimmer { animation: none; background-image: none; -webkit-text-fill-color: inherit; }
    }
    .message-image-status { padding: 8px 10px; border: 1px dashed var(--vscode-widget-border); border-radius: 7px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .message-image-status.failed { color: var(--vscode-errorForeground); }
    .pending-steering { opacity: .82; }
    .pending-steering .message-body::after { content: 'Steering…'; display: block; margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    /**
     * DSH's markdown sheet, at DSH's own measurements: 16px between blocks,
     * 32px around headings, 18px of list indent with the marker on the body
     * line, and hairlines instead of full table borders. Everything is sized
     * from the content axis, so it all moves together with the reader's font.
     */
    .markdown { min-width: 0; font: var(--dsh-content-font-size)/var(--dsh-line) var(--vscode-font-family); color: var(--vscode-foreground); }
    .markdown > :first-child, .markdown p:first-child { margin-top: 0 !important; }
    .markdown > :last-child, .markdown p:last-child { margin-bottom: 0 !important; }
    .streaming-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
    .markdown p { margin: 16px 0; }
    .markdown strong { font-weight: 600; }
    .markdown h1 { font: 700 calc(21px + var(--dsh-content-font-delta))/calc(30px + var(--dsh-content-font-delta)) var(--vscode-font-family); margin: 32px 0 16px; }
    .markdown h2 { font: 700 calc(19px + var(--dsh-content-font-delta))/calc(28px + var(--dsh-content-font-delta)) var(--vscode-font-family); margin: 32px 0 16px; }
    .markdown h3 { font: 700 calc(18px + var(--dsh-content-font-delta))/calc(26px + var(--dsh-content-font-delta)) var(--vscode-font-family); margin: 32px 0 16px; }
    .markdown h4 { font: 600 var(--dsh-content-font-size)/var(--dsh-line) var(--vscode-font-family); margin: 16px 0; }
    .markdown h5, .markdown h6 { font: 600 var(--dsh-content-font-size)/var(--dsh-line) var(--vscode-font-family); margin: 16px 0; }
    /* A short heading against a list keeps 8px, not a whole paragraph of air. */
    .markdown h4 + ul, .markdown h4 + ol, .markdown h5 + ul, .markdown h5 + ol, .markdown h6 + ul, .markdown h6 + ol { margin-top: 8px; }
    .markdown ul, .markdown ol { margin: 16px 0; padding-left: 18px; }
    .markdown li:not(:first-child) { margin-top: 6px; }
    .markdown li > ul, .markdown li > ol { margin-top: 4px; }
    .markdown li::marker { line-height: var(--dsh-line); color: var(--vscode-descriptionForeground); }
    .markdown li > p { margin: 8px 0; }
    .markdown li > *:first-child { margin-top: 0; }
    .markdown li > *:last-child { margin-bottom: 0; }
    .markdown hr { height: var(--dsh-hairline); margin: 32px 0; border: 0; background: var(--dsh-hairline-l2); }
    .markdown blockquote { margin: 16px 0 0; padding-left: 14px; border-left: 2px solid color-mix(in srgb, var(--vscode-foreground) 32%, transparent); color: var(--vscode-foreground); background: none; }
    .markdown pre { margin: 16px 0; font-family: var(--dsh-code-font); overflow: auto; }
    .markdown :not(pre) > code { display: inline-flex; align-items: center; font-family: var(--dsh-code-font); font-size: .875em !important; padding: 0 5px; border: var(--dsh-hairline) solid var(--dsh-hairline-l1); border-radius: var(--dsh-radius-xs); background: var(--vscode-textCodeBlock-background); }
    .markdown-table { max-width: 100%; margin: 16px 0; overflow-x: auto; overscroll-behavior-x: contain; border: 0; border-radius: 0; }
    .markdown table { border-collapse: collapse; width: max-content; max-width: max-content; font: var(--dsh-content-font-size-secondary)/var(--dsh-line-secondary) var(--vscode-font-family); }
    /* Under four columns a table fills the column instead of scrolling. */
    .markdown-table.md-table-fill table { width: 100%; max-width: none; }
    .markdown th { padding: 10px 16px; border: 0; border-bottom: var(--dsh-hairline) solid var(--dsh-hairline-l3); background: none; font-weight: 500; text-align: start; vertical-align: top; max-width: min(30vw, 320px); min-width: 100px; }
    .markdown td { padding: 10px 16px; border: 0; border-bottom: var(--dsh-hairline) solid var(--dsh-hairline-l2); vertical-align: top; max-width: min(30vw, 320px); min-width: 100px; }
    .markdown th:first-child, .markdown td:first-child { padding-left: 0; }
    .markdown td:last-child { padding-right: 0; }
    .markdown tbody tr:nth-child(even) { background: none; }
    .markdown th:not([align]), .markdown td:not([align]) { text-align: left; }
    .markdown-math-inline { display: inline-block; max-width: 100%; overflow-x: auto; vertical-align: middle; padding: 2px 0; }
    .markdown-math-display { display: block; max-width: 100%; overflow-x: auto; margin: 16px 0; }
    .markdown .katex { font-size: 1.1em; overflow-wrap: normal; word-break: normal; }
    .markdown .katex-display { margin: 0; padding: 5px 2px; text-align: left; }
    .markdown .katex-display > .katex { text-align: left; }
    code { padding: 1px 4px; border-radius: var(--dsh-radius-xs); font-family: var(--dsh-code-font); background: var(--vscode-textCodeBlock-background); }
    pre { max-width: 100%; margin: 16px 0; padding: 16px; overflow: auto; white-space: pre; border-radius: var(--dsh-radius-lg); color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); font: 11px/19px var(--dsh-code-font); }
    pre code { padding: 0; background: transparent; }
    .cancel-spinner { display: none; width: 12px; height: 12px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: cancel-spin .8s linear infinite; }
    .cancel.stopping .cancel-spinner { display: block; }
    .cancel.stopping > svg { display: none; }
    .cancel.stopping { opacity: .8; cursor: default; }
    /* The request landed, but the turn is still winding down: keep it clickable
       (a second click re-sends the idempotent cancel) and mark it as pending. */
    .cancel.requested { color: var(--vscode-editorWarning-foreground, #cca700); opacity: .9; }
    @keyframes cancel-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .cancel-spinner { animation-duration: 2.4s; } }
    /* DSH's code card: one surface at the large radius, a banner at 11px, and a
       body that wraps rather than pushing the conversation sideways. */
    .code-block { margin: 16px 0; border: 0; border-radius: var(--dsh-radius-lg); overflow: hidden; background: var(--vscode-textCodeBlock-background); }
    .code-block-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 8px 5px 14px; border-bottom: 0; font: 11px/18px var(--vscode-font-family); }
    .code-block-language { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-foreground); font-family: var(--dsh-code-font); font-size: 11px; }
    .code-copy { flex: none; padding: 2px 8px; border: 0; border-radius: var(--dsh-radius-xs); color: var(--vscode-descriptionForeground); background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
    .code-copy:hover { color: var(--vscode-foreground); background: var(--dsh-hover); }
    .code-copy.copied { color: var(--vscode-charts-green, #3fb950); }
    .code-block pre { margin: 0; padding: 16px; border-radius: 0; background: transparent; white-space: pre-wrap; word-break: break-word; }
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
    /**
     * DSH's tool rows are disclosure rows, not cards: a 16px leading box, the
     * tool's own title on the body line, then a dot and the detail. The result
     * below is DSH's code surface — indented to the title's text edge, at the
     * code-block size, so a long transcript reads as lines rather than boxes.
     */
    .tool { margin: 0; border: 0; border-radius: 0; overflow: visible; background: none; color: var(--vscode-descriptionForeground); }
    .tool.failed { color: var(--vscode-errorForeground); }
    .tool summary { min-height: var(--dsh-line); padding: 0; display: flex; align-items: center; cursor: pointer; list-style: none; transition: color 100ms ease; }
    .tool summary:hover { color: var(--vscode-foreground); }
    .tool summary::-webkit-details-marker { display: none; }
    @media (prefers-reduced-motion: reduce) { .tool summary { transition: none; } }
    .tool-icon { position: relative; flex: none; width: 16px; height: 16px; margin-right: 6px; display: inline-flex; align-items: center; justify-content: center; color: inherit; font-family: var(--dsh-code-font); font-size: 11px; text-align: center; }
    .tool-title { min-width: 0; flex: none; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--dsh-content-font-size); line-height: var(--dsh-line); font-weight: 400; color: inherit; }
    .tool-detail { min-width: 0; flex: auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: inherit; font-size: var(--dsh-content-font-size-secondary); line-height: var(--dsh-line); }
    .tool-detail:not(:empty) { display: inline-flex; align-items: center; }
    .tool-detail:not(:empty)::before { content: ''; flex: none; width: 2px; height: 2px; margin: 0 8px; border-radius: 1px; background: color-mix(in srgb, currentColor 55%, transparent); }
    .tool-body { margin: 4px 0 0 22px; padding: 0; min-width: 0; overflow: hidden; color: var(--vscode-descriptionForeground); }
    .tool-body pre { margin: 4px 0; padding: 10px 12px; border-radius: var(--dsh-radius-md); color: var(--vscode-foreground); background: var(--vscode-textCodeBlock-background); font: 11px/16px var(--dsh-code-font); }
    /* An Auto review denial is a tool outcome, not the tool's own error text:
       one explicit refusal line, at the body's reading size and colour. */
    .auto-review-body { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--vscode-foreground); }
    .tool-output-more { margin: 5px 0 0; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: var(--dsh-radius-xs); color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; }
    .tool-output-more:hover { background: var(--dsh-hover); }
    /* A slash command DSH ran on its own is the same disclosure row, verbatim. */
    .command-card { margin: 0; padding: 0; border: 0; border-radius: 0; background: none; }
    .command-card.failed { color: var(--vscode-errorForeground); }
    .command-head { min-width: 0; min-height: var(--dsh-line); display: flex; align-items: center; color: var(--vscode-descriptionForeground); }
    .command-name { min-width: 0; flex: none; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: var(--dsh-code-font); font-size: var(--dsh-content-font-size); line-height: var(--dsh-line); font-weight: 400; color: var(--vscode-foreground); }
    .command-result { margin: 4px 0 0 22px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--dsh-content-font-size-secondary); line-height: var(--dsh-line-secondary); }
    .diff-path, .result-title { margin: 7px 0 4px; font-weight: 600; color: var(--vscode-foreground); }
    .diff-old { border-left: 2px solid var(--vscode-gitDecoration-deletedResourceForeground); }
    .diff-new { border-left: 2px solid var(--vscode-gitDecoration-addedResourceForeground); }
    .source { display: block; margin: 4px 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .source-line { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .tool-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
    .tool-action { min-height: 24px; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: var(--dsh-radius-xs); color: var(--vscode-foreground); background: transparent; font-size: 11px; }
    .tool-action:hover { background: var(--vscode-toolbar-hoverBackground); }
    .changed-files { margin: 10px 0 4px; border: 1px solid var(--dsh-border); border-radius: 8px; background: transparent; font-size: 12px; line-height: 16px; }
    .changed-files-head { min-width: 0; min-height: 34px; padding: 4px 6px; display: flex; align-items: center; gap: 6px; }
    .changed-files-toggle { min-width: 0; flex: 1; min-height: 26px; padding: 0 2px; display: flex; align-items: center; gap: 6px; border: 0; border-radius: 4px; background: transparent; text-align: left; font-size: 11px; }
    .changed-files-toggle:hover { background: var(--dsh-hover); }
    .changed-files-title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 500; }
    .changes-chevron { flex: none; width: 12px; height: 12px; color: var(--dsh-muted); }
    .changes-chevron svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; }
    .changes-chevron.expanded { transform: rotate(90deg); }
    .changed-files-body { max-height: 220px; overflow: auto; padding: 0 6px 4px; border-top: .5px solid var(--dsh-border); }
    .changed-turn-title { padding: 6px 4px 2px; color: var(--dsh-muted); font-size: 10px; }
    .changed-file { min-width: 0; min-height: 30px; padding: 2px 4px; display: grid; grid-template-columns: minmax(0, 1fr) auto 24px; align-items: center; gap: 6px; border-radius: 4px; }
    .changed-file:hover, .changed-file:focus-within { background: var(--dsh-hover); }
    .changed-file-link { min-width: 0; padding: 4px 0; display: flex; align-items: baseline; gap: 6px; border: 0; border-radius: 4px; background: transparent; text-align: left; font-size: 11px; }
    .changed-file-name, .changed-file-dir { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .changed-file-name { font-weight: 500; }
    .changed-file-dir { max-width: 45%; color: var(--dsh-muted); font-size: 10px; }
    .changed-file-stats { flex: none; display: flex; gap: 5px; font-size: 10px; font-variant-numeric: tabular-nums; }
    .change-additions { color: var(--vscode-gitDecoration-addedResourceForeground, var(--dsh-success)); }
    .change-deletions { color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-errorForeground)); }
    .changed-files-head .changed-more, .changed-file:hover .changed-more, .changed-file:focus-within .changed-more { opacity: 1; }
    .changed-action { min-height: 24px; padding: 2px 6px; border: 0; border-radius: 4px; color: var(--vscode-foreground); background: transparent; font-size: 11px; }
    .changed-action:hover { background: var(--dsh-hover); }
    .session-action.danger { color: var(--vscode-errorForeground); }
    .failed, .error-text { color: var(--vscode-errorForeground); }
    .assistant-failure { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); border-radius: 6px; font-size: 12px; line-height: 1.5; }
    .assistant-failure-title { color: var(--vscode-errorForeground); font-weight: 600; }
    /* The runtime code is its own element beside the reason: a narrow sidebar
       wraps it rather than widening, and it never sits in the title row. */
    .assistant-failure-line { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
    .assistant-failure-detail { min-width: 0; flex: 1 1 auto; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    .assistant-failure-code { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; font-weight: 500; }
    /* A model request retried by the runtime: one collapsible process row. */
    .retry-row { margin-top: 8px; border: .5px solid var(--vscode-widget-border, var(--dsh-border)); border-radius: 6px; font-size: 12px; line-height: 1.5; }
    .retry-summary { padding: 6px 9px; cursor: pointer; }
    .retry-text { min-width: 0; overflow-wrap: anywhere; color: var(--vscode-descriptionForeground); }
    .retry-row[data-active] .retry-text { color: var(--vscode-textLink-foreground); }
    .retry-details { padding: 0 9px 7px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
    .retry-detail-label { font-weight: 600; }
    /* The turn ended at the output-token cap: a warning row after the reply. */
    .turn-limit { display: flex; align-items: flex-start; gap: 7px; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--vscode-editorWarning-foreground, #cca700); border-radius: 6px; font-size: 12px; line-height: 1.5; }
    .turn-limit-dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--vscode-editorWarning-foreground, #cca700); }
    .turn-limit-copy { min-width: 0; overflow-wrap: anywhere; }
    .turn-limit-title { display: block; color: var(--vscode-editorWarning-foreground, #cca700); font-weight: 600; }
    /**
     * No typing caret while a reply streams.
     *
     * There used to be a blinking block after the last word, which said the same
     * thing as the swimming tail in the live row two lines below it — and said it
     * worse, because a caret reads as "your text goes here". DSH shows the tail
     * alone, so the tail is the single answer to "is it still working".
     */
    .status, .interaction { margin: 10px 0; padding: 11px; border: 1px solid var(--vscode-widget-border); border-radius: var(--dsh-radius-md); overflow-wrap: anywhere; background: var(--vscode-editor-background); }
    /* A runtime note is a line of the transcript, not a card in it. */
    .status { margin: 6px 0; padding: 0; color: var(--vscode-descriptionForeground); border: 0; border-radius: 0; background: none; font-size: var(--dsh-content-font-size-secondary); line-height: var(--dsh-line-secondary); }
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
    .composer-wrap { width: 100%; min-width: 0; padding: 8px 12px 12px; overflow: hidden; background: linear-gradient(transparent, var(--vscode-sideBar-background) 18px); }
    .task-area { display: flex; flex-direction: column; gap: 4px; max-width: 760px; margin: 0 auto; max-height: min(300px, 36vh); overflow-y: auto; }
    .task-area:has(> :not(.hidden)) { margin-bottom: 8px; }
    .task-area > .task-panel { flex: 0 0 auto; }
    .queue-dock { width: 100%; min-width: 0; max-width: 760px; margin: 0 auto 6px; padding: 7px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 9px; background: var(--vscode-editor-background); }
    .queue-head { min-width: 0; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .queue-title { min-width: 0; flex: 1; font-weight: 600; }
    .queue-row { min-width: 0; min-height: 30px; display: flex; align-items: center; gap: 6px; }
    .queue-row + .queue-row { border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); }
    .queue-preview { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    /* DSH's own wording for a row the runtime has not listed yet. */
    .queue-sending { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 10px; font-style: italic; }
    /* A command this window holds until the conversation is idle. */
    .queue-command-note { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 10px; font-style: italic; }
    .queue-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 3px; }
    .queue-action { min-height: 23px; padding: 1px 5px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
    .queue-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .queue-editor { width: 100%; min-width: 0; min-height: 30px; height: 30px; padding: 4px 6px; resize: none; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); }
    .composer { width: 100%; min-width: 0; max-width: 760px; margin: 0 auto; border: 1px solid var(--dsh-border); border-radius: 16px; background: var(--vscode-input-background, var(--dsh-surface)); box-shadow: 0 3px 12px color-mix(in srgb, var(--vscode-widget-shadow, #0004) 35%, transparent); transition: border-color 120ms; }
    .composer:focus-within { border-color: var(--vscode-focusBorder, #4d6bfe); }
    .command-menu { max-height: 210px; padding: 5px; overflow-y: auto; border-bottom: 1px solid var(--vscode-widget-border); }
    .command-option { width: 100%; min-width: 0; padding: 7px 8px; display: block; border: 0; border-radius: 6px; text-align: left; background: transparent; }
    .command-option:hover, .command-option.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .command-option-line { min-width: 0; display: flex; align-items: baseline; gap: 7px; }
    .command-option-name { flex: 0 0 auto; font-family: var(--vscode-editor-font-family); font-weight: 600; }
    .command-option-hint { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .72; }
    .command-option-current { margin-left: auto; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-family: var(--vscode-font-family); font-size: 10px; font-weight: 500; }
    /* Marks a preset the runtime advertises as experimental. It stays visible
       on its own line item, and the label truncates before the badge does. */
    .command-option-badge { flex: 0 0 auto; padding: 0 4px; border: 1px solid currentColor; border-radius: 4px; font-family: var(--vscode-font-family); font-size: 9px; font-weight: 700; letter-spacing: .04em; opacity: .8; }
    .command-option-description { margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .command-option:hover .command-option-description, .command-option.selected .command-option-description { color: inherit; opacity: .82; }
    .command-section-label { padding: 6px 8px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .policy-menu { max-height: 260px; }
    .policy-menu .command-option { padding: 6px 8px; font-size: 12px; line-height: 18px; }
    /* A preset value may be longer than the item (a pinned custom value), so the
       label gives way first and a badge never pushes the row past the sidebar. */
    .policy-menu .command-option-name { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .policy-menu .command-option-current, .policy-menu .command-option-badge { flex: 0 0 auto; }
    .policy-preset-fixed { display: flex; align-items: center; gap: 8px; padding: 5px 8px; font-size: 11px; line-height: 18px; color: var(--dsh-muted); }
    .policy-preset-name { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .policy-preset-note { flex: none; font-size: 10px; }
    .policy-section-label { padding: 7px 8px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .context-chips { display: flex; flex-wrap: nowrap; gap: 5px; padding: 4px 10px 0; overflow-x: auto; font-size: 11px; line-height: 18px; }
    .attachments { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 10px 0; font-size: 11px; line-height: 18px; }
    .context-chip, .attachment-chip { min-width: 0; max-width: 100%; display: flex; align-items: center; gap: 4px; padding: 1px 4px; border: .5px solid var(--dsh-border); border-radius: 5px; color: var(--dsh-muted); background: transparent; }
    .context-chip { flex: 0 0 auto; max-width: 200px; border-color: transparent; }
    .context-chip.pinned { border-color: var(--dsh-border); }
    .attachment-size { flex: 0 0 auto; color: var(--vscode-descriptionForeground); opacity: .8; font-size: 10px; }
    .context-chip.selection { color: var(--vscode-foreground); border-color: color-mix(in srgb, #4d6bfe 55%, var(--vscode-widget-border)); }
    .context-icon { flex: 0 0 auto; font-size: 11px; }
    .context-open { min-width: 0; display: flex; align-items: center; gap: 4px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; font-size: 11px; line-height: 18px; text-align: left; }
    .context-open:hover { color: var(--dsh-accent); }
    .context-menu { display: flex; flex-direction: column; gap: 4px; max-height: min(270px, 36vh); font-size: 12px; line-height: 18px; }
    .context-search { width: 100%; min-width: 0; padding: 6px 8px; border: .5px solid var(--dsh-border); border-radius: 6px; background: var(--vscode-input-background, var(--dsh-surface)); outline: 0; font-size: 12px; line-height: 18px; }
    .context-list { flex: 1; min-height: 0; overflow-y: auto; }
    .context-option { width: 100%; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 5px 7px; border: 0; border-radius: 6px; background: transparent; text-align: left; font-size: 12px; line-height: 18px; }
    .context-option:hover, .context-option:focus-visible { background: var(--dsh-hover); }
    .context-option[aria-selected="true"] { color: var(--dsh-accent); }
    .context-option-mark { flex: none; width: 16px; text-align: center; }
    .context-option-copy { flex: 1; min-width: 0; }
    .context-option-name, .context-option-path { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .context-option-path { color: var(--dsh-muted); font-size: 10px; line-height: 15px; }
    .context-menu-footer { flex: none; display: flex; align-items: center; gap: 6px; border-top: .5px solid var(--dsh-border); padding-top: 4px; }
    .context-menu-action { border: 0; border-radius: 5px; padding: 3px 7px; background: transparent; font-size: 11px; line-height: 18px; color: var(--dsh-muted); }
    .context-menu-action:hover { color: var(--vscode-foreground); background: var(--dsh-hover); }
    .context-menu-action:last-child { margin-left: auto; }
    .context-menu-status { padding: 6px 8px; font-size: 11px; color: var(--dsh-muted); }
    .context-name, .attachment-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .context-remove, .attachment-remove { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; }
    .context-remove:hover, .attachment-remove:hover { background: var(--vscode-toolbar-hoverBackground); }
    .mode-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 10px 0; font-size: 11px; line-height: 18px; }
    .plan-chip { min-height: 22px; padding: 1px 4px 1px 7px; display: inline-flex; align-items: center; gap: 5px; border: .5px solid color-mix(in srgb, #4d6bfe 58%, var(--dsh-border)); border-radius: 5px; color: var(--vscode-foreground); background: color-mix(in srgb, #4d6bfe 8%, var(--dsh-surface)); }
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
    /**
     * DSH's composer dock: the session's own statistics, as pills, centred above
     * the input. They report what the session has done and what it has cost, and
     * appear only once there is something to report.
     *
     * DSH's compact dock draws these as plain spans, without the dialog the
     * detailed one opens, so there are deliberately no interactive rules here.
     */
    .composer-dock { max-width: 100%; margin: 0 auto; padding-top: 4px; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: calc(var(--dsh-content-font-size-secondary) - 1px); line-height: var(--dsh-line-secondary); }
    .composer-dock.hidden { display: none; }
    .stat-pill { max-width: 100%; padding: 1px 8px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; color: var(--vscode-descriptionForeground); background: transparent; font: inherit; line-height: inherit; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .stat-pill svg { flex: none; width: 14px; height: 14px; }
    .stat-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .stat-sep { margin: 0 6px; color: color-mix(in srgb, currentColor 55%, transparent); }
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
    .send { border-radius: 50%; color: white; background: #4d6bfe; }
    .send:hover { background: #405de6; }
    .cancel { color: var(--vscode-errorForeground); }
    .cancel:hover { background: var(--vscode-toolbar-hoverBackground); }
    .send:disabled, textarea:disabled, button:disabled { opacity: .55; cursor: default; }
    .hidden { display: none !important; }
    @media (max-width: 380px) { .conversation { padding-inline: 12px; } .composer-row { grid-template-columns: 28px auto 20px minmax(0, 1fr) minmax(40px, .5fr) auto; } .project span { display: none; } }
    @media (max-height: 500px) { .conversation-home { gap: 8px; padding-block: 8px; grid-template-rows: auto minmax(0, 1fr); } .task-area { max-height: 24vh; } textarea { max-height: 28vh; } .command-menu { max-height: 26vh; } }
    ${webviewThemeCss}
    ${userTextCss}
    ${settingsPageCss}
    ${subagentLinkCss}
  </style>
</head>
<body>
  <div id="app">
    <div id="dropOverlay" class="drop-overlay hidden"><div class="drop-card">Drop files or folders to add them</div></div>
    <header class="toolbar">
      <button id="conversationHome" class="icon-button" title="All conversations" aria-label="All conversations"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button>
      <span class="brand-mark deepseek-mark" aria-hidden="true"></span>
      <div id="sessionControl" class="session-control">
        <button id="sessionTrigger" class="session-trigger" aria-label="Project conversations" aria-haspopup="dialog" aria-expanded="false"><span id="sessionTriggerTitle" class="session-trigger-title">New conversation</span><span id="sessionAttentionCount" class="session-attention-count hidden"></span><svg viewBox="0 0 24 24"><path d="m7 9.5 5 5 5-5"/></svg></button>
        <div id="sessionMenu" class="session-menu hidden" role="dialog" aria-label="Project conversations">
          <input id="sessionSearch" class="session-search" type="search" placeholder="Search titles and message history" aria-label="Search conversations">
          <div id="sessionList" class="session-list" role="list" aria-label="Recent conversations"></div>
          <div class="session-menu-footer"><button id="viewAllSessions" class="session-directory-link" type="button"><span>View all conversations</span><span id="sessionTotal"></span></button></div>
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
      <button id="runtimeConnection" class="runtime-connection" type="button" title="Connect to DSH" aria-label="Connect to DSH"><span id="runtimeIndicator" class="runtime-indicator" role="img" aria-label="Runtime disconnected"></span><span id="runtimeConnectionLabel">Connect</span></button>
      <button id="openSettings" class="icon-button" title="Settings" aria-label="Settings" aria-haspopup="dialog" aria-expanded="false">${settingsIcon('general')}</button>
      <button id="newSession" class="icon-button" title="New conversation" aria-label="New conversation"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    </header>
    <section id="conversationHomeView" class="conversation-home hidden" aria-label="Conversation directory">
      <div class="home-directory-header">
        <div class="home-list-heading"><span id="homeListTitle">Recent conversations</span><button id="homeArchiveToggle" class="home-archive-toggle" type="button" aria-pressed="false">Archived</button></div>
        <p id="homeError" class="home-error hidden" role="alert"></p>
        <div id="homeRuntime" class="home-runtime hidden" role="status"></div>
      </div>
      <div class="home-directory">
        <input id="homeSessionSearch" class="session-search" type="search" placeholder="Search conversations" aria-label="Search all conversations">
        <div id="homeSessionList" class="home-list" role="list" aria-label="Conversations"></div>
      </div>
    </section>
    <div id="conversationPane" class="conversation-pane">
      <main id="scroll" class="scroll" tabindex="0" aria-label="Conversation"><div id="conversation" class="conversation"><div id="conversationStatus" class="conversation-slot"></div><div id="conversationHistory" class="conversation-slot"></div><div id="messages" class="messages"></div><div id="conversationTail" class="conversation-slot"></div></div></main>
      <button id="jumpLatest" class="jump-latest" type="button" aria-label="Jump to latest" aria-controls="scroll" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-5-5 5 5 5-5"/></svg>Jump to latest</button>
    </div>
    <footer id="composerFooter" class="composer-wrap">
      <p id="conversationCreationError" class="home-error hidden" role="alert"></p>
      <div class="task-area">
      <details id="taskFeatures" class="task-panel task-features hidden"><summary id="taskFeaturesSummary">Goal &amp; reminders</summary><div class="feature-body"><div class="feature-actions"><button id="refreshTasks" class="feature-action" type="button">Refresh tasks</button><button id="configureTaskServices" class="feature-action" type="button">Configure task services</button></div><section id="goalPanel"></section><section id="schedulePanel"></section></div></details>
      <section id="taskPanel" class="task-panel hidden" aria-label="Tasks">
        <button id="taskToggle" class="task-toggle" type="button" aria-expanded="true" aria-controls="taskList"></button>
        <div id="taskList" class="task-list"></div>
      </section>
      </div>
      <div id="queueDock" class="queue-dock hidden" aria-label="Queued messages"></div>
      <div id="usageStats" class="composer-dock hidden" role="status" aria-label="Session statistics"></div>
      <div class="composer">
        <div id="subagentBar" class="subagent-bar hidden" role="status"></div>
        <div id="routableNotice" class="routable-notice hidden" role="status"></div>
        <div id="heldNotice" class="held-notice hidden" role="status"></div>
        <div id="modeChips" class="mode-chips hidden" aria-label="Active collaboration modes"></div>
        <div id="contextChips" class="context-chips hidden" aria-label="Editor context"></div>
        <div id="attachments" class="attachments hidden"></div>
        <div id="contextMenu" class="command-menu context-menu hidden" role="dialog" aria-label="Add files">
          <input id="contextSearch" class="context-search" type="search" placeholder="Search project files" aria-label="Search files to add" autocomplete="off" spellcheck="false">
          <div id="contextList" class="context-list" role="listbox" aria-label="Files to include" aria-multiselectable="true"></div>
          <div class="context-menu-footer"><button id="contextImage" class="context-menu-action" type="button">Attach image…</button><button id="contextDone" class="context-menu-action" type="button">Done</button></div>
        </div>
        <div id="mentionMenu" class="command-menu hidden" role="listbox" aria-label="Files and folders"></div>
        <div id="commandMenu" class="command-menu hidden" role="listbox" aria-label="DeepSeek commands"></div>
        <div id="modelMenu" class="command-menu model-menu hidden" aria-label="Choose a model">
          <input id="modelSearch" class="model-search" type="text" placeholder="Search models" aria-label="Search models" role="combobox" aria-expanded="false" aria-controls="modelList" aria-autocomplete="list" autocomplete="off" spellcheck="false" />
          <div id="modelList" class="model-list" role="listbox" aria-label="Models"></div>
        </div>
        <div id="policyMenu" class="command-menu policy-menu hidden" role="menu" aria-label="Conversation settings"></div>
        <textarea id="prompt" rows="3" placeholder="Ask DeepSeek about this project" aria-label="Message DeepSeek"></textarea>
        <div class="composer-row">
          <button id="attach" class="icon-button" title="Add files or images" aria-label="Add files or images" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
          <button id="policyTrigger" class="icon-button policy-trigger hidden" title="Conversation settings" aria-label="Conversation settings" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6z"/><path d="m9.5 12 1.6 1.6 3.5-3.6"/></svg></button>
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
      </div>
    </footer>
    <div id="sessionActions" class="session-actions hidden" role="menu" aria-label="Conversation actions"></div>
    <div id="sessionNotice" class="session-notice hidden" role="status" aria-live="polite"></div>
  </div>
  <script nonce="${token}" src="${escapeHtml(markdownAssets.script.toString(true))}"></script>
  <script nonce="${token}" src="${escapeHtml(markdownAssets.scroll.toString(true))}"></script>
  ${markdownAssets.settings ? '<script nonce="' + token + '" src="' + escapeHtml(markdownAssets.settings.toString(true)) + '"></script>' : ''}
  <script nonce="${token}">
    const vscode = acquireVsCodeApi();
    const settingsModal = window.dshSettingsPage ? window.dshSettingsPage.createSettingsModal(document, vscode) : undefined;
    window.addEventListener('unload', () => { if (settingsModal) settingsModal.dispose(); });
    window.addEventListener('error', event => {
      vscode.postMessage({ type: 'webview-error', message: event.message || 'Unknown webview error' });
    });
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unknown promise rejection');
      vscode.postMessage({ type: 'webview-error', message: reason });
    });
    const elements = {
      runtimeIndicator: document.getElementById('runtimeIndicator'),
      runtimeConnection: document.getElementById('runtimeConnection'),
      runtimeConnectionLabel: document.getElementById('runtimeConnectionLabel'),
      conversation: document.getElementById('conversation'), scroll: document.getElementById('scroll'),
      conversationStatus: document.getElementById('conversationStatus'), conversationHistory: document.getElementById('conversationHistory'), messages: document.getElementById('messages'), conversationTail: document.getElementById('conversationTail'),
      openSettings: document.getElementById('openSettings'), conversationHome: document.getElementById('conversationHome'), conversationHomeView: document.getElementById('conversationHomeView'), conversationPane: document.getElementById('conversationPane'), composerFooter: document.getElementById('composerFooter'),
      conversationCreationError: document.getElementById('conversationCreationError'), homeError: document.getElementById('homeError'), homeRuntime: document.getElementById('homeRuntime'), homeSessionSearch: document.getElementById('homeSessionSearch'), homeSessionList: document.getElementById('homeSessionList'), homeListTitle: document.getElementById('homeListTitle'), homeArchiveToggle: document.getElementById('homeArchiveToggle'), viewAllSessions: document.getElementById('viewAllSessions'), sessionTotal: document.getElementById('sessionTotal'), sessionActions: document.getElementById('sessionActions'), sessionNotice: document.getElementById('sessionNotice'), sessionControl: document.getElementById('sessionControl'), sessionTrigger: document.getElementById('sessionTrigger'), sessionTriggerTitle: document.getElementById('sessionTriggerTitle'), sessionAttentionCount: document.getElementById('sessionAttentionCount'), sessionMenu: document.getElementById('sessionMenu'), sessionSearch: document.getElementById('sessionSearch'), sessionList: document.getElementById('sessionList'), newSession: document.getElementById('newSession'), jobsControl: document.getElementById('jobsControl'), jobsTrigger: document.getElementById('jobsTrigger'), jobsCount: document.getElementById('jobsCount'), jobsMenu: document.getElementById('jobsMenu'),
      prompt: document.getElementById('prompt'), project: document.getElementById('project'), workspace: document.getElementById('workspace'),
      models: document.getElementById('models'), efforts: document.getElementById('efforts'),
      modelControl: document.getElementById('modelControl'), modelTrigger: document.getElementById('modelTrigger'),
      modelTriggerLabel: document.getElementById('modelTriggerLabel'), modelMenu: document.getElementById('modelMenu'),
      modelSearch: document.getElementById('modelSearch'), modelList: document.getElementById('modelList'),
      policyTrigger: document.getElementById('policyTrigger'), policyMenu: document.getElementById('policyMenu'),
      send: document.getElementById('send'), cancel: document.getElementById('cancel'),
      usageControl: document.getElementById('usageControl'), usageTrigger: document.getElementById('usageTrigger'), usageFill: document.getElementById('usageFill'), usagePanel: document.getElementById('usagePanel'), usageStats: document.getElementById('usageStats'),
      attach: document.getElementById('attach'), attachments: document.getElementById('attachments'),
      contextMenu: document.getElementById('contextMenu'), contextSearch: document.getElementById('contextSearch'), contextList: document.getElementById('contextList'), contextImage: document.getElementById('contextImage'), contextDone: document.getElementById('contextDone'),
      queueDock: document.getElementById('queueDock'), dropOverlay: document.getElementById('dropOverlay'),
      taskPanel: document.getElementById('taskPanel'), taskToggle: document.getElementById('taskToggle'), taskList: document.getElementById('taskList'),
      taskFeatures: document.getElementById('taskFeatures'), taskFeaturesSummary: document.getElementById('taskFeaturesSummary'), refreshTasks: document.getElementById('refreshTasks'), configureTaskServices: document.getElementById('configureTaskServices'), goalPanel: document.getElementById('goalPanel'), schedulePanel: document.getElementById('schedulePanel'),
      accountControl: document.getElementById('accountControl'), accountTrigger: document.getElementById('accountTrigger'), accountMenu: document.getElementById('accountMenu'),
      routableNotice: document.getElementById('routableNotice'), heldNotice: document.getElementById('heldNotice'), subagentBar: document.getElementById('subagentBar'),
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
    const ideContextBySession = new Map();
    let contextMenuOpen = false;
    let contextCandidates = [];
    let contextRequestId = 0;
    let contextLoading = false;
    let contextError = '';
    const pendingContextRequests = new Map();
    let contextChangeId = 0;
    let commandIndex = 0;
    let mentionIndex = 0;
    let mentionRequestId = 0;
    let mentionCandidates = [];
    let queueEditing = null;
    let queueRenderSignature = '';
    /**
     * Messages the user has queued but the runtime has not listed yet.
     *
     * The row we draw comes from the runtime's own queue projection, and reaching
     * it costs a round trip: the composer's own await chain, the prompt POST, the
     * durable inbox splice, the projection broadcast. DSH covers exactly this
     * window with a local row that says it is still sending, so a queued message
     * is never invisible while the agent is busy with a tool call.
     */
    let pendingQueueSends = new Map();
    let policyMenuOpen = false;
    let modelMenuOpen = false;
    /** The filtered models the menu is showing, in the order it shows them. */
    let modelChoices = [];
    /** Which of {@link modelChoices} the keyboard is on. */
    let modelIndex = 0;
    let usageOpen = false;
    let jobsOpen = false;
    let jobScope = 'project';
    let searchTimer;
    let accountOpen = false;
    let sessionMenuOpen = false;
    let sessionAction;
    let sessionNoticeTimer;
    let homeOpen = false;
    let homeArchived = false;
    let pendingConversationCreation;
    let conversationCreationId = 0;
    const conversationRequestScope = Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-');
    let homeRuntimeKey;
    let lastHomeOpen = false;
    let homeReading;
    const expandedChanges = new Set();
    /** Two-press stop state: armed -> pending -> (failed). One job at a time. */
    let jobKillPhase;
    let jobKillTimer;
    let jobsTimer;
    /** Rows the user cleared locally; no protocol message, just hidden finished rows. */
    const clearedJobIds = new Set();
    /** undefined follows DSH's default (Finished starts open when nothing runs). */
    let settledJobsOpen;
    /** Key of the one row whose inline output panel is expanded. */
    let expandedJobKey;
    /** Inline output received per observed job, keyed the same way. */
    const jobOutputViews = new Map();
    /** Status patches from the output stream so a row reacts before the roster does. */
    const jobStatusOverrides = new Map();
    /** The roster array the overrides were received against, so a new snapshot wins. */
    let renderedJobsSource;
    let taskTimer;
    let subagentLinkTimer;
    const subagentLinkViews = new Map();
    function syncSubagentToolLinks() {
      let running = false;
      for (const [id, entry] of subagentLinkViews) {
        if (!entry.view.root.isConnected || !state || entry.sessionId !== state.sessionId) { entry.view.dispose(); subagentLinkViews.delete(id); continue; }
        entry.view.update(array(state.sessions)); running = running || entry.view.running();
      }
      if (running && !subagentLinkTimer) subagentLinkTimer = setInterval(syncSubagentToolLinks, 1000);
      if (!running && subagentLinkTimer) { clearInterval(subagentLinkTimer); subagentLinkTimer = undefined; }
    }
    window.addEventListener('pagehide', () => {
      if (subagentLinkTimer) clearInterval(subagentLinkTimer);
      if (taskTimer) clearInterval(taskTimer);
      for (const entry of subagentLinkViews.values()) entry.view.dispose(); subagentLinkViews.clear();
    });
    const collapsedTaskPanels = new Set();
    let historyAnchor;
    let renderFrame;
    let pendingRenderState;
    /** When the newest state message arrived; the watchdog compares the clock to it. */
    let lastStateAt = Date.now();
    let resyncSentAt = 0;
    /** One-shot chain that watches transitional phases; armed only while they last. */
    let resyncWatchTimer;
    /** One-shot boot watchdog: the first state may itself be the delivery that stalls. */
    let startupWatchTimer;
    /** Last render error report, so a broken frame cannot flood the Host output. */
    let lastRenderErrorAt = 0;
    /**
     * A conversation switch the user asked for, before the Host's state arrives.
     *
     * Only local presentation: the view keeps the old transcript and shows the
     * intent in the header until the target state lands or the deadline passes.
     */
    let pendingSwitch;
    let pendingSwitchTimer;
    const RESYNC_STALE_MS = 5_000;
    const RESYNC_MIN_INTERVAL_MS = 8_000;
    const RESYNC_WATCH_STEP_MS = 1_000;
    const STARTUP_RESYNC_MS = 8_000;
    const RENDER_ERROR_REPORT_MS = 10_000;
    const SWITCH_FEEDBACK_MS = 10_000;
    let renderedSessionId;
    let renderedStatusKey = '';
    let renderedHistoryKey = '';
    let renderedTail = {};
    let renderedChrome = {};
    /**
     * The directory rows are only visible while the directory view is open.
     * While it is closed they are not rebuilt; the flag makes the next open
     * render them once against the newest state.
     */
    let homeListDirty = true;
    /** Inputs the last conversation render consumed, compared by reference. */
    let renderedConversationInputs;
    /**
     * Per-list inputs of the last directory render. Sessions are immutable state
     * values, so comparing the item references is enough to know that rebuilding
     * the rows would produce identical DOM.
     */
    const directoryRenderInputs = new WeakMap();
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
    let toolOutputRequestId = 0;
    const toolOutputChunkSize = 20000;

    const conversationScroller = dshConversationScroll.createConversationScroller(elements.scroll, elements.conversation, document.getElementById('jumpLatest'));
    window.addEventListener('pagehide', () => {
      conversationScroller.dispose();
      if (thinkingTicker !== undefined) { clearInterval(thinkingTicker); thinkingTicker = undefined; }
      if (liveStatusTicker !== undefined) { clearInterval(liveStatusTicker); liveStatusTicker = undefined; }
      if (resyncWatchTimer !== undefined) { clearTimeout(resyncWatchTimer); resyncWatchTimer = undefined; }
      if (startupWatchTimer !== undefined) { clearTimeout(startupWatchTimer); startupWatchTimer = undefined; }
      if (pendingSwitchTimer !== undefined) { clearTimeout(pendingSwitchTimer); pendingSwitchTimer = undefined; }
      pendingSwitch = undefined;
    }, { once: true });
    syncResyncWatch();

    function node(tag, className, text) {
      const value = document.createElement(tag);
      if (className) value.className = className;
      if (text !== undefined) value.textContent = text;
      return value;
    }

    function relativeSessionTime(value) {
      if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
      const minutes = Math.floor(Math.max(0, Date.now() - Number(value)) / 60000);
      if (minutes < 1) return 'Just now';
      if (minutes < 60) return minutes + 'm';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + 'h';
      const days = Math.floor(hours / 24);
      return days === 1 ? '1d' : days + 'd';
    }
    function mainConversation(session) { return !session.parentId && !session.subagent; }
    function conversationRoot(session, byId) {
      const visited = new Set();
      while (session && session.parentId && !visited.has(session.id)) {
        visited.add(session.id);
        const parent = byId.get(session.parentId);
        if (!parent) return undefined;
        session = parent;
      }
      return session && mainConversation(session) ? session : undefined;
    }
    function conversationActivity(current) {
      const sessions = array(current.sessions), byId = new Map(sessions.map(item => [item.id, item])), activity = new Map();
      for (const session of sessions) {
        const root = conversationRoot(session, byId);
        if (!root) continue;
        const value = activity.get(root.id) || { running: false, unread: false, approvals: 0, questions: 0 };
        value.running ||= session.running === true;
        value.unread ||= session.unread === true;
        value.approvals += Number(session.attention && session.attention.approvals) || 0;
        value.questions += Number(session.attention && session.attention.questions) || 0;
        activity.set(root.id, value);
      }
      return activity;
    }
    function sessionTimeGroup(value) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const date = new Date(Number(value)); date.setHours(0, 0, 0, 0);
      const days = Math.round((today.getTime() - date.getTime()) / 86400000);
      return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'Previous 7 days' : 'Older';
    }
    function closeSessionActions(focus) {
      const previous = sessionAction; sessionAction = undefined;
      elements.sessionActions.classList.add('hidden');
      document.querySelectorAll('.session-more[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      if (focus && previous && previous.anchor.isConnected) previous.anchor.focus();
    }
    /** Transient confirmation for a local-only action (copying an id). */
    function showSessionNotice(text) {
      if (!elements.sessionNotice) return;
      elements.sessionNotice.textContent = text;
      elements.sessionNotice.classList.remove('hidden');
      if (sessionNoticeTimer !== undefined) clearTimeout(sessionNoticeTimer);
      sessionNoticeTimer = setTimeout(() => {
        elements.sessionNotice.classList.add('hidden');
        sessionNoticeTimer = undefined;
      }, 1600);
    }
    function positionSessionActions() {
      if (!sessionAction) return;
      const app = document.getElementById('app').getBoundingClientRect(), anchor = sessionAction.anchor.getBoundingClientRect();
      const menu = elements.sessionActions.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.right - app.left - menu.width, app.width - menu.width - 8));
      const below = anchor.bottom - app.top + 4;
      const top = Math.max(8, below + menu.height <= app.height - 8 ? below : anchor.top - app.top - menu.height - 4);
      elements.sessionActions.style.left = left + 'px'; elements.sessionActions.style.top = top + 'px';
    }
    function openSessionActions(session, anchor, archived, focus = true) {
      closeSessionActions(false);
      sessionAction = { kind: 'conversation', id: session.id, anchor, archived, listId: anchor.closest('[role="list"]').id };
      anchor.setAttribute('aria-expanded', 'true');
      elements.sessionActions.replaceChildren();
      const append = (label, type, options) => {
        const button = node('button', 'session-action', label); button.type = 'button'; button.setAttribute('role', 'menuitem');
        button.disabled = !state || state.phase !== 'ready' || Boolean(options && options.disabled);
        if (options && options.title) button.title = options.title;
        button.addEventListener('click', () => {
          if (button.disabled) return;
          closeSessionActions(false); closeSessionMenu(false);
          vscode.postMessage({ type, sessionId: session.id });
          if (type === 'copy-session-id') showSessionNotice('Session ID copied');
        }); elements.sessionActions.append(button);
      };
      // DSH's own order: Pin/Unpin, Rename, Fork, Archive/Restore, Copy Session ID.
      if (!archived && state && state.pinningAvailable === true) {
        const pinned = Array.isArray(state.pinnedSessionIds) && state.pinnedSessionIds.includes(session.id);
        append(pinned ? 'Unpin' : 'Pin', pinned ? 'unpin-session' : 'pin-session');
      }
      append('Rename', 'rename-session');
      // The fork RPC is addressed to the open conversation; for any other row
      // the click would be answered by nothing, so say what to do instead.
      const forkHere = state !== undefined && session.id === state.sessionId && !archived;
      append('Fork', 'fork-conversation', forkHere ? undefined : {
        disabled: true, title: 'Open this conversation to fork it',
      });
      if (archived) append('Restore', 'unarchive-session');
      else {
        // The Host refuses to archive a conversation with running work; say so
        // on the item rather than surfacing the RPC error after the click.
        const running = Boolean(state && (state.running === true || session.running === true));
        append('Archive', 'archive-session', running
          ? { disabled: true, title: 'Stop the running task before archiving' }
          : undefined);
      }
      append('Copy Session ID', 'copy-session-id');
      elements.sessionActions.setAttribute('aria-label', 'Actions for ' + string(session.title));
      elements.sessionActions.classList.remove('hidden'); positionSessionActions();
      if (focus) elements.sessionActions.querySelector('button:not(:disabled)')?.focus();
    }
    function closeSessionMenu(focusTrigger) {
      sessionMenuOpen = false; closeSessionActions(false);
      if (searchTimer !== undefined) { clearTimeout(searchTimer); searchTimer = undefined; }
      elements.sessionSearch.value = '';
      elements.sessionMenu.classList.add('hidden'); elements.sessionTrigger.setAttribute('aria-expanded', 'false');
      if (focusTrigger) elements.sessionTrigger.focus();
      if (homeOpen && elements.homeSessionSearch.value.trim() && state && string(state.historySearch && state.historySearch.query).trim() !== elements.homeSessionSearch.value.trim()) requestSessionSearch(elements.homeSessionSearch);
    }
    function openDirectory() {
      if (pendingConversationCreation) return;
      if (state && state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value);
      closeSessionMenu(false); closeContextMenu(false); closeModelMenu(false);
      policyMenuOpen = false; elements.policyMenu.classList.add('hidden');
      homeOpen = true;
      if (state) { renderNavigation(state); renderSessionCenter(state); }
      elements.homeSessionSearch.focus(); updateSend(); setDropActive(false);
    }
    function sessionRow(session, current, activity, archived, snippet, selectedRootId) {
      const active = session.id === selectedRootId && !archived;
      const row = node('div', 'session-row' + (active ? ' active' : '') + (archived ? ' archived' : ''));
      row.dataset.sessionId = session.id; row.setAttribute('role', 'listitem');
      const main = node('button', 'session-main' + (snippet === undefined ? '' : ' search-hit')); main.type = 'button';
      if (active) main.setAttribute('aria-current', 'page');
      const status = activity.get(session.id) || {};
      const waiting = status.approvals > 0 ? 'Awaiting approval' : status.questions > 0 ? 'Awaiting your answer' : '';
      const detail = waiting || (status.running ? 'Running' : status.unread ? 'New activity' : relativeSessionTime(session.updatedAt));
      const indicator = node('span', 'session-indicator' + (waiting ? ' attention' : status.running ? ' running' : status.unread ? ' unread' : ''));
      indicator.title = waiting || (status.running ? 'Running' : status.unread ? 'New activity' : ''); indicator.setAttribute('aria-hidden', 'true');
      const title = string(session.title, 'New conversation');
      main.title = archived ? 'Restore “' + title + '”' : title + (detail ? ' · ' + detail : '');
      main.setAttribute('aria-label', archived ? 'Restore ' + title : title + (detail ? ' — ' + detail : ''));
      main.append(indicator, node('span', 'session-name', title), node('span', 'session-meta', archived && snippet !== undefined ? 'Archived' : detail));
      if (snippet !== undefined) main.append(node('span', 'session-snippet', string(snippet)));
      main.addEventListener('click', () => {
        // Switching is how a user leaves a conversation that will not open, so
        // the pending new-conversation request must never lock the list. A
        // switch abandons it locally; the Host's newSession(expected) guard
        // rejects the late completion without moving this window back.
        if (pendingConversationCreation) { pendingConversationCreation = undefined; creationError(''); }
        if (archived) { closeSessionActions(false); vscode.postMessage({ type: 'unarchive-session', sessionId: session.id }); return; }
        if (state && state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value);
        closeSessionMenu(false); homeOpen = false;
        // The header confirms the intent immediately; the target's transcript
        // still comes from the Host, never from a local guess.
        beginPendingSwitch(session, state);
        if (state) renderNavigation(state);
        if (!state || session.id !== state.sessionId) vscode.postMessage({ type: 'select-session', sessionId: session.id });
        // A conversation that failed to open is retried by selecting it again;
        // in ready the same row only restores the view.
        else if (state.phase === 'error') vscode.postMessage({ type: 'select-session', sessionId: session.id });
        else { if (state) render(state, 'same-conversation row'); elements.prompt.focus(); }
      });
      row.append(main);
      if (!session.blank) {
        const more = node('button', 'session-more', '…'); more.type = 'button'; more.title = 'Conversation actions';
        more.setAttribute('aria-label', 'Actions for ' + title); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', event => {
          event.stopPropagation();
          if (sessionAction && sessionAction.id === session.id && sessionAction.anchor === more) closeSessionActions(true);
          else openSessionActions(session, more, archived);
        });
        row.addEventListener('contextmenu', event => { event.preventDefault(); if (!more.disabled) openSessionActions(session, more, archived); });
        row.append(more);
      }
      return row;
    }
    function renderSessionDirectory(list, input, current, archivedOnly) {
      const selected = conversationRoot(array(current.sessions).find(item => item.id === current.sessionId), new Map(array(current.sessions).map(item => [item.id, item])));
      const selectedRootId = selected && selected.id;
      const previousScroll = list.scrollTop;
      const focused = document.activeElement, focusedRow = list.contains(focused) && focused.closest('.session-row');
      const focusId = focusedRow && focusedRow.dataset.sessionId, focusMore = focused && focused.classList.contains('session-more');
      const query = input.value.trim().toLocaleLowerCase(), activity = conversationActivity(current);
      const recent = array(current.sessions).filter(mainConversation), archived = array(current.archivedSessions).filter(mainConversation);
      const source = archivedOnly ? archived : recent;
      // A rebuild is only needed when something a row draws changed. Session
      // values are immutable state objects, so their references (including
      // children, whose activity is folded into the root row) decide that;
      // everything else the rows read is compared here too. This keeps a status
      // patch from recreating every row, and preserves focus and DOM identity.
      const inputs = [archivedOnly, query, selectedRootId, current.pinnedSessionIds, current.historySearch,
        ...array(current.sessions), ...array(current.archivedSessions)];
      const previousInputs = directoryRenderInputs.get(list);
      if (previousInputs !== undefined && previousInputs.length === inputs.length
        && inputs.every((value, index) => value === previousInputs[index])) return;
      directoryRenderInputs.set(list, inputs);
      // The Host already orders sessions with pinned conversations first; this
      // view must not re-sort that away by update time. The pin order is the
      // Host's own list, so every consumer (quick switcher and home) agrees.
      const pinnedOrder = new Map(array(current.pinnedSessionIds).flatMap((id, index) => typeof id === 'string' ? [[id, index]] : []));
      const pinIndexOf = session => archivedOnly ? undefined : pinnedOrder.get(session.id);
      const byPinnedThenUpdated = (left, right) => {
        const leftPin = pinIndexOf(left), rightPin = pinIndexOf(right);
        if (leftPin !== undefined || rightPin !== undefined) {
          if (leftPin === undefined) return 1;
          if (rightPin === undefined) return -1;
          return leftPin - rightPin;
        }
        return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
      };
      const matching = source.filter(session => !query || string(session.title).toLocaleLowerCase().includes(query))
        .sort(byPinnedThenUpdated)
        .slice(0, list === elements.sessionList && !query ? 12 : source.length);
      list.replaceChildren();
      let group;
      for (const session of matching) {
        // Without a search, pinned conversations get their own leading group;
        // a search keeps DSH's single "Title matches" heading.
        const next = query ? 'Title matches'
          : pinIndexOf(session) === undefined ? sessionTimeGroup(session.updatedAt) : 'Pinned';
        if (next !== group) { list.append(node('div', 'session-group', next)); group = next; }
        list.append(sessionRow(session, current, activity, archivedOnly, undefined, selectedRootId));
      }
      if (!query) {
        if (!matching.length) list.append(node('div', 'session-empty', archivedOnly ? 'No archived conversations' : 'No conversations yet'));
      } else {
        const search = record(current.historySearch) || {}, rendered = new Set(matching.map(session => session.id));
        const catalog = new Map((archivedOnly ? archived : [...recent, ...archived]).map(session => [session.id, session]));
        const archivedIds = new Set(archived.map(session => session.id));
        const ready = string(search.query).trim().toLocaleLowerCase() === query && !search.loading;
        const hits = ready ? array(search.items).filter(hit => catalog.has(hit.sessionId) && !rendered.has(hit.sessionId) && (rendered.add(hit.sessionId), true)) : [];
        if (hits.length) {
          // A search list is a second view of the same conversations, so it
          // follows the same pinned-first order rather than the runtime's hit
          // order.
          hits.sort((left, right) => byPinnedThenUpdated(catalog.get(left.sessionId) || {}, catalog.get(right.sessionId) || {}));
          list.append(node('div', 'session-group', 'Message matches'));
          for (const hit of hits) list.append(sessionRow(catalog.get(hit.sessionId), current, activity, archivedIds.has(hit.sessionId), hit.snippet, selectedRootId));
        }
        if (!ready) list.append(node('div', 'session-empty', 'Searching message history…'));
        else if (search.error) {
          list.append(node('div', 'session-empty', string(search.error)), featureButton('Configure task services', () => vscode.postMessage({ type: 'configure-task-services' })));
        } else if (!matching.length && !hits.length) list.append(node('div', 'session-empty', 'No matching conversations'));
        if (ready && search.hasMore) list.append(node('div', 'session-empty', 'DSH returns up to 20 matches across the runtime. Refine your query to find more in this project.'));
      }
      list.scrollTop = previousScroll;
      if (focusId) {
        const row = [...list.querySelectorAll('.session-row')].find(item => item.dataset.sessionId === focusId);
        row?.querySelector(focusMore ? '.session-more' : '.session-main')?.focus({ preventScroll: true });
      }
    }
    function renderSessionCenter(current) {
      const sessions = array(current.sessions), selected = sessions.find(session => session.id === current.sessionId);
      const byId = new Map(sessions.map(item => [item.id, item])), selectedRoot = conversationRoot(selected, byId), activity = conversationActivity(current);
      const waiting = [...activity].filter(([id, status]) => id !== (selectedRoot && selectedRoot.id) && (status.approvals > 0 || status.questions > 0)).length;
      elements.sessionAttentionCount.textContent = String(waiting); elements.sessionAttentionCount.classList.toggle('hidden', waiting === 0);
      elements.sessionAttentionCount.title = waiting + ' other conversation(s) need your response';
      elements.sessionTriggerTitle.textContent = homeOpen ? 'Conversations' : selected ? selected.title : 'New conversation';
      elements.sessionTrigger.title = selected ? selected.title : 'Project conversations';
      elements.sessionTrigger.setAttribute('aria-label', waiting ? 'Project conversations — ' + elements.sessionAttentionCount.title : 'Project conversations');
      elements.sessionTotal.textContent = String(sessions.filter(mainConversation).length);
      const previousAction = sessionAction;
      renderSessionDirectory(elements.sessionList, elements.sessionSearch, current, false);
      if (homeOpen) {
        // The full directory is only visible while it is open. Rendering its
        // rows in the background would rebuild a hidden list on every session
        // update; the dirty flag makes the first open after such an update
        // rebuild it once against the newest state.
        if (homeListDirty) directoryRenderInputs.delete(elements.homeSessionList);
        renderSessionDirectory(elements.homeSessionList, elements.homeSessionSearch, current, homeArchived);
        homeListDirty = false;
      } else homeListDirty = true;
      elements.homeListTitle.textContent = homeArchived ? 'Archived conversations' : 'Recent conversations';
      elements.homeArchiveToggle.textContent = homeArchived ? 'Back to recent' : 'Archived (' + array(current.archivedSessions).filter(mainConversation).length + ')';
      elements.homeArchiveToggle.setAttribute('aria-pressed', String(homeArchived));
      if (previousAction && previousAction.kind === 'conversation') {
        const list = document.getElementById(previousAction.listId);
        const row = [...list.querySelectorAll('.session-row')].find(item => item.dataset.sessionId === previousAction.id);
        const more = row && row.querySelector('.session-more');
        const session = [...sessions, ...array(current.archivedSessions)].find(item => item.id === previousAction.id);
        if (more && session) openSessionActions(session, more, previousAction.archived, elements.sessionActions.contains(document.activeElement));
        else closeSessionActions(false);
      } else if (previousAction && (previousAction.originSessionId !== current.sessionId || !previousAction.anchor.isConnected)) closeSessionActions(false);
    }
    function renderNavigation(current) {
      const runtimeKey = JSON.stringify([current.phase, current.setup, current.statusText, current.canReconnect]);
      if (runtimeKey !== homeRuntimeKey) {
        homeRuntimeKey = runtimeKey;
        elements.homeRuntime.replaceChildren();
        elements.homeRuntime.classList.toggle('hidden', current.phase === 'ready');
        if (current.phase !== 'ready') elements.homeRuntime.append(renderStatus(current));
      }
      const creating = Boolean(pendingConversationCreation);
      // Only an empty directory disables the switcher. A pending new conversation
      // must not: switching is the escape from a creation that does not return,
      // and the row click abandons the pending request locally.
      elements.sessionTrigger.disabled = ![...array(current.sessions), ...array(current.archivedSessions)].some(mainConversation);
      elements.newSession.disabled = creating || current.phase !== 'ready';
      elements.newSession.title = creating ? 'Opening new conversation…' : 'New conversation';
      elements.newSession.setAttribute('aria-label', elements.newSession.title);
      elements.newSession.setAttribute('aria-busy', String(creating));
      elements.conversationHome.disabled = creating;
      if (homeOpen && !lastHomeOpen) {
        homeReading = { sessionId: current.sessionId, top: elements.scroll.scrollTop, following: conversationScroller.following };
        conversationScroller.pause();
      }
      elements.conversationHomeView.classList.toggle('hidden', !homeOpen);
      elements.conversationPane.classList.toggle('hidden', homeOpen);
      elements.composerFooter.classList.toggle('hidden', homeOpen);
      elements.conversationHome.setAttribute('aria-pressed', String(homeOpen));
      elements.conversationHome.title = homeOpen ? 'Return to current conversation' : 'All conversations';
      elements.conversationHome.setAttribute('aria-label', elements.conversationHome.title);
      elements.sessionTriggerTitle.textContent = homeOpen ? 'Conversations' : string(array(current.sessions).find(item => item.id === current.sessionId)?.title, 'New conversation');
      if (pendingSwitch !== undefined) {
        // Local intent wins over the still-current conversation: the user's
        // click must be visible even when the Host's state never lands.
        const opening = 'Switching to “' + pendingSwitch.title + '”…';
        elements.sessionTriggerTitle.textContent = pendingSwitch.stalled ? 'Still switching to “' + pendingSwitch.title + '”…' : opening;
        elements.sessionTrigger.title = pendingSwitch.stalled
          ? 'The conversation did not change. Open Conversations to choose one and retry.'
          : 'Waiting for DSH to open the conversation';
        elements.sessionTrigger.setAttribute('aria-busy', String(!pendingSwitch.stalled));
        elements.sessionTrigger.setAttribute('aria-label', elements.sessionTrigger.title);
      } else {
        elements.sessionTrigger.removeAttribute('aria-busy');
      }
      if (!homeOpen && lastHomeOpen && homeReading && homeReading.sessionId === current.sessionId) {
        const reading = homeReading;
        requestAnimationFrame(() => {
          if (!homeOpen && state && state.sessionId === reading.sessionId) {
            elements.scroll.scrollTop = reading.top;
            if (reading.following) conversationScroller.resume();
            else conversationScroller.changed();
          }
        });
      }
      lastHomeOpen = homeOpen;
    }
    function creationError(message) {
      for (const element of [elements.homeError, elements.conversationCreationError]) {
        element.textContent = message || ''; element.classList.toggle('hidden', !message);
      }
    }
    function reconcileConversationCreation(current) {
      if (!pendingConversationCreation) return false;
      if (pendingConversationCreation.cwd !== current.cwd || current.phase === 'error') {
        pendingConversationCreation = undefined;
        creationError('The runtime or project changed. Reopen New conversation for the intended project.');
      } else if (pendingConversationCreation.sessionId === current.sessionId && current.phase === 'ready') {
        pendingConversationCreation = undefined; homeOpen = false; creationError('');
        return true;
      } else if (pendingConversationCreation.sessionId && current.phase === 'ready' && current.sessionId !== pendingConversationCreation.originSessionId) {
        pendingConversationCreation = undefined;
        creationError('Another conversation was selected. The new conversation was not opened here.');
      }
      return false;
    }
    function startNewConversation() {
      if (!state || state.phase !== 'ready' || pendingConversationCreation) return;
      if (state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value);
      closeSessionMenu(false); closeContextMenu(false); closeModelMenu(false);
      policyMenuOpen = false; elements.policyMenu.classList.add('hidden');
      pendingConversationCreation = { requestId: conversationRequestScope + '-' + (++conversationCreationId), cwd: state.cwd, originSessionId: state.sessionId };
      creationError(''); setDropActive(false);
      vscode.postMessage({ type: 'create-conversation', requestId: pendingConversationCreation.requestId, cwd: state.cwd, sessionId: state.sessionId });
      render(state);
    }
    function navigateSessionList(event, list, search) {
      if (event.isComposing) return;
      const buttons = [...list.querySelectorAll('.session-main:not(:disabled)')]; if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0) : index + (event.key === 'ArrowDown' ? 1 : -1);
        if (next < 0) search.focus(); else buttons[Math.min(next, buttons.length - 1)].focus();
      } else if ((event.key === 'ArrowRight' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && index >= 0) {
        const more = buttons[index].closest('.session-row').querySelector('.session-more');
        if (more) { event.preventDefault(); more.click(); }
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
    /**
     * Flatten a content block into text (S4).
     *
     * Tool output is model/plugin supplied and can nest arbitrarily or even
     * reference itself. The depth bound and the visited set turn either into a
     * placeholder instead of letting the recursion exhaust the stack.
     */
    const CONTENT_TEXT_MAX_DEPTH = 64;
    const CONTENT_TEXT_PLACEHOLDER = '[nested content omitted]';
    function contentText(content, depth, visited) {
      const level = depth || 0;
      const seen = visited || new Set();
      if (level >= CONTENT_TEXT_MAX_DEPTH) return CONTENT_TEXT_PLACEHOLDER;
      return array(content).map(part => {
        const item = record(part);
        if (!item) return '';
        if (seen.has(item)) return CONTENT_TEXT_PLACEHOLDER;
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        if (Array.isArray(item.content)) {
          const next = new Set(seen);
          next.add(item);
          return contentText(item.content, level + 1, next);
        }
        return '';
      }).filter(Boolean).join('\\n');
    }
    /** The domain a web link really points at, for the tooltip that names it. */
    function externalTargetOf(href) {
      try {
        const url = new URL(href);
        return url.host || href;
      } catch { return href; }
    }
    function link(href, label) {
      const anchor = node('a', '', label || href);
      anchor.href = href;
      // A model writes both the label and the destination: naming the real
      // target in the tooltip and accessible name shows where a friendly or
      // truncated label actually leads (S6).
      anchor.title = 'Open external link: ' + href;
      anchor.setAttribute('aria-label', 'External link to ' + externalTargetOf(href) + ': ' + href);
      anchor.addEventListener('click', event => { event.preventDefault(); vscode.postMessage({ type: 'open-link', href }); });
      return anchor;
    }

    /**
     * The longest candidate a file-reference scan examines (ReDoS bound, F2/S5).
     *
     * The regex only ever runs on a bounded run, so the scan stays linear; 2048
     * keeps legitimate deep project paths linkable without giving the pattern
     * an unbounded input.
     */
    const FILE_REFERENCE_LIMIT = 2048;
    /** Characters a file reference can be built from, plus separators and colons. */
    const fileReferenceRun = /[A-Za-z0-9_@.+~:\\/\\\\-]/;
    function fileReference(value) {
      // A path a reply writes is short. Refusing longer candidates before the
      // pattern sees them is what keeps a chain such as 'a/a/a/...!' from
      // backtracking quadratically in the Webview.
      if (typeof value !== 'string' || value.length > FILE_REFERENCE_LIMIT) return undefined;
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
      let index = 0;
      while (index < text.length) {
        if (!fileReferenceRun.test(text[index])) { index += 1; continue; }
        const runStart = index;
        while (index < text.length && fileReferenceRun.test(text[index])) index += 1;
        const run = text.slice(runStart, index);
        // The pattern is bounded to short runs: a run longer than any path a
        // reply writes is skipped rather than matched inside, so the scan stays
        // linear in the message length (F2).
        if (run.length > FILE_REFERENCE_LIMIT) continue;
        if (runStart > last) parent.append(document.createTextNode(text.slice(last, runStart)));
        pattern.lastIndex = 0;
        let cursor = runStart;
        let match;
        while ((match = pattern.exec(run)) !== null) {
          const reference = fileReference(match[0]);
          if (reference === undefined) continue;
          const at = runStart + match.index;
          if (at > cursor) parent.append(document.createTextNode(text.slice(cursor, at)));
          parent.append(fileButton(reference.path, reference.line, match[0]));
          cursor = at + match[0].length;
        }
        if (cursor < index) parent.append(document.createTextNode(text.slice(cursor, index)));
        last = index;
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
        fileLink(path, line) { return fileButton(path, line); },
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
    function renderToolBody(message, callView, resultView, context) {
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
            review.type = 'button'; review.addEventListener('click', () => postChangeAction('review-file', { path: filePath }, context)); actions.append(review);
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
    /**
     * DSH's Auto review denial attached to a tool message.
     *
     * The durable denial replaces the tool's own error text: the reviewer's raw
     * reason is presentation data only, normalized to one line and never used as
     * markup. A missing or blank reason falls back to DSH's fixed sentence.
     */
    const AUTO_REVIEW_REJECTED = 'Rejected by Auto review';
    const AUTO_REVIEW_REASON_FALLBACK = 'Auto review did not authorize this action';
    function autoReviewDenialOf(message) {
      const value = record(message && message.autoReviewDenied);
      return value === undefined ? undefined : { reason: typeof value.reason === 'string' ? value.reason : null };
    }
    function autoReviewReasonText(reason) {
      if (typeof reason !== 'string') return AUTO_REVIEW_REASON_FALLBACK;
      const normalized = reason.trim().replace(/[\\r\\n\\u2028\\u2029]+/gu, ' ');
      return normalized === '' ? AUTO_REVIEW_REASON_FALLBACK : normalized;
    }
    function renderAutoReviewBody(reason) {
      const body = node('div', 'tool-body auto-review-body');
      body.append(node('div', 'auto-review-note', 'Tool was not executed. Reason: ' + autoReviewReasonText(reason)));
      return body;
    }
    function renderTool(message) {
      const context = { sessionId: state && state.sessionId, cwd: state && state.cwd };
      const callView = record(message.callView);
      const resultView = record(message.resultView);
      // A reviewer denial is its own outcome: the tool never ran, so its own
      // error text and output are not what the reader should see.
      const denial = autoReviewDenialOf(message);
      // Team tools can only name their target (memberName); the Team projection
      // is what maps a name to the session id a link needs. A name that does not
      // resolve is dropped, so the card stays a generic tool card instead of a
      // dead link to a session that does not exist.
      const teamMemberIds = new Map();
      for (const member of array(state && state.team && state.team.members)) {
        const name = string(member && member.name), id = string(member && member.id);
        if (name !== '' && id !== '') teamMemberIds.set(name, id);
      }
      const references = [];
      for (const view of [resultView, callView]) for (const entry of array(view && view.subagentLinks)) {
        if (!entry || typeof entry.id !== 'string') continue;
        const memberName = string(entry.memberName);
        const id = memberName === '' ? entry.id : teamMemberIds.get(memberName);
        if (typeof id !== 'string' || id === '' || references.some(ref => ref.id === id)) continue;
        references.push({ id, ...(typeof entry.label === 'string' ? { label: entry.label } : {}) });
      }
      const subagent = references.length > 0 || string(callView && callView.subagentLabel) || string(resultView && resultView.subagentLabel);
      const item = document.createElement('details');
      item.className = 'tool' + (message.failed ? ' failed' : '');
      item.open = subagent ? (toolOpenIntent.has(message.id) ? toolOpenIntent.get(message.id) : message.failed === true) : toolStartsOpen(message);
      const summary = document.createElement('summary');
      const toolIcon = node('span', 'tool-icon', message.streaming ? '●' : (message.failed ? '!' : '✓'));
      if (subagent && !message.failed) toolIcon.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>';
      summary.append(toolIcon);
      const title = subagent ? node('span', 'tool-title', 'Details') : message.streaming === true
        ? shimmerNode('tool-title', toolTitle(message, callView, resultView))
        : node('span', 'tool-title', toolTitle(message, callView, resultView));
      summary.append(title);
      summary.append(node('span', 'tool-detail',
        denial !== undefined ? AUTO_REVIEW_REJECTED : subagent ? (message.failed ? 'Failed' : '') : message.detail || ''));
      summary.addEventListener('click', () => { if (!item.open) conversationScroller.pause(); });
      item.append(summary);
      let contentInitialized = false;
      const initializeContent = () => {
        if (contentInitialized) return;
        contentInitialized = true;
        if (denial !== undefined) item.append(renderAutoReviewBody(denial.reason));
        else if (message.deferredBody === true) {
          const body = node('div', 'tool-body'); item.append(body); attachDeferredOutput(message, body, page => renderToolBody(page, record(page.callView), record(page.resultView), context));
        } else item.append(renderToolBody(message, callView, resultView, context));
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
      if (!subagent) return item;
      const card = node('div', 'subagent-tool-card');
      card.append(node('div', 'subagent-tool-heading', references.length > 1 ? 'Subagents · ' + references.length : 'Subagent'));
      const previous = subagentLinkViews.get(message.id); if (previous) { previous.view.dispose(); subagentLinkViews.delete(message.id); }
      if (references.length && window.dshMarkdown && typeof window.dshMarkdown.createSubagentLinks === 'function') {
        const view = window.dshMarkdown.createSubagentLinks(references, context.sessionId, value => vscode.postMessage(value));
        view.update(array(state && state.sessions)); card.append(view.root); subagentLinkViews.set(message.id, { view, sessionId: context.sessionId });
      } else if (!references.length) card.append(node('div', 'subagent-tool-heading', string(callView && callView.subagentLabel) || (message.streaming ? 'Starting subagent…' : 'No child conversation was created.')));
      card.append(item); return card;
    }
    function renderCommand(message) {
      const context = { sessionId: state && state.sessionId, cwd: state && state.cwd };
      const item = node('div', 'command-card' + (message.failed ? ' failed' : ''));
      const head = node('div', 'command-head');
      head.append(node('span', 'tool-icon', message.streaming ? '●' : (message.failed ? '!' : '✓')));
      head.append(node('span', 'command-name', message.text));
      head.append(node('span', 'tool-detail', message.detail || ''));
      item.append(head);
      if (message.deferredBody === true) {
        const result = node('div', 'command-result'); item.append(result); attachDeferredOutput(message, result, page => renderToolBody(page, record(page.callView), record(page.resultView), context), false, 'Show command output');
      } else if (message.rawResult) { const result = node('div', 'command-result'); appendPre(result, message.rawResult); item.append(result); }
      return item;
    }
    function postChangeAction(type, details, context) {
      if (!state || !context || !context.sessionId || state.sessionId !== context.sessionId || state.cwd !== context.cwd) return;
      vscode.postMessage({ type, ...details, sessionId: context.sessionId, cwd: context.cwd });
    }
    function openChangeActions(groups, anchor, file, turn, context) {
      closeSessionActions(false);
      if (!state || state.sessionId !== context.sessionId || state.cwd !== context.cwd) return;
      sessionAction = { kind: 'changes', originSessionId: context.sessionId, anchor };
      anchor.setAttribute('aria-expanded', 'true'); elements.sessionActions.replaceChildren();
      const append = (label, type, disabled, danger) => {
        const button = node('button', 'session-action' + (danger ? ' danger' : ''), label); button.type = 'button'; button.setAttribute('role', 'menuitem');
        button.disabled = disabled || !state || state.phase !== 'ready';
        if (disabled) button.title = 'Full snapshots are unavailable for this change';
        button.addEventListener('click', () => {
          closeSessionActions(false);
          postChangeAction(type, file ? { path: file.path, ...(type === 'open-file' ? {} : { turn }) } : {}, context);
        }); elements.sessionActions.append(button);
      };
      if (file) { append('Open file', 'open-file', false, false); append('Keep change', 'keep-file', false, false); append('Revert change', 'revert-file', file.canRevert !== true, true); }
      else { append('Keep all', 'keep-all', false, false); append('Revert all', 'revert-all', !groups.flatMap(group => group.files || []).every(item => item.canRevert === true), true); }
      elements.sessionActions.setAttribute('aria-label', file ? 'Actions for ' + file.path : 'Actions for all changes');
      elements.sessionActions.classList.remove('hidden'); positionSessionActions();
      elements.sessionActions.querySelector('button:not(:disabled)')?.focus();
    }
    function renderChangedFiles(groups) {
      const origin = state && state.sessionId, context = { sessionId: origin, cwd: state && state.cwd }, files = groups.flatMap(group => group.files || []);
      const count = new Set(files.map(file => file.path)).size;
      const stats = (additions, deletions) => {
        const result = node('span', 'changed-file-stats'); result.append(node('span', 'change-additions', '+' + additions), node('span', 'change-deletions', '−' + deletions)); return result;
      };
      const box = node('section', 'changed-files'); box.setAttribute('aria-label', 'File changes');
      const head = node('div', 'changed-files-head'), toggle = node('button', 'changed-files-toggle'); toggle.type = 'button';
      const chevron = node('span', 'changes-chevron'); chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
      toggle.append(chevron, node('span', 'changed-files-title', count + (count === 1 ? ' file changed' : ' files changed')));
      const totals = stats(files.reduce((sum, file) => sum + (file.additions || 0), 0), files.reduce((sum, file) => sum + (file.deletions || 0), 0));
      head.append(toggle, totals);
      const review = node('button', 'changed-action', 'Review'); review.type = 'button'; review.title = 'Review all changes'; review.addEventListener('click', () => postChangeAction('review-all', {}, context)); head.append(review);
      const more = node('button', 'session-more changed-more', '…'); more.type = 'button'; more.setAttribute('aria-label', 'Actions for all changes'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', event => { event.stopPropagation(); if (sessionAction && sessionAction.anchor === more) closeSessionActions(true); else openChangeActions(groups, more, undefined, undefined, context); }); head.append(more); box.append(head);
      const body = node('div', 'changed-files-body');
      const sync = () => { const expanded = expandedChanges.has(origin); toggle.setAttribute('aria-expanded', String(expanded)); toggle.title = expanded ? 'Hide changed files' : 'Show changed files'; body.classList.toggle('hidden', !expanded); chevron.classList.toggle('expanded', expanded); };
      toggle.addEventListener('click', () => { if (expandedChanges.has(origin)) expandedChanges.delete(origin); else expandedChanges.add(origin); sync(); conversationScroller.changed(); });
      for (const group of groups) {
        const section = node('div', 'changed-turn');
        if (groups.length > 1) section.append(node('div', 'changed-turn-title', group.turn > 0 ? 'Turn ' + group.turn : 'Earlier changes'));
        for (const file of group.files || []) {
          const row = node('div', 'changed-file'), open = node('button', 'changed-file-link'); open.type = 'button';
          const normalized = string(file.path).split(String.fromCharCode(92)).join('/'), index = normalized.lastIndexOf('/');
          open.append(node('span', 'changed-file-name', normalized.slice(index + 1)), node('span', 'changed-file-dir', index > 0 ? normalized.slice(0, index) : ''));
          open.title = 'Review ' + file.path + (groups.length > 1 ? ' · Turn ' + group.turn : ''); open.setAttribute('aria-label', open.title);
          open.addEventListener('click', () => { postChangeAction('review-file', { path: file.path, turn: group.turn }, context); });
          const actions = node('button', 'session-more changed-more', '…'); actions.type = 'button'; actions.setAttribute('aria-label', 'Actions for ' + file.path + ' in turn ' + group.turn); actions.setAttribute('aria-haspopup', 'menu'); actions.setAttribute('aria-expanded', 'false');
          actions.addEventListener('click', event => { event.stopPropagation(); if (sessionAction && sessionAction.anchor === actions) closeSessionActions(true); else openChangeActions(groups, actions, file, group.turn, context); });
          row.addEventListener('contextmenu', event => { event.preventDefault(); openChangeActions(groups, actions, file, group.turn, context); });
          row.append(open, stats(file.additions || 0, file.deletions || 0), actions); section.append(row);
        }
        body.append(section);
      }
      sync(); box.append(body); return box;
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

    /** DSH's label is the state alone; the wait rides its own span beside it. */
    function thinkingLabel(message) {
      return message.streaming === true ? 'Thinking' : 'Thought';
    }
    function thinkingDuration(message) {
      const elapsed = thinkingElapsed(message);
      return elapsed === undefined || elapsed < 1000 ? '' : formatLiveDuration(elapsed);
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
      // The acknowledgement window elapsed while the turn kept running: the
      // request is still in effect, so say so instead of reverting to a plain
      // "Deep diving" clock that hides it.
      if (current.cancelRequested === true) return 'Stop requested; waiting for the current step…';
      const startedAt = Number(current.turnStartedAt) || 0;
      const activityAt = Number(current.turnActivityAt) || 0;
      const label = startedAt === 0 ? 'Deep diving…' : 'Deep diving for ' + formatLiveDuration(Date.now() - startedAt);
      if (activityAt === 0) return label;
      const quiet = Date.now() - activityAt;
      return quiet < QUIET_AFTER_MS ? label : label + ' · no new output for ' + formatLiveDuration(quiet);
    }
    function renderLiveStatus(current) {
      const requested = current.cancelRequested === true && current.stopping !== true;
      const box = node('div', 'live-status' + (current.stopping === true || requested ? ' stopping' : ''));
      // The announcement is a separate, constant string: the visible clock
      // rewrites itself every second, and a live region would read all of it.
      const announced = node('span', 'sr-only', current.stopping === true ? 'Stopping' : requested ? 'Stop requested' : 'Deep diving');
      announced.setAttribute('role', 'status');
      const mark = node('span', 'live-status-mark');
      mark.append(icon([{ tag: 'path', attrs: { d: TAIL_PATH } }], false), node('span', 'live-status-swim'));
      box.append(mark, shimmerNode('live-status-text', liveStatusText(current)), announced);
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
    /**
     * Recovery for a view that stopped receiving state.
     *
     * A Host post that never settles leaves the view frozen with no error
     * anywhere. Two triggers ask for a full snapshot: a live turn (through the
     * interval ticker that already runs) and a transitional phase (loading or a
     * stopping request), which owns a one-shot chain only while it lasts. An
     * idle view owns no timer.
     */
    function postResync(stale) {
      resyncSentAt = Date.now();
      const current = state;
      vscode.postMessage({
        type: 'resync',
        staleMs: Math.max(0, Math.round(Number(stale) || 0)),
        ...(current === undefined ? {} : { staleSessionId: current.sessionId, phase: current.phase }),
      });
    }
    function maybeRequestResync() {
      const stale = Date.now() - lastStateAt;
      if (stale < RESYNC_STALE_MS || Date.now() - resyncSentAt < RESYNC_MIN_INTERVAL_MS) return;
      postResync(stale);
    }
    function transitionalPhase() {
      return state !== undefined
        && (state.phase === 'loading' || state.stopping === true || state.cancelRequested === true);
    }
    function syncResyncWatch() {
      // The first snapshot may itself be the stalled delivery, and then no live
      // ticker exists to notice it: one bounded check covers that window.
      if (startupWatchTimer !== undefined) { clearTimeout(startupWatchTimer); startupWatchTimer = undefined; }
      if (state === undefined) {
        startupWatchTimer = setTimeout(() => {
          startupWatchTimer = undefined;
          if (state === undefined) postResync(Date.now() - lastStateAt);
          syncResyncWatch();
        }, STARTUP_RESYNC_MS);
        return;
      }
      if (resyncWatchTimer !== undefined) { clearTimeout(resyncWatchTimer); resyncWatchTimer = undefined; }
      // A live turn already carries the interval ticker; a transitional phase is
      // watched only until it settles, so no timer outlives it.
      const liveTurn = state.phase === 'ready' && state.running === true;
      if (liveTurn || !transitionalPhase()) return;
      resyncWatchTimer = setTimeout(() => {
        resyncWatchTimer = undefined;
        maybeRequestResync();
        syncResyncWatch();
      }, RESYNC_WATCH_STEP_MS);
    }
    function clearPendingSwitch() {
      if (pendingSwitchTimer !== undefined) { clearTimeout(pendingSwitchTimer); pendingSwitchTimer = undefined; }
      pendingSwitch = undefined;
    }
    /**
     * Show the switch the user just asked for, before the Host's state lands.
     *
     * The transcript and the conversation identity stay untouched: this is only
     * the header's feedback, replaced by the real state when it arrives or by a
     * retry hint after the deadline.
     */
    function beginPendingSwitch(session, current) {
      if (current === undefined || session === undefined || typeof session.id !== 'string' || session.id === current.sessionId) return;
      clearPendingSwitch();
      pendingSwitch = { sessionId: session.id, title: string(session.title, 'New conversation'), fromSessionId: current.sessionId, stalled: false };
      pendingSwitchTimer = setTimeout(() => {
        pendingSwitchTimer = undefined;
        if (pendingSwitch === undefined || pendingSwitch.stalled) return;
        pendingSwitch.stalled = true;
        if (state !== undefined) renderNavigation(state);
      }, SWITCH_FEEDBACK_MS);
    }
    function settlePendingSwitch() {
      if (pendingSwitch === undefined || state === undefined) return;
      // Any state that names another conversation, or a failed open, ends the
      // local intent: the Host has answered it one way or the other.
      if (state.sessionId !== pendingSwitch.fromSessionId || state.phase === 'error') clearPendingSwitch();
    }
    /**
     * A render that throws must not silently freeze the view.
     *
     * The error is reported at most once per window, and a full snapshot is
     * requested so the next frame starts from a known state rather than from a
     * patch computed against a base the user never saw.
     */
    function reportRenderFailure(error, context) {
      const now = Date.now();
      if (now - lastRenderErrorAt >= RENDER_ERROR_REPORT_MS) {
        lastRenderErrorAt = now;
        const detail = error instanceof Error ? error.message : String(error);
        try { vscode.postMessage({ type: 'webview-error', message: 'render failed' + (context ? ' (' + context + ')' : '') + ': ' + detail }); } catch {}
      }
      if (now - resyncSentAt >= RESYNC_MIN_INTERVAL_MS) postResync(now - lastStateAt);
    }
    function syncLiveStatusTicker() {
      const live = state !== undefined && state.phase === 'ready' && state.running === true;
      if (live && liveStatusTicker === undefined) {
        liveStatusTicker = setInterval(() => { if (state !== undefined) syncLiveStatus(state); maybeRequestResync(); }, THINKING_TICK_MS);
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
    /**
     * Reasoning translation (DSH cot-translation, Webview side).
     *
     * DSH mounts one controller per expanded reasoning body: it splits the text
     * into blank-line paragraphs and request-sized fragments, translates each
     * completed fragment once, and renders translated fragments over the
     * original remainder. The Webview has no component to hold that controller,
     * so the same state lives in these module maps keyed by message id and the
     * DOM is patched in place; requests use the existing message channel.
     */
    const cotStates = new Map();
    const cotRequests = new Map();
    let cotSerial = 0;

    /**
     * The translator's request limits whenever the runtime advertises the
     * capability.
     *
     * DSH's own client does not pre-check provider availability: the
     * availability flag only labels a choice in the settings form, and a
     * provider that cannot answer surfaces as a failed fragment with Retry. The
     * controls therefore render whenever the capability is composed, and the
     * selection key tracks only what changes a cached translation.
     */
    function cotLimits() {
      const value = state && state.translation;
      if (!value || typeof value !== 'object') return undefined;
      const maxTextChars = typeof value.maxTextChars === 'number' && Number.isFinite(value.maxTextChars) ? Math.floor(value.maxTextChars) : 0;
      if (maxTextChars <= 0) return undefined;
      const provider = string(value.provider), targetLanguage = string(value.targetLanguage);
      return { provider, targetLanguage, maxTextChars, key: JSON.stringify([provider, targetLanguage, maxTextChars]) };
    }

    /**
     * DSH's exact fragmenter: blank-line paragraphs, then request-sized slices.
     * A high surrogate is never split from its low half, a slice prefers a
     * whitespace boundary, and the whitespace cut through is appended to the
     * fragment's suffix so the rendered text keeps the original spacing.
     */
    function reasoningFragments(text, running, maxTextChars) {
      const fragments = [];
      const separator = /\\r?\\n(?:[\\t ]*\\r?\\n)+/g;
      let start = 0;
      for (;;) {
        const match = separator.exec(text);
        let remaining = text.slice(start, match === null ? text.length : match.index);
        while (remaining.length > maxTextChars) {
          let cut = maxTextChars;
          const code = remaining.charCodeAt(cut - 1);
          if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
          const whitespace = remaining.slice(0, cut).search(/\\s+\\S*$/);
          if (whitespace > 0) cut = whitespace;
          const source = remaining.slice(0, cut);
          remaining = remaining.slice(cut);
          const suffix = (remaining.match(/^\\s+/) ?? [''])[0];
          remaining = remaining.slice(suffix.length);
          fragments.push({ text: source, suffix, complete: true });
        }
        fragments.push({ text: remaining, suffix: match === null ? '' : match[0], complete: match !== null || !running });
        if (match === null) return fragments;
        start = match.index + match[0].length;
      }
    }

    /** Cached controller state for one message, rebuilt when the selection changes. */
    function cotEntry(message) {
      if (typeof message.id !== 'string' || !hasThinking(message)) return undefined;
      const limits = cotLimits();
      if (limits === undefined) return undefined;
      let entry = cotStates.get(message.id);
      if (entry === undefined) {
        entry = { selectionKey: limits.key, fragments: [], cache: new Map(), failed: false, showOriginal: false, requestId: undefined };
        cotStates.set(message.id, entry);
      } else if (entry.selectionKey !== limits.key) {
        // A translated fragment belongs to the selection that produced it.
        if (entry.requestId !== undefined) cotRequests.delete(entry.requestId);
        entry.selectionKey = limits.key; entry.cache.clear(); entry.failed = false; entry.showOriginal = false; entry.requestId = undefined;
      }
      entry.fragments = reasoningFragments(message.reasoning || '', message.streaming === true, limits.maxTextChars);
      return entry;
    }

    /** What an expanded body shows: translations where cached, the original elsewhere. */
    function cotComposed(entry) {
      return entry.fragments.map(fragment => {
        const translated = fragment.complete ? entry.cache.get(fragment.text) : undefined;
        return (translated === undefined ? fragment.text : translated) + fragment.suffix;
      }).join('');
    }

    /** Ask for the next completed, non-empty, uncached fragment; one request per message. */
    function cotPump(messageId) {
      const entry = cotStates.get(messageId);
      if (entry === undefined || entry.failed || entry.requestId !== undefined) return;
      if (cotLimits() === undefined) return;
      const next = entry.fragments.find(fragment => fragment.complete && fragment.text.trim() !== '' && !entry.cache.has(fragment.text));
      if (next === undefined) return;
      const requestId = 'cot-' + String(++cotSerial);
      entry.requestId = requestId;
      cotRequests.set(requestId, { messageId, text: next.text });
      vscode.postMessage({ type: 'translate-reasoning', requestId, text: next.text });
    }

    /** One thinking body's translation controls and translated text slot. */
    function cotCreateView(thinking) {
      const wrapper = node('div', 'thinking-translation');
      const toolbar = node('div', 'thinking-translation-toolbar');
      const toggle = node('button', 'thinking-translation-toggle'); toggle.type = 'button';
      const spinner = node('span', 'thinking-translation-spinner');
      spinner.setAttribute('role', 'status');
      spinner.setAttribute('aria-label', 'Translating reasoning');
      const failure = node('span', 'thinking-translation-failure');
      failure.setAttribute('role', 'status');
      failure.textContent = 'Translation failed. Showing the original.';
      const retry = node('button', 'thinking-translation-retry', 'Retry'); retry.type = 'button';
      const text = node('div', 'thinking-translation-text');
      toggle.addEventListener('click', () => {
        const current = thinking.message;
        const entry = cotEntry(current);
        if (entry === undefined || entry.failed) return;
        entry.showOriginal = !entry.showOriginal;
        cotRender(thinking, current);
      });
      retry.addEventListener('click', () => {
        const current = thinking.message;
        const entry = cotEntry(current);
        if (entry === undefined) return;
        entry.failed = false;
        cotRender(thinking, current);
      });
      toolbar.append(toggle, spinner, failure, retry);
      wrapper.append(toolbar, text);
      return { wrapper, toggle, spinner, failure, retry, text };
    }

    /** Patch one expanded thinking body from its translation state. */
    function cotRender(thinking, message) {
      const entry = cotEntry(message);
      if (entry === undefined) {
        thinking.translation = undefined;
        thinking.body.textContent = message.reasoning || '';
        return;
      }
      let view = thinking.translation;
      if (view === undefined) { view = cotCreateView(thinking); thinking.translation = view; thinking.body.replaceChildren(view.wrapper); }
      // Pump before painting: the request it starts is what makes this frame
      // pending, and the spinner must appear with the request, not one frame late.
      cotPump(message.id);
      const failed = entry.failed === true;
      const pending = !failed && entry.requestId !== undefined;
      const showOriginal = entry.showOriginal || failed;
      view.wrapper.dataset.translationState = failed ? 'failed' : pending ? 'pending' : 'ready';
      view.wrapper.dataset.translationView = showOriginal ? 'original' : 'translated';
      view.toggle.textContent = showOriginal ? 'View translation' : 'View original';
      view.toggle.disabled = failed;
      view.spinner.hidden = !pending;
      view.failure.hidden = !failed;
      view.retry.hidden = !failed;
      view.text.textContent = showOriginal ? (message.reasoning || '') : cotComposed(entry);
    }

    /** Re-render a message's translation DOM after a result or capability change. */
    function cotRefresh(messageId) {
      const rendered = renderedMessages.get(messageId);
      if (rendered === undefined || rendered.thinking === undefined) return;
      if (rendered.thinking.root.open) cotRender(rendered.thinking, rendered.thinking.message);
    }

    function cotAcceptResult(value) {
      if (typeof value.requestId !== 'string') return;
      const pending = cotRequests.get(value.requestId);
      if (pending === undefined) return;
      cotRequests.delete(value.requestId);
      const entry = cotStates.get(pending.messageId);
      if (entry === undefined || entry.requestId !== value.requestId) return;
      entry.requestId = undefined;
      if (value.ok === true && typeof value.text === 'string') entry.cache.set(pending.text, value.text);
      else entry.failed = true;
      cotRefresh(pending.messageId);
      if (!entry.failed) cotPump(pending.messageId);
    }

    /** Capability changed: every expanded body gains or loses its toolbar. */
    function cotApplyCapability() {
      for (const rendered of renderedMessages.values()) {
        if (rendered.thinking !== undefined && rendered.thinking.root.open) cotRender(rendered.thinking, rendered.thinking.message);
      }
    }

    function cotReset() {
      cotStates.clear();
      cotRequests.clear();
    }

    /** Collapsed-by-default model thinking, folded above the answer. */
    function renderThinking(message) {
      const root = document.createElement('details');
      root.className = 'thinking';
      const summary = document.createElement('summary');
      const title = node('span', 'thinking-title', thinkingLabel(message));
      // DSH puts the wait in the code face, then a 2px dot, then the preview.
      const duration = node('span', 'thinking-duration', thinkingDuration(message));
      const separator = node('span', 'thinking-sep');
      const preview = shimmerNode('thinking-preview', thinkingPreview(message.reasoning));
      const glyph = node('span', 'thinking-icon');
      glyph.append(icon(THINK_SHAPES, false));
      summary.append(glyph, title, duration, separator, preview);
      const body = node('div', 'thinking-body');
      root.append(summary, body);
      const thinking = { root, title, duration, separator, preview, body, message, translation: undefined };
      applyThinkingState(thinking, message);
      // A collapsed body is never materialized, so long thinking stays cheap.
      // Opening is also what starts translation: the toolbar is body content.
      root.addEventListener('toggle', () => { if (root.open) cotRender(thinking, thinking.message); });
      if (root.open) cotRender(thinking, message);
      return thinking;
    }
    /** One place decides what a thinking summary shows, for render and refresh. */
    function applyThinkingState(thinking, message) {
      thinking.message = message;
      const live = message.streaming === true;
      thinking.root.classList.toggle('live', live);
      thinking.title.textContent = thinkingLabel(message);
      const duration = thinkingDuration(message);
      thinking.duration.textContent = duration;
      thinking.duration.hidden = duration === '';
      // DSH shows the dot and the summary together or not at all.
      const summary = thinkingPreview(message.reasoning);
      thinking.separator.hidden = summary === '';
      thinking.preview.hidden = summary === '';
      // DSH highlights the summary while the model is still writing it.
      thinking.preview.classList.toggle('shimmer', live);
      thinking.preview.textContent = summary;
      if (thinking.root.open) cotRender(thinking, message);
    }
    function syncThinking(thinking, message) {
      applyThinkingState(thinking, message);
    }
    // Indexed once per published batch: a conversation with a thousand messages
    // would otherwise scan the whole table for every message on every render,
    // and renders happen on every streamed chunk.
    /** Stable empty list so a runtime without meta does not rebuild the index per message. */
    const emptyStateList = [];
    let metaIndex = { source: null, byId: new Map() };
    function messageMetaFor(id) {
      const list = (state && state.messageMeta) || emptyStateList;
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
    /**
     * DSH's own token pill: what the turn spent, then how much of it the cache
     * carried. The field-by-field breakdown stays on the pill's tooltip, which is
     * where the old text pill kept it.
     */
    function usagePill(turnUsage) {
      const pill = node('button', 'message-action usage-pill');
      pill.type = 'button';
      pill.append(icon(DATABASE_SHAPES, false));
      const label = node('span', 'stat-label');
      label.append(document.createTextNode(compactTokens(turnUsage.totalTokens) + ' tok'));
      const cached = Number(turnUsage.cacheReadTokens || 0);
      const input = cached + Number(turnUsage.uncachedInputTokens || 0);
      if (turnUsage.cacheReadTokens !== undefined && input > 0) {
        label.append(node('span', 'usage-pill-sep', '·'), document.createTextNode('Cache hit ' + Math.round((cached / input) * 100) + '%'));
      }
      pill.append(label);
      const detail = usageLines(turnUsage).join('\\n');
      pill.title = detail; pill.setAttribute('aria-label', 'Turn usage: ' + detail);
      return pill;
    }
    function copyMessageText(message, button) {
      const text = typeof message.text === 'string' ? message.text : '';
      const restore = () => window.setTimeout(() => {
        button.classList.remove('copied'); button.title = 'Copy'; button.setAttribute('aria-label', 'Copy');
      }, 1000);
      const confirm = () => {
        button.classList.add('copied'); button.title = 'Copied'; button.setAttribute('aria-label', 'Copied');
        restore();
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(confirm, () => { vscode.postMessage({ type: 'copy-text', text }); confirm(); });
        return;
      }
      vscode.postMessage({ type: 'copy-text', text });
      confirm();
    }
    let feedbackIndex = { source: null, byId: new Map() };
    function feedbackFor(messageId) {
      const list = (state && state.messageFeedback) || emptyStateList;
      if (feedbackIndex.source !== list) {
        const byId = new Map();
        for (const entry of list) if (entry && typeof entry.messageId === 'string') byId.set(entry.messageId, entry);
        feedbackIndex = { source: list, byId };
      }
      return feedbackIndex.byId.get(messageId);
    }
    /**
     * The marks DSH's own action row draws, from the icon set its client
     * primitives use (16px viewBox, one-pixel stroke). Emoji rendered in whatever
     * font and size the platform chose, which is what made the rating buttons look
     * like they belonged to a different row.
     */
    /**
     * DSH's running mark: the tail alone, which is what its own chat row draws
     * (the still frame of its animated asset) rather than the whole brand mark.
     */
    const TAIL_PATH = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742';
    /** DSH's thinking mark: two crossed rings and a centre dot. */
    const THINK_SHAPES = [
      { tag: 'path', attrs: { d: 'M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z' } },
      { tag: 'path', attrs: { d: 'M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z' } },
      { tag: 'path', attrs: { d: 'M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z' }, fill: 'currentColor', stroke: false },
    ];
    const LIKE_PATH = 'M13.537 8.12098L12.3983 12.8455C12.1818 13.7438 11.378 14.3769 10.454 14.3769L9.35595 14.3769H7.43799H5.16577C3.50892 14.3769 2.16577 13.0337 2.16577 11.3769V7.88668C2.16577 7.33439 2.61349 6.88668 3.16577 6.88668H4.02665C5.84943 6.88668 7.38083 3.28711 7.67689 2.54578C7.71259 2.45639 7.73501 2.36373 7.77922 2.27824C7.86506 2.11221 8.08228 1.87578 8.59039 2.07775C10.3291 2.76886 9.23144 6.04071 8.96955 6.75058C8.94502 6.81707 8.99495 6.88668 9.06581 6.88668H12.5648C13.2119 6.88668 13.6886 7.49192 13.537 8.12098Z';
    const DISLIKE_PATH = 'M2.46302 8.06749L3.60171 3.34299C3.81822 2.44467 4.62196 1.81162 5.546 1.8116L6.64406 1.81158L8.56202 1.81158L10.8342 1.81158C12.4911 1.81158 13.8342 3.15473 13.8342 4.81158L13.8342 8.3018C13.8342 8.85408 13.3865 9.3018 12.8342 9.3018L11.9734 9.3018C10.1506 9.3018 8.61918 12.9014 8.32311 13.6427C8.28741 13.7321 8.26499 13.8247 8.22078 13.9102C8.13494 14.0763 7.91772 14.3127 7.40961 14.1107C5.67089 13.4196 6.76856 10.1478 7.03045 9.43789C7.05498 9.37141 7.00505 9.3018 6.93419 9.3018L3.43519 9.3018C2.78811 9.3018 2.31141 8.69656 2.46302 8.06749Z';
    const COPY_SHAPES = [
      { tag: 'rect', attrs: { x: '1.52075', y: '4.07373', width: '10.3932', height: '10.3932', rx: '2' } },
      { tag: 'path', attrs: { d: 'M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z' } },
    ];
    const BRANCH_SHAPES = [
      { tag: 'path', attrs: { d: 'M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564' } },
      { tag: 'path', attrs: { d: 'M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944' } },
      { tag: 'circle', attrs: { cx: '12.4502', cy: '3.3079', r: '1.56962' } },
      { tag: 'circle', attrs: { cx: '12.4502', cy: '12.6921', r: '1.56962' } },
    ];
    /** DSH's gauge: the session's own pace, next to the counts it belongs to. */
    const GAUGE_SHAPES = [
      { tag: 'path', attrs: { d: 'M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096' } },
      { tag: 'path', attrs: { d: 'M8 8.49994L11.6114 4.88855' } },
      { tag: 'path', attrs: { d: 'M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z' }, fill: 'currentColor', stroke: false },
    ];
    /** DSH's database: what the session has spent. */
    const DATABASE_SHAPES = [
      { tag: 'path', attrs: { d: 'M13.1967 5.1869C13.7232 4.77378 14.0003 4.30517 14.0001 3.82819C14.0003 3.3512 13.7232 2.88259 13.1967 2.46947C12.6702 2.05635 11.9128 1.71328 11.0006 1.47475C10.0885 1.23621 9.05371 1.11062 8.00039 1.1106C6.94707 1.11057 5.9123 1.23612 5.00009 1.47461C4.08742 1.71301 3.32948 2.05604 2.80249 2.46919C2.2755 2.88235 1.99805 3.35106 1.99805 3.82819C1.99805 4.30531 2.2755 4.77402 2.80249 5.18718C3.32948 5.60033 4.08742 5.94336 5.00009 6.18176C5.9123 6.42025 6.94707 6.5458 8.00039 6.54578C9.05371 6.54575 10.0885 6.42016 11.0006 6.18163C11.9128 5.94309 12.6702 5.60002 13.1967 5.1869Z' } },
      { tag: 'path', attrs: { d: 'M2 3.80371V11.7848' } },
      { tag: 'path', attrs: { d: 'M14 3.80371V11.7848' } },
      { tag: 'path', attrs: { d: 'M2 7.81396C2 8.60524 2.63214 9.36411 3.75736 9.92363C4.88258 10.4832 6.4087 10.7975 8 10.7975C9.5913 10.7975 11.1174 10.4832 12.2426 9.92363C13.3679 9.36411 14 8.60524 14 7.81396' } },
      { tag: 'path', attrs: { d: 'M2 11.7847C2 12.6081 2.63214 13.3977 3.75736 13.98C4.88258 14.5622 6.4087 14.8893 8 14.8893C9.5913 14.8893 11.1174 14.5622 12.2426 13.98C13.3679 13.3977 14 12.6081 14 11.7847' } },
    ];
    /**
     * Build one icon: stroked, or filled as well when it marks a chosen state.
     *
     * A shape may ask for its own fill or no stroke, because DSH's artwork mixes
     * them: the think icon's rings are stroked and its centre dot is filled.
     */
    function icon(shapes, filled) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('aria-hidden', 'true');
      for (const shape of shapes) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', shape.tag);
        for (const [name, value] of Object.entries(shape.attrs)) element.setAttribute(name, value);
        const shapeFill = shape.fill === undefined ? (filled === true ? 'currentColor' : 'none') : shape.fill;
        element.setAttribute('fill', shapeFill);
        if (shape.stroke !== false) {
          element.setAttribute('stroke', 'currentColor');
          element.setAttribute('stroke-width', '1');
        }
        svg.append(element);
      }
      return svg;
    }
    /** Text that carries the streaming highlight while it keeps changing. */
    function shimmerNode(className, text) {
      return node('span', 'shimmer ' + className, text);
    }
    function feedbackButton(rating, messageId, current) {
      const active = current === rating;
      const button = node('button', 'message-action message-icon message-' + rating + (active ? ' active' : ''));
      button.type = 'button';
      button.append(icon([{ tag: 'path', attrs: { d: rating === 'positive' ? LIKE_PATH : DISLIKE_PATH } }], active));
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
      const button = node('button', 'message-action message-icon message-branch');
      button.type = 'button';
      button.append(icon(BRANCH_SHAPES, false));
      // The Host sends the turn/end seq for each reply's own turn: a message seq
      // would cut mid-turn, where the runtime appends synthetic closers.
      const atSeq = meta && typeof meta.forkAtSeq === 'number' && Number.isFinite(meta.forkAtSeq)
        ? meta.forkAtSeq
        : undefined;
      if (atSeq === undefined || meta.forkable !== true) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = 'Available only on the last message of a completed turn';
        button.setAttribute('aria-label', button.title);
        return button;
      }
      button.title = 'Branch into a new conversation';
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => vscode.postMessage({
        type: 'fork-conversation', sessionId: state && state.sessionId, atSeq,
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
      const copy = node('button', 'message-action message-icon message-copy');
      copy.type = 'button'; copy.title = 'Copy'; copy.setAttribute('aria-label', 'Copy');
      copy.append(icon(COPY_SHAPES, false));
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
      const row = node('div', 'message-actions end');
      const list = (state && state.messages) || [];
      // Only the newest turn's row stays visible; the rest reveal on hover, as
      // DSH does, so a long transcript is not a wall of buttons. A retry chain or
      // a token-limit notice can trail the closing reply without closing the
      // turn, so the search looks past those procedural rows to the newest reply.
      let newest = list.length - 1;
      while (newest >= 0) {
        const role = list[newest] && list[newest].role;
        if (role === 'retry' || role === 'limit') { newest -= 1; continue; }
        break;
      }
      if (newest >= 0 && list[newest].id === message.id) row.classList.add('always');
      const copy = node('button', 'message-action message-icon message-copy');
      copy.type = 'button'; copy.title = 'Copy'; copy.setAttribute('aria-label', 'Copy');
      copy.append(icon(COPY_SHAPES, false));
      copy.addEventListener('click', () => copyMessageText(message, copy));
      row.append(copy);
      const current = feedbackFor(message.id);
      const rating = current === undefined ? undefined : current.rating;
      row.append(feedbackButton('positive', message.id, rating));
      row.append(feedbackButton('negative', message.id, rating));
      row.append(branchButton(meta));
      // DSH groups the turn's bill and its clock at the end of the row, in that
      // order, 8px clear of the marks.
      const end = node('div', 'message-end');
      if (meta.turnUsage !== undefined) end.append(usagePill(meta.turnUsage));
      // What DSH's turn process row calls "Completed in 2m 3s": the wait the user
      // sat through, measured from the prompt that opened the turn.
      if (typeof meta.turnDurationMs === 'number' && meta.turnDurationMs >= 1000) {
        const duration = node('span', 'message-duration');
        duration.append(document.createTextNode(message.failed ? 'Failed after ' : 'Completed in '));
        duration.append(node('span', 'duration-number', formatLiveDuration(meta.turnDurationMs)));
        end.append(duration);
      }
      const clock = formatMessageClock(meta.time);
      if (clock !== '') end.append(node('span', 'message-clock', clock));
      if (end.childNodes.length > 0) row.append(end);
      return row;
    }
    /**
     * DSH's own failure copy: the runtime code picks both the title and the
     * reason, while a code the sidebar does not know keeps the provider text.
     */
    function failureTitleOf(message) {
      const code = typeof message.failureCode === 'string' ? message.failureCode : '';
      return code === 'ACCOUNT_SIGNED_OUT' || code === 'INTERRUPTED' ? 'Task stopped' : 'This turn failed';
    }
    function failureReasonOf(message) {
      const code = typeof message.failureCode === 'string' ? message.failureCode : '';
      return failureReasonForCode(code, message.detail || 'Error details are not available in the loaded history.');
    }
    /** DSH's per-code failure copy, shared by turn failures and retry rows. */
    function failureReasonForCode(code, detail) {
      if (code === 'AUTH') return 'API key is invalid';
      if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return 'Request quota exhausted.';
      if (code === 'ACCOUNT_SIGNED_OUT') return 'Stopped because you signed out of DeepSeek.';
      if (code === 'ACCOUNT_SIGN_IN_REQUIRED') return 'Sign in to DeepSeek and ensure the request destination supports account authentication.';
      if (code === 'INTERRUPTED') return 'The DSH process exited before this turn finished (for example, it was killed, crashed, or timed out while shutting down), so the turn was closed when DSH restarted. Unfinished tool calls have unknown outcomes.';
      return detail;
    }
    /** The runtime code shown beside the reason; INTERRUPTED has no chip. */
    function failureCodeOf(message) {
      const code = typeof message.failureCode === 'string' ? message.failureCode : '';
      return code === '' || code === 'INTERRUPTED' ? '' : code;
    }
    function retrySeconds(delayMs) {
      const milliseconds = Number(delayMs);
      return Math.max(1, Math.ceil((Number.isFinite(milliseconds) ? milliseconds : 0) / 1000));
    }
    function retryLabelOf(retry) {
      // DSH's own active-state copy: a scheduled retry is shown as retrying,
      // not as waiting, because the active branch is the one that renders.
      if (retry.state === 'started') return 'Retried model request';
      if (retry.state === 'cancelled') return 'Model request retry cancelled';
      return 'Retrying model request';
    }
    /** One collapsible process row per retry chain, showing its newest attempt. */
    function renderRetry(message) {
      const retry = record(message.retry);
      const row = node('details', 'retry-row');
      if (retry === undefined) return row;
      const active = retry.state === 'scheduled';
      if (active) row.setAttribute('data-active', '');
      row.setAttribute('data-state', string(retry.state));
      const summary = node('summary', 'retry-summary');
      const maximum = string(retry.mode) === 'normal' ? String(Number(retry.maxRetries) || 0) : '∞';
      const text = node('span', 'retry-text', retryLabelOf(retry)
        + ' (' + String(Number(retry.retry) || 0) + '/' + maximum + ') · ' + retrySeconds(retry.delayMs) + 's');
      text.setAttribute('role', 'status');
      summary.append(text); row.append(summary);
      const details = node('div', 'retry-details');
      const delay = node('div');
      delay.append(node('span', 'retry-detail-label', 'Retry delay: '),
        document.createTextNode(String(Math.round(Number(retry.delayMs) || 0)) + 'ms'));
      const failure = node('div');
      failure.append(node('span', 'retry-detail-label', 'Failure reason: '),
        document.createTextNode(failureReasonForCode(string(retry.failureCode), string(retry.detail) || 'Error details are not available in the loaded history.')));
      details.append(delay, failure); row.append(details);
      return row;
    }
    function renderLimit() {
      const row = node('div', 'turn-limit'); row.setAttribute('role', 'status');
      row.append(node('span', 'turn-limit-dot'));
      const copy = node('div', 'turn-limit-copy');
      copy.append(node('span', 'turn-limit-title', 'Output token limit reached'),
        node('span', 'turn-limit-text', 'The reply was cut off; earlier output is preserved in the conversation. Send "continue" to let the model resume.'));
      row.append(copy);
      return row;
    }
    function renderMessage(message) {
      if (message.role === 'tool') return { message, node: renderTool(message) };
      if (message.role === 'command') return { message, node: renderCommand(message) };
      if (message.role === 'notice') return { message, node: node('div', 'status' + (message.failed ? ' error' : ''), message.text) };
      if (message.role === 'retry') return { message, node: renderRetry(message) };
      if (message.role === 'limit') return { message, node: renderLimit() };
      const item = node('article', 'message ' + message.role);
      // A failed attempt without visible output shows only its failure block; an
      // empty body would render as a blank reply bubble.
      const emptyFailure = message.role === 'assistant' && message.failed === true && message.deferredBody !== true
        && message.text === '' && (message.reasoning ?? '') === '' && (message.images?.length ?? 0) === 0;
      const markdown = message.role === 'assistant' && message.streaming === true ? createMarkdownStream(message.text) : undefined;
      const thinking = message.role === 'assistant' && hasThinking(message) ? renderThinking(message) : undefined;
      if (thinking) item.append(thinking.root);
      if (!emptyFailure) {
        const body = message.role === 'assistant'
          ? message.deferredBody === true ? node('div', 'markdown') : (markdown ? markdown.root : renderMarkdown(message.text))
          : (window.dshMarkdown && typeof window.dshMarkdown.renderUserText === 'function'
            ? window.dshMarkdown.renderUserText(message.text) : node('div', '', 'Message renderer unavailable.'));
        body.classList.add('message-body');
        if (message.deferredBody === true) attachDeferredOutput(message, body, renderAssistantPage, false, 'Show full response' + (message.bodyLength ? ' · ' + String(message.bodyLength) + ' characters' : ''));
        else appendImages(body, message.images);
        item.append(body);
      }
      if (message.role === 'assistant' && message.failed === true) {
        const failure = node('div', 'assistant-failure'); failure.setAttribute('role', 'status');
        failure.append(node('div', 'assistant-failure-title', failureTitleOf(message)));
        const line = node('div', 'assistant-failure-line');
        line.append(node('div', 'assistant-failure-detail', failureReasonOf(message)));
        const code = failureCodeOf(message);
        if (code !== '') line.append(node('code', 'assistant-failure-code', code));
        failure.append(line);
        item.append(failure);
      }
      const meta = messageMetaFor(message.id);
      if (meta !== undefined && message.role === 'assistant' && meta.turnEnd === true) item.append(renderMessageActions(message, meta));
      else if (meta !== undefined && message.role === 'user') item.append(renderUserActions(message, meta));
      return { message, node: item, ...(markdown ? { markdown } : {}), ...(thinking ? { thinking } : {}) };
    }
    /**
     * Stable part of a tool row's reuse key: a late denial reason must repaint.
     *
     * The incremental patch normally upserts a new message object, which already
     * forces the repaint; this key matters when a caller mutates the nested
     * denial in place and the row identity stays the same.
     */
    function denialKeyOf(message) {
      const denial = autoReviewDenialOf(message);
      return denial === undefined ? null : autoReviewReasonText(denial.reason);
    }
    /** The key of a row that draws no action content; no JSON is needed for it. */
    const plainRowKey = 'plain';
    /**
     * What the action row under one message draws.
     *
     * The key covers the values the row reads outside the message object (meta,
     * feedback, denial). Its parts are passed in because messageNode already
     * looks them up: caching the computed key per rendered entry means a long
     * transcript pays only reference comparisons for unchanged messages.
     */
    function messageRowKey(message, meta, feedback, denialKey) {
      // The retry row is replaced as a value and the limit row is fixed: each
      // needs its own key, or an update to the same message would be swallowed.
      if (message.role === 'retry') return JSON.stringify(['retry', message.retry]);
      if (message.role === 'limit') return JSON.stringify(['limit']);
      const autoReview = denialKey === null ? null : [true, denialKey];
      const failure = message.role === 'assistant' && message.failed === true ? [message.failed, message.detail, message.failureCode] : [];
      // Most rows draw neither a failure nor an auto-review note: one constant
      // key saves serializing the same two empty values for every message.
      if (meta === undefined || (message.role === 'assistant' ? meta.turnEnd !== true : message.role !== 'user')) {
        return failure.length === 0 && autoReview === null ? plainRowKey : JSON.stringify([failure, autoReview]);
      }
      return JSON.stringify([
        feedback === undefined ? null : [feedback.rating, feedback.version],
        meta.turnUsage === undefined ? null : meta.turnUsage,
        typeof meta.turnDurationMs === 'number' ? meta.turnDurationMs : null,
        typeof meta.forkAtSeq === 'number' ? meta.forkAtSeq : null,
        meta.forkable === true,
        typeof meta.seq === 'number' ? meta.seq : null,
        typeof meta.time === 'number' ? meta.time : null,
        failure,
        autoReview,
      ]);
    }
    /**
     * The Team projection a tool card resolves member names against.
     *
     * The projection and the event stream travel independently, so a team
     * member update can arrive after the tool message was drawn. Keying the
     * rendered card on exactly this map re-renders those cards when it changes,
     * instead of leaving the link missing until the next message arrives.
     */
    function teamLinkKey() {
      const members = array(state && state.team && state.team.members);
      return members.map(member => string(member && member.name) + '\\u0000' + string(member && member.id)).sort().join('\\u0001');
    }
    function hasTeamLinks(message) {
      return [record(message.callView), record(message.resultView)]
        .some(view => array(view && view.subagentLinks).length > 0);
    }
    function messageNode(message) {
      const rendered = renderedMessages.get(message.id);
      const meta = messageMetaFor(message.id);
      const feedback = feedbackFor(message.id);
      const denialKey = denialKeyOf(message);
      // While the message object and the row's external inputs keep their
      // identities, the key cannot change: reuse it instead of serializing the
      // same fields for every message on every streamed chunk.
      const keyInputsUnchanged = rendered !== undefined && rendered.message === message
        && rendered.rowMeta === meta && rendered.rowFeedback === feedback && rendered.rowDenial === denialKey;
      const rowKey = keyInputsUnchanged ? rendered.rowKey : messageRowKey(message, meta, feedback, denialKey);
      const rowChanged = rendered !== undefined && rendered.rowKey !== rowKey;
      const teamChanged = rendered !== undefined && rendered.teamKey !== undefined && rendered.teamKey !== teamLinkKey();
      if (rendered && rendered.message === message && !rowChanged && !teamChanged) return rendered.node;
      if (rendered && rendered.message.deferredBodyRevision !== message.deferredBodyRevision) resetDeferredOutput(message.id);
      const appended = pendingMessageAppends.get(message.id);
      // Thinking that shows up after the node was built needs a fresh render.
      const thinkingAppeared = hasThinking(message) && rendered !== undefined && rendered.thinking === undefined;
      if (rendered && !rowChanged && !teamChanged && rendered.markdown && appended !== undefined && !thinkingAppeared && message.role === 'assistant' && message.images === rendered.message.images) {
        pendingMessageAppends.delete(message.id);
        // Always run this: an empty delta with streaming=false is what flushes
        // the settled markdown and drops the streaming tail node.
        appendMarkdownStream(rendered.markdown, appended, message.streaming === true);
        if (rendered.thinking !== undefined) syncThinking(rendered.thinking, message);
        rendered.message = message; rendered.rowMeta = meta; rendered.rowFeedback = feedback; rendered.rowDenial = denialKey;
        syncThinkingTicker();
        return rendered.node;
      }
      if (rendered) deferredOutputViews.delete(message.id);
      pendingMessageAppends.delete(message.id);
      const next = renderMessage(message);
      next.rowKey = rowKey; next.rowMeta = meta; next.rowFeedback = feedback; next.rowDenial = denialKey;
      if (hasTeamLinks(message)) next.teamKey = teamLinkKey();
      // reconcileMessages owns node placement. Replacing a connected node here
      // invalidates its cursor before insertBefore can finish reconciling the list.
      renderedMessages.set(message.id, next);
      return next.node;
    }
    function reconcileMessages(messages, current) {
      if (!messages.length) {
        renderedMessages.clear(); cotReset(); elements.messages.replaceChildren(renderEmpty(current)); syncThinkingTicker(); return;
      }
      const ids = new Set(messages.map(message => message.id));
      for (const [id, rendered] of renderedMessages) {
        if (!ids.has(id)) {
          rendered.node.remove(); renderedMessages.delete(id); toolOpenIntent.delete(id); resetDeferredOutput(id); pendingMessageAppends.delete(id);
          // A message that left the transcript cannot answer its translation.
          cotStates.delete(id);
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
      if (current.phase === 'idle') {
        const actions = node('div', 'actions');
        const connect = node('button', 'primary', 'Connect to DSH'); connect.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' })); actions.append(connect);
        box.append(actions);
      } else if (current.phase === 'loading') {
        const actions = node('div', 'actions');
        const output = node('button', 'secondary', 'Show Output'); output.addEventListener('click', () => vscode.postMessage({ type: 'output' })); actions.append(output);
        box.append(actions);
      } else if (current.phase === 'error') {
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
          // A failed open is retried in place: the conversation list remains
          // usable in every phase, but the broken conversation itself needs its
          // own way back. Without it a single held conversation leaves only a
          // runtime restart, which in a shared runtime stops every window.
          if (current.sessionId !== undefined && current.sessionId !== '') {
            const retryConversation = node('button', 'primary', 'Retry Conversation');
            retryConversation.addEventListener('click', () => {
              if (typeof current.occupancyNotice === 'string' && current.occupancyNotice !== '') {
                // Held: re-check the ownership before reopening the conversation.
                vscode.postMessage({ type: 'retry-occupancy' });
              } else {
                vscode.postMessage({ type: 'select-session', sessionId: current.sessionId });
              }
            });
            actions.append(retryConversation);
          }
          if (current.canReconnect) {
            const retry = node('button', 'secondary', 'Reconnect'); retry.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' })); actions.append(retry);
          } else {
            const retry = node('button', 'secondary', 'Retry Connection'); retry.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' })); actions.append(retry);
          }
          // Only a runtime this window owns may be restarted from here: adopted
          // and external runtimes are shared with other windows, so restarting
          // would stop their turns too.
          const connection = current.runtimeConnection;
          if (connection !== null && connection !== undefined && connection.ownership === 'managed') {
            const restart = node('button', 'secondary', 'Restart Runtime'); restart.addEventListener('click', () => vscode.postMessage({ type: 'restart' })); actions.append(restart);
          }
        }
        if (setup !== 'workspace') { const output = node('button', 'secondary', 'Show Output'); output.addEventListener('click', () => vscode.postMessage({ type: 'output' })); actions.append(output); }
        box.append(actions);
      }
      return box;
    }
    function renderEmpty(current) {
      const empty = node('div', 'empty'); empty.append(node('div', 'empty-logo deepseek-mark'), node('h2', '', 'Build with DeepSeek'));
      empty.append(node('p', '', 'Ask questions, explore code, and make changes in ' + current.workspaceName + '.'));
      const actions = node('div', 'empty-actions');
      for (const [label, prompt] of [
        ['Explore this project', 'Explain this project’s structure and the main entry points.'],
        ['Review changes', 'Review the current changes for bugs, regressions, and missing validation.'],
        ['Find a bug', 'Inspect this project for a reproducible bug and explain its cause before making changes.'],
      ]) {
        const button = node('button', 'empty-action', label); button.type = 'button';
        const arrow = node('span', ''); arrow.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>'; button.append(arrow);
        button.addEventListener('click', () => {
          if (elements.prompt.disabled) return;
          elements.prompt.value = prompt; if (state && state.sessionId) sessionDrafts.set(state.sessionId, prompt);
          resizePrompt(); renderCommandMenu(); renderMentionMenu(); elements.prompt.focus();
        }); actions.append(button);
      }
      empty.append(actions); return empty;
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
    function policyMenuOption(label, description, selected, disabled, onSelect, badge) {
      const option = node('button', 'command-option' + (selected ? ' selected' : ''));
      option.type = 'button'; option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(selected)); option.disabled = disabled;
      const line = node('span', 'command-option-line'); line.append(node('span', 'command-option-name', label));
      if (badge) { const mark = node('span', 'command-option-badge', badge); mark.title = 'Experimental preset'; line.append(mark); }
      if (selected) line.append(node('span', 'command-option-current', 'Current'));
      option.append(line, node('span', 'command-option-description', description));
      // The description is ellipsised in a narrow sidebar; the title keeps it
      // readable on hover without growing the row.
      option.title = description;
      option.addEventListener('click', () => { if (selected || disabled) return; policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); onSelect(); });
      return option;
    }
    function renderPolicyState(current) {
      const plan = current.plan || { available: false, active: false, pending: false };
      const planActive = effectivePlanMode(plan);
      const permissions = current.permissions || [];
      const selectedPermission = permissions.find(permission => permission.selected) || permissions[0];
      // Permission presets are the safety-relevant choice, so they keep the
      // control. Plan mode is entered and left with the slash command, as in DSH.
      const preset = current.agentPreset || { available: false, current: '', locked: true, busy: false, options: [] };
      const presetAvailable = preset.available && preset.options.length > 0;
      const selectedPreset = presetAvailable ? (preset.options.find(option => option.selected) || preset.options[0]) : undefined;
      const available = permissions.length > 0 || presetAvailable;
      // Agent composition belongs in settings. Once fixed, it has no action
      // to offer and must not consume a permanent row above the draft.
      elements.modeChips.replaceChildren();
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
      elements.policyTrigger.title = [status ? 'Permissions: ' + status : '', selectedPreset ? 'Agent: ' + selectedPreset.label : ''].filter(Boolean).join(' · ') || 'Conversation settings';
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
            permission.experimental === true ? 'EXP' : undefined,
          ));
        }
      }
      if (presetAvailable) {
        elements.policyMenu.append(node('div', 'policy-section-label', 'Agent preset'));
        if (preset.locked) {
          const row = node('div', 'policy-preset-fixed');
          row.title = 'Agent preset is fixed after the first turn';
          row.append(node('span', 'policy-preset-name', selectedPreset.label), node('span', 'policy-preset-note', 'Fixed for this conversation'));
          elements.policyMenu.append(row);
        } else for (const option of preset.options) {
          const button = policyMenuOption(option.label + (option.trust === 'user' ? ' · User' : ''), option.description || 'Agent composition for this conversation', option.selected === true,
            preset.busy || current.running === true || current.phase !== 'ready', () => vscode.postMessage({ type: 'select-agent-preset', agentPreset: option.id }));
          button.classList.add('agent-preset-option'); button.dataset.presetId = option.id; elements.policyMenu.append(button);
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
    /** DSH's decode figure: whole tokens from ten up, one decimal below. */
    function formatTokensPerSecond(value) {
      const clamped = Math.max(0, Number(value) || 0);
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
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
        if (stats.decodeMs > 0) speeds.push(formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000)) + ' tok/s');
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
    /**
     * One of DSH's composer-dock pills: a mark, then the parts of one figure,
     * separated by the dot DSH separates them with.
     */
    function statPill(shapes, parts, title) {
      const pill = node('span', 'stat-pill');
      pill.append(icon(shapes, false));
      const label = node('span', 'stat-label');
      label.append(document.createTextNode(parts[0]));
      for (const part of parts.slice(1)) label.append(node('span', 'stat-sep', '·'), document.createTextNode(part));
      pill.append(label);
      if (title) { pill.title = title; pill.setAttribute('aria-label', title); }
      return pill;
    }
    /**
     * DSH's session statistics, split the way its own pills split them: what the
     * session has done, then what it has cost. Empty groups are simply absent,
     * so a fresh session shows no dock at all.
     */
    function usageStatPills(usage) {
      const pills = [];
      const stats = usage && usage.sessionStats;
      if (stats && stats.steps > 0) {
        const counts = [stats.turns + (stats.turns === 1 ? ' turn' : ' turns') + ' ' + stats.steps + (stats.steps === 1 ? ' step' : ' steps')];
        if (stats.decodeMs > 0) counts.push(formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000)) + ' tok/s');
        pills.push(statPill(GAUGE_SHAPES, counts, usageStatsLine(usage)));
      }
      const tokens = usage && usage.tokenUsage;
      if (tokens) {
        const input = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
        const total = input + tokens.outputTokens;
        if (total > 0) {
          const spent = [formatTokens(total) + ' tok'];
          if (input > 0) spent.push('Cache hit ' + Math.round(tokens.cacheReadTokens / input * 100) + '%');
          pills.push(statPill(DATABASE_SHAPES, spent, usageStatsLine(usage)));
        }
      }
      return pills;
    }
    function renderUsage(current) {
      const usage = current.usage || { available: false, percent: 0, usedTokens: 0, contextWindow: 0 };
      const pills = usageStatPills(usage);
      elements.usageStats.replaceChildren(...pills);
      elements.usageStats.classList.toggle('hidden', pills.length === 0);
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
      const name = reference.path.split(/[\\\\/]/).filter(Boolean).pop() || reference.path;
      return name + (reference.kind === 'folder' ? '/' : '') + range + (reference.truncated ? ' (truncated)' : '');
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
      const references = array(ideContext.pinned);
      elements.contextChips.classList.toggle('hidden', references.length === 0);
      for (const reference of references) {
        const chip = node('div', 'context-chip' + (reference.kind === 'selection' ? ' selection' : '') + (reference.id ? ' pinned' : ''));
        chip.title = reference.path + '\\n' + contextTitle(reference);
        const icon = reference.kind === 'folder' ? '🗀' : reference.kind === 'selection' ? '§' : '▧';
        const label = contextLabel(reference);
        if (reference.kind === 'file' || reference.kind === 'selection' || reference.kind === 'problem') {
          const open = node('button', 'context-open'); open.type = 'button'; open.setAttribute('aria-label', 'Open ' + reference.path); open.title = chip.title;
          open.append(node('span', 'context-icon', icon), node('span', 'context-name', label));
          open.addEventListener('click', () => vscode.postMessage({ type: 'open-file', path: reference.path, ...(reference.startLine === undefined ? {} : { line: reference.startLine }) })); chip.append(open);
        } else chip.append(node('span', 'context-icon', icon), node('span', 'context-name', label));
        if (reference.id) {
          const remove = node('button', 'context-remove', '×'); remove.title = 'Remove pinned context'; remove.setAttribute('aria-label', 'Remove ' + reference.path);
          remove.addEventListener('click', () => changeContext({ type: 'remove-context', id: reference.id })); chip.append(remove);
        }
        elements.contextChips.append(chip);
      }
      renderContextMenu();
    }
    function closeContextMenu(focus) {
      contextMenuOpen = false; elements.contextMenu.classList.add('hidden'); elements.attach.setAttribute('aria-expanded', 'false');
      if (focus) elements.prompt.focus();
    }
    function requestContextFiles() {
      if (!state || !state.sessionId || !contextMenuOpen) return;
      contextLoading = true; contextError = ''; contextCandidates = [];
      vscode.postMessage({ type: 'request-context-files', sessionId: state.sessionId, requestId: ++contextRequestId, query: elements.contextSearch.value });
      renderContextMenu();
    }
    function chosenContext(candidate) {
      return array(ideContext.pinned).find(reference => reference.path === candidate.path
        && reference.startLine === candidate.startLine && reference.endLine === candidate.endLine);
    }
    function changeContext(change) {
      if (!state || !state.sessionId || elements.prompt.disabled) return;
      const requestId = ++contextChangeId;
      pendingContextRequests.set(requestId, state.sessionId);
      vscode.postMessage({ ...change, sessionId: state.sessionId, requestId }); updateSend();
    }
    function toggleContext(candidate) {
      const chosen = chosenContext(candidate);
      if (chosen && chosen.id) changeContext({ type: 'remove-context', id: chosen.id });
      else changeContext({ type: 'add-context', path: candidate.path, ...(candidate.startLine === undefined ? {} : { startLine: candidate.startLine, endLine: candidate.endLine }) });
    }
    function renderContextMenu() {
      elements.contextMenu.classList.toggle('hidden', !contextMenuOpen);
      elements.attach.setAttribute('aria-expanded', String(contextMenuOpen));
      if (!contextMenuOpen) return;
      const focusedKey = elements.contextList.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
      elements.contextList.replaceChildren();
      const query = elements.contextSearch.value.trim().toLowerCase();
      const choices = [];
      const suggestions = [ideContext.availableSelection, ideContext.availableFile].filter(Boolean);
      for (const candidate of suggestions) if (!query || candidate.path.toLowerCase().includes(query)) choices.push({ ...candidate, suggestion: candidate.startLine === undefined ? 'Current editor · optional' : 'Selected lines · optional' });
      for (const candidate of contextCandidates) if ((candidate.kind === 'file' || candidate.kind === 'folder') && !choices.some(item => item.path === candidate.path && item.startLine === candidate.startLine)) choices.push(candidate);
      for (const candidate of choices) {
        const chosen = chosenContext(candidate), option = node('button', 'context-option'); option.type = 'button';
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(Boolean(chosen))); option.dataset.path = candidate.path;
        option.dataset.key = JSON.stringify([candidate.path, candidate.startLine, candidate.endLine]);
        const copy = node('span', 'context-option-copy'); copy.append(node('span', 'context-option-name', contextLabel(candidate)), node('span', 'context-option-path', candidate.path + (candidate.suggestion ? ' · ' + candidate.suggestion : '')));
        option.append(node('span', 'context-option-mark', chosen ? '✓' : '+'), copy);
        option.title = candidate.path; option.addEventListener('click', () => toggleContext(candidate)); elements.contextList.append(option);
      }
      if (contextError || contextLoading || !choices.length) elements.contextList.append(node('div', 'context-menu-status', contextError || (contextLoading ? 'Searching project files…' : 'No matching files')));
      if (focusedKey) { const focused = [...elements.contextList.querySelectorAll('.context-option')].find(option => option.dataset.key === focusedKey); if (focused) focused.focus(); }
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
          if (permission.experimental === true) {
            const mark = node('span', 'command-option-badge', 'EXP'); mark.title = 'Experimental preset'; line.append(mark);
          }
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
    /**
     * Drop the local rows the runtime has caught up with.
     *
     * Matched by the text the user typed, because the two sides name the message
     * differently: the composer counts its own drafts, and the runtime answers
     * with the message it admitted. A row leaves as soon as one host row carries
     * its text.
     */
    function reconcilePendingQueue(sessionId, queue) {
      let changed = false;
      for (const [requestId, pending] of pendingQueueSends) {
        if (pending.sessionId !== sessionId) { pendingQueueSends.delete(requestId); changed = true; continue; }
        if (queue.some(item => (item.text ?? item.preview ?? '') === pending.text)) { pendingQueueSends.delete(requestId); changed = true; }
      }
      return changed;
    }
    function pendingQueueRows(sessionId) {
      const rows = [];
      for (const [requestId, pending] of pendingQueueSends) {
        if (pending.sessionId === sessionId) rows.push({ requestId, preview: pending.preview });
      }
      return rows;
    }
    /**
     * The queue dock's render signature, built in exactly one place.
     *
     * The editor's input handler used to write its own copy, which fell out of step
     * when the local pending rows were added — the two key sets could never be
     * equal, so the guard was dead and every keystroke rebuilt the textarea and
     * pulled the caret back to the end.
     */
    function queueSignature(sessionId, queue, pending, commands, editing) {
      return JSON.stringify({ sessionId, queue, pending, commands, running: state && state.running, editing });
    }
    /** One action on a command this window is holding until the conversation is idle. */
    function postQueuedCommandAction(sessionId, commandId, action) {
      if (!state || state.phase !== 'ready' || state.sessionId !== sessionId) return;
      vscode.postMessage({ type: 'queued-command-action', sessionId, commandId, action });
    }
    function renderQueue(force) {
      const sessionId = state && state.sessionId;
      const queue = (state && state.phase === 'ready' && state.queue || []).filter(item => item.placement === 'queued');
      const commands = array(state && state.phase === 'ready' && state.queuedCommands);
      if (reconcilePendingQueue(sessionId, queue)) queueRenderSignature = '';
      const pending = pendingQueueRows(sessionId);
      const total = queue.length + pending.length + commands.length;
      if (queueEditing && (queueEditing.sessionId !== sessionId || !queue.some(item => item.id === queueEditing.id))) queueEditing = null;
      const signature = queueSignature(sessionId, queue, pending, commands, queueEditing);
      if (!force && signature === queueRenderSignature) return;
      queueRenderSignature = signature; elements.queueDock.replaceChildren(); elements.queueDock.classList.toggle('hidden', total === 0);
      if (total === 0) return;
      // "Message" is what the runtime's own rows are; a held command is not one,
      // and the dock counts both, so a mixed dock says "items".
      const title = commands.length === 0
        ? (total === 1 ? '1 queued message' : total + ' queued messages')
        : (total === 1 ? '1 queued item' : total + ' queued items');
      const head = node('div', 'queue-head'); head.append(node('span', '', '≡'), node('span', 'queue-title', title)); elements.queueDock.append(head);
      for (const item of pending) {
        const row = node('div', 'queue-row pending');
        row.append(node('span', 'queue-preview', item.preview || 'Queued message'), node('span', 'queue-sending', 'Sending…'));
        elements.queueDock.append(row);
      }
      for (const item of queue) {
        const row = node('div', 'queue-row');
        if (queueEditing && queueEditing.id === item.id) {
          const editor = node('textarea', 'queue-editor'); editor.value = queueEditing.text; editor.rows = 1; editor.setAttribute('aria-label', 'Edit queued message');
          editor.addEventListener('input', () => {
            queueEditing = { sessionId, id: item.id, text: editor.value };
            queueRenderSignature = queueSignature(sessionId, queue, pending, commands, queueEditing);
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
      for (const item of commands) {
        const row = node('div', 'queue-row command');
        row.append(node('span', 'queue-preview', item.preview || item.text || 'Command'),
          node('span', 'queue-command-note', 'Runs when this task finishes'));
        const actions = node('div', 'queue-actions');
        const run = node('button', 'queue-action', 'Run now'); run.type = 'button';
        run.title = 'Run this command now instead of waiting for the task to finish';
        run.addEventListener('click', () => postQueuedCommandAction(sessionId, item.id, 'run'));
        const remove = node('button', 'queue-action', 'Delete'); remove.type = 'button';
        remove.title = 'Do not run this command';
        remove.addEventListener('click', () => postQueuedCommandAction(sessionId, item.id, 'remove'));
        actions.append(run, remove); row.append(actions);
        elements.queueDock.append(row);
      }
    }
    function featureButton(label, run) {
      const button = node('button', 'feature-action', label); button.type = 'button'; button.addEventListener('click', run); return button;
    }
    function reminderTime(value) {
      const date = new Date(value); return Number.isNaN(date.getTime()) ? string(value) : date.toLocaleString();
    }
    function renderTaskFeatures(current) {
      const goal = record(current.goal) || {}, value = record(goal.value), schedules = record(current.schedules) || {}, reminders = array(schedules.items);
      const available = value || goal.available || goal.loading || goal.error || schedules.available || schedules.loading || schedules.error || reminders.length;
      elements.taskFeatures.classList.toggle('hidden', current.phase !== 'ready' || !available);
      elements.taskFeaturesSummary.textContent = 'Goal & reminders' + (value ? ' · ' + value.phase : '') + (reminders.length ? ' · ' + reminders.length + ' reminders' : '');
      elements.goalPanel.replaceChildren(); elements.schedulePanel.replaceChildren();
      elements.goalPanel.append(node('div', 'feature-title', 'Goal'));
      if (value) {
        elements.goalPanel.append(node('div', 'feature-copy', string(value.objective)), node('div', 'feature-hint', value.phase + ' · ' + value.roundsStarted + '/' + value.maxGoalRounds + ' rounds' + (value.activation ? ' · continuation ' + value.activation : '')));
        if (value.blockedReason) elements.goalPanel.append(node('div', 'feature-copy', string(value.blockedReason.message)));
      } else elements.goalPanel.append(node('div', 'feature-hint', goal.loading ? 'Loading goal…' : 'No goal in this conversation.'));
      if (goal.error) elements.goalPanel.append(node('div', 'feature-hint', string(goal.error)));
      const actions = node('div', 'feature-actions');
      const goalAction = (label, action) => {
        const button = featureButton(label, () => vscode.postMessage({ type: 'goal-action', action, sessionId: current.sessionId, ...(value ? { id: value.id, revision: value.revision } : {}) }));
        button.disabled = !goal.available || goal.loading || goal.busy || Boolean(current.childReadOnlyReason); actions.append(button);
      };
      if (!value || value.phase === 'complete') goalAction('New goal', 'create');
      if (value) {
        goalAction('Edit', 'edit');
        if (value.phase !== 'complete') {
          if (value.phase === 'active' && value.activation === 'armed') goalAction('Pause', 'pause');
          else if (value.activation !== undefined || value.phase === 'paused' || value.phase === 'blocked') goalAction('Resume', 'resume');
          goalAction('Complete', 'complete');
        }
        goalAction('Clear', 'clear');
      }
      elements.goalPanel.append(actions);
      elements.schedulePanel.append(node('div', 'feature-title', 'Reminders'));
      if (schedules.error) elements.schedulePanel.append(node('div', 'feature-hint', string(schedules.error)));
      if (!reminders.length) elements.schedulePanel.append(node('div', 'feature-hint', schedules.loading ? 'Loading reminders…' : 'No reminders in this project.'));
      for (const reminder of reminders) {
        const row = node('div', 'reminder-row');
        row.append(node('div', 'feature-title', string(reminder.title)), node('div', 'feature-copy', string(reminder.prompt)), node('div', 'feature-hint', reminder.status + ' · ' + reminder.kind + ' · ' + (reminder.status === 'active' ? 'next ' : 'scheduled ') + reminderTime(reminder.scheduledAt)));
        if (reminder.lastDelivery) row.append(node('div', 'feature-hint', 'Last delivered ' + reminderTime(reminder.lastDelivery.deliveredAt)));
        row.append(featureButton('Delivery history', () => vscode.postMessage({ type: 'schedule-history', sessionId: reminder.sessionId, id: reminder.id }))); elements.schedulePanel.append(row);
      }
      const history = record(schedules.history);
      if (history) {
        const box = node('div', 'reminder-row'); box.append(node('div', 'feature-title', 'Delivery history'));
        if (history.retention) box.append(node('div', 'feature-hint', 'Retention: ' + history.retention.days + ' days · ' + history.retention.records + ' records'));
        for (const entry of array(history.records)) box.append(node('div', 'feature-copy', reminderTime(entry.scheduledAt) + ' → ' + reminderTime(entry.deliveredAt) + (entry.prompt ? '\\n' + entry.prompt : '')));
        if (history.earlierRecordsPruned || history.earlierRecordsUnavailable) box.append(node('div', 'feature-hint', 'Earlier delivery records are unavailable or were pruned.'));
        if (history.error) box.append(node('div', 'feature-hint', string(history.error)));
        if (history.loading) box.append(node('div', 'feature-hint', 'Loading history…'));
        else if (!array(history.records).length && !history.error) box.append(node('div', 'feature-hint', 'No deliveries yet.'));
        if (history.nextBefore && !history.loading) box.append(featureButton('Load earlier deliveries', () => vscode.postMessage({ type: 'schedule-history', sessionId: history.sessionId, id: history.id, before: history.nextBefore })));
        elements.schedulePanel.append(box);
      }
    }
    function liveJob(job) { return job.status === 'running' || job.status === 'stopping'; }
    function childTasks(current) {
      const rows = array(current && current.sessions);
      const descendants = new Set([current && current.sessionId]);
      // The host sends a parent-first forest. Remember only reachable children.
      return rows.filter(item => {
        if (!item.parentId || !descendants.has(item.parentId) || descendants.has(item.id)) return false;
        descendants.add(item.id); return true;
      });
    }
    function taskStatus(item) {
      if (item.subagent && item.subagent.mode === 'external') return { label: 'External task', kind: 'idle' };
      if (item.catalogOnly) return { label: 'Not opened', kind: 'idle' };
      const attention = item.attention || {};
      if (Number(attention.approvals) > 0) return { label: 'Needs approval', kind: 'waiting' };
      if (Number(attention.questions) > 0) return { label: 'Needs your answer', kind: 'waiting' };
      if (item.running === true) return { label: 'Running', kind: 'running' };
      if (item.activity && item.activity.status === 'completed') return { label: 'Completed', kind: 'completed' };
      return { label: 'Idle', kind: 'idle' };
    }
    function taskDuration(item) {
      const activity = item.activity;
      if (!activity || typeof activity.elapsedMs !== 'number') return '';
      let elapsed = activity.elapsedMs;
      if (typeof activity.activeSince === 'number') {
        const end = item.running === true ? Date.now() : Number(activity.activeThrough);
        if (Number.isFinite(end)) elapsed += Math.max(0, end - activity.activeSince);
      }
      const seconds = Math.max(0, Math.floor(elapsed / 1000));
      return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's';
    }
    function syncTaskDurations() {
      const byId = new Map(childTasks(state).map(item => [item.id, item]));
      for (const element of elements.taskList.querySelectorAll('[data-task-duration]')) {
        const item = byId.get(element.dataset.taskDuration);
        if (item) element.textContent = taskDuration(item);
      }
    }
    function renderTaskPanel(current) {
      if (taskTimer) { clearInterval(taskTimer); taskTimer = undefined; }
      const children = childTasks(current);
      const todos = array(current.todos);
      const workflows = array(current.workflows);
      // The Team view is null unless the agentTeam projection carries a
      // roster, a task board or a failure; an empty team renders no section.
      const team = record(current.team);
      const teamMembers = array(team && team.members);
      const teamTasks = array(team && team.tasks);
      const teamFailure = string(team && team.failure);
      // A member's durable phase only says whether the Team record is
      // established; it is not turn activity. Every member row — the Lead
      // included — addresses a Session, and the session list carries the live
      // running flag, which is the only source for a Running row.
      const runningById = new Map(array(current.sessions).map(item => [string(item && item.id), item && item.running === true]));
      // The Lead row names the open conversation. Keep it answerable even when
      // the visible list does not carry that row (an archived selection, or a
      // list snapshot still loading).
      const currentSessionId = string(current.sessionId);
      if (currentSessionId !== '' && !runningById.has(currentSessionId)) runningById.set(currentSessionId, current.running === true);
      const teamVisible = team !== undefined && (teamMembers.length > 0 || teamTasks.length > 0 || teamFailure !== '');
      const visible = current.phase === 'ready' && (children.length > 0 || todos.length > 0 || workflows.length > 0 || teamVisible);
      elements.taskPanel.classList.toggle('hidden', !visible);
      if (!visible) { elements.taskList.replaceChildren(); return; }
      const live = children.filter(item => item.running === true).length;
      const waiting = children.filter(item => taskStatus(item).kind === 'waiting').length;
      const completed = todos.filter(item => item.status === 'completed').length;
      const counts = [];
      if (children.length) counts.push(children.length + ' subagents' + (live ? ' · ' + live + ' running' : ''));
      if (teamVisible) {
        const runningMembers = teamMembers.filter(member => runningById.get(string(member && member.id)) === true).length;
        counts.push(teamMembers.length + ' team ' + (teamMembers.length === 1 ? 'member' : 'members')
          + (runningMembers ? ' · ' + runningMembers + ' running' : '')
          + (teamTasks.length ? ' · ' + teamTasks.filter(task => task.status === 'completed').length + '/' + teamTasks.length + ' tasks' : ''));
      }
      if (todos.length) counts.push(completed + '/' + todos.length + ' steps done');
      if (workflows.length) counts.push(workflows.length + ' workflows');
      const expanded = !collapsedTaskPanels.has(current.sessionId);
      elements.taskToggle.replaceChildren(node('span', 'task-toggle-title', 'Tasks'), node('span', 'task-toggle-count', counts.join(' · ')));
      elements.taskToggle.title = 'Tasks · ' + counts.join(' · ') + (waiting ? ' · ' + waiting + ' need you' : '');
      if (waiting) elements.taskToggle.append(node('span', 'task-attention', waiting + ' need you'));
      const chevron = node('span', 'task-chevron'); chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'; elements.taskToggle.append(chevron);
      elements.taskToggle.setAttribute('aria-expanded', String(expanded));
      elements.taskList.classList.toggle('hidden', !expanded);
      elements.taskList.replaceChildren();
      if (!expanded) return;
      if (children.length) {
        elements.taskList.append(node('div', 'task-section', 'Subagents'));
        const depths = new Map([[current.sessionId, -1]]);
        for (const item of children) {
          const depth = Math.min(8, (depths.get(item.parentId) ?? -1) + 1); depths.set(item.id, depth);
          const status = taskStatus(item);
          const external = item.subagent && item.subagent.mode === 'external';
          const label = string(item.subagent && item.subagent.label) || string(item.title, 'Subagent');
          const row = node('button', 'task-child'); row.type = 'button'; row.style.paddingLeft = (8 + depth * 12) + 'px';
          row.title = external ? label + ' · External task' : label + ' · ' + status.label + ' · Open conversation';
          row.setAttribute('aria-label', (external ? '' : 'Open subagent ') + label + ', ' + status.label);
          if (external) { row.setAttribute('aria-disabled', 'true'); row.tabIndex = -1; }
          row.dataset.sessionId = item.id;
          const glyph = node('span', 'task-glyph ' + status.kind); glyph.setAttribute('aria-hidden', 'true');
          glyph.innerHTML = status.kind === 'completed' ? '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" rx="3"/><path d="M9 10h.01M15 10h.01M9 14h6M12 3v3"/></svg>';
          const copy = node('span', 'task-copy'); copy.append(node('span', 'task-name', label));
          const meta = node('span', 'task-meta');
          meta.append(node('span', 'task-status ' + status.kind, status.label));
          if (item.activity && typeof item.activity.totalTokens === 'number') meta.append(node('span', '', formatTokens(item.activity.totalTokens) + ' tokens'));
          const duration = node('span', 'task-duration', taskDuration(item)); duration.dataset.taskDuration = item.id; meta.append(duration);
          copy.append(meta);
          const open = node('button', 'task-open'); open.type = 'button'; open.title = 'Open details beside this chat'; open.setAttribute('aria-label', 'Open subagent details beside this chat: ' + label); open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11v11M19 5 5 19"/></svg>';
          row.append(glyph, copy);
          const sessionId = item.id;
          if (!external) row.addEventListener('click', () => vscode.postMessage({ type: 'select-session', sessionId }));
          open.addEventListener('click', () => vscode.postMessage({ type: 'open-task-details', kind: 'subagent', sessionId }));
          const entry = node('div', 'task-entry'); entry.append(row); if (!external) entry.append(open); elements.taskList.append(entry);
        }
      }
      if (teamVisible) {
        elements.taskList.append(node('div', 'task-section', 'Team'));
        for (const member of teamMembers) {
          const phase = string(member && member.phase);
          const sessionRunning = runningById.get(string(member && member.id)) === true;
          // Durable lifecycle only decides the fallback label; a member is
          // Running only while its Session reports an active turn.
          const status = sessionRunning ? { label: 'Running', kind: 'running' }
            : phase === 'failed' ? { label: 'Failed', kind: 'waiting' }
              : phase === 'provisioning' ? { label: 'Provisioning', kind: 'idle' }
                : { label: 'Inactive', kind: 'idle' };
          const name = string(member && member.name) || string(member && member.id, 'Member');
          const role = string(member && member.role) === 'lead' ? 'Lead' : 'Teammate';
          const row = node('button', 'task-child'); row.type = 'button';
          row.title = name + ' · ' + role + ' · ' + status.label + ' · Open conversation';
          row.setAttribute('aria-label', 'Open teammate ' + name + ', ' + status.label);
          const glyph = node('span', 'task-glyph ' + status.kind); glyph.setAttribute('aria-hidden', 'true');
          glyph.innerHTML = status.kind === 'completed' ? '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" rx="3"/><path d="M9 10h.01M15 10h.01M9 14h6M12 3v3"/></svg>';
          const copy = node('span', 'task-copy'); copy.append(node('span', 'task-name', name));
          const meta = node('span', 'task-meta');
          meta.append(node('span', 'task-status ' + status.kind, status.label), node('span', '', role));
          copy.append(meta); row.append(glyph, copy);
          const sessionId = string(member && member.id);
          // A row without a session id cannot open a conversation; keeping it
          // inert is better than posting a select-session that cannot resolve.
          if (sessionId !== '') {
            row.dataset.sessionId = sessionId;
            row.addEventListener('click', () => vscode.postMessage({ type: 'select-session', sessionId }));
          } else {
            row.setAttribute('aria-disabled', 'true'); row.tabIndex = -1;
            row.title = name + ' · ' + role + ' · ' + status.label;
          }
          const entry = node('div', 'task-entry'); entry.append(row); elements.taskList.append(entry);
          if (string(member && member.error) !== '') elements.taskList.append(node('div', 'team-member-note', 'Error: ' + string(member && member.error)));
        }
        if (teamTasks.length) {
          elements.taskList.append(node('div', 'task-section', 'Shared tasks'));
          for (const task of teamTasks) {
            const status = string(task && task.status);
            const kind = status === 'completed' ? 'completed' : status === 'in_progress' ? 'running' : 'idle';
            const symbol = status === 'completed' ? '✓' : status === 'in_progress' ? '●' : '○';
            const row = node('div', 'team-task');
            const head = node('div', 'team-task-head');
            head.append(node('span', 'task-status ' + kind, symbol), node('span', 'team-task-subject', string(task && task.subject, 'Task')));
            row.append(head);
            const notes = [status === 'in_progress' ? 'In progress' : status === 'completed' ? 'Completed' : task && task.blocked === true ? 'Blocked' : task && task.ready === true ? 'Ready' : 'Pending'];
            if (string(task && task.ownerName) !== '') notes.push('Owner: ' + string(task && task.ownerName));
            const blockedBy = array(task && task.blockedBy).filter(id => typeof id === 'string' && id !== '');
            if (blockedBy.length) notes.push((task && task.blocked === true ? 'Blocked by ' : 'After ') + blockedBy.join(', '));
            const scopes = array(task && task.writeScopes).filter(scope => typeof scope === 'string' && scope !== '');
            if (scopes.length) notes.push('Writes: ' + scopes.join(', '));
            row.append(node('div', 'team-task-note', notes.join(' · ')));
            for (const warning of array(task && task.writeScopeWarnings)) {
              if (typeof warning === 'string' && warning !== '') row.append(node('div', 'team-task-note', 'Warning: ' + warning));
            }
            if (string(task && task.description) !== '') row.title = string(task && task.description);
            elements.taskList.append(row);
          }
        }
        if (teamFailure !== '') elements.taskList.append(node('div', 'feature-hint', 'Team: ' + teamFailure));
      }
      if (todos.length) {
        elements.taskList.append(node('div', 'task-section', 'Plan steps'));
        for (const item of todos) {
          const row = node('div', 'task-todo ' + item.status);
          const symbol = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○';
          row.append(node('span', 'task-status', symbol), node('span', '', string(item.content)));
          row.title = item.status === 'in_progress' ? 'In progress' : item.status === 'completed' ? 'Completed' : 'Pending';
          elements.taskList.append(row);
        }
      }
      for (const run of workflows) {
        const section = node('div', 'workflow-run');
        section.append(node('div', 'feature-title', string(run.name, 'Workflow') + ' · ' + string(run.stopReason, run.partial ? 'Partial history' : 'Running')));
        if (run.partial) section.append(node('div', 'feature-hint', 'Earlier workflow records are outside the loaded history.'));
        const phases = new Map();
        for (const member of array(run.members)) {
          const phase = string(member.phase, 'Members');
          if (!phases.has(phase)) phases.set(phase, []);
          phases.get(phase).push(member);
        }
        for (const [phase, members] of phases) {
          section.append(node('div', 'task-section', phase));
          for (const member of members) {
            const button = node('button', 'workflow-member', string(member.label, 'Subagent') + ' · ' + string(member.outcome, run.stopReason ? 'No recorded outcome' : run.partial ? 'Unknown' : 'Running')); button.type = 'button';
            button.addEventListener('click', () => vscode.postMessage({ type: 'open-task-details', kind: 'subagent', sessionId: member.childId })); section.append(button);
          }
        }
        section.append(featureButton('View workflow output', () => { jobScope = 'project'; openJobsMenu(); }));
        section.append(node('div', 'feature-hint', 'Choose the workflow background task for live phases and logs.'));
        elements.taskList.append(section);
      }
      if (children.some(item => item.running === true && item.activity && typeof item.activity.activeSince === 'number')) taskTimer = setInterval(syncTaskDurations, 1000);
    }
    function jobDuration(job) {
      const end = jobLive(job) ? Date.now() : (Number(job.finishedAt) || Number(job.startedAt));
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
    /** The per-row key: jobs are addressed by their owning Session and id. */
    function jobKeyOf(job) {
      return (string(job && job.sessionId) || string(state && state.sessionId)) + ':' + string(job && job.id);
    }
    function jobOwnerOf(job) {
      return string(job && job.sessionId) || string(state && state.sessionId);
    }
    /** Retained output bytes for a job, from the roster field DSH projects. */
    function jobOutputTotal(job) {
      const total = Number(job && job.outputTotal);
      if (Number.isFinite(total) && total >= 0) return total;
      const output = record(job && job.output);
      const nested = Number(output && output.total);
      return Number.isFinite(nested) && nested >= 0 ? nested : 0;
    }
    function jobStatusOf(job) {
      return string(jobStatusOverrides.get(jobKeyOf(job))) || string(job && job.status);
    }
    function jobStatusLabel(job) {
      const status = jobStatusOf(job);
      // DSH calls a killed job "cancelled": it ended on request, not by itself.
      return status === 'killed' ? 'cancelled' : status === '' ? 'unknown' : status;
    }
    /** Live progress while running, the terminal reason once settled, else the status. */
    function jobDetailOf(job) {
      const progress = string(job && job.progress);
      if (progress !== '') return progress;
      const detail = string(job && job.detail);
      return detail !== '' ? detail : jobStatusLabel(job);
    }
    function jobLive(job) {
      const status = jobStatusOf(job);
      return status === 'running' || status === 'stopping';
    }
    /** DSH exposes output for a live job or a settled one that retained output. */
    function observableJob(job) { return jobLive(job) || jobOutputTotal(job) > 0; }
    function jobOutputBytes(text) {
      try { return new TextEncoder().encode(text).length; } catch { return text.length; }
    }
    const JOB_OUTPUT_MAX_CHUNKS = 512;
    const JOB_OUTPUT_MAX_BYTES = 256 * 1024;
    /**
     * Defence-in-depth cap on resident terminal buffers. One panel is open at a
     * time, so this is a backstop against future call sites that retain rows:
     * the oldest view that is not the expanded one is dropped with its output.
     */
    const JOB_OUTPUT_VIEW_LIMIT = 8;
    function pruneJobOutputViews() {
      while (jobOutputViews.size > JOB_OUTPUT_VIEW_LIMIT) {
        let oldest;
        for (const candidate of jobOutputViews.keys()) {
          if (candidate !== expandedJobKey) { oldest = candidate; break; }
        }
        if (oldest === undefined) break;
        jobOutputViews.delete(oldest);
      }
    }
    function clearJobKillPhase() {
      if (jobKillTimer !== undefined) { clearTimeout(jobKillTimer); jobKillTimer = undefined; }
      jobKillPhase = undefined;
    }
    function setJobKillPhase(phase, timeoutMs) {
      clearJobKillPhase();
      jobKillPhase = phase;
      if (timeoutMs !== undefined) {
        jobKillTimer = setTimeout(() => { jobKillTimer = undefined; jobKillPhase = undefined; renderJobs(); }, timeoutMs);
      }
    }
    /**
     * DSH's two-press stop: the first press arms for three seconds, the second
     * sends the kill. A rejected kill shows inline instead of a native modal.
     */
    function pressJobStop(job) {
      const key = string(job && job.id);
      const current = jobKillPhase;
      if (current !== undefined && current.key === key && current.state === 'armed') {
        setJobKillPhase({ key, state: 'pending' });
        vscode.postMessage({ type: 'kill-job', sessionId: jobOwnerOf(job), jobId: key });
      } else {
        setJobKillPhase({ key, state: 'armed' }, 3000);
      }
      renderJobs();
    }
    /** Close the open inline output stream and release its buffered terminal output. */
    function collapseJobOutput() {
      const key = expandedJobKey;
      if (key === undefined) return;
      const view = jobOutputViews.get(key);
      if (view !== undefined) {
        vscode.postMessage({ type: 'job-output-close', sessionId: view.sessionId, jobId: view.jobId });
        // This tree is the only copy of the received output: never keep it
        // after the row collapses, the menu closes, or the session changes.
        jobOutputViews.delete(key);
      }
      expandedJobKey = undefined;
    }
    function toggleJobOutput(job) {
      const key = jobKeyOf(job);
      if (expandedJobKey === key) {
        collapseJobOutput();
        if (jobsOpen) renderJobs();
        return;
      }
      collapseJobOutput();
      expandedJobKey = key;
      let view = jobOutputViews.get(key);
      if (view === undefined) {
        view = { sessionId: jobOwnerOf(job), jobId: string(job && job.id), chunks: [], bytes: 0, next: undefined, gap: false, lossy: false, error: '' };
        jobOutputViews.set(key, view);
        pruneJobOutputViews();
      }
      // A resume cursor only exists after this view has received output. A
      // fresh view (always the case after a collapse) opens without one; never
      // send from: NaN.
      const next = view.next;
      const from = typeof next === 'number' && Number.isFinite(next) && next >= 0 ? next : undefined;
      vscode.postMessage({ type: 'job-output-open', sessionId: view.sessionId, jobId: view.jobId, ...(from === undefined ? {} : { from }) });
      if (jobsOpen) renderJobs();
    }
    function resetJobTransients() {
      clearJobKillPhase();
      collapseJobOutput();
      // Whatever collapse did not own (defensive) must not outlive the session.
      jobOutputViews.clear();
      jobStatusOverrides.clear();
      settledJobsOpen = undefined;
      clearedJobIds.clear();
    }
    function openJobsMenu() {
      jobsOpen = true;
      elements.jobsMenu.classList.remove('hidden');
      elements.jobsTrigger.setAttribute('aria-expanded', 'true');
      renderJobs();
    }
    function closeJobsMenu(focusTrigger) {
      jobsOpen = false;
      elements.jobsMenu.classList.add('hidden');
      elements.jobsTrigger.setAttribute('aria-expanded', 'false');
      clearJobKillPhase();
      collapseJobOutput();
      if (focusTrigger) elements.jobsTrigger.focus();
    }
    function appendJobOutputChunks(view, data) {
      for (const value of array(data.chunks)) {
        const chunk = record(value);
        if (chunk === undefined || typeof chunk.text !== 'string' || chunk.text === '') continue;
        const channel = chunk.channel === 'stderr' || chunk.channel === 'log' ? chunk.channel : 'stdout';
        view.chunks.push({ text: chunk.text, channel, gapBefore: chunk.gapBefore === true });
        view.bytes += jobOutputBytes(chunk.text);
      }
      const next = Number(data.next);
      if (Number.isFinite(next) && next >= 0) view.next = next;
      if (data.lossy === true) view.lossy = view.gap = true;
      // The panel is a tail, not a log viewer: keep it bounded like DSH does.
      while (view.chunks.length > JOB_OUTPUT_MAX_CHUNKS || view.bytes > JOB_OUTPUT_MAX_BYTES) {
        const dropped = view.chunks.shift();
        if (dropped === undefined) break;
        view.bytes = Math.max(0, view.bytes - jobOutputBytes(dropped.text));
        view.gap = true;
      }
    }
    function receiveJobOutput(data) {
      const key = string(data.sessionId) + ':' + string(data.jobId);
      const view = jobOutputViews.get(key);
      if (view === undefined) return;
      appendJobOutputChunks(view, data);
      if (jobsOpen && expandedJobKey === key) renderJobs();
    }
    function receiveJobOutputStatus(data) {
      const jobId = string(data.jobId);
      const status = string(data.status);
      if (jobId === '' || status === '') return;
      jobStatusOverrides.set(string(data.sessionId) + ':' + jobId, status);
      if (jobKillPhase !== undefined && jobKillPhase.key === jobId && status !== 'running') clearJobKillPhase();
      const view = jobOutputViews.get(string(data.sessionId) + ':' + jobId);
      if (view !== undefined) view.status = status;
      if (jobsOpen) renderJobs();
    }
    function receiveJobOutputError(data) {
      const key = string(data.sessionId) + ':' + string(data.jobId);
      const view = jobOutputViews.get(key);
      if (view === undefined) return;
      view.error = string(data.error);
      if (jobsOpen && expandedJobKey === key) renderJobs();
    }
    function receiveJobKillResult(data) {
      const phase = jobKillPhase;
      if (phase === undefined || phase.key !== string(data.jobId)) return;
      // An accepted kill stays pending until the roster stops reporting running;
      // a rejected one shows inline for four seconds, then the button resets.
      if (data.ok === true) return;
      setJobKillPhase({ key: phase.key, state: 'failed', detail: string(data.error).slice(0, 160) }, 4000);
      if (jobsOpen) renderJobs();
    }
    function jobOutputPanel(job, key) {
      const view = jobOutputViews.get(key);
      const panel = node('div', 'job-output');
      const gap = view !== undefined && (view.gap === true || view.lossy === true
        || (view.chunks.length > 0 && view.chunks[0].gapBefore === true));
      if (gap) panel.append(node('div', 'job-output-notice', '… earlier output dropped …'));
      if (view !== undefined && string(view.error) !== '') {
        panel.append(node('div', 'job-output-notice error', 'live output stream interrupted: ' + string(view.error)));
      }
      const pre = node('pre', 'job-output-pre');
      if (view === undefined || view.chunks.length === 0) pre.append(node('span', 'job-output-empty', '(no output)'));
      else for (const chunk of view.chunks) {
        if (chunk.channel === 'stdout') pre.append(document.createTextNode(chunk.text));
        else pre.append(node('span', chunk.channel, chunk.text));
      }
      panel.append(pre);
      const actions = node('div', 'job-output-actions');
      // DSH copies the command line, not the output: the output can be a tail.
      const copy = node('button', 'feature-action', 'Copy command');
      copy.type = 'button'; copy.title = 'Copy the command line';
      copy.addEventListener('click', event => {
        event.stopPropagation();
        vscode.postMessage({ type: 'copy-text', text: string(job && job.label) });
        copy.textContent = 'Copied';
        setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copy command'; }, 1500);
      });
      const collapse = node('button', 'feature-action', 'Collapse');
      collapse.type = 'button';
      collapse.addEventListener('click', event => { event.stopPropagation(); collapseJobOutput(); if (jobsOpen) renderJobs(); });
      actions.append(copy, collapse);
      panel.append(actions);
      return panel;
    }
    function jobItem(job) {
      const key = jobKeyOf(job);
      const status = jobStatusOf(job);
      const live = jobLive(job);
      const observable = observableJob(job);
      const expanded = expandedJobKey === key;
      const item = node('div', 'job-item');
      const row = node('div', 'job-row');
      if (observable) {
        const chevron = node('button', 'job-chevron' + (expanded ? ' expanded' : ''), '▸');
        chevron.type = 'button';
        chevron.setAttribute('aria-expanded', String(expanded));
        chevron.setAttribute('aria-label', (expanded ? 'Hide live output of ' : 'Show live output of ') + string(job && job.label, 'background job'));
        chevron.addEventListener('click', event => { event.stopPropagation(); toggleJobOutput(job); });
        row.append(chevron);
      } else {
        const spacer = node('span', 'job-chevron empty');
        spacer.setAttribute('aria-hidden', 'true');
        row.append(spacer);
      }
      row.append(node('span', 'job-kind', string(job && job.kind, 'job')));
      const main = node('div', 'job-main');
      const label = node('span', 'job-label', string(job && job.label, 'Background job'));
      label.title = string(job && job.label, 'Background job');
      main.append(label, node('span', 'job-detail', jobDetailOf(job)));
      row.append(main);
      const duration = jobDuration(job);
      const durationCell = node('span', 'job-duration', duration);
      durationCell.title = (live ? 'Running for ' : 'Took ') + duration;
      row.append(durationCell);
      const owner = string(job && job.sessionTitle);
      if (owner !== '') row.title = owner;
      if (status === 'running') {
        const phase = jobKillPhase !== undefined && jobKillPhase.key === string(job && job.id) ? jobKillPhase : undefined;
        const phaseState = phase === undefined ? 'idle' : phase.state;
        const text = phaseState === 'armed' ? 'Confirm' : phaseState === 'failed' ? 'Stop failed' : 'Stop';
        const stop = node('button', 'job-stop' + (phaseState === 'armed' ? ' armed' : '') + (phaseState === 'failed' ? ' failed' : ''), text);
        stop.type = 'button';
        stop.disabled = phaseState === 'pending';
        stop.title = phaseState === 'armed' ? 'Click again to confirm'
          : phaseState === 'failed' ? 'Stop failed' + (phase !== undefined && string(phase.detail) !== '' ? ': ' + string(phase.detail) : '')
          : phaseState === 'pending' ? 'Stopping…' : 'Stop task ' + string(job && job.label, 'background job');
        stop.setAttribute('aria-label', stop.title);
        stop.addEventListener('click', event => { event.stopPropagation(); pressJobStop(job); });
        row.append(stop);
      }
      item.append(row);
      if (expanded) item.append(jobOutputPanel(job, key));
      return item;
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
      const projectJobs = array(state && state.projectJobs);
      const jobSource = jobScope === 'project' && state && Array.isArray(state.projectJobs) ? state.projectJobs : array(state && state.jobs);
      if (jobSource !== renderedJobsSource) {
        // A new roster is authoritative: the stream patches were interim.
        renderedJobsSource = jobSource;
        jobStatusOverrides.clear();
      }
      const jobs = array(jobSource);
      if (jobKillPhase !== undefined) {
        const target = jobs.find(job => string(job && job.id) === jobKillPhase.key);
        if (target === undefined || jobStatusOf(target) !== 'running') clearJobKillPhase();
      }
      if (!jobsOpen) { clearJobKillPhase(); collapseJobOutput(); }
      if (expandedJobKey !== undefined) {
        const active = jobs.find(job => jobKeyOf(job) === expandedJobKey);
        if (active === undefined || !observableJob(active)) collapseJobOutput();
      }
      const liveJobs = jobs.filter(jobLive).sort((left, right) => (Number(left.startedAt) || 0) - (Number(right.startedAt) || 0));
      const settledJobs = jobs.filter(job => !jobLive(job) && !clearedJobIds.has(string(job && job.id))).sort((left, right) => {
        const finished = (Number(right.finishedAt) || Number(right.startedAt) || 0) - (Number(left.finishedAt) || Number(left.startedAt) || 0);
        return finished !== 0 ? finished : (Number(left.startedAt) || 0) - (Number(right.startedAt) || 0);
      });
      // Rows the user cleared are gone from the menu, so they must not keep the
      // trigger visible or its counter high (VERIFY-JOBS B3).
      const visibleCount = liveJobs.length + settledJobs.length;
      const visibleProjectCount = projectJobs.filter(job => jobLive(job) || !clearedJobIds.has(string(job && job.id))).length;
      elements.jobsControl.classList.toggle('hidden', (!state || state.phase !== 'ready')
        || (visibleCount === 0 && visibleProjectCount === 0 && !state.jobsStatus));
      elements.jobsTrigger.classList.toggle('live', liveJobs.length > 0);
      const count = liveJobs.length > 0 ? liveJobs.length : visibleCount;
      elements.jobsCount.textContent = String(count);
      const noun = value => value === 1 ? 'background job' : 'background jobs';
      elements.jobsTrigger.title = liveJobs.length > 0
        ? liveJobs.length + ' ' + noun(liveJobs.length) + ' running'
        : count + ' ' + noun(count);
      elements.jobsTrigger.setAttribute('aria-label', elements.jobsTrigger.title);
      elements.jobsMenu.setAttribute('aria-label', 'Background jobs');
      elements.jobsMenu.replaceChildren();
      const actions = node('div', 'feature-actions');
      for (const [scope, label] of [['project', 'Project'], ['session', 'This chat']]) {
        const button = node('button', 'feature-action', label); button.type = 'button'; button.disabled = jobScope === scope;
        button.addEventListener('click', event => { event.stopPropagation(); jobScope = scope; clearJobKillPhase(); collapseJobOutput(); renderJobs(); });
        actions.append(button);
      }
      const refresh = node('button', 'feature-action', 'Refresh'); refresh.type = 'button';
      refresh.addEventListener('click', event => { event.stopPropagation(); vscode.postMessage({ type: 'refresh-tasks' }); });
      actions.append(refresh);
      elements.jobsMenu.append(actions);
      if (state && state.jobsStatus) elements.jobsMenu.append(node('div', 'session-empty', state.jobsStatus));
      if (liveJobs.length === 0 && settledJobs.length === 0) {
        elements.jobsMenu.append(node('div', 'session-empty', 'No background tasks in this scope'));
      }
      if (liveJobs.length > 0) {
        elements.jobsMenu.append(node('div', 'jobs-section', 'Running'));
        for (const job of liveJobs) elements.jobsMenu.append(jobItem(job));
      }
      if (settledJobs.length > 0) {
        const open = settledJobsOpen === undefined ? liveJobs.length === 0 : settledJobsOpen;
        const header = node('div', 'jobs-section');
        const toggle = node('button', 'jobs-section-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', 'Finished ' + String(settledJobs.length));
        const chevron = node('span', 'jobs-section-chevron' + (open ? ' open' : ''), '▸');
        chevron.setAttribute('aria-hidden', 'true');
        toggle.append(chevron, document.createTextNode('Finished ' + String(settledJobs.length)));
        toggle.addEventListener('click', event => { event.stopPropagation(); settledJobsOpen = !open; renderJobs(); });
        const clear = node('button', 'jobs-clear', 'Clear');
        clear.type = 'button';
        clear.title = 'Clear finished background jobs';
        clear.addEventListener('click', event => {
          event.stopPropagation();
          const clearing = new Set(settledJobs.map(job => jobKeyOf(job)));
          for (const job of settledJobs) clearedJobIds.add(string(job && job.id));
          // A running row's panel is unrelated to this Clear; only close when
          // the expanded row itself is one of the settled rows being cleared.
          if (expandedJobKey !== undefined && clearing.has(expandedJobKey)) collapseJobOutput();
          renderJobs();
        });
        header.append(toggle, clear);
        elements.jobsMenu.append(header);
        if (open) for (const job of settledJobs) elements.jobsMenu.append(jobItem(job));
      }
      if (jobsTimer !== undefined) { clearInterval(jobsTimer); jobsTimer = undefined; }
      if (jobsOpen && liveJobs.length > 0) jobsTimer = setInterval(renderJobs, 1000);
    }
    function renderConversation(current) {
      if (renderedSessionId !== current.sessionId) {
        if (renderedSessionId) sessionDrafts.set(renderedSessionId, elements.prompt.value);
        renderedSessionId = current.sessionId; renderedMessages.clear(); thinkingTiming.clear(); syncThinkingTicker(); elements.messages.replaceChildren();
        // Translation controllers belong to the conversation that requested
        // them; a switch (or a rebuilt list) must not answer into old nodes.
        cotReset();
        closeContextMenu(false); contextCandidates = []; contextRequestId++;
        ideContext = ideContextBySession.get(current.sessionId) || { pinned: [] }; renderIdeContext();
        if (current.sessionId) vscode.postMessage({ type: 'request-ide-context', sessionId: current.sessionId });
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
      // Ownership decides which recovery actions are legal (Restart is only
      // offered for a runtime this window started), so it belongs in the key: a
      // reconnect can change it without changing phase, status text or setup.
      const ownership = current.runtimeConnection && typeof current.runtimeConnection === 'object' ? current.runtimeConnection.ownership : undefined;
      const statusKey = current.phase + '::' + current.statusText + '::' + current.setup + '::' + current.canReconnect + '::' + String(ownership);
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
        // The bodies are gone with the messages, so nothing may keep translating.
        cotReset();
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
        if (sessionAction && sessionAction.kind === 'changes') closeSessionActions(false);
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
      const liveKey = current.running === true ? current.sessionId + '::' + String(current.stopping === true) + '::' + String(current.cancelRequested === true) : '';
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
    /**
     * Render one state, reporting instead of throwing.
     *
     * Every entry point (the scheduled frame and the direct redraws from user
     * actions) goes through here, so one broken node cannot abort an event
     * handler and leave the view half-updated with no record.
     */
    function render(current, context) {
      try { renderNow(current); }
      catch (error) { reportRenderFailure(error, context); }
    }
    function renderNow(current) {
      elements.runtimeIndicator.dataset.phase = current.phase;
      const connection = current.runtimeConnection;
      const shared = connection && connection.ownership === 'adopted';
      const external = connection && (connection.ownership === 'external' || connection.ownership === 'attached');
      const connected = connection || current.phase === 'ready';
      const runtimeLabel = current.phase === 'ready' ? (shared ? 'Shared DSH connected' : external ? 'External DSH connected' : 'Runtime connected')
        : current.phase === 'error' ? 'Runtime connection failed' : current.phase === 'loading' ? (current.statusText || 'Connecting to DSH…') : 'Runtime disconnected';
      elements.runtimeIndicator.title = runtimeLabel; elements.runtimeIndicator.setAttribute('aria-label', runtimeLabel);
      elements.runtimeConnectionLabel.textContent = current.phase === 'loading' ? (connected ? 'Loading' : 'Connecting')
        : current.phase === 'error' ? 'Retry' : current.phase === 'idle' ? 'Connect' : shared ? 'Shared' : external ? 'External' : 'DSH';
      const identity = connection && Number.isSafeInteger(connection.pid) && connection.pid > 0 ? ' · PID ' + connection.pid : '';
      const action = current.setup === 'runtime-auth' ? 'Connect to the existing runtime using its launch URL'
        : current.phase === 'ready' ? 'Reconnect this window' : current.phase === 'loading' ? 'See the current stage or Show Output below' : 'Connect to DSH; reuse a compatible saved runtime';
      elements.runtimeConnection.title = runtimeLabel + identity + '. ' + action;
      elements.runtimeConnection.setAttribute('aria-label', elements.runtimeConnection.title);
      elements.runtimeConnection.disabled = current.phase === 'loading' || current.setup === 'workspace';
      const preservingHistory = historyAnchor && historyAnchor.sessionId === current.sessionId;
      state = current;
      // A different conversation starts with a clean stop/output state; the
      // roster itself is reconciled by renderJobs below.
      const jobSessionChanged = renderedChrome.sessionId !== undefined && renderedChrome.sessionId !== current.sessionId;
      // A disconnect (any non-ready phase after ready) drops every buffered
      // terminal view instead of leaving it resident across a reconnect.
      const jobRuntimeLost = current.phase !== 'ready' && renderedChrome.phase === 'ready';
      if (jobSessionChanged || jobRuntimeLost) resetJobTransients();
      const createdConversation = reconcileConversationCreation(current);
      if (renderedChrome.workspaceName !== current.workspaceName || renderedChrome.cwd !== current.cwd) {
        elements.workspace.textContent = current.workspaceName || 'Workspace'; elements.project.title = current.cwd ? 'DeepSeek project: ' + current.cwd : 'Choose DeepSeek project';
      }
      if (renderedChrome.sessions !== current.sessions || renderedChrome.archivedSessions !== current.archivedSessions || renderedChrome.pinnedSessionIds !== current.pinnedSessionIds || renderedChrome.historySearch !== current.historySearch || renderedChrome.sessionId !== current.sessionId || renderedChrome.phase !== current.phase || renderedChrome.cwd !== current.cwd || renderedChrome.creatingConversation !== Boolean(pendingConversationCreation)) renderSessionCenter(current);
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
      if (renderedChrome.jobs !== current.jobs || renderedChrome.projectJobs !== current.projectJobs || renderedChrome.jobsStatus !== current.jobsStatus || renderedChrome.phase !== current.phase || renderedChrome.sessionId !== current.sessionId) renderJobs();
      if (renderedChrome.sessions !== current.sessions || renderedChrome.todos !== current.todos || renderedChrome.team !== current.team
        || renderedChrome.sessionId !== current.sessionId || renderedChrome.phase !== current.phase || renderedChrome.workflows !== current.workflows) renderTaskPanel(current);
      if (renderedChrome.goal !== current.goal || renderedChrome.schedules !== current.schedules || renderedChrome.childReadOnlyReason !== current.childReadOnlyReason || renderedChrome.sessionId !== current.sessionId || renderedChrome.phase !== current.phase) renderTaskFeatures(current);
      if (renderedChrome.account !== current.account || renderedChrome.accountNotice !== current.accountNotice || renderedChrome.accountFailed !== current.accountFailed) renderAccount(current);
      if (renderedChrome.parentSessionId !== current.parentSessionId
        || renderedChrome.subagentOwnerTitle !== subagentOwnerTitle(current) || renderedChrome.sessions !== current.sessions || renderedChrome.childReadOnlyReason !== current.childReadOnlyReason) renderSubagentBar(current);
      renderRoutableNotice(current);
      renderHeldNotice(current);
      // The transcript is the most expensive subtree. Most patches (account,
      // usage, settings, jobs) cannot change it, so compare the references it
      // reads and skip the reconcile entirely when none changed. The runtime
      // ownership participates because the status slot shows its recovery actions.
      const conversationInputs = [
        current.sessionId, current.phase, current.statusText, current.setup, current.canReconnect,
        connection && connection.ownership,
        current.hasMoreHistory, current.loadingHistory,
        current.messages, current.messageMeta, current.messageFeedback, current.team, current.translation,
        current.queue, current.changedFiles, current.approval, current.question,
        current.running, current.stopping, current.cancelRequested,
      ];
      const previousInputs = renderedConversationInputs;
      if (previousInputs === undefined || previousInputs.length !== conversationInputs.length
        || conversationInputs.some((value, index) => value !== previousInputs[index])) {
        renderedConversationInputs = conversationInputs;
        renderConversation(current);
      }
      // The translator capability can arrive after the transcript was rendered:
      // an expanded body gains (or loses) its toolbar without a message reload.
      if (renderedChrome.translation !== current.translation) cotApplyCapability();
      syncSubagentToolLinks();
      const enabled = composerReady() && Boolean(current.sessionId);
      elements.prompt.disabled = !enabled; elements.attach.disabled = !enabled; elements.project.disabled = current.running === true || Boolean(pendingConversationCreation); elements.newSession.disabled = current.phase !== 'ready'; elements.policyTrigger.disabled = current.phase !== 'ready' || Boolean(pendingConversationCreation);
      if (!enabled) closeContextMenu(false);
      // The conversation list is the way out of a conversation that will not
      // open, so no phase may lock it: a conversation stuck in loading is
      // exactly when the user has to reach another one. It is disabled only when
      // there is nothing to switch to, and a click it does accept reports its own
      // failure rather than doing nothing. A pending new conversation does not
      // lock it either: a row click abandons that request locally.
      elements.sessionTrigger.disabled = array(current.sessions).length === 0 && array(current.archivedSessions).length === 0;
      elements.newSession.disabled ||= Boolean(pendingConversationCreation);
      // The picker answers a different question from the composer. When the
      // selected model is unavailable but another provider can route, disabling
      // the picker would leave the user with no way back: they cannot send and
      // cannot switch. So it follows "any provider", not "this one".
      const canPickModel = !pendingConversationCreation && current.phase === 'ready' && current.anyRoutable !== false && Boolean(current.sessionId);
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
      const requested = current.cancelRequested === true && current.running === true && !stopping;
      // Cancellation requires a ready conversation: the Host refuses a stop while
      // a conversation is opening or failed, and showing the control there only
      // offers a click with no visible effect.
      elements.cancel.classList.toggle('hidden', current.running !== true || current.phase !== 'ready');
      elements.cancel.classList.toggle('stopping', stopping);
      elements.cancel.classList.toggle('requested', requested);
      // A stopping turn refuses a second click while the acknowledgement is on
      // screen. Once that window elapsed the request is still pending, but the
      // Host accepts another idempotent cancel, so the button becomes usable and
      // says so instead of mimicking a hang.
      elements.cancel.disabled = stopping;
      elements.cancel.title = stopping ? 'Stopping…'
        : requested ? 'Stop requested; waiting for the current step to finish. Click again to retry.'
          : 'Stop';
      elements.cancel.setAttribute('aria-label', stopping ? 'Stopping…' : requested ? 'Stop requested; click to retry.' : 'Stop');
      elements.send.title = current.running ? 'Queue message (Enter) · Steer now (Cmd/Ctrl+Enter)' : 'Send (Enter)'; updateSend(); renderQueue(); renderNavigation(current);
      if (renderedChrome.commands !== current.commands || renderedChrome.skills !== current.skills || renderedChrome.permissions !== current.permissions) renderCommandMenu();
      renderedChrome = {
        creatingConversation: Boolean(pendingConversationCreation),
        workspaceName: current.workspaceName, cwd: current.cwd, sessions: current.sessions, sessionId: current.sessionId, models: current.models,
        agentPreset: current.agentPreset, permissions: current.permissions, plan: current.plan, running: current.running,
        account: current.account, accountNotice: current.accountNotice, accountFailed: current.accountFailed,
        parentSessionId: current.parentSessionId, subagentOwnerTitle: subagentOwnerTitle(current),
        goal: current.goal, schedules: current.schedules, workflows: current.workflows, projectJobs: current.projectJobs, jobsStatus: current.jobsStatus, historySearch: current.historySearch, archivedSessions: current.archivedSessions, pinnedSessionIds: current.pinnedSessionIds, childReadOnlyReason: current.childReadOnlyReason,
        phase: current.phase, usage: current.usage, jobs: current.jobs, todos: current.todos, team: current.team, commands: current.commands, skills: current.skills,
        translation: current.translation,
      };
      if (preservingHistory && current.loadingHistory !== true) {
        const anchor = historyAnchor; historyAnchor = undefined;
        anchor.restore();
      }
      conversationScroller.changed();
      if (createdConversation) { resizePrompt(); elements.prompt.focus(); }
    }
    function scheduleRender(current) {
      state = current; pendingRenderState = current;
      // Watching and switch feedback react to the state itself, not to the next
      // frame: a stalled delivery must be noticed even if no frame ever runs.
      syncResyncWatch();
      settlePendingSwitch();
      if (renderFrame !== undefined) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = undefined;
        const pending = pendingRenderState; pendingRenderState = undefined;
        if (pending) render(pending, 'scheduled frame');
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
      const active = array(current.sessions).find(item => item.id === current.sessionId);
      if (active && active.subagent && active.subagent.mode !== 'continuable') {
        elements.subagentBar.append(node('span', 'subagent-bar-label', 'Read-only · continue in the owning conversation'));
      }
      if (current.childReadOnlyReason && (!active || !active.subagent || active.subagent.mode === 'continuable')) {
        elements.subagentBar.append(node('span', 'subagent-bar-label', string(current.childReadOnlyReason)));
      }
    }
    function renderRoutableNotice(current) {
      const text = current.routableNotice;
      const show = current.phase === 'ready' && current.routable === false && typeof text === 'string' && text !== '';
      elements.routableNotice.textContent = show ? text : '';
      elements.routableNotice.classList.toggle('hidden', !show);
    }
    /**
     * Whether another DSH process owns this conversation.
     *
     * The history stays readable, so this is not an error state: the composer is
     * disabled and the banner offers the two things a user can actually do —
     * look again, or find out who holds it.
     */
    function conversationHeld(current) {
      return typeof current.occupancyNotice === 'string' && current.occupancyNotice !== '';
    }
    let heldNoticeText = null;
    function renderHeldNotice(current) {
      const text = typeof current.occupancyNotice === 'string' ? current.occupancyNotice : '';
      // Ownership is independent of the conversation phase: a held conversation
      // that failed to open still needs its recovery actions, and hiding them
      // here left only a runtime restart (which affects every shared window).
      const show = text !== '';
      elements.heldNotice.classList.toggle('hidden', !show);
      if (heldNoticeText === text) return;
      heldNoticeText = text;
      elements.heldNotice.replaceChildren();
      if (text === '') return;
      elements.heldNotice.append(node('span', 'held-notice-text', text));
      const retry = node('button', 'held-action', 'Check again');
      retry.type = 'button';
      retry.title = 'Ask the runtime again whether this conversation is still held';
      retry.addEventListener('click', () => vscode.postMessage({ type: 'retry-occupancy' }));
      const diagnose = node('button', 'held-action', 'Find the holder');
      diagnose.type = 'button';
      diagnose.title = 'Report which process holds this conversation';
      diagnose.addEventListener('click', () => vscode.postMessage({ type: 'diagnose-occupancy' }));
      elements.heldNotice.append(retry, diagnose);
    }
    /**
     * Whether the composer may submit at all. The button and Enter must agree:
     * an unroutable conversation disables typing, so it must also refuse to
     * send a draft that was typed before it became unroutable.
     */
    function composerReady() {
      const active = state && array(state.sessions).find(item => item.id === state.sessionId);
      const readOnly = Boolean(state && state.childReadOnlyReason) || active && active.subagent && active.subagent.mode !== 'continuable';
      return !homeOpen && !pendingConversationCreation && Boolean(state) && state.phase === 'ready' && state.routable !== false && !conversationHeld(state) && !readOnly;
    }
    function updateSend() {
      const pendingSend = state && [...pendingDraftSends.values()].some(draft => draft.sessionId === state.sessionId);
      const pendingAttachment = state && [...pendingAttachmentRequests.values()].some(request => request.sessionId === state.sessionId);
      const pendingUpload = state && (pendingUploadsBySession.get(state.sessionId) || 0) > 0;
      elements.send.disabled = !composerReady() || pendingSend || pendingAttachment || pendingUpload || [...pendingContextRequests.values()].some(sessionId => sessionId === state.sessionId)
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
      if ([...pendingDraftSends.values()].some(draft => draft.sessionId === sessionId)) return false;
      if ([...pendingAttachmentRequests.values()].some(request => request.sessionId === sessionId)) return false;
      if ([...pendingContextRequests.values()].some(origin => origin === sessionId)) return false;
      // Enter must honour the same gate the button uses, or a message can leave
      // before its file is staged and the file then rides the NEXT prompt.
      return (pendingUploadsBySession.get(sessionId) || 0) === 0;
    }
    function send(mode) {
      const text = elements.prompt.value.trim(); if (!text && !draftImages.length && !draftFiles.length) return false;
      if (!canSend()) return false;
      const sessionId = state.sessionId;
      const requestId = ++draftSendRequestId;
      pendingDraftSends.set(requestId, { sessionId, text, scrollVersion: conversationScroller.intentVersion });
      // Show it as queued from this keystroke, not from the runtime's answer.
      if ((mode || 'queue') === 'queue') {
        pendingQueueSends.set(requestId, { sessionId, text, preview: text.length > 200 ? text.slice(0, 200) + '…' : text });
        renderQueue(true);
      }
      vscode.postMessage({ type: 'send', sessionId, requestId, text, mode: mode || 'queue' }); elements.prompt.value = ''; sessionDrafts.set(sessionId, ''); commandIndex = 0; resetPrompt();
      return true;
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
      if (homeOpen || pendingConversationCreation) return;
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
      if (resources.length > 0) {
        const requestId = ++contextChangeId; pendingContextRequests.set(requestId, sessionId); updateSend();
        vscode.postMessage({ type: 'attach-resources', sessionId, requestId, uris: resources });
      }
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
      event.preventDefault(); if (homeOpen || pendingConversationCreation) return; dropDepth += 1; setDropActive(true);
    });
    document.addEventListener('dragover', event => {
      if (!dragCarriesPayload(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = homeOpen || pendingConversationCreation ? 'none' : 'copy';
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
    elements.prompt.addEventListener('input', () => { closeContextMenu(false); if (state && state.sessionId) sessionDrafts.set(state.sessionId, elements.prompt.value); policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); commandIndex = 0; mentionIndex = 0; elements.prompt.placeholder = 'Ask DeepSeek about this project'; resizePrompt(); renderCommandMenu(); requestMentions(); });
    elements.prompt.addEventListener('click', () => { closeContextMenu(false); policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); requestMentions(); });
    elements.prompt.addEventListener('paste', event => {
      const files = clipboardImageFiles(event);
      if (!files.length) return;
      event.preventDefault();
      if (!composerReady() || !state.sessionId) return;
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
    elements.send.addEventListener('click', () => send('queue')); elements.cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    elements.attach.addEventListener('click', () => {
      if (elements.attach.disabled) return;
      if (contextMenuOpen) { closeContextMenu(true); return; }
      closeModelMenu(false); policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false');
      elements.commandMenu.classList.add('hidden'); elements.mentionMenu.classList.add('hidden');
      contextMenuOpen = true; elements.contextSearch.value = ''; requestContextFiles(); elements.contextSearch.focus();
    });
    elements.contextSearch.addEventListener('input', requestContextFiles);
    elements.contextSearch.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        const first = elements.contextList.querySelector('.context-option');
        if (first) { event.preventDefault(); if (event.key === 'Enter') first.click(); else first.focus(); }
      }
    });
    elements.contextList.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const choices = [...elements.contextList.querySelectorAll('.context-option')]; if (!choices.length) return;
      event.preventDefault(); const index = choices.indexOf(document.activeElement); choices[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length].focus();
    });
    elements.contextDone.addEventListener('click', () => closeContextMenu(true));
    elements.contextImage.addEventListener('click', () => { closeContextMenu(true); vscode.postMessage({ type: 'attach' }); });
    elements.usageTrigger.addEventListener('click', event => {
      event.stopPropagation(); usageOpen = !usageOpen; policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); if (state) renderUsage(state);
    });
    elements.policyTrigger.addEventListener('click', event => {
      closeContextMenu(false);
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
      closeJobsMenu(false);
      if (state) renderAccount(state);
    });
    elements.jobsTrigger.addEventListener('click', event => {
      event.stopPropagation();
      if (jobsOpen) { closeJobsMenu(false); return; }
      accountOpen = false; elements.accountMenu.classList.add('hidden'); elements.accountTrigger.setAttribute('aria-expanded', 'false');
      openJobsMenu();
    });
    elements.taskToggle.addEventListener('click', () => {
      if (!state) return;
      if (collapsedTaskPanels.has(state.sessionId)) collapsedTaskPanels.delete(state.sessionId);
      else collapsedTaskPanels.add(state.sessionId);
      renderTaskPanel(state);
    });
    elements.refreshTasks.addEventListener('click', () => vscode.postMessage({ type: 'refresh-tasks' }));
    elements.configureTaskServices.addEventListener('click', () => vscode.postMessage({ type: 'configure-task-services' }));
    elements.project.addEventListener('click', () => vscode.postMessage({ type: 'choose-workspace' }));
    elements.runtimeConnection.addEventListener('click', () => vscode.postMessage({ type: state && state.setup === 'runtime-auth' ? 'connect-existing-runtime' : 'reconnect' }));
    elements.openSettings.addEventListener('click', () => { elements.openSettings.setAttribute('aria-busy', 'true'); vscode.postMessage({ type: 'open-settings' }); });
    elements.conversationHome.addEventListener('click', () => {
      if (pendingConversationCreation) return;
      if (homeOpen) { homeOpen = false; if (state) render(state); elements.prompt.focus(); }
      else openDirectory();
    });
    elements.viewAllSessions.addEventListener('click', openDirectory);
    elements.homeArchiveToggle.addEventListener('click', () => { homeArchived = !homeArchived; closeSessionActions(false); if (state) renderSessionCenter(state); });
    elements.sessionTrigger.addEventListener('click', event => {
      event.stopPropagation();
      if (sessionMenuOpen) { closeSessionMenu(false); return; }
      sessionMenuOpen = true; closeSessionActions(false); elements.sessionMenu.classList.remove('hidden'); elements.sessionTrigger.setAttribute('aria-expanded', 'true');
      renderSessionCenter(state || { sessions: [] }); requestAnimationFrame(() => elements.sessionSearch.focus());
    });
    function requestSessionSearch(input) {
      closeSessionActions(false); if (searchTimer !== undefined) clearTimeout(searchTimer);
      const query = input.value.trim();
      searchTimer = setTimeout(() => { searchTimer = undefined; vscode.postMessage({ type: 'search-history', query }); }, 250);
      if (state) renderSessionCenter(state);
    }
    elements.sessionSearch.addEventListener('input', () => requestSessionSearch(elements.sessionSearch));
    elements.homeSessionSearch.addEventListener('input', () => requestSessionSearch(elements.homeSessionSearch));
    for (const [list, search] of [[elements.sessionList, elements.sessionSearch], [elements.homeSessionList, elements.homeSessionSearch]]) {
      list.addEventListener('keydown', event => navigateSessionList(event, list, search));
      search.addEventListener('keydown', event => navigateSessionList(event, list, search));
      list.addEventListener('scroll', () => closeSessionActions(false));
    }
    elements.sessionActions.addEventListener('click', event => event.stopPropagation());
    elements.sessionActions.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSessionActions(true); return; }
      const items = [...elements.sessionActions.querySelectorAll('button:not(:disabled)')];
      if (items.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const index = items.indexOf(document.activeElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      }
    });
    window.addEventListener('resize', positionSessionActions);
    elements.sessionMenu.addEventListener('click', event => event.stopPropagation());
    elements.newSession.addEventListener('click', startNewConversation);
    elements.models.addEventListener('change', () => { applyModelSelection(elements.models.value); });
    elements.modelTrigger.addEventListener('click', event => {
      event.stopPropagation();
      if (modelMenuOpen) closeModelMenu(false); else openModelMenu();
    });
    elements.modelMenu.addEventListener('click', event => event.stopPropagation());
    elements.modelSearch.addEventListener('input', () => { modelIndex = 0; renderModelMenu(); });
    elements.modelSearch.addEventListener('keydown', event => {
      // A composing Enter commits an IME candidate, not the highlighted model:
      // without this guard, searching in a CJK or accented input method picked a
      // model the moment the user accepted a character.
      if (event.isComposing) return;
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
      if (sessionAction && !elements.sessionActions.contains(event.target) && !sessionAction.anchor.contains(event.target)) closeSessionActions(false);
      if (contextMenuOpen && !elements.contextMenu.contains(event.target) && !elements.attach.contains(event.target)) closeContextMenu(false);
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
      if (jobsOpen && !elements.jobsMenu.contains(event.target) && !elements.jobsTrigger.contains(event.target)) closeJobsMenu(false);
      if (sessionMenuOpen && !elements.sessionControl.contains(event.target) && !elements.sessionActions.contains(event.target)) closeSessionMenu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && sessionAction) {
        event.preventDefault(); closeSessionActions(true);
      } else if (event.key === 'Escape' && contextMenuOpen) {
        event.preventDefault(); closeContextMenu(true);
      } else if (event.key === 'Escape' && sessionMenuOpen) {
        event.preventDefault(); closeSessionMenu(true);
      } else if (event.key === 'Escape' && modelMenuOpen) {
        event.preventDefault(); closeModelMenu(true);
      } else if (event.key === 'Escape' && usageOpen) {
        usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false'); elements.usageTrigger.focus();
      } else if (event.key === 'Escape' && jobsOpen) {
        event.preventDefault(); closeJobsMenu(true);
      }
    });
    window.addEventListener('message', event => {
      if (event.data && event.data.type === 'open-subagent-result') for (const entry of subagentLinkViews.values()) entry.view.reply(event.data);
      if (!event.data) return;
      if (event.data.type === 'conversation-created' && pendingConversationCreation && event.data.requestId === pendingConversationCreation.requestId && event.data.cwd === pendingConversationCreation.cwd) {
        if (typeof event.data.sessionId === 'string' && !event.data.error) {
          pendingConversationCreation.sessionId = event.data.sessionId;
        } else {
          pendingConversationCreation = undefined; creationError(string(event.data.error, 'Could not open the new conversation. Your previous draft was retained.'));
        }
        if (state) render(state);
      }
      if (event.data.type === 'state') { pendingMessageAppends.clear(); lastStateAt = Date.now(); scheduleRender(event.data.state); }
      if (event.data.type === 'state-update') { lastStateAt = Date.now(); applyStateUpdate(event.data.update); }
      if (event.data.type === 'job-output') receiveJobOutput(event.data);
      if (event.data.type === 'job-output-status') receiveJobOutputStatus(event.data);
      if (event.data.type === 'job-output-error') receiveJobOutputError(event.data);
      if (event.data.type === 'job-kill-result') receiveJobKillResult(event.data);
      // The Host answers one reasoning translation per request id.
      if (event.data.type === 'translate-reasoning-result') cotAcceptResult(event.data);
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
        // Either answer ends the local queue row: the runtime took the message
        // (draft-sent) or handed it back (restore-draft). A message sent into an
        // idle conversation never sits in the queue long enough to be seen there
        // — it becomes its own turn at once, and the transcript is its record —
        // so a local row that waited for a projected row to reclaim it would say
        // "Sending…" for good, and a message already sent would still read as
        // queued. Only the projection's own rows describe a queue.
        if (pendingQueueSends.delete(event.data.requestId)) renderQueue(true);
        if (event.data.type === 'restore-draft') {
          // The runtime never took it, so the composer holds it again.
          const existing = sessionDrafts.get(pending.sessionId) || '';
          const restored = existing === '' || existing === pending.text ? pending.text : pending.text + '\\n' + existing;
          sessionDrafts.set(pending.sessionId, restored);
          if (state && state.sessionId === pending.sessionId) {
            elements.prompt.value = restored; resizePrompt(); requestMentions(); renderCommandMenu();
          }
        }
        updateSend();
      }
      if (event.data.type === 'ide-context') {
        const incoming = event.data.state || { pinned: [] };
        const sessionId = incoming.sessionId || (state && state.sessionId);
        const previousIds = new Set(array(ideContextBySession.get(sessionId)?.pinned).map(item => item.id));
        const explicitlyAdded = array(incoming.pinned).some(item => !previousIds.has(item.id));
        if (sessionId) ideContextBySession.set(sessionId, incoming);
        if (state && sessionId === state.sessionId) { ideContext = incoming; renderIdeContext(); }
        if (homeOpen && explicitlyAdded && state && sessionId === state.sessionId) { homeOpen = false; render(state); elements.prompt.focus(); }
      }
      if (event.data.type === 'context-files' && state && event.data.sessionId === state.sessionId && event.data.requestId === contextRequestId && event.data.query === elements.contextSearch.value) {
        contextCandidates = array(event.data.candidates); contextLoading = false; contextError = string(event.data.error); renderContextMenu();
      }
      if (event.data.type === 'context-updated' && pendingContextRequests.get(event.data.requestId) === event.data.sessionId) { pendingContextRequests.delete(event.data.requestId); updateSend(); }
      if (event.data.type === 'mention-suggestions' && event.data.requestId === mentionRequestId) {
        const mention = currentMentionQuery();
        if (mention && mention.query === event.data.query) { mentionCandidates = event.data.candidates || []; mentionIndex = 0; renderMentionMenu(); }
      }
      if (event.data.type === 'focus-prompt' && !pendingConversationCreation) { homeOpen = false; if (state) render(state); elements.prompt.focus(); }
      if (event.data.type === 'set-prompt' && typeof event.data.text === 'string') {
        homeOpen = false; if (state) render(state);
        elements.prompt.value = event.data.text; if (state && state.sessionId) sessionDrafts.set(state.sessionId, event.data.text); resizePrompt(); requestMentions(); renderCommandMenu(); elements.prompt.focus();
        const cursor = elements.prompt.value.length; elements.prompt.setSelectionRange(cursor, cursor);
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
}
