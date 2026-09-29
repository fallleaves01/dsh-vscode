/**
 * Token accounting for one model call, and for the turn it belongs to.
 *
 * DSH attaches `usage` to each `assistant/message` event — one model call — and
 * leaves the turn aggregate to the client. Both figures are read from remote
 * payloads, so nothing is trusted without validating it first.
 */

/** The usage DSH reports for a single model call. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** What a turn's worth of model calls cost, as DSH's own usage panel reports it. */
export interface TurnTokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  /** Provider/model routes that contributed, in first-seen order. */
  routes: string[]
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Read one call's usage, or nothing.
 *
 * `inputTokens` and `outputTokens` are the two DSH always writes; a payload
 * missing either is not a usage figure, and substituting a zero would invent a
 * number the runtime never reported.
 */
export function tokenUsageOf(value: unknown): TokenUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const inputTokens = countOf(record.inputTokens)
  const outputTokens = countOf(record.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const optional = {
    ...(countOf(record.totalTokens) === undefined ? {} : { totalTokens: countOf(record.totalTokens) as number }),
    ...(countOf(record.cacheReadTokens) === undefined ? {} : { cacheReadTokens: countOf(record.cacheReadTokens) as number }),
    ...(countOf(record.cacheWriteTokens) === undefined ? {} : { cacheWriteTokens: countOf(record.cacheWriteTokens) as number }),
    ...(countOf(record.reasoningTokens) === undefined ? {} : { reasoningTokens: countOf(record.reasoningTokens) as number }),
  }
  return { inputTokens, outputTokens, ...optional }
}

/**
 * Fold the usage of one turn's messages into the turn figure.
 *
 * A cache bucket is only summed when every call reported it: one call that omits
 * the bucket makes the sum a guess, and DSH's own panel omits it in that case
 * rather than under-reporting the cache.
 */
export function turnUsageOf(usages: readonly (TokenUsage | undefined)[], routes: readonly string[]): TurnTokenUsage | undefined {
  const present = usages.filter((usage): usage is TokenUsage => usage !== undefined)
  if (present.length === 0) return undefined
  const sum = (pick: (usage: TokenUsage) => number | undefined): number | undefined => {
    const values = present.map(pick)
    return values.every((value): value is number => value !== undefined)
      ? values.reduce((total, value) => total + value, 0)
      : undefined
  }
  const uncachedInputTokens = present.reduce((total, usage) => total + usage.inputTokens, 0)
  const outputTokens = present.reduce((total, usage) => total + usage.outputTokens, 0)
  const cacheReadTokens = sum(usage => usage.cacheReadTokens)
  const cacheWriteTokens = sum(usage => usage.cacheWriteTokens)
  const reasoningTokens = sum(usage => usage.reasoningTokens)
  // `totalTokens` is optional per call, and a total is only a total when every
  // call supplied one; otherwise it is derived from the buckets we do trust.
  const reported = sum(usage => usage.totalTokens)
  return {
    uncachedInputTokens,
    outputTokens,
    totalTokens: reported ?? uncachedInputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    routes: [...new Set(routes.filter(route => route !== ''))],
  }
}

/**
 * The compact figure DSH shows on the pill: `<1000` raw, then `12.3K`, then `1.2M`,
 * one decimal below 100 and none above it.
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count)
  const scaled = count < 1_000_000 ? count / 1000 : count / 1_000_000
  const suffix = count < 1_000_000 ? 'K' : 'M'
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10
  return `${String(rounded)}${suffix}`
}

/** The exact figure the usage panel uses, with digit grouping. */
export function formatExactTokenCount(count: number): string {
  return count.toLocaleString('en-US')
}
