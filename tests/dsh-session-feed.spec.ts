import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DshFrame } from '../src/dsh-client.js'
import type { DshConnection } from '../src/dsh-connection.js'
import { DshConnectionError } from '../src/dsh-connection.js'
import {
  DshSessionFeed, FOLLOW_PAGE_BUDGETS, FOLLOW_SNAPSHOT_TIMEOUT_MS, HISTORY_PAGE_BUDGETS, MAX_FRAME_BYTES, frameBytes,
} from '../src/dsh-session-feed.js'

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
  return { feed, connection, socket, outgoing, frames, errors, diagnostics, push, receive, terminate }
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
    // alpha2's provider model-list refresh and plugin update progress.
    h.push('$events', { type: 'emit', event: 'llm/models-updated', args: [] })
    h.push('$events', { type: 'emit', event: 'plugin-manager/update-state', args: [{ requestId: 'r1', phase: 'checking' }] })
    h.push('$events', { type: 'emit', event: 'plugin-manager/operation', args: [] })

    expect(h.errors).toEqual([])
    expect(h.terminate).not.toHaveBeenCalled()
    expect(h.socket.readyState).toBe(1)
    expect(h.diagnostics).toEqual([
      '$events: ignored unknown frame type "future/stream-frame"',
      '$events: ignored unknown frame type "later/frame-type"',
    ])
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/models-changed' } })
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/plugins-changed' } })
    expect(h.frames.some(frame => frame.payload.type === 'host/models-changed')).toBe(true)
    // The still-unknown event stays safely ignored.
    expect(h.errors).toEqual([])
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
  ])('ignores a known top-level type with an invalid shape: %s', async (_case, frame) => {
    const h = harness()
    await h.feed.start()

    h.push('$events', frame)

    // The frame is diagnosed, not thrown: the shared carrier must stay alive.
    expect(h.diagnostics).toContain('$events: ignored a malformed remote event')
    expect(h.errors).toEqual([])
    expect(h.terminate).not.toHaveBeenCalled()
  })

  it('keeps strict validation for a ready frame without a client id', async () => {
    const h = harness()
    await h.feed.start()

    h.push('$events', { type: 'ready' })

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

/** The `session/follow` snapshot the sidebar requires before it can show a conversation. */
const snapshot = (id: string, cursor = 0, values: Record<string, unknown> = {}) => ({
  type: 'snapshot', header: { id }, cursor, records: [], hasMore: false,
  projections: { asOfSeq: cursor, values },
})

/** The stream id of the newest `session/follow` open, for cancel/failure assertions. */
function newestFollowStream(h: ReturnType<typeof harness>): string {
  const opened = h.outgoing.filter(message => message.type === 'open' && message.endpoint === 'session/follow').at(-1)
  if (opened === undefined || typeof opened.streamId !== 'string') throw new Error('No session/follow subscription was opened.')
  return opened.streamId
}

/** The `maxMessages` budgets of every `session/follow` open, in send order. */
function followBudgets(h: ReturnType<typeof harness>): number[] {
  return h.outgoing
    .filter(message => message.type === 'open' && message.endpoint === 'session/follow')
    .map(message => (message.payload as { args: { request: { maxMessages: number } } }).args.request.maxMessages)
}

/** A structurally valid snapshot whose single wire frame exceeds the size limit. */
const oversizedSnapshot = (id: string) => ({
  ...snapshot(id),
  records: [{ filler: 'x'.repeat(MAX_FRAME_BYTES) }],
})

describe('follow snapshot wait', () => {
  it('asks the runtime to activate the cold session, as alpha2 requires', async () => {
    const h = harness()
    await h.feed.start()
    const pending = h.feed.open('a')
    const opened = h.outgoing.filter(message => message.type === 'open' && message.endpoint === 'session/follow').at(-1)!
    // A superset field: rc.2/rc.3 strip it and promote automatically, alpha2
    // reads it, and omitting it would leave alpha2 on passive observation.
    expect(opened.payload).toMatchObject({ args: { request: { activate: true, maxMessages: 30, assistantStream: true } } })
    // Settle the opener so disposal cannot surface it as an unhandled rejection.
    h.push('session/follow', snapshot('a', 1))
    await pending
  })

  it('rejects with actionable text after the snapshot deadline and can open again', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.feed.start()

    const first = h.feed.open('a')
    const firstError = first.catch((error: unknown) => error as Error)
    const firstStream = newestFollowStream(h)
    // Nothing settles before the bound: the stream is quiet, not failed.
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS - 1)
    expect(await Promise.race([firstError.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending')

    await vi.advanceTimersByTimeAsync(1)
    const timeout = await firstError
    expect(timeout).toBeInstanceOf(Error)
    expect(timeout.message).toBe('The conversation snapshot timed out: DSH did not send it in time. Open the conversation again; if it keeps timing out, reconnect the runtime.')
    // Cleanup: the failed follow is no longer current, its stream was cancelled
    // and the failure is the opener's alone (no feed-level error).
    expect(h.feed.handledSessionIds).not.toContain('a')
    expect(h.outgoing).toContainEqual({ type: 'cancel', streamId: firstStream })
    expect(h.errors).toEqual([])

    // A replacement open is not affected by the old deadline.
    const second = h.feed.open('a')
    h.push('session/follow', snapshot('a', 2, { title: 'Recovered' }))
    const opening = await second
    expect(opening.asOfSeq).toBe(2)
    expect(opening.projections).toMatchObject({ title: 'Recovered' })
    opening.activate()
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS * 3)
    expect(h.errors).toEqual([])
    expect(h.feed.handledSessionIds).toContain('a')
  })

  it('resolves a snapshot that arrives inside the window and keeps streaming events', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.feed.start()

    const pending = h.feed.open('a')
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS - 1)
    h.push('session/follow', snapshot('a', 3, { title: 'A' }))
    const opening = await pending
    expect(opening.asOfSeq).toBe(3)
    expect(opening.isCurrent()).toBe(true)
    // The snapshot timer is cleared, so a later durable event still arrives and
    // the stale deadline never rejects a live conversation.
    opening.activate()
    h.push('session/follow', { type: 'event', event: { seq: 4, time: 40, type: 'turn/end', data: { turn: 1 } } })
    expect(h.frames.some(frame => frame.payload.type === 'session/event')).toBe(true)
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS * 2)
    expect(h.errors).toEqual([])
    expect(h.feed.handledSessionIds).toContain('a')
  })

  it('keeps a superseded open timer from firing against the next conversation', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.feed.start()

    const first = h.feed.open('a')
    const firstError = first.catch((error: unknown) => error as Error)
    const second = h.feed.open('b')
    // The superseded open reports the ordinary supersession, never the timeout.
    expect((await firstError).message).toBe('The conversation subscription changed.')
    // Advancing past A's original deadline must not produce a second rejection
    // or a feed-level error for B, whose own deadline is still open.
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS - 1)
    expect(h.errors).toEqual([])
    h.push('session/follow', snapshot('b', 1))
    const opening = await second
    expect(opening.asOfSeq).toBe(1)
    opening.activate()
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS * 2)
    expect(h.errors).toEqual([])
    expect(h.feed.handledSessionIds).toEqual(['b'])
  })
  it('pins the snapshot wait to eight seconds', () => {
    // The other cases advance by this constant, so only an explicit assertion
    // keeps a silent return to the old thirty-second wait from passing.
    expect(FOLLOW_SNAPSHOT_TIMEOUT_MS).toBe(8_000)
  })
})

