import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * A cycle among declared subagent parents must not hang the walk that keeps the
 * open conversation's ancestors visible.
 *
 * This runs in a child process on purpose: a synchronous infinite loop cannot be
 * interrupted by a test timeout, so an in-process regression test would hang the
 * whole run instead of failing it. `spawnSync`'s timeout kills the child, which
 * is what turns the regression into a failure.
 */
describe('session list construction', () => {
  it('returns when the open conversation sits inside a parent cycle', () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cycle-'))
    const entry = join(dir, 'entry.ts')
    const out = join(dir, 'entry.mjs')
    writeFileSync(entry, `
import { sessionItems } from ${JSON.stringify(join(root, 'src', 'session-center.js'))}
const summary = (value) => ({ updatedAt: 0, running: false, blank: false, ...value })
const summaries = [
  summary({ sessionId: 'a', updatedAt: 10, origin: 'subagent', parentSessionId: 'b' }),
  summary({ sessionId: 'b', updatedAt: 20, origin: 'subagent', parentSessionId: 'a' }),
  summary({ sessionId: 'solo', updatedAt: 30 }),
]
const ids = sessionItems(summaries, new Set(), 'a', new Set()).map(item => item.id)
process.stdout.write(JSON.stringify(ids))
`, 'utf8')

    return build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
      .then(() => {
        const result = spawnSync(process.execPath, [out], { encoding: 'utf8', timeout: 10_000 })
        // A killed child means the walk never returned.
        expect(result.signal, `the walk was killed after ${String(result.error ?? 'the timeout')}`).toBeNull()
        expect(result.status).toBe(0)
        // A cycle has no root, so its members may legitimately be hidden — what
        // matters is that the walk returned at all rather than spinning.
        const ids = JSON.parse(result.stdout) as string[]
        expect(Array.isArray(ids)).toBe(true)
        expect(ids).toContain('solo')
        expect(new Set(ids).size).toBe(ids.length)
      })
  }, 30_000)
})
