import { describe, expect, it } from 'vitest'
import { ConversationProjector, turnFooters, type DshEvent, type MessageMeta } from '../src/conversation.js'
import { withIdeContext } from '../src/ide-context.js'

function event(type: string, seq: number, data: unknown): DshEvent {
  return { type, seq, time: seq, data }
}

describe('turn footers', () => {
  const meta = (usage: unknown): Map<string, MessageMeta> => new Map([
    ['m1', { seq: 4, time: 4, turn: 1, step: 1, usage } as MessageMeta],
  ])

  it('anchors the row to a turn that finished', () => {
    const footers = turnFooters([{ id: 'm1', role: 'assistant', text: 'x' }], meta({ inputTokens: 10, outputTokens: 5 }))
    expect(footers.get('m1')?.turnEnd).toBe(true)
    expect(footers.get('m1')?.turnUsage?.totalTokens).toBe(15)
  })

  it('writes no row for a turn whose reply is still streaming', () => {
    const footers = turnFooters([{ id: 'm1', role: 'assistant', text: 'x', streaming: true }], meta({ inputTokens: 10, outputTokens: 5 }))
    expect(footers.size).toBe(0)
  })

  it('names no route rather than inventing one', () => {
    // The projection does not carry the model that served each call, so a route
    // would have to be made up — and the usage panel would print it.
    const footers = turnFooters([{ id: 'm1', role: 'assistant', text: 'x' }], meta({ inputTokens: 10, outputTokens: 5 }))
    expect(footers.get('m1')?.turnUsage?.routes).toEqual([])
  })
})

