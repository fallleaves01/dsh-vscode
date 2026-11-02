import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PENDING_MIGRATION = 'PendingMigrationError: navigator is now a global in nodejs'
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
let originalNavigator: PropertyDescriptor | undefined

function installThrowingNavigator(): void {
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() { throw new Error(PENDING_MIGRATION) },
  })
}

function restoreNavigator(): void {
  if (originalNavigator === undefined) delete (globalThis as Record<string, unknown>).navigator
  else Object.defineProperty(globalThis, 'navigator', originalNavigator)
  originalNavigator = undefined
}

afterEach(() => {
  restoreNavigator()
  vi.resetModules()
})

describe('zod remote runtime bootstrap', () => {
  it('loads the MCP server under a throwing navigator after configuring zod jitless', async () => {
    installThrowingNavigator()
    vi.resetModules()
    const server = await import('../src/debug-mcp-server.js')
    expect(server.DebugMcpServer).toBeTypeOf('function')
    const zod = await import('zod')
    expect(zod.config().jitless).toBe(true)
    // Schema construction and parsing must not read the throwing getter.
    expect(() => zod.object({ value: zod.string() }).parse({ value: 'ok' })).not.toThrow()
  })

  it('fails without the bootstrap and succeeds with it in a real Node process', () => {
    const script = (bootstrap: boolean): string => [
      "Object.defineProperty(globalThis, 'navigator', { configurable: true, get() { throw new Error('PendingMigrationError: navigator is now a global in nodejs') } })",
      "const { createRequire } = await import('node:module')",
      "const require = createRequire(process.cwd() + '/package.json')",
      ...(bootstrap ? ["require('zod').config({ jitless: true })"] : []),
      "require('@modelcontextprotocol/sdk/server/mcp.js')",
      "console.log('LOADED')",
    ].join('\n')
    const run = (bootstrap: boolean): { status: number; output: string } => {
      try {
        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script(bootstrap)],
          { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
        return { status: 0, output }
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string }
        return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
      }
    }
    const withoutBootstrap = run(false)
    expect(withoutBootstrap.status).not.toBe(0)
    expect(withoutBootstrap.output).toContain('navigator')
    const withBootstrap = run(true)
    expect(withBootstrap.status).toBe(0)
    expect(withBootstrap.output).toContain('LOADED')
  })
})