describe('follow snapshot page budgets', () => {
  const SNAPSHOT_TOO_LARGE = 'The conversation snapshot is larger than the 8 MiB frame limit. Open the conversation again; if it keeps failing, reconnect the runtime.'

  it('pins the page budgets', () => {
    expect([...FOLLOW_PAGE_BUDGETS]).toEqual([30, 12, 4, 1])
    expect([...HISTORY_PAGE_BUDGETS]).toEqual([30, 12, 4, 1])
  })

  it('retries a snapshot over the frame limit with the next budget and accepts the smaller one', async () => {
    const h = harness()
    await h.feed.start()
    const pending = h.feed.open('a')
    h.push('session/follow', oversizedSnapshot('a'))

    // The first stream was cancelled and the snapshot asked for again with a
    // narrower page instead of being dropped.
    expect(followBudgets(h)).toEqual([30, 12])
    const firstStream = h.outgoing.find(message => message.type === 'open' && message.endpoint === 'session/follow')!.streamId
    expect(h.outgoing).toContainEqual({ type: 'cancel', streamId: firstStream })
    // The diagnostic carries sizes and budgets, never frame content.
    expect(h.diagnostics).toHaveLength(1)
    expect(h.diagnostics[0]).toContain('retrying with maxMessages 12')
    expect(h.diagnostics[0]).not.toContain('xxxxxxxx')

    h.push('session/follow', snapshot('a', 1, { title: 'Small page' }))
    const opening = await pending
    expect(opening.asOfSeq).toBe(1)
    expect(opening.projections).toMatchObject({ title: 'Small page' })
    opening.activate()
    h.push('session/follow', { type: 'event', event: { seq: 2, time: 20, type: 'turn/end', data: { turn: 1 } } })
    expect(h.frames.some(frame => frame.payload.type === 'session/event')).toBe(true)
    expect(h.errors).toEqual([])
  })

  it('fails with an actionable error when every budget is over the frame limit', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.feed.start()
    const pending = h.feed.open('a')
    const failure = pending.catch((error: unknown) => error as Error)
    for (let index = 0; index < FOLLOW_PAGE_BUDGETS.length; index += 1) h.push('session/follow', oversizedSnapshot('a'))

    const error = await failure
    expect(error.message).toBe(SNAPSHOT_TOO_LARGE)
    // Never the generic timeout text: the runtime answered, the frame did not fit.
    expect(error.message).not.toContain('timed out')
    // One conversation failed, not the runtime.
    expect(h.errors).toEqual([])
    expect(h.terminate).not.toHaveBeenCalled()
    expect(h.socket.readyState).toBe(1)
    expect(h.feed.handledSessionIds).not.toContain('a')
    expect(followBudgets(h)).toEqual([...FOLLOW_PAGE_BUDGETS])
    expect(h.diagnostics.at(-1)).toContain('even at maxMessages 1')

    // The eight-second deadline belonged to the failed open and was cleared with
    // it, so it cannot fire a second, generic timeout afterwards.
    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS * 2)
    expect(h.errors).toEqual([])

    // The failed session is not poisoned: opening it again starts over.
    const second = h.feed.open('a')
    h.push('session/follow', snapshot('a', 2))
    const opening = await second
    expect(opening.asOfSeq).toBe(2)
    expect(h.feed.handledSessionIds).toContain('a')
    expect(h.errors).toEqual([])
  })

  it('walks the budget list one step at a time', async () => {
    const h = harness()
    await h.feed.start()
    const pending = h.feed.open('a')
    h.push('session/follow', oversizedSnapshot('a'))
    h.push('session/follow', oversizedSnapshot('a'))
    expect(followBudgets(h)).toEqual([30, 12, 4])

    h.push('session/follow', snapshot('a', 3, { title: 'Third try' }))
    const opening = await pending
    expect(opening.asOfSeq).toBe(3)
    expect(opening.projections).toMatchObject({ title: 'Third try' })
    expect(h.errors).toEqual([])
  })

  it('ignores a late frame from the cancelled stream while the retry is pending', async () => {
    const h = harness()
    await h.feed.start()
    const pending = h.feed.open('a')
    h.push('session/follow', oversizedSnapshot('a'))

    const opens = h.outgoing.filter(message => message.type === 'open' && message.endpoint === 'session/follow')
    expect(opens).toHaveLength(2)
    const stale = opens[0]!.streamId as string
    // A frame already queued for the cancelled stream must neither resolve this
    // open nor move its cursor.
    h.receive(stale, snapshot('a', 7, { title: 'stale' }))
    expect(h.feed.handledSessionIds).toContain('a')

    h.push('session/follow', snapshot('a', 1, { title: 'fresh' }))
    const opening = await pending
    expect(opening.asOfSeq).toBe(1)
    expect(opening.projections).toMatchObject({ title: 'fresh' })
    expect(h.errors).toEqual([])
  })

  it('keeps the original snapshot deadline across a retry', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.feed.start()
    const pending = h.feed.open('a')
    const failure = pending.catch((error: unknown) => error as Error)
    await vi.advanceTimersByTimeAsync(1_000)
    h.push('session/follow', oversizedSnapshot('a'))
    expect(followBudgets(h)).toEqual([30, 12])

    await vi.advanceTimersByTimeAsync(FOLLOW_SNAPSHOT_TIMEOUT_MS - 1_001)
    expect(await Promise.race([failure.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    const timeout = await failure
    expect(timeout.message).toContain('timed out')
    expect(h.errors).toEqual([])
    expect(h.feed.handledSessionIds).not.toContain('a')
  })
})

