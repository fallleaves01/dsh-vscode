import { describe, expect, it } from 'vitest'
import { pageConversationMessage } from '../src/tool-output-page.js'

describe('tool output content recursion bounds', () => {
  it('renders a deeply nested view without throwing', () => {
    let content: unknown = [{ text: 'leaf' }]
    for (let depth = 0; depth < 200; depth++) content = [{ content }]
    const message = { role: 'tool', resultView: { card: 'generic', content } } as never
    const page = pageConversationMessage(message)
    expect(JSON.stringify(page.message)).toContain('…')
  })

  it('does not loop on a cyclic content graph', () => {
    const node: Record<string, unknown>[] = []
    node.push({ content: node })
    const message = { role: 'tool', resultView: { card: 'generic', content: node } } as never
    expect(() => pageConversationMessage(message)).not.toThrow()
  })
})
