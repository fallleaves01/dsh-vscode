import { describe, expect, it, vi } from 'vitest'
import { dispatchChangeAction } from '../src/change-actions.js'

function host() {
  return {
    state: { sessionId: 'active', cwd: '/workspace' },
    reviewFile: vi.fn(async () => {}), reviewAll: vi.fn(async () => {}),
    keepFile: vi.fn(), keepAll: vi.fn(),
    revertFile: vi.fn(async () => {}), revertAll: vi.fn(async () => {}),
  }
}
const actions = ['review-file', 'review-all', 'keep-file', 'keep-all', 'revert-file', 'revert-all'] as const
const packet = { sessionId: 'active', cwd: '/workspace', path: 'src/shared.ts', turn: 2 }

describe('change operation routing across asynchronous webview updates', () => {
  it.each(actions)('rejects %s from a previously selected conversation or project', async type => {
    const target = host()
    for (const scope of [{ sessionId: 'previous' }, { cwd: '/another-project' }, { sessionId: undefined }, { cwd: undefined }]) {
      await dispatchChangeAction({ ...packet, type, ...scope }, target)
    }
    expect(Object.values(target).filter(value => typeof value === 'function').every(value => vi.mocked(value).mock.calls.length === 0)).toBe(true)
  })

  it.each(actions)('dispatches %s only to the matching active target', async type => {
    const target = host()
    await dispatchChangeAction({ ...packet, type }, target)
    const method = type === 'review-file' ? target.reviewFile : type === 'review-all' ? target.reviewAll : type === 'keep-file' ? target.keepFile : type === 'keep-all' ? target.keepAll : type === 'revert-file' ? target.revertFile : target.revertAll
    expect(method).toHaveBeenCalledTimes(1)
    if (type.endsWith('-file')) expect(method).toHaveBeenCalledWith('src/shared.ts', 2)
  })

  it('allows a tool diff without a turn, but rejects malformed write actions', async () => {
    const target = host()
    await dispatchChangeAction({ ...packet, type: 'review-file', turn: undefined }, target)
    expect(target.reviewFile).toHaveBeenCalledWith('src/shared.ts', undefined)
    for (const turn of [undefined, -1, 1.5, NaN, Infinity]) {
      await dispatchChangeAction({ ...packet, type: 'revert-file', turn }, target)
      await dispatchChangeAction({ ...packet, type: 'keep-file', turn }, target)
    }
    expect(target.revertFile).not.toHaveBeenCalled()
    expect(target.keepFile).not.toHaveBeenCalled()
  })
})
