import { dshReferenceFor, remoteDroppedUriError } from '../src/ide-context.js'
import { describe, expect, it } from 'vitest'
import {
  mentionedPaths,
  mentionQueryAt,
  replaceTextPreservingIdeContext,
  resolveMentionReferences,
  searchMentionCandidates,
  withIdeContext,
  withoutIdeContext,
  type IdeContextSnapshot,
} from '../src/ide-context.js'

const snapshot: IdeContextSnapshot = {
  activeFile: { kind: 'file', path: 'src/extension.ts', languageId: 'typescript' },
  selection: {
    kind: 'selection',
    path: 'src/extension.ts',
    languageId: 'typescript',
    startLine: 10,
    endLine: 12,
    text: 'const answer = 42',
  },
  pinned: [],
  mentions: [{ kind: 'folder', path: 'tests' }],
}

describe('IDE context', () => {
  it('adds machine-readable editor context without changing the visible request', () => {
    const enriched = withIdeContext('Explain this code', snapshot)

    expect(enriched).toContain('"path": "src/extension.ts"')
    expect(enriched).toContain('"startLine": 10')
    expect(enriched).toContain('const answer = 42')
    expect(withoutIdeContext(enriched)).toBe('Explain this code')
  })

  it('leaves ordinary prompts untouched', () => {
    expect(withoutIdeContext('hello')).toBe('hello')
  })

  it('edits queued prompt text without dropping its captured context', () => {
    const enriched = withIdeContext('Original request', snapshot)
    const edited = replaceTextPreservingIdeContext(enriched, 'Updated request')

    expect(edited).toContain('"path": "src/extension.ts"')
    expect(withoutIdeContext(edited)).toBe('Updated request')
    expect(replaceTextPreservingIdeContext('Original request', 'Updated request')).toBe('Updated request')
  })

  it('recognizes inline and braced file mentions', () => {
    expect(mentionedPaths('Check @src/extension.ts and @{docs/design notes.md}.')).toEqual([
      'src/extension.ts',
      'docs/design notes.md',
    ])
    expect(mentionQueryAt('Look at @src/ext', 'Look at @src/ext'.length)).toEqual({
      start: 8,
      query: 'src/ext',
    })
  })

  it('prioritizes basename matches for mention completion', () => {
    expect(searchMentionCandidates([
      { kind: 'file', path: 'src/extension.ts' },
      { kind: 'file', path: 'tests/extension.spec.ts' },
      { kind: 'folder', path: 'src' },
    ], 'ext')).toEqual([
      { kind: 'file', path: 'src/extension.ts' },
      { kind: 'file', path: 'tests/extension.spec.ts' },
    ])
  })

  it('offers Problems before file mentions and searches diagnostic messages', () => {
    const candidates = [
      { kind: 'problems' as const, path: 'problems' },
      {
        kind: 'problem' as const,
        path: 'src/app.ts',
        startLine: 18,
        startCharacter: 7,
        severity: 'error' as const,
        message: 'Cannot find name userId',
        source: 'typescript',
      },
      { kind: 'file' as const, path: 'src/app.ts' },
    ]

    expect(searchMentionCandidates(candidates, '')[0]).toEqual({ kind: 'problems', path: 'problems' })
    expect(searchMentionCandidates(candidates, 'userId')).toEqual([candidates[1]])
  })

  it('resolves aggregate and individual diagnostic mentions as IDE context', () => {
    const problem = {
      kind: 'problem' as const,
      path: 'src/app.ts',
      startLine: 18,
      startCharacter: 7,
      endLine: 18,
      endCharacter: 13,
      severity: 'error' as const,
      message: 'Cannot find name userId',
      source: 'typescript',
    }
    const candidates = [{ kind: 'file' as const, path: 'src/app.ts' }]

    expect(resolveMentionReferences(['src/app.ts:18:7'], candidates, [problem])).toEqual([problem])
    expect(resolveMentionReferences(['problems'], candidates, [problem])).toEqual([{
      kind: 'problems',
      path: '.',
      text: JSON.stringify([problem], null, 2),
    }])
  })
})

describe('DSH reference literals', () => {
  it('builds relative, absolute, folder and whitespace-quoted literals', () => {
    expect(dshReferenceFor('/workspace', '/workspace/src/a.ts', 'file').reference).toEqual({ text: '@src/a.ts', label: 'a.ts', kind: 'file' })
    expect(dshReferenceFor('/workspace', '/elsewhere/b.ts', 'file').reference).toEqual({ text: '@/elsewhere/b.ts', label: 'b.ts', kind: 'file' })
    expect(dshReferenceFor('/workspace', '/workspace/docs', 'folder').reference).toMatchObject({ text: '@docs/', kind: 'folder' })
    expect(dshReferenceFor('/workspace', '/workspace/my file.txt', 'file').reference).toMatchObject({ text: '@"my file.txt"' })
  })
  it('rejects control characters and quotes in a path', () => {
    expect(dshReferenceFor('/workspace', '/workspace/bad\u0007.txt', 'file').error).toContain('cannot be referenced')
    expect(dshReferenceFor('/workspace', '/workspace/quo"te.txt', 'file').error).toContain('cannot be referenced')
  })
  it('rejects zero-width and bidirectional control characters', () => {
    expect(dshReferenceFor('/workspace', '/workspace/zero\u200bwidth.ts', 'file').error).toContain('bidirectional')
    expect(dshReferenceFor('/workspace', '/workspace/bidi\u202Eevil.ts', 'file').error).toContain('bidirectional')
    expect(dshReferenceFor('/workspace', '/workspace/iso\u2066late.ts', 'file').error).toContain('bidirectional')
  })
  it('rejects parent-directory segments and network shares', () => {
    expect(dshReferenceFor('/workspace', '/workspace/../outside.ts', 'file').error).toContain('parent-directory')
    expect(dshReferenceFor('/workspace', '//server/share/file.ts', 'file').error).toContain('Network share')
    expect(dshReferenceFor('/workspace', '\\\\server\\share\\file.ts', 'file').error).toContain('Network share')
  })
  it('rejects a local file URI in a remote window', () => {
    expect(remoteDroppedUriError('ssh-remote', 'file')).toContain('remote window')
    expect(remoteDroppedUriError(undefined, 'file')).toBeUndefined()
  })
})

describe('quoted DSH references in the mention parser', () => {
  it('parses @"path with space", folders, mixed grammars and ignores empty quotes', () => {
    expect(mentionedPaths('see @"a b/c.ts"')).toEqual(['a b/c.ts'])
    expect(mentionedPaths('see @"dir x/"')).toEqual(['dir x'])
    expect(mentionedPaths('@"a b/c.ts" then @src/x.ts and @{dir y/z}')).toEqual(['a b/c.ts', 'src/x.ts', 'dir y/z'])
    expect(mentionedPaths('nothing @" " and @"" here')).toEqual([])
  })
  it('does not open the candidate query for a quoted reference', () => {
    expect(mentionQueryAt('look @"a b', 11)).toBeUndefined()
    expect(mentionQueryAt('look @"a b"', 12)).toBeUndefined()
    expect(mentionQueryAt('look @{a b', 11)).toEqual({ start: 5, query: 'a b' })
    expect(mentionQueryAt('look @src/a', 12)).toEqual({ start: 5, query: 'src/a' })
  })
})
