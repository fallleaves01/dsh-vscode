import { describe, expect, it } from 'vitest'
import { jobsSnapshotOf } from '../src/jobs.js'

describe('jobsSnapshotOf', () => {
  it('keeps the official background job view and rejects malformed rows', () => {
    expect(jobsSnapshotOf([
      {
        id: 'subagent-1',
        kind: 'subagent',
        label: 'Review the API',
        status: 'running',
        startedAt: 100,
      },
      {
        id: 'bash-2',
        kind: 'bash',
        label: 'npm test',
        status: 'failed',
        detail: 'exit code: 1',
        startedAt: 200,
        finishedAt: 250,
      },
      { id: 'bad', kind: 'bash', label: 'bad', status: 'unknown', startedAt: 1 },
    ])).toEqual([
      {
        id: 'subagent-1',
        kind: 'subagent',
        label: 'Review the API',
        status: 'running',
        startedAt: 100,
      },
      {
        id: 'bash-2',
        kind: 'bash',
        label: 'npm test',
        status: 'failed',
        detail: 'exit code: 1',
        startedAt: 200,
        finishedAt: 250,
      },
    ])
  })
})

describe('job row extensions', () => {
  const base = { id: 'j1', kind: 'bash', label: 'npm test', status: 'running', startedAt: 1 }
  it('keeps progress and retained-output counters', () => {
    const [job] = jobsSnapshotOf([{ ...base, progress: '3/10', output: { total: 42, earliest: 7 } }])
    expect(job).toMatchObject({ progress: '3/10', outputTotal: 42, outputEarliest: 7 })
  })
  it('sanitizes progress into one bounded line', () => {
    const [job] = jobsSnapshotOf([{ ...base, progress: 'step\u0001 one\nline ' + 'x'.repeat(5_000) }])
    expect(job!.progress).not.toContain('\u0001')
    expect(job!.progress).not.toContain('\n')
    expect(job!.progress!.length).toBeLessThanOrEqual(4_000)
  })
  it('ignores unsafe output counters and absent fields', () => {
    expect(jobsSnapshotOf([{ ...base, output: { total: -1, earliest: 1.5 } }])[0]).not.toHaveProperty('outputTotal')
    expect(jobsSnapshotOf([{ ...base, output: { total: 'x' } }])[0]).not.toHaveProperty('outputTotal')
    expect(jobsSnapshotOf([base])[0]).toEqual(base)
  })
})

describe('job snapshot bounds', () => {
  it('caps one snapshot at 2,000 rows', () => {
    const rows = Array.from({ length: 100_000 }, (_value, index) => ({
      id: `job-${String(index)}`, kind: 'bash', label: 'task', status: 'running', startedAt: index,
    }))
    expect(jobsSnapshotOf(rows)).toHaveLength(2_000)
  })

  it('rejects invalid ids and bounds kind, label and detail text', () => {
    const label = 'x'.repeat(1024 * 1024)
    const [job] = jobsSnapshotOf([{ id: 'job-1', kind: 'k'.repeat(100), label, status: 'running', startedAt: 1,
      detail: 'line one\nline two ' + 'y'.repeat(5_000) }])
    expect(job!.label.length).toBeLessThanOrEqual(1_024)
    expect(job!.kind.length).toBeLessThanOrEqual(64)
    expect(job!.detail!.length).toBeLessThanOrEqual(4_000)
    expect(job!.detail).not.toContain('\n')
    expect(jobsSnapshotOf([
      { id: '', kind: 'bash', label: 'empty', status: 'running', startedAt: 1 },
      { id: 'i'.repeat(300), kind: 'bash', label: 'long', status: 'running', startedAt: 1 },
      { id: 'ok', kind: 'bash', label: 'kept', status: 'running', startedAt: 1 },
    ])).toEqual([{ id: 'ok', kind: 'bash', label: 'kept', status: 'running', startedAt: 1 }])
  })
})
