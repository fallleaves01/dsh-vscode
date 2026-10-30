import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Exercise the actual transitive package used by VSCE's credential scanner.
// It is not shipped in the extension, but malformed glob patterns must not
// exhaust the packager's stack while processing an untrusted checkout.
let requirePackage = createRequire(import.meta.url)
for (const name of ['@vscode/vsce', 'secretlint', 'globby', 'fast-glob', 'micromatch']) {
  requirePackage = createRequire(requirePackage.resolve(name))
}
const braces = requirePackage('braces') as Record<'compile' | 'expand' | 'stringify', (pattern: string | object) => unknown>

describe('patched build dependency nesting limit', () => {
  it.each(['compile', 'expand', 'stringify'] as const)('%s rejects deeply nested string patterns before stack exhaustion', method => {
    for (const [open, close] of [['{', '}'], ['(', ')'], ['{(', ')}']]) {
      // Stay below braces' character limit so the depth guard is exercised.
      const pattern = open!.repeat(2_000) + 'x' + close!.repeat(2_000)
      expect(() => braces[method](pattern)).toThrow(SyntaxError)
      expect(() => braces[method](pattern)).toThrow('nesting exceeds 128 levels')
    }
  })

  it('still compiles and expands ordinary project globs', () => {
    expect(braces.compile('src/{app,test}.{ts,tsx}')).toBe('src/(app|test).(ts|tsx)')
    expect(braces.expand('src/{app,test}.ts')).toEqual(['src/app.ts', 'src/test.ts'])
    expect(braces.stringify('src/{app,test}.ts')).toBe('src/{app,test}.ts')
  })

  it.each(['compile', 'expand', 'stringify'] as const)('%s also rejects a deeply nested caller-supplied AST', method => {
    let ast: object = { type: 'text', value: 'x', nodes: [] }
    for (let depth = 0; depth < 2_000; depth++) ast = { type: 'root', nodes: [ast] }
    expect(() => braces[method](ast)).toThrow(SyntaxError)
    expect(() => braces[method](ast)).toThrow('nesting exceeds 128 levels')
  })
})

// Security floors for packages that are bundled into dist by esbuild.
// These assertions prevent a dependency downgrade from silently reintroducing
// the advisories this release repaired.
const projectRoot = process.cwd()
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const lockfile = readFileSync(join(projectRoot, 'pnpm-lock.yaml'), 'utf8')
const workspaceConfig = existsSync(join(projectRoot, 'pnpm-workspace.yaml'))
  ? readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')
  : ''
// These packages are bundled into dist/extension.js or dist/webview/* by
// esbuild. They must be production dependencies, or `pnpm audit --prod` (the
// CI/release gate) audits nothing and SCA scanners cannot see the shipped graph.
const RUNTIME_DEPENDENCIES = [
  '@modelcontextprotocol/sdk',
  'diff',
  'dompurify',
  'highlight.js',
  'katex',
  'marked',
  'ws',
  'zod',
] as const

function numericVersion(spec: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(spec)
  if (match === null) throw new Error(`No numeric version in ${spec}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(spec: string, floor: string): boolean {
  const actual = numericVersion(spec)
  const required = numericVersion(floor)
  for (let index = 0; index < 3; index += 1) {
    if (actual[index]! !== required[index]!) return actual[index]! > required[index]!
  }
  return true
}

function walk(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

describe('bundled dependency security floors', () => {
  it('lists every bundled runtime package as a production dependency', () => {
    const dependencies = packageJson.dependencies ?? {}
    const devDependencies = packageJson.devDependencies ?? {}
    for (const name of RUNTIME_DEPENDENCIES) {
      expect(dependencies[name], `${name} must stay in dependencies`).toBeDefined()
      expect(devDependencies[name], `${name} must not regress to devDependencies`).toBeUndefined()
    }
  })

  it('keeps the repaired dompurify and MCP SDK versions in package.json', () => {
    const dependencies = packageJson.dependencies ?? {}
    expect(atLeast(dependencies.dompurify ?? '', '3.4.17')).toBe(true)
    expect(atLeast(dependencies['@modelcontextprotocol/sdk'] ?? '', '1.32.2')).toBe(true)
  })

  it('keeps zod at or above the repaired 4.6.6 line', () => {
    expect(atLeast(packageJson.dependencies?.zod ?? '', '4.6.6')).toBe(true)
  })

  it('pins fast-uri through the pnpm override and lockfile', () => {
    expect(workspaceConfig).toMatch(/^ {2}fast-uri: 3\.1\.9$/m)
    expect(lockfile).toMatch(/^ {2}fast-uri: 3\.1\.9$/m)
    expect(lockfile).toMatch(/^ {2}fast-uri@3\.1\.9:$/m)
    expect(lockfile).not.toMatch(/^ {2}fast-uri@3\.1\.8:$/m)
  })

  it('pins the production body-parser advisory through the lockfile', () => {
    expect(workspaceConfig).toMatch(/^ {2}body-parser: 2\.4\.0$/m)
    expect(lockfile).toMatch(/^ {2}body-parser@2\.4\.0:$/m)
    expect(lockfile).not.toMatch(/^ {2}body-parser@2\.[0-3]\.[0-9]+:$/m)
  })

  it('keeps the repaired package versions in the lockfile and every registry resolution integrity-checked', () => {
    expect(lockfile).toMatch(/^ {2}dompurify@3\.4\.17:$/m)
    expect(lockfile).toMatch(/^ {2}'@modelcontextprotocol\/sdk@1\.32\.2':$/m)
    expect(lockfile).toMatch(/^ {2}zod@4\.6\.7:$/m)
    expect(lockfile).not.toMatch(/dompurify@3\.4\.16|@modelcontextprotocol\/sdk@1\.31\.0|zod@3\.25\.76|fast-uri@3\.1\.8/)
    expect((lockfile.match(/integrity: sha512-/g) ?? []).length).toBeGreaterThan(400)
    // No tarball, git or directory resolutions: all dependencies stay registry
    // packages with integrity checks.
    expect(lockfile).not.toMatch(/resolution: \{[^\n]*(?:tarball:|directory:|git\+)/)
  })

  it.skipIf(!existsSync(join(projectRoot, 'dist')))('does not bundle the known vulnerable version strings', () => {
    const files = walk(join(projectRoot, 'dist')).filter(file => /\.(?:js|map)$/.test(file))
    expect(files.length).toBeGreaterThan(0)
    const contents = files.map(file => ({ file, text: readFileSync(file, 'utf8') }))
    for (const { file, text } of contents) {
      const name = relative(projectRoot, file)
      for (const vulnerable of ['3.4.16', '1.31.0', '3.25.76', '3.1.8']) {
        expect(text, `${name} still contains vulnerable version ${vulnerable}`).not.toContain(vulnerable)
      }
    }
    // Positive control: the sanitizer version is visible in the browser bundle,
    // and the repaired MCP/zod/fast-uri versions appear in the extension map.
    expect(contents.find(item => item.file.endsWith('markdown.js'))?.text).toContain('3.4.17')
    const extensionMap = contents.find(item => item.file.endsWith('extension.js.map'))?.text ?? ''
    expect(extensionMap).toContain('1.32.2')
    expect(extensionMap).toContain('4.6.7')
    expect(extensionMap).toContain('3.1.9')
  })
})
