import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  activationEvents: string[]
  contributes: {
    commands: Array<{ command: string }>
    keybindings?: Array<{ command: string; key: string; mac?: string; when?: string }>
    menus: Record<string, Array<{ command: string }>>
  }
}

const commandIds = new Set(manifest.contributes.commands.map(entry => entry.command))
const keybindings = manifest.contributes.keybindings ?? []

describe('keybindings', () => {
  it('binds the commands a user reaches for mid-edit', () => {
    const bound = new Set(keybindings.map(entry => entry.command))
    for (const command of [
      'deepseekHarness.openChat',
      'deepseekHarness.openInEditor',
      'deepseekHarness.addSelection',
      'deepseekHarness.fixWithDeepSeek',
    ]) {
      expect(bound, `${command} should have a default binding`).toContain(command)
    }
  })

  it('only binds commands the extension actually contributes', () => {
    for (const binding of keybindings) expect([...commandIds]).toContain(binding.command)
  })

  it('never reuses a chord, across the default and macOS forms', () => {
    const chords = keybindings.flatMap(binding => [binding.key, ...(binding.mac === undefined ? [] : [binding.mac])])
    expect(new Set(chords).size).toBe(chords.length)
  })

  it('gives macOS its own chord, so Ctrl+Alt is never asked of a Mac', () => {
    for (const binding of keybindings) {
      expect(binding.mac, `${binding.command} needs a mac chord`).toBeDefined()
      expect(binding.mac).toMatch(/^cmd\+/)
    }
  })

  it('scopes editor-context commands so they cannot fire on nothing', () => {
    const byCommand = new Map(keybindings.map(binding => [binding.command, binding]))
    expect(byCommand.get('deepseekHarness.addSelection')?.when).toContain('editorHasSelection')
    expect(byCommand.get('deepseekHarness.fixWithDeepSeek')?.when).toContain('editorTextFocus')
    // The two that open a surface must work anywhere.
    expect(byCommand.get('deepseekHarness.openChat')?.when).toBeUndefined()
    expect(byCommand.get('deepseekHarness.openInEditor')?.when).toBeUndefined()
  })
})

describe('launch configuration scope', () => {
  const properties = (manifest as unknown as {
    contributes: { configuration: { properties: Record<string, { scope?: string }> } }
  }).contributes.configuration.properties

  it('keeps the executable machine-scoped so Settings Sync cannot move it', () => {
    // Reported in the field as "spawn /opt/homebrew/bin/dsh ENOENT" on a Linux
    // host: a `resource`-scoped setting was synced from a Mac, and nothing on
    // the remote could use that path. Machine-scoped settings are not synced.
    expect(properties['deepseekHarness.executable']?.scope).toBe('machine-overridable')
  })

  it('keeps launch arguments machine-scoped, since they can name local paths', () => {
    expect(properties['deepseekHarness.arguments']?.scope).toBe('machine-overridable')
  })
})

describe('account contributions', () => {
  it('exposes sign-in and sign-out in the palette', () => {
    expect(commandIds).toContain('deepseekHarness.signIn')
    expect(commandIds).toContain('deepseekHarness.signOut')
  })

  it('activates on the account commands, since either can start the extension', () => {
    expect(manifest.activationEvents).toContain('onCommand:deepseekHarness.signIn')
    expect(manifest.activationEvents).toContain('onCommand:deepseekHarness.signOut')
  })
})