describe('history page budget fallback', () => {
  const OVERSIZED = () => new DshConnectionError('invalid-response', 'DSH session/page returned a response larger than 8388608 bytes.')
  const PAGE_TOO_LARGE = 'The older history is larger than the 8 MiB frame limit. Open the conversation again; if it keeps failing, reconnect the runtime.'

  async function openConversation(h: ReturnType<typeof harness>): Promise<void> {
    const opening = h.feed.open('a')
    h.push('session/follow', snapshot('a', 5))
    await opening
  }

  const requestedBudgets = (call: ReturnType<typeof vi.mocked<DshConnection['call']>>): number[] =>
    call.mock.calls.map(([, args]) => (args as { request: { maxMessages: number } }).request.maxMessages)

  it('asks for the largest history budget first', async () => {
    const h = harness()
    await h.feed.start()
    await openConversation(h)
    const call = vi.mocked(h.connection.call)
    call.mockResolvedValueOnce({ records: [], hasMore: false })
    await expect(h.feed.page('a', 5)).resolves.toEqual({ events: [], hasMore: false })
    expect(requestedBudgets(call)).toEqual([30])
  })

  it('retries an oversized page with the next budget and returns the smaller page', async () => {
    const h = harness()
    await h.feed.start()
    await openConversation(h)
    const call = vi.mocked(h.connection.call)
    call.mockRejectedValueOnce(OVERSIZED())
    call.mockResolvedValueOnce({ records: [], hasMore: true })
    await expect(h.feed.page('a', 5)).resolves.toEqual({ events: [], hasMore: true })
    expect(requestedBudgets(call)).toEqual([30, 12])
  })

  it('reports a dedicated error when every history budget is oversized', async () => {
    const h = harness()
    await h.feed.start()
    await openConversation(h)
    const call = vi.mocked(h.connection.call)
    call.mockRejectedValue(OVERSIZED())
    await expect(h.feed.page('a', 5)).rejects.toThrow(PAGE_TOO_LARGE)
    expect(requestedBudgets(call)).toEqual([...HISTORY_PAGE_BUDGETS])
    // The failure belongs to this caller; it must not tear down the feed.
    expect(h.errors).toEqual([])
  })

  it('rethrows any other failure unchanged instead of lowering the budget', async () => {
    const h = harness()
    await h.feed.start()
    await openConversation(h)
    const call = vi.mocked(h.connection.call)
    call.mockRejectedValueOnce(new DshConnectionError('gateway/bad-request', 'History is unavailable.'))
    await expect(h.feed.page('a', 5)).rejects.toThrow('History is unavailable.')
    expect(requestedBudgets(call)).toEqual([30])
  })
})

