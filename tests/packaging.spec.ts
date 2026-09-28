import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The packaging rules are a security boundary, not a convenience: a probe home
 * created in the repository root during development holds a DSH credentials
 * file (the cookie signing secret) and the session logs. `vsce` packages
 * everything not listed in `.vscodeignore`, so an unlisted transient directory
 * ships a secret inside a published extension.
 */

const root = process.cwd()
const vscodeignore = readFileSync(join(root, '.vscodeignore'), 'utf8')
const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')

/** Directories tooling/ and the test suites create at the repository root. */
const TRANSIENT = ['.acct-home', '.audit-home', '.probe-home', '.drift', '.npm-cache']

describe('packaging rules', () => {
  it.each(TRANSIENT)('keeps %s out of the published extension', directory => {
    expect(vscodeignore).toContain(`${directory}/**`)
  })

  it.each(TRANSIENT)('keeps %s out of version control', directory => {
    expect(gitignore).toContain(`${directory}/`)
  })

  it('still excludes the sources and tooling the extension does not run', () => {
    for (const entry of ['src/**', 'tests/**', 'tooling/**', 'docs/**', 'node_modules/**']) {
      expect(vscodeignore).toContain(entry)
    }
  })

  it('ships only the built bundle and its assets from dist', () => {
    // Source maps are large and not needed at runtime; the build already strips them.
    expect(vscodeignore).toContain('dist/**/*.map')
  })

  it('never ignores the manifest or the built entry point', () => {
    for (const required of ['package.json', 'dist']) {
      expect(vscodeignore.split('\n').some(line => line.trim() === required)).toBe(false)
    }
  })
})
