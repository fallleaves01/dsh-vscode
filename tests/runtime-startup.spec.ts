import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  version: '0.1.2-rc.1',
  timeout: 60_000,
  reuse: false,
  debugging: false,
  children: [] as ChildProcessWithoutNullStreams[],
}))

vi.mock('vscode', () => ({
  EventEmitter: class {
    readonly event = vi.fn()
    fire(): void {}
    dispose(): void {}
  },
  Uri: { parse: (value: string) => ({ toString: () => value, fsPath: '/workspace' }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => key === 'reuseExistingRuntime' ? state.reuse
        // A hostile workspace value; the product must read only the global one.
        : key === 'autonomousDebugging' ? true
        : key === 'startupTimeout' ? state.timeout : fallback,
      inspect: (key: string) => key === 'autonomousDebugging' ? { globalValue: state.debugging } : undefined,
    }),
  },
}))

vi.mock('../src/launch.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/launch.ts')>(),
  findSourceRoot: () => undefined,
  resolveLaunch: (_root: string, _executable: string, args: string[]) => ({ command: process.execPath, args, env: {} }),
}))

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return {
    spawn: vi.fn((_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        pid: 123, exitCode: null as number | null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      }) as unknown as ChildProcessWithoutNullStreams
      if (args.includes('--version')) {
        queueMicrotask(() => {
          child.stdout.emit('data', state.version + '\n')
          child.emit('exit', 0)
          child.emit('close', 0)
        })
      } else {
        state.children.push(child)
      }
      return child
    }),
  }
})

vi.mock('../src/process-tree.ts', () => ({
  terminateProcessTree: vi.fn((child: ChildProcessWithoutNullStreams) => {
    child.emit('exit', 0)
    child.emit('close', 0)
    return true
  }),
}))

import { DshRuntime, clearDshVersionCacheForTests, describeLaunchFailure } from '../src/runtime.ts'
import { terminateProcessTree } from '../src/process-tree.js'
import type { RuntimeLaunchContributor } from '../src/runtime-launch.js'

const runtimes: DshRuntime[] = []
function runtime(contributor?: RuntimeLaunchContributor) {
  const logs: string[] = []
  const readSecret = vi.fn(async () => undefined)
  const instance = new DshRuntime({
    extensionUri: { fsPath: '/extension' }, secrets: { get: readSecret },
  } as never, { appendLine: (line: string) => { logs.push(line) } } as never, contributor)
  runtimes.push(instance)
  return { instance, logs, readSecret }
}

