import { createRequire } from 'node:module'
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
