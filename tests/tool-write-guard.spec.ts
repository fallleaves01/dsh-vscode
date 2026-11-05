import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DshEvent } from '../src/conversation.js'
import { absoluteToolPaths, toolWriteIntents } from '../src/tool-write-guard.js'

function event(type: string, data: unknown): DshEvent {
  return { type, seq: 1, time: 1, data }
}

describe('toolWriteIntents', () => {
  it('detects a write in the completed assistant message before tool dispatch', () => {
    const value = event('assistant/message', {
      message: {
        content: [
          { type: 'text', text: 'I will update it.' },
          { type: 'tool-call', id: 'call-1', name: 'write', arguments: '{"file_path":"src/app.ts","content":"x"}' },
        ],
      },
    })

    expect(toolWriteIntents(value)).toEqual([{ callId: 'call-1', paths: ['src/app.ts'] }])
  })

  it('uses the official diff presentation for modifying tools', () => {
    const value = event('tool/call', { callId: 'call-2', name: 'custom_writer', arguments: '{}' })
    const view = {
      for: 'call',
      view: { card: 'diff', title: 'Change files', diffs: [{ path: 'a.ts' }, { path: 'b.ts' }] },
    }

    expect(toolWriteIntents(value, view)).toEqual([{ callId: 'call-2', paths: ['a.ts', 'b.ts'] }])
  })

  it.each(['write', 'edit'])('detects rc.1 %s arguments without a presentation view', name => {
    expect(toolWriteIntents(event('tool/call', {
      turn: 1, step: 1, callId: 'rc1-call', name,
      arguments: JSON.stringify({ file_path: 'src/app.ts', content: 'new', old_string: 'old', new_string: 'new' }),
    }))).toEqual([{ callId: 'rc1-call', paths: ['src/app.ts'] }])
  })

  it('ignores read-only calls and malformed write arguments', () => {
    expect(toolWriteIntents(event('tool/call', {
      callId: 'read-1', name: 'read', arguments: '{"file_path":"src/app.ts"}',
    }))).toEqual([])
    expect(toolWriteIntents(event('tool/call', {
      callId: 'write-1', name: 'write', arguments: '{broken',
    }))).toEqual([])
  })
})

describe('absoluteToolPaths', () => {
  it('resolves relative paths and preserves absolute paths', () => {
    const root = path.parse(process.cwd()).root
    const cwd = path.join(root, 'workspace', 'project')
    const absolute = path.join(root, 'shared', 'config.ts')
    expect(absoluteToolPaths(cwd, ['src/app.ts', absolute])).toEqual([
      path.join(cwd, 'src', 'app.ts'),
      absolute,
    ])
  })
})

/** Render one Codex-style patch from its lines, as DSH delivers it. */
function patchOf(lines: readonly string[]): string {
  return lines.join('\n')
}

const MULTI_FILE_PATCH = patchOf([
  '*** Begin Patch',
  '*** Update File: app.ts',
  '@@',
  ' context',
  '-old',
  '+new',
  '*** Add File: added.ts',
  '+export const added = true',
  '*** Delete File: gone.ts',
  '*** Update File: moved.ts',
  '*** Move to: destination.ts',
  '@@',
  '-line',
  '+line changed',
  '*** End Patch',
])

