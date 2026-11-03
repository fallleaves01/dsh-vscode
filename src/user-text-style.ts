/** The official inline secret control, using the host editor's theme tokens. */
export const userTextCss = `
.user-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.secret-text { box-sizing: border-box; max-width: 100%; font-family: var(--vscode-editor-font-family); align-items: center; margin: 0 2px; font-size: .875em; display: inline-flex; }
.secret-value { overflow-wrap: anywhere; min-width: 0; }
.secret-mask-run { -webkit-text-fill-color: transparent; background-color: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 20'%3E%3Cpath d='M6 5.6v8.8M2.19 7.8l7.62 4.4M2.19 12.2l7.62-4.4' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") 0/1ch 100% repeat-x; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 20'%3E%3Cpath d='M6 5.6v8.8M2.19 7.8l7.62 4.4M2.19 12.2l7.62-4.4' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") 0/1ch 100% repeat-x; }
.message .secret-toggle { color: var(--vscode-descriptionForeground); cursor: pointer; background: none; border: none; flex: none; align-items: center; padding: 0 0 0 3px; display: inline-flex; min-height: 0; }
.secret-toggle:hover { color: var(--vscode-foreground); }
.secret-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; border-radius: 2px; }
.secret-toggle svg { width: 1em; height: 1em; }
.quote-preview { display: inline-flex; align-items: baseline; gap: 4px; box-sizing: border-box; max-width: min(80%, 300px); margin: 0; padding: 0; vertical-align: baseline; color: var(--vscode-textLink-foreground, #4d6bfe); font-size: inherit; line-height: inherit; }
.quote-preview-mark { flex: none; display: inline-flex; align-self: center; width: 1em; height: 1em; }
.quote-preview-text { min-width: 0; padding: 0; border: none; outline: none; background: none; color: inherit; font: inherit; line-height: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quote-mark { width: 1em; height: 1em; fill: currentColor; stroke: none; }
.quote-mark path { fill: currentColor; stroke: none; }
`
