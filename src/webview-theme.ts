/** Shared surfaces and accessible controls for chat and independent task panes. */
export const webviewThemeCss = `
  :root {
    --dsh-accent: var(--vscode-textLink-foreground, #4d6bfe);
    --dsh-muted: var(--vscode-descriptionForeground, #888);
    --dsh-border: var(--vscode-contrastBorder, color-mix(in srgb, var(--vscode-foreground) 12%, transparent));
    --dsh-surface: var(--vscode-editor-background, #202020);
    --dsh-hover: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--vscode-foreground) 8%, transparent));
    --dsh-success: var(--vscode-testing-iconPassed, #73c991);
    --dsh-warning: var(--vscode-editorWarning-foreground, #cca700);
  }
  button, input, select, textarea { font-family: inherit; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #4d6bfe); outline-offset: 2px;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, #8885); border-radius: 6px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, #8888); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0s !important; } }
`