function patchCall(callId: string, input: string, name = 'apply_patch'): DshEvent {
  return event('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify({ input }) })
}

describe('apply_patch file headers', () => {
  it('collects add, update, delete and move paths without a presentation view', () => {
    expect(toolWriteIntents(patchCall('patch-1', MULTI_FILE_PATCH))).toEqual([{
      callId: 'patch-1',
      paths: ['app.ts', 'added.ts', 'gone.ts', 'moved.ts', 'destination.ts'],
    }])
  })

  it('reads a patch from the completed assistant message before tool dispatch', () => {
    const value = event('assistant/message', {
      message: { content: [
        { type: 'text', text: 'I will patch it.' },
        { type: 'tool-call', id: 'patch-2', name: 'apply_patch', arguments: JSON.stringify({ input: MULTI_FILE_PATCH }) },
      ] },
    })
    expect(toolWriteIntents(value)).toEqual([{
      callId: 'patch-2',
      paths: ['app.ts', 'added.ts', 'gone.ts', 'moved.ts', 'destination.ts'],
    }])
  })

  it('keeps the move source and its destination as separate files', () => {
    const input = patchOf([
      '*** Begin Patch',
      '*** Update File: moved.ts',
      '*** Move to: destination.ts',
      '@@',
      '-line',
      '+line changed',
      '*** End Patch',
    ])
    expect(toolWriteIntents(patchCall('move-1', input))).toEqual([{ callId: 'move-1', paths: ['moved.ts', 'destination.ts'] }])
  })

  it('unions the view paths first and deduplicates a path named twice', () => {
    const input = patchOf([
      '*** Begin Patch',
      '*** Update File: app.ts',
      '@@',
      '-a',
      '+b',
      '*** Delete File: gone.ts',
      '*** End Patch',
    ])
    const view = { for: 'call', view: { card: 'diff', diffs: [{ path: 'app.ts' }, { path: 'viewed.ts' }] } }
    expect(toolWriteIntents(patchCall('union-1', input), view)).toEqual([{
      callId: 'union-1',
      paths: ['app.ts', 'viewed.ts', 'gone.ts'],
    }])
  })

  it('accepts an already-parsed argument object and CRLF line endings', () => {
    const input = '*** Begin Patch\r\n*** Delete File: gone.ts\r\n*** End Patch'
    const value = event('tool/call', { callId: 'object-1', name: 'apply_patch', arguments: { input } })
    expect(toolWriteIntents(value)).toEqual([{ callId: 'object-1', paths: ['gone.ts'] }])
  })

  it('reads a heredoc-wrapped patch input', () => {
    const input = ["<<'EOF'", '*** Begin Patch', '*** Add File: created.ts', '+hello', '*** End Patch', 'EOF'].join('\n')
    expect(toolWriteIntents(patchCall('heredoc-1', input))).toEqual([{ callId: 'heredoc-1', paths: ['created.ts'] }])
  })

  it.each([
    ['ordinary text', 'Please update app.ts and gone.ts.'],
    ['JSON text', '{"input":"*** Update File: app.ts"}'],
    ['a header without the envelope', '*** Update File: app.ts'],
    ['a missing end marker', patchOf(['*** Begin Patch', '*** Update File: app.ts'])],
    ['a missing begin marker', patchOf(['*** Update File: app.ts', '*** End Patch'])],
    ['an empty patch', patchOf(['*** Begin Patch', '*** End Patch'])],
    ['a blank input', '   '],
  ])('reads no paths from %s', (_case, input) => {
    expect(toolWriteIntents(patchCall('malformed-1', input))).toEqual([])
  })

  it('never reads patch headers from another tool or outside an envelope', () => {
    // The same `input` on a read-only tool is not a mutation at all.
    expect(toolWriteIntents(patchCall('read-patch', MULTI_FILE_PATCH, 'read'))).toEqual([])
    // A write tool's own file_path stays the only path; its `input` is not a patch.
    const write = event('tool/call', {
      callId: 'write-input',
      name: 'write',
      arguments: JSON.stringify({ file_path: 'app.ts', input: MULTI_FILE_PATCH }),
    })
    expect(toolWriteIntents(write)).toEqual([{ callId: 'write-input', paths: ['app.ts'] }])
  })

  it('reads a deletion path from a view that carries locations without diffs', () => {
    const call = event('tool/call', { callId: 'replay-delete', name: 'apply_patch', arguments: '{}' })
    const view = {
      for: 'call',
      view: { card: 'diff', title: 'Apply patch (2 files)', diffs: [], locations: [{ path: 'gone.ts' }, { path: 'moved.ts' }] },
    }
    expect(toolWriteIntents(call, view)).toEqual([{ callId: 'replay-delete', paths: ['gone.ts', 'moved.ts'] }])
  })

  it('ignores header-like lines that are patch content', () => {
    const input = patchOf([
      '*** Begin Patch',
      '*** Update File: app.ts',
      '@@',
      ' *** Move to: not-a-header.ts',
      '+*** Delete File: also-not-a-header.ts',
      '*** End Patch',
    ])
    expect(toolWriteIntents(patchCall('content-1', input))).toEqual([{ callId: 'content-1', paths: ['app.ts'] }])
  })
})

describe('absoluteToolPaths for patch paths', () => {
  it('resolves relative patch paths against the project cwd and keeps absolute ones', () => {
    const root = path.parse(process.cwd()).root
    const cwd = path.join(root, 'workspace', 'project')
    const absolute = path.join(root, 'shared', 'config.ts')
    expect(absoluteToolPaths(cwd, ['app.ts', '../shared/util.ts', absolute])).toEqual([
      path.join(cwd, 'app.ts'),
      path.join(root, 'workspace', 'shared', 'util.ts'),
      absolute,
    ])
  })

  it('deduplicates the same file reached through several spellings', () => {
    const root = path.parse(process.cwd()).root
    const cwd = path.join(root, 'workspace', 'project')
    expect(absoluteToolPaths(cwd, ['app.ts', './app.ts', path.join(cwd, 'app.ts')])).toEqual([path.join(cwd, 'app.ts')])
  })
})
