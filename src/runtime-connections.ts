import { randomUUID } from 'node:crypto'
import { existingRuntimeUrl } from './runtime-target.js'

/**
 * Saved external runtime connections.
 *
 * A profile keeps only non-secret metadata in extension global state. The
 * launch URL (which carries the runtime's authentication token) lives in VS
 * Code Secret Storage under a key derived from the profile id, so a settings
 * sync, a log line or an exported state snapshot cannot leak it.
 */

/** The metadata half of the store, structurally compatible with `vscode.Memento`. */
export interface RuntimeConnectionMemento {
  get<T>(key: string, defaultValue?: T): T | undefined
  update(key: string, value: unknown): Thenable<void> | Promise<void> | void
}

/** The secret half of the store, structurally compatible with `vscode.SecretStorage`. */
export interface RuntimeConnectionSecrets {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>
  store(key: string, value: string): Thenable<void> | Promise<void> | void
  delete(key: string): Thenable<unknown> | Promise<unknown> | void
}

/** One runtime connection as the manager lists it. Never carries the launch URL. */
export interface RuntimeConnectionProfile {
  readonly id: string
  readonly label: string
  readonly host: string
  readonly createdAt: number
  readonly lastUsedAt?: number
}

export const MAX_RUNTIME_CONNECTIONS = 20
export const RUNTIME_CONNECTIONS_KEY = 'deepseekHarness.runtimeConnections.v1'
export const RUNTIME_CONNECTION_SECRET_PREFIX = 'deepseekHarness.runtimeConnection.'

const MAX_LABEL = 80
const MAX_METADATA_ENTRIES = 200

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Safe display label: controls removed, whitespace collapsed, bounded. */
function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const text = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_LABEL)
  return text === '' ? fallback : text
}

function profileOf(value: unknown): RuntimeConnectionProfile | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  if (typeof row.id !== 'string' || row.id === '' || row.id.length > 128) return undefined
  if (typeof row.label !== 'string' || row.label === '' || row.label.length > MAX_LABEL * 2) return undefined
  if (typeof row.host !== 'string' || row.host === '' || row.host.length > 300) return undefined
  if (typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)) return undefined
  const createdAt = row.createdAt
  const lastUsedAt = typeof row.lastUsedAt === 'number' && Number.isFinite(row.lastUsedAt) ? row.lastUsedAt : undefined
  return { id: row.id, label: cleanLabel(row.label, row.host), host: row.host,
    createdAt, ...(lastUsedAt === undefined ? {} : { lastUsedAt }) }
}

/** The public list shape: host plus a display label, never a launch URL. */
export function publicRuntimeConnections(value: unknown): RuntimeConnectionProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const profiles: RuntimeConnectionProfile[] = []
  for (const row of value.slice(0, MAX_METADATA_ENTRIES)) {
    const profile = profileOf(row)
    if (profile === undefined || seen.has(profile.id)) continue
    seen.add(profile.id)
    profiles.push(profile)
  }
  return profiles.sort((left, right) => left.createdAt - right.createdAt)
}

export class RuntimeConnectionStore {
  constructor(
    private readonly memento: RuntimeConnectionMemento,
    private readonly secrets: RuntimeConnectionSecrets,
    /** Test seam: deterministic id and clock. */
    private readonly options: { newId?: () => string; now?: () => number } = {},
  ) {}

  private get id(): () => string { return this.options.newId ?? randomUUID }
  private get now(): () => number { return this.options.now ?? Date.now }
  private secretKey(id: string): string { return RUNTIME_CONNECTION_SECRET_PREFIX + id }

  /** All saved connections, metadata only. Malformed entries are ignored, never repaired. */
  list(): RuntimeConnectionProfile[] {
    try {
      return publicRuntimeConnections(this.memento.get<unknown>(RUNTIME_CONNECTIONS_KEY, []))
    } catch {
      return []
    }
  }

  private async write(profiles: readonly RuntimeConnectionProfile[]): Promise<void> {
    const metadata = profiles.map(profile => ({
      id: profile.id, label: profile.label, host: profile.host, createdAt: profile.createdAt,
      ...(profile.lastUsedAt === undefined ? {} : { lastUsedAt: profile.lastUsedAt }),
    }))
    await this.memento.update(RUNTIME_CONNECTIONS_KEY, metadata)
  }

  /**
   * Save a launch URL for this window and later windows.
   *
   * The URL is validated before anything is written, rejected when it repeats
   * an existing entry, and removed again if the metadata write fails so the two
   * halves of a profile cannot diverge.
   */
  async add(input: { launchUrl: string; label?: string } | string, label?: string): Promise<RuntimeConnectionProfile> {
    const value = typeof input === 'string' ? { launchUrl: input, ...(label === undefined ? {} : { label }) } : input
    const url = existingRuntimeUrl(value.launchUrl)
    const host = url.host
    if (host === '' || host === 'unknown host') throw new Error('That launch URL does not name a runtime host.')
    const profiles = this.list()
    if (profiles.length >= MAX_RUNTIME_CONNECTIONS) {
      throw new Error(`At most ${String(MAX_RUNTIME_CONNECTIONS)} runtime connections can be saved. Delete one before adding another.`)
    }
    const displayLabel = cleanLabel(value.label, host)
    for (const profile of profiles) {
      if (profile.label.toLowerCase() === displayLabel.toLowerCase()) throw new Error(`A runtime connection named “${displayLabel}” already exists.`)
      if (await this.secrets.get(this.secretKey(profile.id)) === url.href) {
        throw new Error(`That launch URL is already saved as “${profile.label}”.`)
      }
    }
    const id = this.id()
    const key = this.secretKey(id)
    await this.secrets.store(key, url.href)
    try {
      const profile: RuntimeConnectionProfile = { id, label: displayLabel, host, createdAt: this.now() }
      await this.write([...profiles, profile])
      return profile
    } catch (error) {
      await this.secrets.delete(key)
      throw error
    }
  }

  async getLaunchUrl(id: string): Promise<string | undefined> {
    if (id === '') return undefined
    const value = await this.secrets.get(this.secretKey(id))
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /** Delete the record and its secret; the external process is never touched here. */
  async remove(id: string): Promise<RuntimeConnectionProfile | undefined> {
    const profiles = this.list()
    const found = profiles.find(profile => profile.id === id)
    if (found === undefined) return undefined
    await this.secrets.delete(this.secretKey(id))
    await this.write(profiles.filter(profile => profile.id !== id))
    return found
  }

  async markUsed(id: string): Promise<void> {
    const profiles = this.list()
    if (!profiles.some(profile => profile.id === id)) return
    const used = this.now()
    await this.write(profiles.map(profile => profile.id === id
      ? { id: profile.id, label: profile.label, host: profile.host, createdAt: profile.createdAt, lastUsedAt: used }
      : profile))
  }

  findByHost(host: string): RuntimeConnectionProfile | undefined {
    const wanted = host.trim().toLowerCase()
    if (wanted === '') return undefined
    return this.list().find(profile => profile.host.toLowerCase() === wanted)
  }
}