describe('workspace pinned sessions', () => {
  const pinnedFrame = (ids: string[]) => ({ channel: 'host', rpcId: '', payload: { type: 'host/pinned-sessions-changed', pinnedSessionIds: ids } })

  it('reads the pinned list from the workspace baseline and reports it as available', async () => {
    const h = harness()
    // The harness baseline omits pins; a replace frame is the incremental
    // carrier for a runtime that does serve them.
    await h.feed.start()
    h.push('workspace/follow', { type: 'replace', value: { archivedSessionIds: [], pinnedSessionIds: ['b', 'a'] } })
    await expect(h.feed.listWorkspaces()).resolves.toEqual({ archivedSessionIds: [], pinnedSessionIds: ['b', 'a'], pinningAvailable: true })
    expect(h.frames).toContainEqual(pinnedFrame(['b', 'a']))
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [] } })
  })

  it('applies a pinned increment frame and emits it to the host', async () => {
    const h = harness()
    await h.feed.start()
    h.push('workspace/follow', { type: 'pinned', pinnedSessionIds: ['c'] })
    await expect(h.feed.listWorkspaces()).resolves.toMatchObject({ pinnedSessionIds: ['c'], pinningAvailable: true })
    expect(h.frames).toContainEqual(pinnedFrame(['c']))
    expect(h.errors).toEqual([])
  })

  it('reports pinning as unavailable when the runtime omits the list', async () => {
    const h = harness()
    await h.feed.start()
    await expect(h.feed.listWorkspaces()).resolves.toEqual({ archivedSessionIds: [], pinnedSessionIds: [], pinningAvailable: false })
    expect(h.frames.some(frame => frame.payload.type === 'host/pinned-sessions-changed')).toBe(false)
  })

  it('does not claim pinning for a replace frame that omits the list', async () => {
    const h = harness()
    await h.feed.start()
    h.push('workspace/follow', { type: 'replace', value: { archivedSessionIds: [] } })
    expect(h.frames.some(frame => frame.payload.type === 'host/pinned-sessions-changed')).toBe(false)
    await expect(h.feed.listWorkspaces()).resolves.toEqual({ archivedSessionIds: [], pinnedSessionIds: [], pinningAvailable: false })
  })

  it('rejects a malformed pinned list instead of guessing', async () => {
    const h = harness()
    await h.feed.start()
    h.push('workspace/follow', { type: 'baseline', value: { archivedSessionIds: [], pinnedSessionIds: [1] } })
    expect(h.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('invalid event stream frame') })])
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed pinned increment frame', async () => {
    const h = harness()
    await h.feed.start()
    h.push('workspace/follow', { type: 'pinned', pinnedSessionIds: 'a' })
    expect(h.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('invalid event stream frame') })])
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })
})

