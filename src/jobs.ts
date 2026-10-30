export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

export interface JobItem {
  id: string
  kind: string
  label: string
  status: JobStatus
  detail?: string
  /** Live progress text (`3/10`); control characters removed, single line, bounded. */
  progress?: string
  /** Retained output byte count reported by the job row, when it carries `output`. */
  outputTotal?: number
  /** Earliest retained output cursor, when the job row carries `output`. */
  outputEarliest?: number
  startedAt: number
  finishedAt?: number
}

const PROGRESS_TEXT_LIMIT = 4_000
/** One session/jobs snapshot is bounded: a hostile runtime cannot inflate the list. */
const MAX_JOB_ROWS = 2_000
const MAX_JOB_ID = 256
const MAX_JOB_KIND = 64
const MAX_JOB_LABEL = 1_024
const MAX_JOB_DETAIL = 4_000

/** One display-safe single line: C0/C1 removed, whitespace collapsed, bounded. */
function displayLine(value: string, limit: number): string {
  const single = value.replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ').replace(/\s+/gu, ' ').trim()
  return single.length > limit ? `${single.slice(0, Math.max(0, limit - 1))}…` : single
}

/** One display-safe progress line: C0/C1 removed, whitespace collapsed, bounded. */
function progressText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const single = value
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (single === '') return undefined
  return single.length > PROGRESS_TEXT_LIMIT ? `${single.slice(0, PROGRESS_TEXT_LIMIT - 1)}…` : single
}

/** A retained-output counter: a non-negative safe integer or nothing. */
function counterOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function statusOf(value: unknown): JobStatus | undefined {
  return value === 'running' || value === 'stopping' || value === 'completed' || value === 'killed' || value === 'failed'
    ? value
    : undefined
}

/** Narrows the authoritative DSH session/jobs snapshot before it reaches the Webview. */
export function jobsSnapshotOf(value: unknown): JobItem[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_JOB_ROWS).flatMap((candidate): JobItem[] => {
    if (typeof candidate !== 'object' || candidate === null) return []
    const item = candidate as Record<string, unknown>
    const status = statusOf(item.status)
    if (typeof item.id !== 'string' || item.id.trim() === '' || item.id.length > MAX_JOB_ID
      || typeof item.kind !== 'string'
      || typeof item.label !== 'string'
      || status === undefined
      || typeof item.startedAt !== 'number'
      || !Number.isFinite(item.startedAt)) return []
    const kind = displayLine(item.kind, MAX_JOB_KIND)
    const label = displayLine(item.label, MAX_JOB_LABEL)
    const output = typeof item.output === 'object' && item.output !== null && !Array.isArray(item.output)
      ? item.output as Record<string, unknown>
      : undefined
    const outputTotal = counterOf(output?.total)
    const outputEarliest = counterOf(output?.earliest)
    const progress = progressText(item.progress)
    return [{
      id: item.id,
      kind: kind === '' ? 'job' : kind,
      label,
      status,
      startedAt: item.startedAt,
      ...(typeof item.detail === 'string' && displayLine(item.detail, MAX_JOB_DETAIL) !== ''
        ? { detail: displayLine(item.detail, MAX_JOB_DETAIL) }
        : {}),
      ...(progress === undefined ? {} : { progress }),
      ...(outputTotal === undefined ? {} : { outputTotal }),
      ...(outputEarliest === undefined ? {} : { outputEarliest }),
      ...(typeof item.finishedAt === 'number' && Number.isFinite(item.finishedAt)
        ? { finishedAt: item.finishedAt }
        : {}),
    }]
  })
}
