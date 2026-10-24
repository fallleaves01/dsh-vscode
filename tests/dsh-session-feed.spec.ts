import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DshFrame } from '../src/dsh-client.js'
import type { DshConnection } from '../src/dsh-connection.js'
import { DshSessionFeed } from '../src/dsh-session-feed.js'

const feeds: DshSessionFeed[] = []
afterEach(() => {
  for (const feed of feeds.splice(0)) feed.dispose()
  vi.useRealTimers()
})

interface FakeSocket extends EventEmitter {
  readyState: number
  send: (raw: string) => void
  terminate: () => void
}

/**
 * Drive the `$events`, `session/control` and `workspace/follow` baselines over a
 * fake carrier. The socket is a real `EventEmitter` so the production frame
 * parser, the item handlers and the carrier abort path all run unchanged.
 */
function harness(options: { eventsReady?: unknown } = {}) {
  const socket = new EventEmitter() as FakeSocket
  socket.readyState = 0
  const outgoing: Array<Record<string, unknown>> = []
  const ids = new Map<string, string>()
  const frames: DshFrame[] = []
  const errors: Error[] = []
  const diagnostics: string[] = []
  const terminate = vi.fn(() => { socket.readyState = 3; socket.emit('close') })
  socket.terminate = terminate
  const receive = (streamId: string, value: unknown): void => {
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'item', streamId, value })), false)
  }
  socket.send = raw => {
    const sent = JSON.parse(raw) as Record<string, unknown>
    outgoing.push(sent)
    if (sent.type !== 'open') return
    const endpoint = sent.endpoint
    const streamId = sent.streamId
    if (typeof endpoint !== 'string' || typeof streamId !== 'string') return
    ids.set(endpoint, streamId)
    queueMicrotask(() => {
      if (endpoint === '$events') receive(streamId, options.eventsReady ?? { type: 'ready', clientId: 'client-1' })
      if (endpoint === 'session/control') receive(streamId, { type: 'baseline', value: { projections: {} } })
      if (endpoint === 'workspace/follow') receive(streamId, { type: 'baseline', value: { archivedSessionIds: [] } })
    })
  }
  const connection = {
    call: vi.fn(async () => ({ accepted: true })),
    openStreamSocket: vi.fn(() => {
      queueMicrotask(() => { socket.readyState = 1; socket.emit('open') })
      return socket
    }),
  } as unknown as DshConnection
  const feed = new DshSessionFeed(connection,
    frame => { frames.push(frame) },
    error => { errors.push(error) },
    message => { diagnostics.push(message) })
  feeds.push(feed)
  const push = (endpoint: string, value: unknown): void => {
    const id = ids.get(endpoint)
    if (id === undefined) throw new Error(`The ${endpoint} baseline is not open.`)
    receive(id, value)
  }
  return { feed, socket, outgoing, frames, errors, diagnostics, push, terminate }
}