describe('runtime data bounds and prototype safety', () => {
  it('filters prototype-poisoning projection keys without touching the prototype', async () => {
    const h = harness()
    await h.feed.start()
    h.push('session/control', { type: 'baseline', value: { projections: { a: { asOfSeq: 1, values: {
      title: 'kept', '__proto__': { polluted: true }, constructor: { prototype: { polluted: true } }, prototype: { polluted: true },
    } } } } })
    expect((Object.prototype as any).polluted).toBeUndefined()
    expect(Object.keys(h.feed.projectionValues('a'))).toEqual(['title'])
    expect(h.feed.projectionValues('a').title).toBe('kept')
  })

  it('ignores a malformed known event and keeps the stream alive', async () => {
    const h = harness()
    await h.feed.start()
    h.push('$events', { type: 'emit', event: 'future/event', args: 'not-an-array' })
    expect(h.diagnostics).toContain('$events: ignored a malformed remote event')
    expect(h.errors).toEqual([])
    // The same stream still carries later valid events.
    h.push('$events', { type: 'emit', event: 'llm/models-updated', args: [] })
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/models-changed' } })
  })

  it('fails an opened follow visibly when a live frame exceeds the frame limit', async () => {
    const h = harness()
    await h.feed.start()
    const opening = h.feed.open('a')
    h.push('session/follow', snapshot('a', 1))
    ;(await opening).activate()
    const streamId = newestFollowStream(h)
    h.push('session/follow', { type: 'event', event: { type: 'user/message', seq: 2, time: 2, data: { content: 'x'.repeat(MAX_FRAME_BYTES) } } })

    // No longer silently dropped: the follow ends with one explicit failure that
    // the sidebar can show, instead of a transcript that merely stops moving.
    expect(h.errors).toHaveLength(1)
    expect(h.errors[0]?.message).toBe('The conversation stopped updating: DSH sent a frame larger than the 8 MiB frame limit. Open the conversation again; if it keeps failing, reconnect the runtime.')
    expect((h.feed as unknown as { follow: unknown }).follow).toBeUndefined()
    expect(h.outgoing).toContainEqual({ type: 'cancel', streamId })
    // A conversation-scoped failure must not abort the shared carrier.
    expect(h.terminate).not.toHaveBeenCalled()
    expect(h.socket.readyState).toBe(1)
    h.push('$events', { type: 'emit', event: 'llm/models-updated', args: [] })
    expect(h.frames).toContainEqual({ channel: 'host', rpcId: '', payload: { type: 'host/models-changed' } })
  })

  it('measures frame size in UTF-8 bytes rather than UTF-16 code units', () => {
    const frame = { text: '中文' }
    expect(frameBytes(frame)).toBe(Buffer.byteLength(JSON.stringify(frame), 'utf8'))
    expect(frameBytes(frame)).toBeGreaterThan(JSON.stringify(frame).length)
  })

  it('refuses a frame that is only oversized once multi-byte text is encoded', async () => {
    const h = harness()
    await h.feed.start()
    // Three million CJK code points: under the cap as a JS string length, over
    // it as UTF-8, which is the size the transport actually carries.
    h.push('$events', { type: 'emit', event: 'future/huge', args: ['中'.repeat(3_000_000)] })
    expect(h.diagnostics.filter(line => line.includes('ignored a frame larger than'))).toHaveLength(1)
    expect(h.errors).toEqual([])
  })

  it('bounds per-session projection state', async () => {
    const h = harness()
    await h.feed.start()
    for (let index = 0; index < 20_050; index++) {
      h.push('session/control', { type: 'projection', sessionId: `forged-${String(index)}`, key: 'title', seq: 1, value: 'x' })
    }
    const projections = (h.feed as unknown as { projections: Map<string, unknown> }).projections
    expect(projections.size).toBeLessThanOrEqual(20_000)
    expect(projections.has('forged-20049')).toBe(true)
  })

  it('rejects an oversized runtime frame with one diagnostic', async () => {
    const h = harness()
    await h.feed.start()
    h.push('$events', { type: 'emit', event: 'future/huge', args: ['x'.repeat(9 * 1024 * 1024)] })
    h.push('$events', { type: 'emit', event: 'future/huge', args: ['x'.repeat(9 * 1024 * 1024)] })
    expect(h.diagnostics.filter(line => line.includes('ignored a frame larger than'))).toHaveLength(1)
    expect(h.errors).toEqual([])
  })

  it('bounds per-session status maps under a flood of forged sessions', async () => {
    const h = harness()
    await h.feed.start()
    for (let index = 0; index < 20_050; index++) {
      h.push('$events', { type: 'emit', event: 'api-session/status', args: [`forged-${String(index)}`, true] })
    }
    const running = (h.feed as unknown as { running: Map<string, boolean> }).running
    expect(running.size).toBeLessThanOrEqual(20_000)
    expect(running.has('forged-20049')).toBe(true)
  })

  it('truncates an over-budget history page instead of expanding it', async () => {
    const { decodeHistory, MAX_HISTORY_RECORDS } = await import('../src/dsh-history.ts')
    const records = Array.from({ length: MAX_HISTORY_RECORDS + 10 }, (_value, seq) => ({ type: 'event', event: { type: 'user/message', seq, time: seq, data: {} }, view: {} }))
    expect(decodeHistory(records)).toHaveLength(MAX_HISTORY_RECORDS)
  })
})

