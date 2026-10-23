import { describe, expect, it } from 'vitest'
import { methodsOf } from '../tooling/dsh-contract-surface.mjs'

describe('released DSH descriptor formats', () => {
  it('reads RPC identities from legacy descriptors', () => {
    expect([...methodsOf("{ id: '@deepseek-ai/dsh-api-session-controller#session/list' }, { id: '@deepseek-ai/dsh-api-session-controller#session/follow' }")!])
      .toEqual(['session/list', 'session/follow'])
  })

  it('reads current Typert method table keys without counting parameter names', () => {
    expect([...methodsOf(`const $remote = createTypertRemoteInfo({
  methods: {
    'session/list': { parameters: [{ name: 'request' }] },
    'session/follow': { parameters: [] },
  },
})`)!]).toEqual(['session/list', 'session/follow'])
  })

  it('deduplicates methods in mixed generated descriptors', () => {
    expect([...methodsOf("{ id: 'pkg#session/list' }\n    'session/list': {}")!]).toEqual(['session/list'])
  })

  it('distinguishes absent host faces and explicitly empty tables', () => {
    expect(methodsOf(undefined)).toBeUndefined()
    expect(methodsOf('methods: {}')?.size).toBe(0)
    expect(methodsOf('methods: []')?.size).toBe(0)
  })

  it('rejects an unrecognized descriptor instead of reporting all methods removed', () => {
    expect(() => methodsOf('createNewRemoteFormat({})')).toThrow('Unrecognized DSH Remote descriptor')
  })
})