describe('$events top-level frame tolerance', () => {
  it('ignores an unknown frame type and keeps processing later frames', async () => {
    const h = harness()
    await h.feed.start()

    h.push('$events', { type: 'future/stream-frame', payload: { seq: 9 } })
    h.push('$events', { type: 'future/stream-frame', payload: { seq: 10 } })
    h.push('$events', { type: 'later/frame-type' })
    // A known envelope with a new event name must keep its existing tolerance.
    h.push('$events', { type: 'emit', event: 'future/event-name', args: [7] })
    h.push('$events', { type: 'emit', event: 'llm/adapters-updated', args: [] })

    expect(h.errors).toEqual([])
    expect(h.terminate).not.toHaveBeenCalled()
    expect(h.socket.readyState).toBe(1)
    expect(h.diagnostics).toEqual([
      '$events: ignored unknown frame type "future/stream-frame"',
      '$events: ignored unknown frame type "later/frame-type"',
    ])
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/models-changed' } })
  })

  it('labels a missing or non-string type without echoing wire text', async () => {
    const h = harness()
    await h.feed.start()

    h.push('$events', { seq: 1 })
    h.push('$events', { type: 42 })
    h.push('$events', { type: 'bad\nforged\r\u0000line' })

    expect(h.errors).toEqual([])
    expect(h.diagnostics).toEqual([
      '$events: ignored unknown frame type "(missing)"',
      '$events: ignored unknown frame type "(number)"',
      '$events: ignored unknown frame type "bad?forged??line"',
    ])
  })

  it('caps the number of distinct unknown types it reports', async () => {
    const h = harness()
    await h.feed.start()

    for (let index = 0; index < 16; index += 1) h.push('$events', { type: `future/type-${String(index)}` })
    h.push('$events', { type: 'future/type-16' })
    h.push('$events', { type: 'future/type-17' })

    expect(h.errors).toEqual([])
    expect(h.diagnostics).toHaveLength(17)
    expect(h.diagnostics.slice(0, 16)).toEqual(
      Array.from({ length: 16 }, (_value, index) => `$events: ignored unknown frame type "future/type-${String(index)}"`),
    )
    expect(h.diagnostics.at(-1))
      .toBe('$events: further unknown frame types are suppressed for this connection (after 16)')
  })

  it.each([
    ['emit without args', { type: 'emit', event: 'settings/document-updated' }],
    ['emit without event name', { type: 'emit', args: [] }],
    ['cancel without eventId', { type: 'cancel' }],
    ['waterfall without request', { type: 'waterfall', eventId: 'e', agentId: 'a', event: 'approval/request' }],
    ['ready without clientId', { type: 'ready' }],
  ])('keeps strict validation for a known top-level type: %s', async (_case, frame) => {
    const h = harness()
    await h.feed.start()

    h.push('$events', frame)

    expect(h.errors).toEqual([
      expect.objectContaining({ name: 'DshStreamError', message: expect.stringContaining('invalid event stream frame') }),
    ])
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it('still rejects a malformed initial ready frame', async () => {
    const h = harness({ eventsReady: { type: 'ready' } })

    await expect(h.feed.start()).rejects.toThrow('invalid event stream frame')
    expect(h.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('invalid event stream frame') })])
  })

  it.each([
    ['session/control baseline without projections', 'session/control', { type: 'baseline', value: {} }],
    ['session/control projection without seq', 'session/control', { type: 'projection', sessionId: 's', key: 'todos' }],
    ['session/control update without session', 'session/control', { type: 'jobs' }],
    ['session/control queue with a wrong payload', 'session/control', { type: 'queue', sessionId: 's', items: 'rows' }],
    ['workspace/follow invalid baseline', 'workspace/follow', { type: 'baseline', value: { archivedSessionIds: [1] } }],
  ])('keeps other streams strict for known frame types: %s', async (_case, endpoint, frame) => {
    const h = harness()
    await h.feed.start()

    h.push(endpoint, frame)

    expect(h.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('invalid event stream frame') })])
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })
})

describe('session/control top-level frame tolerance', () => {
  it('ignores an unknown control frame and keeps processing later projections', async () => {
    const h = harness()
    await h.feed.start()

    h.push('session/control', { type: 'future/control-frame', payload: 1 })
    h.push('session/control', { type: 'future/control-frame', payload: 2 })
    h.push('session/control', {})
    h.push('session/control', { type: 7 })
    h.push('session/control', { type: 'projection', sessionId: 's', key: 'todos', seq: 3, value: [{ content: 'x', status: 'pending' }] })
    h.push('$events', { type: 'future/events-frame' })

    expect(h.errors).toEqual([])
    expect(h.terminate).not.toHaveBeenCalled()
    expect(h.socket.readyState).toBe(1)
    // Each stream owns its diagnostic budget: the control labels are separate
    // from the `$events` labels, with the stream as the prefix.
    expect(h.diagnostics).toEqual([
      'session/control: ignored unknown frame type "future/control-frame"',
      'session/control: ignored unknown frame type "(missing)"',
      'session/control: ignored unknown frame type "(number)"',
      '$events: ignored unknown frame type "future/events-frame"',
    ])
    // The later legal projection is cached and forwarded as usual.
    expect(h.feed.projectionValues('s')).toEqual({ todos: [{ content: 'x', status: 'pending' }] })
    expect(h.frames).toContainEqual({ channel: 'mux', rpcId: '', payload: {
      type: 'session/projection', sessionId: 's', key: 'todos', value: [{ content: 'x', status: 'pending' }],
    } })
  })

  it('caps unknown control types independently of the $events budget', async () => {
    const h = harness()
    await h.feed.start()

    for (let index = 0; index < 16; index += 1) h.push('$events', { type: `future/events-${String(index)}` })
    h.push('$events', { type: 'future/events-overflow' })
    h.push('session/control', { type: 'future/control-frame' })

    expect(h.errors).toEqual([])
    expect(h.diagnostics).toHaveLength(18)
    expect(h.diagnostics.slice(16, 17)).toEqual([
      '$events: further unknown frame types are suppressed for this connection (after 16)',
    ])
    expect(h.diagnostics.at(-1)).toBe('session/control: ignored unknown frame type "future/control-frame"')
  })
})

describe('plugin management invalidation hints', () => {
  it('forwards bundle changes and permission catalogue changes as host invalidations', async () => {
    const h = harness()
    await h.feed.start()

    h.push('$events', { type: 'emit', event: 'plugin-manager/changed', args: [{ reason: 'bundle' }] })
    h.push('$events', { type: 'emit', event: 'permission-presets/catalog-changed', args: [] })

    expect(h.errors).toEqual([])
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/plugins-changed' } })
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/permission-catalog-changed' } })
  })
})