describe('ConversationProjector', () => {
  it('keeps human prompts and final assistant text while excluding injected plugin context', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('user/message', 1, { id: 'plugin', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden context' }] }),
      event('user/message', 2, { id: 'human', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
      event('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'Hi' } }),
      event('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'Hi there' }] } }),
    ])

    expect(projector.messages()).toEqual([
      { id: 'human', role: 'user', text: 'hello' },
      // Thinking is surfaced alongside the answer; the plugin-authored user
      // message above is still dropped.
      { id: 'assistant:1:1', role: 'assistant', text: 'Hi there', reasoning: 'private' },
    ])
  })

  it('surfaces live thinking chunks alongside the answer', () => {
    const projector = new ConversationProjector()
    projector.applyStream({ kind: 'start', attemptId: 'attempt', turn: 1, step: 1 })
    projector.applyStream({ kind: 'chunk', attemptId: 'attempt', chunk: { type: 'reasoning-delta', index: 0, text: 'Weighing ' } })
    projector.applyStream({ kind: 'chunk', attemptId: 'attempt', chunk: { type: 'reasoning-delta', index: 1, text: 'options' } })
    projector.applyStream({ kind: 'chunk', attemptId: 'attempt', chunk: { type: 'text-delta', index: 2, text: 'Answer' } })

    const live = projector.messages().filter(message => message.role === 'assistant')
    expect(live).toHaveLength(1)
    expect(live[0]?.reasoning).toBe('Weighing options')
    expect(live[0]?.text).toBe('Answer')
  })

  it('keeps thinking visible for a step that produced no answer text', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('assistant/message', 1, { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'Only thinking here' }] } }),
    ])

    expect(projector.messages()).toEqual([
      { id: 'assistant:1:1', role: 'assistant', text: '', reasoning: 'Only thinking here' },
    ])
  })

  it('updates one streaming assistant row instead of duplicating chunks', () => {
    const projector = new ConversationProjector()
    projector.apply(event('assistant/chunk', 1, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'A' } }))
    projector.apply(event('assistant/chunk', 2, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'B' } }))

    expect(projector.messages()).toEqual([
      { id: 'assistant:2:1', role: 'assistant', text: 'AB', streaming: true },
    ])
  })

  it('hides extension-owned IDE context from the durable user bubble', () => {
    const projector = new ConversationProjector()
    const text = withIdeContext('Explain this', {
      activeFile: { kind: 'file', path: 'src/example.ts' },
      pinned: [],
      mentions: [],
    })
    projector.apply(event('user/message', 1, {
      id: 'contextual',
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    }))

    expect(projector.messages()).toEqual([{ id: 'contextual', role: 'user', text: 'Explain this' }])
  })

  it('correlates official tool results through message.source.callId', () => {
    const projector = new ConversationProjector()
    projector.apply(event('tool/call', 1, { callId: 'call-1', name: 'bash' }))
    projector.apply(event('tool/result', 2, {
      message: {
        source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false }],
      },
    }))

    expect(projector.messages()).toEqual([
      { id: 'tool:call-1', role: 'tool', text: 'bash', detail: 'Completed', failed: false },
    ])
  })

  it('keeps official call and result presentation views for rich tool cards', () => {
    const projector = new ConversationProjector()
    projector.apply(event('tool/call', 1, {
      callId: 'call-rich',
      name: 'bash',
      arguments: '{"command":"pnpm test"}',
    }), {
      for: 'call',
      view: { card: 'terminal', title: 'pnpm test', cwd: '/workspace' },
    })
    projector.apply(event('tool/result', 2, {
      message: {
        source: { kind: 'tool', callId: 'call-rich' },
        content: [{ type: 'tool-result', toolCallId: 'call-rich', content: [{ type: 'text', text: 'passed' }] }],
      },
    }), {
      for: 'result',
      view: { card: 'terminal', output: 'passed', exitCode: 0 },
    })

    expect(projector.messages()).toEqual([expect.objectContaining({
      id: 'tool:call-rich',
      callView: { card: 'terminal', title: 'pnpm test', cwd: '/workspace' },
      resultView: { card: 'terminal', output: 'passed', exitCode: 0 },
      rawInput: '{"command":"pnpm test"}',
      rawResult: 'passed',
    })])
  })

  it('keeps durable assistant and nested tool-result images for client-side loading', () => {
    const projector = new ConversationProjector()
    projector.apply(event('assistant/message', 1, {
      turn: 1,
      step: 1,
      message: {
        content: [{
          type: 'image',
          attachment: {
            attachmentId: 'assistant-image',
            mediaType: 'image/png',
            bytes: 100,
            width: 20,
            height: 10,
            name: 'chart.png',
          },
        }],
      },
    }))
    projector.apply(event('tool/call', 2, { callId: 'image-call', name: 'mcp_image' }))
    projector.apply(event('tool/result', 3, {
      message: {
        source: { kind: 'tool', callId: 'image-call' },
        content: [{
          type: 'tool-result',
          toolCallId: 'image-call',
          content: [{
            type: 'tool-result',
            toolCallId: 'nested',
            content: [{
              type: 'image',
              attachment: {
                attachmentId: 'tool-image',
                mediaType: 'image/webp',
                bytes: 200,
                width: 40,
                height: 30,
              },
            }],
          }],
        }],
      },
    }))

    expect(projector.messages()).toEqual([
      expect.objectContaining({
        id: 'assistant:1:1',
        text: '',
        images: [{
          attachmentId: 'assistant-image',
          mediaType: 'image/png',
          width: 20,
          height: 10,
          name: 'chart.png',
        }],
      }),
      expect.objectContaining({
        id: 'tool:image-call',
        images: [{
          attachmentId: 'tool-image',
          mediaType: 'image/webp',
          width: 40,
          height: 30,
        }],
      }),
    ])
  })

  it('folds official command lifecycle events into one card', () => {
    const projector = new ConversationProjector()
    projector.apply(event('command/run', 1, { commandId: 'command-1', name: 'compact' }))
    projector.apply(event('command/done', 2, { commandId: 'command-1', kind: 'success', text: 'Compacted.' }))

    expect(projector.messages()).toEqual([{
      id: 'command:command-1',
      role: 'command',
      text: '/compact',
      detail: 'Completed',
      failed: false,
      rawResult: 'Compacted.',
    }])
  })

  it('hides plan control transitions from the conversation', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('command/run', 1, { commandId: 'plan', name: 'plan' }),
      event('command/done', 2, { commandId: 'plan', kind: 'success', text: 'Plan mode on.' }),
      event('command/run', 3, { commandId: 'legacy-plan-on', name: 'plan', args: ' on' }),
      event('command/done', 4, { commandId: 'legacy-plan-on', kind: 'success', text: 'Plan mode on.' }),
      event('command/run', 5, { commandId: 'plan-off', name: 'plan', args: ' off' }),
      event('command/done', 6, { commandId: 'plan-off', kind: 'success', text: 'Plan mode off.' }),
    ])

    expect(projector.messages()).toEqual([])
  })
})
