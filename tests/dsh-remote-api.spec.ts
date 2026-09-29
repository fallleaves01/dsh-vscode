import { describe, expect, it, vi } from 'vitest'
import type { DshConnection } from '../src/dsh-connection.ts'
import { DshRemoteApi } from '../src/dsh-remote-api.ts'

describe('DSH 0.1.2 Session Remotes', () => {
  it('uses the exact named arguments for list, create, rename, cancel and queue mutations', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    await api.listSessions()
    await api.createSession('C:\\Users\\测试\\project')
    await api.renameSession('s1', 'A new title')
    await api.cancel('s1')
    await api.updateQueue('s1', 'm1', { kind: 'steer' })
    expect(call.mock.calls.map(args => args.slice(0, 2))).toEqual([
      ['session/list', { _request: {} }],
      ['session/create', { request: { cwd: 'C:\\Users\\测试\\project' } }],
      ['session/rename', { request: { sessionId: 's1', title: 'A new title' } }],
      ['session/cancel', { request: { sessionId: 's1' } }],
      ['session/updateQueue', { request: { sessionId: 's1', itemId: 'm1', action: { kind: 'steer' } } }],
    ])
  })

  it('mints a fresh user-message requestId and preserves image order and steering', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'YWJj', name: 'diagram.png' }
    await api.prompt('s1', 'inspect this', [image], 'steer')
    await api.prompt('s1', '', [image])
    const first = call.mock.calls[0]![1].request
    const second = call.mock.calls[1]![1].request
    expect(first).toEqual({
      requestId: expect.any(String), sessionId: 's1', mode: 'steer', content: [image, { type: 'text', text: 'inspect this' }],
      clientTimeZone: expect.any(String),
    })
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.content).toEqual([image])
    expect(second.mode).toBe('queue')
  })

  it('sends a staged file as its receipt, never as bytes', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    // The Host resolves the receipt to a durable attachment, so the prompt must
    // carry only the opaque handle the upload returned.
    await api.prompt('s1', 'summarize this', [{ type: 'file', receiptId: 'r-1' }])
    expect(call.mock.calls[0]![1].request.content).toEqual([
      { type: 'file', receiptId: 'r-1' },
      { type: 'text', text: 'summarize this' },
    ])
  })

  it('delivers a subagent message through subagents/prompt', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'YWJj' }
    await api.prompt('child', 'continue', [image], 'steer', 'parent')
    // DSH refuses `session/prompt` for a session owned by subagent routing, so
    // the child is addressed by parent and carries the delivery discriminator.
    expect(call.mock.calls[0]![0]).toBe('subagents/prompt')
    expect(call.mock.calls[0]![1]).toEqual({
      request: {
        requestId: expect.any(String), parentSessionId: 'parent', childSessionId: 'child',
        mode: 'continuable', delivery: 'steer', content: [image, { type: 'text', text: 'continue' }],
        clientTimeZone: expect.any(String),
      },
    })
  })

  it('refuses a file attachment for a subagent before it reaches the Host', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    // The Host admits only the parts it can verify, and a receipt minted for the
    // parent is not one of them — so the refusal happens while the composer
    // still holds the message.
    await expect(api.prompt('child', 'see file', [{ type: 'file', receiptId: 'r-1' }], 'queue', 'parent'))
      .rejects.toThrow('cannot receive file attachments')
    expect(call).not.toHaveBeenCalled()
  })

  it('keeps an ordinary conversation on session/prompt', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    await api.prompt('s1', 'hello')
    expect(call.mock.calls[0]![0]).toBe('session/prompt')
  })

  it('keeps attachment order when images and files are mixed', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const api = new DshRemoteApi({ call } as unknown as DshConnection)
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'YWJj' }
    await api.prompt('s1', 'compare', [image, { type: 'file', receiptId: 'r-2' }])
    expect(call.mock.calls[0]![1].request.content).toEqual([
      { type: 'image', mediaType: 'image/png', data: 'YWJj' },
      { type: 'file', receiptId: 'r-2' },
      { type: 'text', text: 'compare' },
    ])
  })

  it('forwards the client lifetime to all session mutations', async () => {
    const call = vi.fn().mockResolvedValue({ accepted: true })
    const lifetime = new AbortController()
    const api = new DshRemoteApi({ call } as unknown as DshConnection, lifetime.signal)
    await api.prompt('s1', 'hello')
    await api.cancel('s1')
    lifetime.abort()
    expect(call.mock.calls.every(args => args[2] === 30_000 && args[3] === lifetime.signal)).toBe(true)
    expect(call.mock.calls[0]![3].aborted).toBe(true)
  })
})
