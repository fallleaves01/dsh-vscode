import { describe, expect, it } from 'vitest'
import { sessionAddress } from '../src/dsh-session-feed.js'

/**
 * DSH addresses a conversation with a union: an ordinary session by id, and a
 * subagent child by its durable parent. Sending the plain id for a child is
 * refused with `session/agent-busy`, which is why opening one used to fail.
 */
describe('session addresses', () => {
  it('addresses an ordinary conversation by id', () => {
    expect(sessionAddress('s1', undefined)).toEqual({ kind: 'session', sessionId: 's1' })
  })

  it('addresses a subagent child through its parent', () => {
    expect(sessionAddress('child', 'parent')).toEqual({
      kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child', mode: 'unknown',
    })
  })
})
