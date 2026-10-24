import { officialSettingsIcons } from './vendor/dsh-settings-icons.js'

/** Layout and measurements follow DSH 0.2.1-rc.2 SettingsRoot and ModelsSection. */
export function settingsIcon(name: string): string {
  const paths: Record<string, string> = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13.4 3M4.5 15a8 8 0 0 0 13.4 3"/>',
  }
  if (officialSettingsIcons[name]) return officialSettingsIcons[name]!
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.close}</svg>`
}

export function settingsShellHtml(): string {
  return `<section id="settingsRoot" class="dsh-settings" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1">
    <aside class="settings-nav"><h1 id="settingsTitle">Settings</h1><nav id="navigation" aria-label="Settings sections"></nav></aside>
    <div class="settings-content"><header class="settings-header"><div class="settings-header-actions"><button id="refresh" class="settings-icon" type="button" title="Refresh settings" aria-label="Refresh settings">${settingsIcon('refresh')}</button><button id="settingsClose" class="settings-icon" type="button" title="Close settings" aria-label="Close settings">${settingsIcon('close')}</button></div></header>
    <div id="banner" role="status"></div><main class="settings-options"><div id="content"><p class="empty">Loading settings…</p></div></main></div>
  </section>`
}

export const settingsPageCss = `
  .dsh-settings, .dsh-settings * { box-sizing: border-box; }
  .dsh-settings { --settings-fill: var(--vscode-editorWidget-background, var(--vscode-editor-background, #202020)); --settings-card: var(--vscode-input-background, transparent); position: relative; display: flex; width: 800px; max-width: calc(100vw - 48px); height: min(800px, calc(100vh - 48px)); min-height: 0; overflow: hidden; border: .5px solid var(--dsh-border); border-radius: 20px; background: var(--settings-fill); box-shadow: 0 12px 48px var(--vscode-widget-shadow, #0003); color: var(--vscode-foreground); font: 14px/22px var(--vscode-font-family, sans-serif); text-align: left; }
  .dsh-settings .settings-nav { flex: none; width: 188px; padding: 22px 12px 16px; display: flex; flex-direction: column; gap: 18px; min-height: 0; }
  .dsh-settings h1 { margin: 0; padding: 0 12px; font-size: 16px; font-weight: 500; line-height: 24px; }
  .dsh-settings #navigation { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; padding: 0; border: 0; }
  .dsh-settings #navigation button { height: 40px; min-height: 40px; width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 16px 9px 12px; border: 0; border-radius: 12px; font-size: 14px; line-height: 22px; text-align: left; background: transparent; color: inherit; }
  .dsh-settings #navigation button[aria-current] { background: color-mix(in srgb, var(--vscode-foreground) 8%, var(--settings-fill)); color: var(--vscode-foreground); }
  .dsh-settings svg path[fill="currentColor"] { stroke: none; }
  .dsh-settings .nav-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .dsh-settings .settings-content { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .dsh-settings .settings-header { display: flex; flex: none; align-items: flex-start; justify-content: flex-end; height: 54px; padding: 20px 14px 8px 10px; border: 0; }
  .dsh-settings .settings-header-actions { display: flex; align-items: center; gap: 8px; }
  .dsh-settings button.settings-icon { width: 28px; height: 28px; min-height: 28px; padding: 0; border: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--vscode-foreground); }
  .dsh-settings svg { width: 16px; height: 16px; flex: none; }
  .dsh-settings #banner { flex: none; margin: 0 24px 12px; max-height: 90px; overflow-y: auto; color: var(--dsh-warning); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
  .dsh-settings #banner:empty { display: none; }
  .dsh-settings .settings-options { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 0 24px 24px; }
  .dsh-settings #content { width: 100%; max-width: 720px; margin: 0; min-width: 0; }
  .dsh-settings h2 { margin: 0 0 12px; font-size: 16px; font-weight: 500; line-height: 24px; }
  .dsh-settings h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; line-height: 22px; }
  .dsh-settings p { margin: 0 0 12px; }
  .dsh-settings .hint { color: var(--dsh-muted); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
  .dsh-settings .card { padding: 16px; margin: 10px 0; border: .5px solid var(--dsh-border); border-radius: 16px; background: var(--settings-card); min-width: 0; }
  .dsh-settings .general-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: .5px solid var(--dsh-border); }
  .dsh-settings .general-row .hint { margin: 4px 0 0; }
  .dsh-settings .general-row > div { min-width: 0; }
  .dsh-settings .card.general-form { padding: 16px 0; border: 0; border-bottom: .5px solid var(--dsh-border); border-radius: 0; background: transparent; margin: 0; }
  .dsh-settings .general-form > h3 { display: none; }
  .dsh-settings .general-form .field { padding: 0; }
  .dsh-settings .field > .switch-row .choice-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .dsh-settings .field { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 6px 8px; padding: 8px 0; min-width: 0; }
  .dsh-settings .field-copy { grid-column: 1 / -1; min-width: 0; }
  .dsh-settings .field:has(> button:not([hidden])) .field-copy { grid-column: 1; }
  .dsh-settings .field-description { grid-column: 1 / -1; grid-row: 3; }
  .dsh-settings .key-status { margin: 0 0 12px; }
  .dsh-settings .field-name { font-size: 12px; font-weight: 500; line-height: 18px; }
  .dsh-settings .field .hint { display: block; margin-top: 4px; }
  .dsh-settings .field > input, .dsh-settings .field > select, .dsh-settings .field > textarea, .dsh-settings .field > .key-input { grid-column: 1 / -1; grid-row: 2; }
  .dsh-settings textarea { display: block; width: 100%; min-width: 0; min-height: 84px; padding: 8px 10px; border: .5px solid var(--vscode-input-border, var(--dsh-border)); border-radius: 12px; background: var(--vscode-input-background, var(--settings-fill)); color: inherit; font: 13px/20px var(--vscode-editor-font-family, monospace); resize: vertical; }
  .dsh-settings .field > button { grid-column: 2; grid-row: 1; }
  .dsh-settings .field:has(> .switch-row) { display: flex; }
  .dsh-settings .field:has(> .switch-row) .field-copy { flex: 1; }
  .dsh-settings button, .dsh-settings input, .dsh-settings select { color: inherit; font-family: inherit; }
  .dsh-settings button { font-size: 14px; line-height: 22px; min-height: 36px; padding: 0 14px; border: .5px solid var(--dsh-border); border-radius: 12px; background: transparent; cursor: pointer; }
  .dsh-settings button:hover:not(:disabled) { background: var(--dsh-hover); }
  .dsh-settings button:disabled { opacity: .4; cursor: default; }
  .dsh-settings input:not([type="checkbox"]), .dsh-settings select { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: .5px solid var(--vscode-input-border, var(--dsh-border)); border-radius: 12px; background: var(--vscode-input-background, var(--settings-fill)); font-size: 14px; line-height: 22px; }
  .dsh-settings .key-input { display: flex; align-items: center; min-width: 0; border: .5px solid var(--vscode-input-border, var(--dsh-border)); border-radius: 12px; background: var(--vscode-input-background, var(--settings-fill)); }
  .dsh-settings .key-input input { border: 0; background: transparent; flex: 1; }
  .dsh-settings .key-input button { min-height: 28px; width: 32px; padding: 0; flex: none; display: flex; align-items: center; justify-content: center; }
  .dsh-settings input[type="checkbox"] { accent-color: var(--dsh-accent); }
  .dsh-settings .check { display: flex; align-items: center; gap: 8px; min-height: 28px; font-size: 13px; }
  .dsh-settings .switch-row { flex-direction: row-reverse; justify-content: space-between; gap: 16px; }
  .dsh-settings .switch-row .choice-label { white-space: normal; overflow: visible; }
  .dsh-settings .switch-row input { appearance: none; position: relative; width: 32px; min-width: 32px; height: 20px; margin: 0; border: 0; border-radius: 20px; background: var(--vscode-checkbox-background, #8886); cursor: pointer; }
  .dsh-settings .switch-row input:after { content: ''; position: absolute; width: 16px; height: 16px; top: 2px; left: 2px; border-radius: 50%; background: var(--vscode-button-foreground, #fff); box-shadow: 0 1px 3px #0002; }
  .dsh-settings .switch-row input:checked { background: var(--vscode-foreground); }
  .dsh-settings .switch-row input:checked:after { transform: translateX(12px); background: var(--settings-fill); }
  .dsh-settings .switch-row input:disabled { cursor: default; opacity: .4; }
  .dsh-settings fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  .dsh-settings .actions { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
  .dsh-settings .actions .hint { margin-right: auto; }
  .dsh-settings .primary { background: var(--vscode-foreground); color: var(--settings-fill); border-color: transparent; }
  .dsh-settings .primary:hover:not(:disabled) { opacity: .85; background: var(--vscode-foreground); }
  .dsh-settings .quiet { min-height: 28px; padding: 0 8px; border-color: transparent; border-radius: 8px; color: var(--dsh-muted); font-size: 12px; line-height: 18px; }
  .dsh-settings .danger, .dsh-settings .error { color: var(--vscode-errorForeground, #f48771); }
  .dsh-settings .error { font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .dsh-settings .error:empty { display: none; } .dsh-settings .success { color: var(--dsh-success); font-size: 12px; }
  .dsh-settings .provider-shell { margin: 8px 0; border: .5px solid var(--dsh-border); border-radius: 20px; padding: 12px 14px; background: var(--settings-card); }
  .dsh-settings .provider { width: 100%; display: flex; align-items: center; gap: 10px; padding: 0; min-height: 28px; text-align: left; border: 0; border-radius: 8px; }
  .dsh-settings .provider-label { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dsh-settings .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--vscode-errorForeground, #f48771); }
  .dsh-settings .dot.active { background: var(--dsh-success); }
  .dsh-settings .provider-shell .card { background: transparent; border: 0; padding: 14px 0 0; margin: 0; }
  .dsh-settings .provider-shell .section-save { position: static; padding: 0; border: 0; background: transparent; }
  .dsh-settings .provider-shell > button.danger { min-height: 28px; margin-top: 8px; padding: 0; border: 0; font-size: 12px; }
  .dsh-settings .provider-add { display: flex; width: 100%; height: 44px; align-items: center; justify-content: center; gap: 6px; margin-top: 10px; border: 1px dashed var(--dsh-border); border-radius: 16px; }
  .dsh-settings .provider-add:before { content: '+'; font-size: 20px; font-weight: 300; }
  .dsh-settings .provider-customized { padding-top: 10px; border-top: .5px solid var(--dsh-border); }
  .dsh-settings .provider-customized > summary { cursor: pointer; color: var(--dsh-muted); font-size: 12px; line-height: 18px; margin-bottom: 10px; }
  .dsh-settings .model { border: .5px solid var(--dsh-border); border-radius: 16px; padding: 8px; margin-top: 8px; min-width: 0; }
  .dsh-settings .model-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
  .dsh-settings .model-grid label { min-width: 0; font-size: 12px; color: var(--dsh-muted); }
  .dsh-settings .model-grid input { margin-top: 4px; }
  .dsh-settings .model .actions { justify-content: flex-start; } .dsh-settings .model .actions button { margin-left: auto; }
  .dsh-settings .model-reasoning { margin-top: 12px; padding-top: 8px; border-top: .5px solid var(--dsh-border); }
  .dsh-settings .reasoning-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) 28px; gap: 6px; align-items: center; margin: 6px 0; }
  .dsh-settings .reasoning-row button { width: 28px; min-height: 28px; padding: 0; } .dsh-settings .reasoning-row input { font-family: var(--vscode-editor-font-family,monospace); font-size: 13px; }
  .dsh-settings .choices { max-height: 300px; overflow-y: auto; margin-top: 8px; padding: 4px; border: .5px solid var(--dsh-border); border-radius: 12px; }
  .dsh-settings .plugin-inventory { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
  .dsh-settings .inventory-heading { margin-top: 18px; }
  .dsh-settings .inventory-card { min-width: 0; padding: 12px 14px; border: .5px solid var(--dsh-border); border-radius: 16px; display: flex; flex-direction: column; gap: 4px; }
  .dsh-settings .inventory-name { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
  .dsh-settings .inventory-module { display: block; font: 12px/18px var(--vscode-editor-font-family,monospace); color: var(--dsh-muted); overflow-wrap: anywhere; }
  .dsh-settings .bundle-card .switch-row { margin-top: 4px; }
  .dsh-settings .bundle-description { overflow-wrap: anywhere; }
  .dsh-settings .bundle-status { font-size: 12px; color: var(--dsh-muted); }
  .dsh-settings .choice-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dsh-settings .notice { margin: 8px 0; padding: 8px 10px; border-radius: 8px; background: var(--dsh-hover); font-size: 12px; overflow-wrap: anywhere; }
  .dsh-settings .empty { padding: 16px 0; color: var(--dsh-muted); font-size: 13px; }
  .dsh-settings .section-save { position: sticky; bottom: -24px; margin-top: 16px; padding: 12px 0 8px; border-top: .5px solid var(--dsh-border); background: var(--settings-fill); }
  .dsh-settings .settings-plugin-tabs { display: flex; flex: none; gap: 22px; overflow-x: auto; border-bottom: .5px solid var(--dsh-border); margin-bottom: 14px; }
  .dsh-settings .settings-plugin-tabs button { position: relative; flex: none; padding: 7px 1px 9px; min-height: 36px; border: 0; border-radius: 0; font-size: 13px; line-height: 20px; color: var(--dsh-muted); white-space: nowrap; }
  .dsh-settings .settings-plugin-tabs button[aria-selected="true"] { color: var(--vscode-foreground); }
  .dsh-settings .settings-plugin-tabs button[aria-selected="true"]:after { content: ''; position: absolute; bottom: 0; inset-inline: 0; height: 2px; border-radius: 2px 2px 0 0; background: currentColor; }
  .dsh-settings .hidden, .dsh-settings [hidden] { display: none !important; }
  .settings-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: #0006; }
  @media(max-width:620px) { .dsh-settings { max-width: calc(100vw - 16px); height: calc(100vh - 16px); border-radius: 16px; } .dsh-settings .settings-nav { width: 52px; padding: 14px 6px; gap: 14px; } .dsh-settings .settings-nav h1, .dsh-settings .nav-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .dsh-settings #navigation button { width: 40px; padding: 0; justify-content: center; } .dsh-settings .settings-header { height: 44px; padding: 8px 8px 8px 0; } .dsh-settings .settings-options { padding: 0 16px 16px; } .dsh-settings #banner { margin-inline: 16px; } .dsh-settings .section-save { bottom: -16px; } .dsh-settings .card { padding: 12px; } }
  @media(max-width:380px) { .dsh-settings .model-grid, .dsh-settings .plugin-inventory { grid-template-columns: minmax(0,1fr); } .dsh-settings .general-row { flex-wrap: wrap; gap: 8px; } .dsh-settings .section-save .hint { flex-basis: 100%; } }
`