describe('per-conversation protocol state caps', () => {
  it('bounds inner projection keys per session and keeps the newest', async () => {
    const h = harness()
    await h.feed.start()
    for (let index = 0; index < 2_500; index++) {
      h.push('session/control', { type: 'projection', sessionId: 'a', key: `key-${String(index)}`, seq: index + 1, value: index })
    }
    const inner = (h.feed as unknown as { projections: Map<string, Map<string, unknown>> }).projections.get('a')!
    expect(inner.size).toBeLessThanOrEqual(2_000)
    expect(inner.has('key-2499')).toBe(true)
    expect(inner.has('key-0')).toBe(false)
  })

  it('bounds frames buffered behind an inactive follow and reports once', async () => {
    const h = harness()
    await h.feed.start()
    const opening = h.feed.open('a')
    h.push('session/follow', snapshot('a', 0))
    await opening
    for (let index = 1; index <= 1_200; index++) {
      h.push('session/follow', { type: 'event', event: { type: 'turn/end', seq: index, time: index, data: { turn: 1 } } })
    }
    const state = (h.feed as unknown as { follow: { pending: unknown[] } }).follow
    expect(state.pending.length).toBeLessThanOrEqual(1_000)
    expect(h.diagnostics.filter(line => line.includes('dropped the oldest buffered frame')).length).toBe(1)
    expect(h.errors).toEqual([])
  })

  it('bounds committed steering message ids per conversation', async () => {
    const h = harness()
    await h.feed.start()
    const opening = h.feed.open('a')
    h.push('session/follow', snapshot('a', 0))
    await opening
    const feed = h.feed as unknown as {
      follow: unknown
      acceptQueuedMessage(state: unknown, entry: { event: { type: string; data: Record<string, unknown> } }): void
    }
    for (let index = 0; index < 25_000; index++) {
      feed.acceptQueuedMessage(feed.follow, { event: { type: 'user/message', data: { id: `m-${String(index)}` } } })
    }
    const state = (h.feed as unknown as { follow: { committedMessages: Set<string> } }).follow
    expect(state.committedMessages.size).toBeLessThanOrEqual(20_000)
    expect(state.committedMessages.has('m-24999')).toBe(true)
    expect(state.committedMessages.has('m-0')).toBe(false)
  })
})