function authResponse(): Response {
  const name = `dsh-auth-${createHash('sha256').update('127.0.0.1:43127').digest('base64url')}`
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${name}=v1.dGVzdA.c2lnbmF0dXJl` } })
}

function rpcResponse(init?: RequestInit): Response {
  const message = JSON.parse(String(init?.body))
  return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: { items: [] } } })
}

beforeEach(() => {
  clearDshVersionCacheForTests()
  state.children = []
  state.version = '0.1.2-rc.1'
  state.timeout = 60_000
  state.reuse = false
  state.debugging = false
  vi.mocked(spawn).mockClear()
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET' ? authResponse() : rpcResponse(init)))
})

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(instance => instance.stop()))
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('launch failure diagnosis', () => {
  it('explains a missing configured executable instead of echoing ENOENT', () => {
    // The real report was "spawn /opt/homebrew/bin/dsh ENOENT" on a Linux host,
    // because Settings Sync carried a macOS path into the remote User settings.
    const enoent = Object.assign(new Error('spawn /opt/homebrew/bin/dsh ENOENT'), { code: 'ENOENT' })
    const message = describeLaunchFailure({ command: '/opt/homebrew/bin/dsh', args: [], sourceCheckout: false }, enoent).message
    expect(message).toContain('/opt/homebrew/bin/dsh')
    expect(message).toContain(process.platform)
    expect(message).toContain('deepseekHarness.executable')
    expect(message).toContain('Settings Sync')
    expect(message).not.toBe('spawn /opt/homebrew/bin/dsh ENOENT')
  })

  it('leaves every other launch failure untouched', () => {
    const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    expect(describeLaunchFailure({ command: 'dsh', args: [], sourceCheckout: false }, denied)).toBe(denied)
    const plain = new Error('boom')
    expect(describeLaunchFailure({ command: 'dsh', args: [], sourceCheckout: false }, plain)).toBe(plain)
    expect(describeLaunchFailure({ command: 'dsh', args: [], sourceCheckout: false }, 'boom').message).toBe('boom')
  })
})

describe('authenticated runtime startup', () => {
  const external = { kind: 'external' as const, launchUrl: new URL('http://127.0.0.1:43127/?token=private-token') }

  it('offers an explicit choice for an authenticated existing runtime instead of spawning another', async () => {
    state.reuse = true
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    const { instance, readSecret } = runtime()
    await expect(instance.start()).rejects.toThrow('requires its launch URL')
    expect(instance.state).toMatchObject({ kind: 'failed', reason: 'runtime-auth' })
    expect(spawn).not.toHaveBeenCalled()
    // The credential read runs in parallel with the version/endpoint work now.
    expect(readSecret).toHaveBeenCalledTimes(1)
  })

  it('never adopts an unauthenticated listener on the shared loopback port', async () => {
    state.reuse = true
    // 127.0.0.1 is host-wide, so any local account can bind 3080. A real DSH
    // answers 401 without its launch token; the stub here answers session/list
    // with a valid-looking shape, which is exactly the impostor case.
    const { instance, logs } = runtime()
    const pending = instance.start()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', `dsh web: ${external.launchUrl.href}\n`)
    await pending
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'managed' })
    expect(logs.join('\n')).toContain('ignoring an unauthenticated service')
  })

  it('skips automatic reuse when the user explicitly chooses a managed runtime', async () => {
    state.reuse = true
    const { instance } = runtime()
    const pending = instance.start(undefined, { kind: 'managed' })
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    expect(fetch).not.toHaveBeenCalled()
    state.children[0]!.stdout.emit('data', `dsh web: ${external.launchUrl.href}\n`)
    await pending
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'managed' })
  })

  it('skips the contract probe for a versioned managed runtime and verifies on the first stream read', async () => {
    const { instance, logs } = runtime()
    const pending = instance.start(undefined, { kind: 'managed' })
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', `dsh web: ${external.launchUrl.href}\n`)
    await pending
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'managed' })
    // Only the auth request: the duplicate session/list probe is gone.
    expect(vi.mocked(fetch).mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual(['/'])
    expect(logs.join('\n')).toContain('contract verified on the first stream read')
  })

  it('keeps the contract probe when the CLI does not report a version', async () => {
    state.version = 'source'
    const { instance, logs } = runtime()
    const pending = instance.start(undefined, { kind: 'managed' })
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', `dsh web: ${external.launchUrl.href}\n`)
    await pending
    expect(vi.mocked(fetch).mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual(['/', '/api/session/list'])
    expect(logs.join('\n')).not.toContain('contract verified on the first stream read')
  })

  it('does not cache a version that failed the support check, so an upgrade is retried', async () => {
    state.version = '0.1.1-rc.2'
    const { instance } = runtime()
    await expect(instance.start(undefined, { kind: 'managed' })).rejects.toThrow('requires DeepSeek Harness')
    expect(state.children).toHaveLength(0)
    // The runtime was upgraded in place; the failed version must not be served again.
    state.version = '0.1.2-rc.1'
    const pending = instance.start(undefined, { kind: 'managed' })
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', `dsh web: ${external.launchUrl.href}\n`)
    await pending
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'managed' })
  })

  it('reads the CLI version once for repeated starts of the same executable', async () => {
    const { instance } = runtime()
    for (let run = 0; run < 2; run += 1) {
      state.children = []
      const pending = instance.start(undefined, { kind: 'managed' })
      await vi.waitFor(() => expect(state.children).toHaveLength(1))
      state.children.at(-1)!.stdout.emit('data', `dsh web: ${external.launchUrl.href}\n`)
      await pending
      await instance.stop()
    }
    const versionSpawns = vi.mocked(spawn).mock.calls.filter(call => (call[1] as string[]).includes('--version'))
    expect(versionSpawns).toHaveLength(1)
  })

  it('connects without a CLI, API key or launch patch, and never owns the external process', async () => {
    const prepare = vi.fn(async () => undefined)
    const { instance, logs, readSecret } = runtime({ prepare })
    const uri = await instance.start(undefined, external)
    expect(uri.toString()).toBe('http://127.0.0.1:43127/')
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'external' })
    expect(instance.connection.authenticated).toBe(true)
    expect(prepare).not.toHaveBeenCalled()
    expect(readSecret).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    const connection = instance.connection
    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map(c => new URL(String(c[0])).pathname)).toEqual(['/', '/api/session/list'])
    expect(calls[1]?.[1]?.headers).toHaveProperty('cookie')
    expect(JSON.stringify({ state: instance.state, logs })).not.toContain('private-token')
    await instance.stop()
    expect(connection.authenticated).toBe(false)
    expect(state.children).toHaveLength(0)
    expect(instance.state.kind).toBe('stopped')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('allows retrying external authentication and never silently falls back to a managed process', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('private-token', { status: 401 }))
    const { instance, logs } = runtime()
    await expect(instance.start(undefined, external)).rejects.toThrow('did not accept')
    expect(instance.state).toMatchObject({ kind: 'failed', reason: 'runtime-auth' })
    expect(spawn).not.toHaveBeenCalled()
    expect(JSON.stringify({ state: instance.state, logs })).not.toContain('private-token')
    await instance.start(undefined, external)
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'external' })
  })

  it('does not accept an authenticated endpoint without the Remote protocol', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET'
      ? authResponse() : new Response(null, { status: 404 })))
    const { instance } = runtime()
    await expect(instance.start(undefined, external)).rejects.toThrow('0.1.2-rc.1')
    expect(instance.state).toMatchObject({ kind: 'failed', reason: 'runtime-auth' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not contact an unsafe external URL', async () => {
    const { instance } = runtime()
    await expect(instance.start(undefined, { kind: 'external', launchUrl: new URL('http://example.com/?token=secret') }))
      .rejects.toThrow('Paste the full launch URL')
    expect(fetch).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('ignores a workspace-scoped autonomous debugging value', async () => {
    // getConfiguration.get() reports the repository-controlled value as true,
    // but only the user/global setting may enable debugging.
    state.debugging = false
    const { instance } = runtime()
    const uri = await instance.start(undefined, external)
    expect(uri.toString()).toBe('http://127.0.0.1:43127/')
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'external' })
  })

  it('does not attach autonomous debugging to an external runtime', async () => {
    state.debugging = true
    const prepare = vi.fn(async () => undefined)
    const { instance } = runtime({ prepare })
    await expect(instance.start(undefined, external)).rejects.toThrow('managed runtime')
    expect(prepare).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('ignores a cancelled external handshake after a replacement has connected', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
    const { instance } = runtime()
    const first = instance.start(undefined, external)
    const checked = expect(first).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await instance.stop()
    await checked
    await instance.start(undefined, { kind: 'external', launchUrl: new URL('http://127.0.0.1:43127/?token=replacement') })
    finish(authResponse())
    await new Promise(resolve => setImmediate(resolve))
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'external' })
    expect(instance.connection.browserUrl().search).toBe('?token=replacement')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects changing targets while a connection is active', async () => {
    const { instance } = runtime()
    await instance.start(undefined, external)
    await expect(instance.start(undefined, { kind: 'managed' })).rejects.toThrow('Disconnect the current runtime')
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'external' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('waits for authentication and a Remote probe before publishing a credential-free ready state', async () => {
    let finishAuth!: (response: Response) => void
    const auth = new Promise<Response>(resolve => { finishAuth = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET' ? auth : rpcResponse(init)))
    const { instance, logs } = runtime()
    const pending = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?to')
    state.children[0]!.stdout.emit('data', 'ken=private-launch-token\r\n')
    expect(instance.state.kind).toBe('starting')
    expect(() => instance.connection).toThrow('not connected')
    finishAuth(authResponse())
    const uri = await pending
    expect(uri.toString()).toBe('http://127.0.0.1:43127/')
    expect(instance.state.kind).toBe('ready')
    expect(JSON.stringify(instance.state)).not.toContain('private-launch-token')
    expect(logs.join('\n')).not.toContain('private-launch-token')
    expect(instance.connection.browserUrl().search).toBe('?token=private-launch-token')
  })

  it('also accepts and redacts launch URLs on stderr', async () => {
    const { instance, logs } = runtime()
    const pending = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.stderr.emit('data', '\u001b[32mdsh web: http://127.0.0.1:43127/?token=secret\u001b[0m\n')
    await pending
    expect(instance.state.kind).toBe('ready')
    expect(logs.join('\n')).not.toContain('token=secret')
  })

  it.each(['stored', 'environment'])('redacts the %s API key even when runtime output echoes it without a label', async source => {
    const { instance, logs, readSecret } = runtime()
    if (source === 'stored') readSecret.mockResolvedValue('test-stored-credential' as never)
    else vi.stubEnv('DEEPSEEK_API_KEY', 'test-stored-credential')
    const pending = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    const child = state.children[0]!
    child.stderr.emit('data', 'provider echoed test-stored-credential\n')
    child.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=secret\n')
    await pending
    expect(logs.join('\n')).not.toContain('test-stored-credential')
    expect(logs.join('\n')).toContain('provider echoed [redacted]')
  })

  it('does not publish or reject a launch failure containing the stored API key', async () => {
    const { instance, readSecret } = runtime()
    readSecret.mockResolvedValue('test-stored-credential' as never)
    const pending = instance.start()
    const rejection = expect(pending).rejects.toThrow('failed for [redacted]')
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.emit('error', new Error('failed for test-stored-credential'))
    await rejection
    expect(JSON.stringify(instance.state)).not.toContain('test-stored-credential')
  })

  it('rejects older DSH before spawning its web process', async () => {
    state.version = '0.1.1-rc.2'
    const { instance } = runtime()
    await expect(instance.start()).rejects.toThrow('0.1.2-rc.1')
    expect(state.children).toEqual([])
    expect(instance.state.kind).toBe('failed')
  })

  it('does not report ready after stop interrupts an authentication request', async () => {
    let finishAuth!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finishAuth = resolve })))
    const { instance } = runtime()
    const pending = instance.start()
    const checked = expect(pending).rejects.toThrow('stopped')
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=secret\n')
    await instance.stop()
    finishAuth(authResponse())
    await checked
    await new Promise(resolve => { setImmediate(resolve) })
    expect(instance.state.kind).toBe('stopped')
    expect(() => instance.connection).toThrow('not connected')
  })

  it('preserves an authentication error after terminating its managed process', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-token', { status: 401 })))
    const { instance, logs } = runtime()
    const pending = instance.start()
    const checked = expect(pending).rejects.toThrow('did not accept')
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=private-token\n')
    await checked
    await new Promise(resolve => { setImmediate(resolve) })
    expect(instance.state).toMatchObject({ kind: 'failed', message: expect.stringContaining('did not accept') })
    expect(logs.join('\n')).not.toContain('private-token')
  })

  it('ignores a late exit from a replaced process', async () => {
    const { instance } = runtime()
    const first = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    const old = state.children[0]!
    old.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=first\n')
    await first
    await instance.stop()
    const second = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(2) })
    state.children[1]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=second\n')
    await second
    old.emit('exit', 1)
    expect(instance.state.kind).toBe('ready')
    expect(instance.connection.authenticated).toBe(true)
  })

  it('shares concurrent startup callers', async () => {
    const { instance } = runtime()
    const first = instance.start()
    const second = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=secret\n')
    expect((await first).toString()).toBe((await second).toString())
  })

  it('can stop before startup has reserved its pending connection', async () => {
    const { instance } = runtime()
    const pending = instance.start()
    const checked = expect(pending).rejects.toThrow('stopped')
    await instance.stop()
    await checked
    expect(state.children).toEqual([])
  })

  it('settles a stop whose own process cannot be signalled', async () => {
    const { instance, logs } = runtime()
    const starting = instance.start()
    await vi.waitFor(() => { expect(state.children).toHaveLength(1) })
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=secret\n')
    await starting

    // A platform that refuses the signal must not leave the stop pending: the
    // next restart awaits the same task, so one throw would wedge the sidebar.
    vi.mocked(terminateProcessTree).mockImplementationOnce(() => { throw new Error('EPERM: not permitted') })
    await expect(instance.stop()).rejects.toThrow('EPERM: not permitted')
    expect(instance.state).toMatchObject({ kind: 'failed' })
    expect(logs.join('\n')).toContain('EPERM: not permitted')
    expect(state.children).toHaveLength(1)
    // Retrying uses the original handle, rather than abandoning the process.
    await instance.stop()
    expect(terminateProcessTree).toHaveBeenLastCalledWith(state.children[0], 'SIGTERM')
    expect(instance.state).toMatchObject({ kind: 'stopped' })
  })

  it.each(['refused', 'no-exit'])('cancels restart when force termination is %s', async outcome => {
    const { instance } = runtime()
    const starting = instance.start()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=secret\n')
    await starting
    vi.useFakeTimers()
    try {
      vi.mocked(terminateProcessTree).mockImplementationOnce(() => true).mockImplementationOnce(() => {
        if (outcome === 'refused') throw new Error('EPERM: force kill refused')
        return true // Signal delivery alone does not prove process exit.
      })
      const restart = instance.restart()
      const rejected = expect(restart).rejects.toThrow(outcome === 'refused' ? 'EPERM' : 'did not exit')
      await vi.advanceTimersByTimeAsync(5_000)
      await rejected
      expect(instance.state).toMatchObject({ kind: 'failed' })
      expect(state.children).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves a startup timeout and ignores a late launch URL', async () => {
    state.timeout = 20
    const { instance } = runtime()
    await expect(instance.start()).rejects.toThrow('within 20 ms')
    await new Promise(resolve => { setImmediate(resolve) })
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=too-late\n')
    expect(instance.state).toMatchObject({ kind: 'failed', message: expect.stringContaining('within 20 ms') })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
