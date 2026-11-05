import { describe, expect, it } from 'vitest'
import {
  MAX_RUNTIME_CONNECTIONS,
  RUNTIME_CONNECTIONS_KEY,
  RuntimeConnectionStore,
  publicRuntimeConnections,
} from '../src/runtime-connections.js'

const TOKEN = 'file-private-token'

interface FakeStorage {
  metadata: Map<string, unknown>
  secrets: Map<string, string>
  failMetadata: boolean
  failStore: boolean
}

function storage(): FakeStorage {
  return { metadata: new Map(), secrets: new Map(), failMetadata: false, failStore: false }
}

function storeFor(data: FakeStorage, ids: string[] = []): RuntimeConnectionStore {
  const pendingIds = [...ids]
  return new RuntimeConnectionStore(
    {
      get: <T>(key: string, fallback?: T): T | undefined => (data.metadata.has(key) ? data.metadata.get(key) as T : fallback),
      update: async (key: string, value: unknown) => {
        if (data.failMetadata) throw new Error('metadata write failed')
        data.metadata.set(key, value)
      },
    },
    {
      get: async (key: string) => data.secrets.get(key),
      store: async (key: string, value: string) => {
        if (data.failStore) throw new Error('secret write failed')
        data.secrets.set(key, value)
      },
      delete: async (key: string) => { data.secrets.delete(key) },
    },
    { newId: () => pendingIds.shift() ?? 'generated', now: () => 1_700_000_000_000 },
  )
}

const url = (port: number): string => `http://127.0.0.1:${String(port)}/?token=${TOKEN}`

describe('saved external runtime connections', () => {
  it('stores the launch URL only in Secret Storage and lists label and host', async () => {
    const data = storage()
    const store = storeFor(data, ['conn-a'])
    const profile = await store.add({ launchUrl: url(4000) })
    expect(profile).toEqual({ id: 'conn-a', label: '127.0.0.1:4000', host: '127.0.0.1:4000', createdAt: 1_700_000_000_000 })
    expect(await store.getLaunchUrl('conn-a')).toBe(url(4000))
    expect(data.secrets.get('deepseekHarness.runtimeConnection.conn-a')).toBe(url(4000))
    const metadata = JSON.stringify(data.metadata.get(RUNTIME_CONNECTIONS_KEY))
    expect(metadata).toContain('127.0.0.1:4000')
    expect(metadata).not.toContain(TOKEN)
    expect(metadata).not.toContain('token=')
    expect(metadata).not.toContain('http://')
    expect(store.list()).toEqual([profile])
  })

  it('uses an explicit label, keeps creation order, marks use and finds by host', async () => {
    const data = storage()
    const store = storeFor(data, ['conn-a', 'conn-b'])
    await store.add({ launchUrl: url(4000), label: 'Laptop' })
    await store.add({ launchUrl: url(5000), label: 'Desktop' })
    expect(store.list().map(profile => profile.label)).toEqual(['Laptop', 'Desktop'])
    await store.markUsed('conn-b')
    expect(store.list().find(profile => profile.id === 'conn-b')?.lastUsedAt).toBe(1_700_000_000_000)
    expect(store.findByHost('127.0.0.1:5000')?.label).toBe('Desktop')
    expect(store.findByHost('LOCALHOST:5000')).toBeUndefined()
    expect(await store.getLaunchUrl('missing')).toBeUndefined()
  })

  it('rejects duplicate URLs and duplicate labels without echoing the URL', async () => {
    const data = storage()
    const store = storeFor(data, ['conn-a', 'conn-b'])
    await store.add({ launchUrl: url(4000), label: 'Primary' })
    await expect(store.add({ launchUrl: url(4000), label: 'Second' })).rejects.toThrow(/already saved/i)
    await expect(store.add({ launchUrl: url(5000), label: 'Primary' })).rejects.toThrow(/already exists/i)
    try { await store.add({ launchUrl: url(4000), label: 'Third' }) } catch (error) {
      expect(String(error)).not.toContain(TOKEN)
      expect(String(error)).not.toContain('token=')
    }
  })

  it(`refuses more than ${MAX_RUNTIME_CONNECTIONS} connections`, async () => {
    const data = storage()
    const ids = Array.from({ length: MAX_RUNTIME_CONNECTIONS + 1 }, (_, index) => 'conn-' + String(index))
    const store = storeFor(data, ids)
    for (let index = 0; index < MAX_RUNTIME_CONNECTIONS; index += 1) {
      await store.add({ launchUrl: url(4000 + index), label: 'Connection ' + String(index) })
    }
    await expect(store.add({ launchUrl: url(9000), label: 'Too many' })).rejects.toThrow(/At most 20/)
  })

  it('deletes metadata and the secret together', async () => {
    const data = storage()
    const store = storeFor(data, ['conn-a'])
    await store.add({ launchUrl: url(4000) })
    const removed = await store.remove('conn-a')
    expect(removed?.host).toBe('127.0.0.1:4000')
    expect(await store.getLaunchUrl('conn-a')).toBeUndefined()
    expect(data.metadata.get(RUNTIME_CONNECTIONS_KEY)).toEqual([])
    expect(store.list()).toEqual([])
    expect(await store.remove('conn-a')).toBeUndefined()
  })

  it('rejects an invalid launch URL before writing anything', async () => {
    const data = storage()
    const store = storeFor(data, ['conn-a'])
    await expect(store.add({ launchUrl: 'http://127.0.0.1:4000/' })).rejects.toThrow(/launch URL/i)
    await expect(store.add({ launchUrl: 'https://example.com/?token=' + TOKEN })).rejects.toThrow(/launch URL/i)
    expect(data.metadata.size).toBe(0)
    expect(data.secrets.size).toBe(0)
  })

  it('removes the secret when the metadata write fails', async () => {
    const data = storage()
    data.failMetadata = true
    const store = storeFor(data, ['conn-a'])
    await expect(store.add({ launchUrl: url(4000) })).rejects.toThrow('metadata write failed')
    expect(data.secrets.size).toBe(0)
  })

  it('ignores malformed metadata and never reads a token from it', () => {
    expect(publicRuntimeConnections([
      { id: 'ok', label: 'Good', host: '127.0.0.1:4000', createdAt: 1 },
      { id: '', label: 'Bad', host: 'x', createdAt: 1 },
      { id: 'bad2', label: 'Bad', host: '', createdAt: 1 },
      { id: 'bad3', label: 'Bad', host: 'h', createdAt: 'yesterday' },
      { id: 'dup', label: 'First', host: 'h', createdAt: 2 },
      { id: 'dup', label: 'Second', host: 'h', createdAt: 3 },
      null,
    ]).map(profile => profile.id)).toEqual(['ok', 'dup'])
  })
})
