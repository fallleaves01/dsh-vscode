import { describe, expect, it } from 'vitest'
import { settingsPageCss } from '../src/settings-ui.js'

describe('settings page third-party bundle row styles', () => {
  it('aligns version rows and uses a monospace version number', () => {
    // The version row is a full-width flex button so its version text, date and
    // markers stay on one line inside the scrollable choices box.
    expect(settingsPageCss).toMatch(/\.dsh-settings \.bundle-version \{[^}]*display: flex;/)
    expect(settingsPageCss).toMatch(/\.dsh-settings \.bundle-version \{[^}]*align-items: center;/)
    expect(settingsPageCss).toMatch(/\.dsh-settings \.bundle-version \{[^}]*gap: 8px;/)
    expect(settingsPageCss).toMatch(/\.dsh-settings \.bundle-version \.version-number \{[^}]*font: 12px\/18px var\(--vscode-editor-font-family, monospace\);/)
  })

  it('adds no external resource, import or font face', () => {
    expect(settingsPageCss).not.toContain('@import')
    expect(settingsPageCss).not.toContain('@font-face')
    expect(settingsPageCss).not.toContain('url(')
  })
})
