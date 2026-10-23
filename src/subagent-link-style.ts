export const subagentLinkCss = `
.subagent-tool-card { margin: 8px 0; min-width: 0; border: .5px solid var(--dsh-border); border-radius:var(--dsh-radius-sm,8px); overflow: hidden; }
.subagent-tool-card > .tool { margin: 0; border: 0; border-top: .5px solid var(--dsh-border); border-radius: 0; }
.subagent-tool-card > .tool > summary { min-height:28px; padding:5px 10px; font:11px/18px var(--vscode-font-family, system-ui, sans-serif); }
.subagent-tool-card .tool-title, .subagent-tool-card .tool-detail { font:inherit; }
.subagent-tool-card .tool-icon { width:12px; height:12px; }
.subagent-tool-card .tool-icon svg { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:1.5; }
.subagent-tool-card .tool[open] > summary .tool-icon svg { transform:rotate(90deg); }
.subagent-tool-heading { display:flex; align-items:center; gap:7px; padding:4px 10px; color:var(--dsh-muted); font:11px/18px var(--vscode-font-family, system-ui, sans-serif); }
.subagent-tool-links { padding:2px 5px; min-width:0; max-height:min(260px,35vh); overflow-y:auto; overscroll-behavior:contain; }
.subagent-tool-row { display:grid; grid-template-columns:minmax(0,1fr) 28px; align-items:center; min-width:0; }
.subagent-tool-main { display:flex; align-items:center; gap:9px; min-width:0; width:100%; padding:7px 5px; text-align:left; border:0; border-radius:6px; color:var(--vscode-foreground); background:transparent; cursor:pointer; }
.subagent-tool-main:hover:not(:disabled), .subagent-tool-aside:hover { background:var(--dsh-hover); }
.subagent-tool-main:focus-visible, .subagent-tool-aside:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:-1px; }
.subagent-tool-main:disabled { opacity:1; cursor:default; }
.subagent-tool-copy { display:grid; flex:1; min-width:0; gap:2px; }
.subagent-tool-name { color:var(--dsh-accent); font:500 12px/18px var(--vscode-font-family, system-ui, sans-serif); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
[data-activity="external"] .subagent-tool-name { color:var(--vscode-foreground); }
.subagent-tool-main:hover:not(:disabled) .subagent-tool-name { color:var(--dsh-accent); }
.subagent-tool-meta { color:var(--dsh-muted); font:11px/15px var(--vscode-font-family, system-ui, sans-serif); overflow-wrap:anywhere; }
.subagent-tool-metrics { display:grid; flex:none; gap:2px; text-align:right; color:var(--dsh-muted); font:10px/15px var(--vscode-font-family,system-ui,sans-serif); font-variant-numeric:tabular-nums; }
.subagent-tool-metrics[hidden] { display:none; }
.subagent-tool-metrics > span:empty { display:none; }
.subagent-tool-glyph { flex:none; width:14px; height:14px; display:grid; place-items:center; }
.subagent-tool-glyph::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--dsh-muted); }
[data-activity="completed"] .subagent-tool-glyph::before { background:var(--dsh-success); }
[data-activity="waiting"] .subagent-tool-glyph::before { background:var(--dsh-warning); }
[data-activity="running"] .subagent-tool-glyph::before { width:12px; height:12px; border:1.5px solid var(--dsh-border); border-top-color:var(--dsh-accent); background:transparent; animation:subagent-link-spin 1s linear infinite; }
.subagent-tool-aside { display:grid; place-items:center; width:28px; height:28px; padding:6px; border:0; border-radius:6px; background:transparent; color:var(--dsh-muted); cursor:pointer; }
.subagent-tool-aside svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.5; }
.subagent-tool-aside[hidden] { display:none!important; }
.subagent-tool-error { grid-column:1/-1; color:var(--vscode-errorForeground); font:11px/17px var(--vscode-font-family, system-ui, sans-serif); white-space:pre-wrap; overflow-wrap:anywhere; }
.subagent-tool-error:not(:empty) { padding:3px 5px 7px; }
@keyframes subagent-link-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { [data-activity="running"] .subagent-tool-glyph::before { animation:none; } }
`
