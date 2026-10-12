import { describe, expect, it } from 'vitest'
import { todosOf } from '../src/task-state.js'

describe('DSH task projection', () => {
  it('accepts whole-list replacements and clears on null', () => {
    expect(todosOf([{ content: 'Inspect', status: 'completed' }, { content: 'Fix', status: 'in_progress' }]))
      .toEqual([{ content: 'Inspect', status: 'completed' }, { content: 'Fix', status: 'in_progress' }])
    expect(todosOf(null)).toEqual([])
  })
  it('does not turn malformed state into invented tasks', () => {
    expect(todosOf([null, { content: '', status: 'pending' }, { content: 'Work', status: 'failed' },
      { content: '<script>safe text</script>', status: 'pending' }]))
      .toEqual([{ content: '<script>safe text</script>', status: 'pending' }])
  })
})
