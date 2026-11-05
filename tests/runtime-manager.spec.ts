import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pick: vi.fn(async (..._args: any[]) => undefined as any),
  warning: vi.fn(async (..._args: any[]) => undefined as any),
  info: vi.fn(async (..._args: any[]) => undefined as any),
  error: vi.fn(async (..._args: any[]) => undefined as any),
  input: vi.fn(async (..._args: any[]) => undefined as any),
}))

vi.mock('vscode', () => ({
  window: {
    showQuickPick: mocks.pick,
    showWarningMessage: mocks.warning,
    showInformationMessage: mocks.info,
    showErrorMessage: mocks.error,
    showInputBox: mocks.input,
  },
}))

import {
  manageRuntimes,
  runtimeHostLabel,
  startManagedRuntimeFlow,
  runtimeManagerSnapshot,
  type RuntimeManagerHost,
  type RuntimeManagerSnapshot,
} from '../src/runtime-manager.js'
import type { RuntimeState } from '../src/runtime.js'

afterEach(() => {
  mocks.pick.mockReset(); mocks.pick.mockResolvedValue(undefined)
  mocks.warning.mockReset(); mocks.warning.mockResolvedValue(undefined)
  mocks.info.mockReset(); mocks.info.mockResolvedValue(undefined)
  mocks.error.mockReset(); mocks.error.mockResolvedValue(undefined)
  mocks.input.mockReset(); mocks.input.mockResolvedValue(undefined)
})

function snapshot(overrides: Partial<RuntimeManagerSnapshot> = {}): RuntimeManagerSnapshot {
  return {
    current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 4321, host: '127.0.0.1:3080' },
    saved: { host: '127.0.0.1:9999' },
    recorded: { pid: 5555, cwd: '/leftover', host: '127.0.0.1:4444', held: 3, heldIsLowerBound: false },
    ...overrides,
  }
}

function host(overrides: Partial<RuntimeManagerHost> = {}): RuntimeManagerHost {
  return {
    workspaceOpen: true,
    snapshot: vi.fn(async () => snapshot()),
    disconnectCurrent: vi.fn(async () => 'Disconnected and stopped the DSH runtime this window was using.'),
    execute: vi.fn(async () => {}),
    showOutput: vi.fn(),
    ...overrides,
  }
}

/** The items the manager offered on one QuickPick call. */
function offered(call = 0): Array<Record<string, any>> {
  return (mocks.pick.mock.calls[call]?.[0] ?? []) as Array<Record<string, any>>
}

function pickAction(action: string): Record<string, any> {
  return { label: action, action }
}

describe('runtime manager list', () => {
  it('lists the current connection, a saved runtime, a leftover runtime and the actions', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    const items = offered()
    expect(items.find(item => item.action === 'current')).toMatchObject({
      label: '$(plug) Current connection: Ready',
      description: 'managed · 127.0.0.1:3080',
      detail: 'cwd: /workspace · pid 4321',
    })
    expect(items.find(item => item.action === 'saved')).toMatchObject({
      label: '$(cloud) Saved external runtime',
      description: 'attach-only · 127.0.0.1:9999',
    })
    expect(items.find(item => item.action === 'recorded')).toMatchObject({
      label: '$(server-process) Extension-started runtime: pid 5555',
      description: 'started by this extension · 127.0.0.1:4444',
      detail: 'cwd: /leftover · holding 3 conversation(s)',
    })
    expect(items.find(item => item.action === 'none')?.label).toContain('runtimes you started yourself')
    expect(items.map(item => item.action)).toEqual(expect.arrayContaining(['start-managed', 'connect-external', 'diagnose', 'show-output']))
  })

  it('merges a recorded runtime that is the current connection', async () => {
    const h = host({ snapshot: vi.fn(async () => snapshot({
      current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 4321, host: '127.0.0.1:3080' },
      recorded: { pid: 4321, cwd: '/workspace', held: 2, heldIsLowerBound: false },
    })) })
    mocks.pick.mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    const items = offered()
    expect(items.filter(item => item.action === 'current')).toHaveLength(1)
    expect(items.some(item => item.action === 'recorded')).toBe(false)
    expect(items.find(item => item.action === 'current')?.detail).toContain('holding 2 conversation(s)')
  })

  it('shows a lower-bound held count and redacts a token-bearing detail', async () => {
    const h = host({ snapshot: vi.fn(async () => snapshot({
      current: { phase: 'failed', cwd: '', detail: 'startup failed: http://127.0.0.1:3080/?token=secret-token' },
      recorded: undefined,
      saved: undefined,
    })) })
    mocks.pick.mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    const serialized = JSON.stringify(offered())
    expect(serialized).not.toContain('secret-token')
    expect(serialized).toContain('[redacted]')
    expect(offered().find(item => item.action === 'current')?.label).toBe('$(plug) Current connection: Failed')
  })

  it('says no folder is open and refuses to start a managed runtime without a workspace', async () => {
    const h = host({ workspaceOpen: false, snapshot: vi.fn(async () => snapshot({
      current: { phase: 'stopped', cwd: '' }, saved: undefined, recorded: undefined,
    })) })
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(offered()[0]?.label).toContain('runtimes you started yourself')
    expect(offered().some(item => item.label === '$(warning) No folder is open')).toBe(true)
    expect(mocks.pick.mock.calls[0]![1]?.placeHolder).toContain('No folder is open')
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Open a folder'))
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does nothing when the list is dismissed', async () => {
    const h = host()
    await manageRuntimes(h)
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.disconnectCurrent).not.toHaveBeenCalled()
    expect(h.showOutput).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('reports a snapshot failure instead of showing a stale list', async () => {
    const h = host({ snapshot: vi.fn(async () => { throw new Error('record unreadable') }) })
    await manageRuntimes(h)
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Could not read DSH runtimes'))
    expect(mocks.pick).not.toHaveBeenCalled()
  })
})

describe('runtime manager actions', () => {
  it('starts a managed runtime and connects to a URL through the existing commands', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).toHaveBeenCalledWith('start-managed')

    mocks.pick.mockReset(); mocks.pick.mockResolvedValueOnce(pickAction('connect-external')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).toHaveBeenCalledWith('connect-external')
  })

  it('restarts only after a modal confirmation and then re-reads the list', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('restart')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Restart Runtime')
    await manageRuntimes(h)
    expect(mocks.warning.mock.calls[0]![0]).toContain('Restart the current DSH runtime?')
    expect(String(mocks.warning.mock.calls[0]![1]?.detail)).toContain('interrupts running conversations')
    expect(h.execute).toHaveBeenCalledWith('restart')
    expect(h.snapshot).toHaveBeenCalledTimes(2)
  })

  it('does not restart when the confirmation is cancelled', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('restart')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('reconnects without a confirmation because it stops nothing', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('reconnect')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).toHaveBeenCalledWith('reconnect')
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it('disconnects the current managed runtime after a confirmation', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('disconnect')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Disconnect')
    await manageRuntimes(h)
    expect(mocks.warning.mock.calls[0]![0]).toContain('Disconnect from the DSH runtime?')
    expect(String(mocks.warning.mock.calls[0]![1]?.detail)).toContain('last VS Code window')
    expect(h.disconnectCurrent).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith('Disconnected and stopped the DSH runtime this window was using.')
  })

  it('ends the current extension-started runtime after confirmation', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('end-current')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('End Runtime')
    await manageRuntimes(h)
    expect(mocks.warning.mock.calls[0]![0]).toContain('End the extension-started DSH runtime?')
    expect(h.disconnectCurrent).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does not disconnect when the confirmation is cancelled', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('disconnect')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.disconnectCurrent).not.toHaveBeenCalled()
  })

  it('describes an external runtime disconnect as detach-only and never ends it', async () => {
    const h = host({
      snapshot: vi.fn(async () => snapshot({ current: { phase: 'ready', ownership: 'external', cwd: '/workspace', host: '127.0.0.1:3080' }, saved: undefined, recorded: undefined })),
      disconnectCurrent: vi.fn(async () => 'Disconnected. The external DSH runtime keeps running.'),
    })
    mocks.pick.mockResolvedValueOnce(pickAction('current')).mockResolvedValueOnce(pickAction('disconnect')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Disconnect')
    await manageRuntimes(h)
    expect(String(mocks.warning.mock.calls[0]![1]?.detail)).toContain('external runtime keeps running')
    expect(h.disconnectCurrent).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalledWith('end-recorded')
    expect(mocks.info).toHaveBeenCalledWith('Disconnected. The external DSH runtime keeps running.')
  })

  it('ends a leftover runtime and forgets a saved runtime through their commands', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('recorded')).mockResolvedValueOnce(pickAction('end-recorded')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).toHaveBeenCalledWith('end-recorded')
    expect(h.disconnectCurrent).not.toHaveBeenCalled()

    mocks.pick.mockReset()
    mocks.pick.mockResolvedValueOnce(pickAction('saved')).mockResolvedValueOnce(pickAction('forget-saved')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).toHaveBeenCalledWith('forget-saved')
  })

  it('dispatches diagnose and closes after showing output', async () => {
    const h = host()
    mocks.pick.mockResolvedValueOnce(pickAction('diagnose')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.execute).toHaveBeenCalledWith('diagnose')

    const outputHost = host()
    mocks.pick.mockReset()
    mocks.pick.mockResolvedValueOnce(pickAction('show-output'))
    await manageRuntimes(outputHost)
    expect(outputHost.showOutput).toHaveBeenCalledTimes(1)
    expect(outputHost.execute).not.toHaveBeenCalled()
  })

  it('keeps the last list after an action failure and reports it without secrets', async () => {
    const h = host({ execute: vi.fn(async () => { throw new Error('command failed on http://127.0.0.1:3080/?token=secret-token') }) })
    mocks.pick.mockResolvedValueOnce(pickAction('diagnose')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    const message = String(mocks.error.mock.calls[0]![0])
    expect(message).toContain('The runtime action failed')
    expect(message).not.toContain('secret-token')
    expect(message).toContain('[redacted]')
  })
})

describe('runtime manager helpers', () => {
  it('reduces a launch URL to host:port and never echoes a token', () => {
    expect(runtimeHostLabel('http://127.0.0.1:3080/?token=secret')).toBe('127.0.0.1:3080')
    expect(runtimeHostLabel('not a url')).toBe('unknown host')
    expect(runtimeHostLabel(undefined)).toBe('unknown host')
  })

  it('projects observed runtime facts without a launch URL or token', () => {
    const snapshot = runtimeManagerSnapshot({
      runtime: { kind: 'ready', localUri: { toString: () => 'http://127.0.0.1:3080/?token=secret-token' } as any,
        ownership: 'managed', pid: 7 } as RuntimeState,
      cwd: '/workspace',
      saved: { launchUrl: 'http://127.0.0.1:9999/?token=saved-token' },
      recorded: { pid: 7, cwd: '/workspace', launchUrl: 'http://127.0.0.1:3080/?token=recorded-token', held: 2, heldIsLowerBound: true },
    })
    expect(snapshot.current).toEqual({ phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 7, host: '127.0.0.1:3080' })
    expect(snapshot.saved).toEqual({ host: '127.0.0.1:9999' })
    expect(snapshot.recorded).toEqual({ pid: 7, cwd: '/workspace', host: '127.0.0.1:3080', held: 2, heldIsLowerBound: true })
    expect(JSON.stringify(snapshot)).not.toContain('token=')
  })

  it('redacts a failed runtime message and projects a stopped runtime', () => {
    const failed = runtimeManagerSnapshot({
      runtime: { kind: 'failed', message: 'authentication failed for http://127.0.0.1:3080/?token=secret-token', reason: 'runtime-auth' },
      cwd: '',
    })
    expect(failed.current).toMatchObject({ phase: 'failed', cwd: '' })
    expect(JSON.stringify(failed)).not.toContain('secret-token')
    expect(failed.current.detail).toContain('[redacted]')

    expect(runtimeManagerSnapshot({ runtime: { kind: 'stopped' }, cwd: '/workspace' }).current)
      .toEqual({ phase: 'stopped', cwd: '/workspace' })
  })

  it('contributes the command and its activation event', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      activationEvents?: string[]; contributes?: { commands?: Array<{ command: string; title: string }> }
    }
    expect(manifest.activationEvents).toContain('onCommand:deepseekHarness.manageRuntimes')
    expect(manifest.contributes?.commands).toContainEqual({
      command: 'deepseekHarness.manageRuntimes',
      title: 'DeepSeek Harness: Manage Runtimes',
      icon: '$(server-process)',
    })
  })
})

describe('multi-connection runtime manager', () => {
  const multiSnapshot = (overrides: Partial<RuntimeManagerSnapshot> = {}): RuntimeManagerSnapshot => ({
    current: { phase: 'ready', ownership: 'external', cwd: '/workspace', host: '127.0.0.1:4000', pid: 123 },
    connections: [
      { id: 'c1', label: 'Primary', host: '127.0.0.1:4000', connected: true },
      { id: 'c2', label: 'Secondary', host: '127.0.0.1:5000', connected: false },
    ],
    saved: { host: '127.0.0.1:9999', key: 'legacy:1' },
    ...overrides,
  })

  function multiHost(overrides: Partial<RuntimeManagerHost> = {}): RuntimeManagerHost {
    return host({
      snapshot: vi.fn(async () => multiSnapshot()),
      startManaged: vi.fn(async () => {}),
      saveSaved: vi.fn(async () => ({ label: '127.0.0.1:9999', host: '127.0.0.1:9999' })),
      connectSaved: vi.fn(async () => {}),
      addConnection: vi.fn(async (input: { launchUrl: string; label?: string }) =>
        ({ id: 'new-conn', label: input.label ?? '127.0.0.1:7000', host: '127.0.0.1:7000' })),
      connectConnection: vi.fn(async () => {}),
      removeConnection: vi.fn(async () => ({ label: 'Secondary', host: '127.0.0.1:5000' })),
      ...overrides,
    })
  }

  const pickRow = (id: string): void => {
    mocks.pick.mockImplementationOnce(async (items: any[]) => items.find(item => item.action === 'connection' && item.connection.id === id))
  }

  it('lists every saved connection with its connected state and the add action', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    const items = offered()
    const rows = items.filter(item => item.action === 'connection')
    expect(rows.map(row => row.connection.id)).toEqual(['c1', 'c2'])
    expect(rows[0]).toMatchObject({ label: '$(server) Primary', description: '127.0.0.1:4000 · Connected' })
    expect(rows[1]).toMatchObject({ label: '$(server) Secondary', description: '127.0.0.1:5000 · Not connected' })
    expect(items.some(item => item.action === 'add-connection')).toBe(true)
    expect(JSON.stringify(items)).not.toContain('token=')
  })

  it('only reports a connection as connected for an external/attached current host', async () => {
    const h = multiHost({ snapshot: vi.fn(async () => multiSnapshot({
      current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', host: '127.0.0.1:4000', pid: 123 },
      connections: [{ id: 'c1', label: 'Primary', host: '127.0.0.1:4000', connected: false }],
    })) })
    mocks.pick.mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    const rows = offered().filter(item => item.action === 'connection')
    expect(rows[0]?.description).toBe('127.0.0.1:4000 · Not connected')
  })

  it('connects to a saved connection after confirmation', async () => {
    const h = multiHost()
    pickRow('c2'); mocks.pick.mockResolvedValueOnce(pickAction('connect-connection')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Connect')
    await manageRuntimes(h)
    expect(h.connectConnection).toHaveBeenCalledWith('c2')
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Connected to “Secondary”'))
  })

  it('does not reconnect an already connected entry', async () => {
    const h = multiHost()
    pickRow('c1'); mocks.pick.mockResolvedValueOnce(pickAction('connect-connection')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.connectConnection).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('already connected'))
  })

  it('deletes a saved connection only after confirmation and never ends the process', async () => {
    const h = multiHost()
    pickRow('c2'); mocks.pick.mockResolvedValueOnce(pickAction('delete-connection')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Delete')
    await manageRuntimes(h)
    expect(mocks.warning.mock.calls[0]![0]).toContain('Delete saved runtime connection')
    expect(h.removeConnection).toHaveBeenCalledWith('c2')
    expect(h.execute).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('keeps running'))

    mocks.pick.mockReset()
    const cancelHost = multiHost()
    pickRow('c2'); mocks.pick.mockResolvedValueOnce(pickAction('delete-connection')).mockResolvedValueOnce(undefined)
    await manageRuntimes(cancelHost)
    expect(cancelHost.removeConnection).not.toHaveBeenCalled()
  })

  it('adds a connection from a password URL plus optional label and offers to connect', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(pickAction('add-connection')).mockResolvedValueOnce(undefined)
    mocks.input.mockResolvedValueOnce('http://127.0.0.1:7000/?token=secret-token').mockResolvedValueOnce('Work laptop')
    mocks.info.mockResolvedValueOnce('Connect')
    await manageRuntimes(h)
    expect(JSON.stringify(offered())).not.toContain('secret-token')
    expect(h.addConnection).toHaveBeenCalledWith({ launchUrl: 'http://127.0.0.1:7000/?token=secret-token', label: 'Work laptop' })
    expect(h.connectConnection).toHaveBeenCalledWith('new-conn')
    expect(String(mocks.info.mock.calls[0]![0])).toContain('127.0.0.1:7000')
    expect(String(mocks.info.mock.calls[0]![0])).not.toContain('secret-token')
  })

  it('keeps a saved connection without connecting when the prompt is declined', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(pickAction('add-connection')).mockResolvedValueOnce(undefined)
    mocks.input.mockResolvedValueOnce('http://127.0.0.1:7000/?token=secret-token').mockResolvedValueOnce('')
    await manageRuntimes(h)
    expect(h.addConnection).toHaveBeenCalledWith({ launchUrl: 'http://127.0.0.1:7000/?token=secret-token' })
    expect(h.connectConnection).not.toHaveBeenCalled()
  })

  it('refuses a saved external runtime when one is already connected managed', async () => {
    const h = multiHost({ snapshot: vi.fn(async () => multiSnapshot({
      current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 123, host: '127.0.0.1:4000' },
    })) })
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.startManaged).not.toHaveBeenCalled()
    expect(mocks.warning.mock.calls[0]![0]).toContain('A managed DSH runtime is already connected')
    expect(h.execute).not.toHaveBeenCalledWith('start-managed')
  })

  it('offers Restart instead of spawning another runtime when managed is already connected', async () => {
    const h = multiHost({ snapshot: vi.fn(async () => multiSnapshot({
      current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 123, host: '127.0.0.1:4000' },
      saved: undefined,
    })) })
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Restart Runtime').mockResolvedValueOnce('Restart Runtime')
    await manageRuntimes(h)
    expect(h.startManaged).not.toHaveBeenCalled()
    expect(h.execute).toHaveBeenCalledWith('restart')
  })

  it('connects an idle window to a saved connection without a switch confirmation', async () => {
    const h = multiHost({ snapshot: vi.fn(async () => multiSnapshot({
      current: { phase: 'stopped', cwd: '/workspace' }, saved: undefined,
      connections: [{ id: 'c2', label: 'Secondary', host: '127.0.0.1:5000', connected: false }],
    })) })
    pickRow('c2'); mocks.pick.mockResolvedValueOnce(pickAction('connect-connection')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(h.connectConnection).toHaveBeenCalledWith('c2')
  })

  it('warns before clearing a legacy saved external runtime and starts a real managed runtime', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Start Without Saving')
    await manageRuntimes(h)
    const warning = mocks.warning.mock.calls[0]!
    expect(String(warning[0])).toContain('Start a separate managed DSH runtime?')
    expect(String(warning[1]?.detail)).toContain('clears that saved record')
    expect(String(warning[1]?.detail)).toContain('external process keeps running')
    expect(h.saveSaved).not.toHaveBeenCalled()
    expect(h.startManaged).toHaveBeenCalledWith({ legacyKey: 'legacy:1' })
    expect(h.execute).not.toHaveBeenCalledWith('start-managed')
    expect(mocks.info).toHaveBeenCalledWith('Started a new managed DSH runtime.')
  })

  it('saves the legacy runtime to connections before starting when asked', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Save and Start')
    await manageRuntimes(h)
    expect(h.saveSaved).toHaveBeenCalledTimes(1)
    expect(h.startManaged).toHaveBeenCalledWith({ legacyKey: 'legacy:1' })
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Saved the external DSH runtime'))
  })

  it('still starts when the legacy runtime is already saved under connections', async () => {
    const h = multiHost({ saveSaved: vi.fn(async () => { throw new Error('That launch URL is already saved as “127.0.0.1:9999”.') }) })
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Save and Start')
    await manageRuntimes(h)
    expect(h.startManaged).toHaveBeenCalledWith({ legacyKey: 'legacy:1' })
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('already saved'))
  })

  it('does nothing when the legacy start warning is dismissed', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.startManaged).not.toHaveBeenCalled()
    expect(h.saveSaved).not.toHaveBeenCalled()
  })

  it('starts directly when no legacy saved runtime exists', async () => {
    const h = multiHost({ snapshot: vi.fn(async () => multiSnapshot({
      current: { phase: 'stopped', cwd: '/workspace' }, saved: undefined, connections: [],
    })) })
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.startManaged).toHaveBeenCalledWith({})
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it('reports a failed managed start and re-reads the list', async () => {
    const h = multiHost({ startManaged: vi.fn(async () => { throw new Error('saved record changed; http://127.0.0.1:9999/?token=secret-token') }) })
    mocks.pick.mockResolvedValueOnce(pickAction('start-managed')).mockResolvedValueOnce(undefined)
    mocks.warning.mockResolvedValueOnce('Start Without Saving')
    await manageRuntimes(h)
    const message = String(mocks.error.mock.calls[0]![0])
    expect(message).toContain('Could not start the managed DSH runtime')
    expect(message).not.toContain('secret-token')
    expect(message).toContain('[redacted]')
    expect(h.snapshot).toHaveBeenCalledTimes(2)
  })

  it('connects and saves the legacy saved runtime from its row', async () => {
    const h = multiHost()
    mocks.pick.mockResolvedValueOnce(pickAction('saved')).mockResolvedValueOnce(pickAction('connect-saved')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.connectSaved).toHaveBeenCalledTimes(1)

    mocks.pick.mockReset()
    mocks.pick.mockResolvedValueOnce(pickAction('saved')).mockResolvedValueOnce(pickAction('save-saved')).mockResolvedValueOnce(undefined)
    await manageRuntimes(h)
    expect(h.saveSaved).toHaveBeenCalledTimes(1)
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('saved DSH record was kept'))
  })
})

describe('start managed runtime flow (command entry point)', () => {
  const flowSnapshot = (overrides: Partial<RuntimeManagerSnapshot> = {}): RuntimeManagerSnapshot => ({
    current: { phase: 'ready', ownership: 'external', cwd: '/workspace', host: '127.0.0.1:4000', pid: 123 },
    saved: { host: '127.0.0.1:9999', key: 'legacy:1' },
    ...overrides,
  })

  function flowHost(overrides: Partial<RuntimeManagerHost> = {}): RuntimeManagerHost {
    return host({
      snapshot: vi.fn(async () => flowSnapshot()),
      startManaged: vi.fn(async () => {}),
      saveSaved: vi.fn(async () => ({ label: '127.0.0.1:9999', host: '127.0.0.1:9999' })),
      ...overrides,
    })
  }

  it('runs the legacy warning and record-clearing start without opening the list', async () => {
    const h = flowHost()
    mocks.warning.mockResolvedValueOnce('Start Without Saving')
    await startManagedRuntimeFlow(h)
    expect(mocks.pick).not.toHaveBeenCalled()
    expect(h.startManaged).toHaveBeenCalledWith({ legacyKey: 'legacy:1' })
    expect(h.execute).not.toHaveBeenCalledWith('start-managed')
    expect(mocks.info).toHaveBeenCalledWith('Started a new managed DSH runtime.')
  })

  it('offers Restart instead of spawning when a managed runtime is already connected', async () => {
    const h = flowHost({ snapshot: vi.fn(async () => flowSnapshot({
      current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 123, host: '127.0.0.1:4000' },
      saved: undefined,
    })) })
    mocks.warning.mockResolvedValueOnce(undefined)
    await startManagedRuntimeFlow(h)
    expect(h.startManaged).not.toHaveBeenCalled()
    expect(String(mocks.warning.mock.calls[0]![0])).toContain('A managed DSH runtime is already connected')
  })

  it('dispatches Restart when the existing managed runtime is confirmed', async () => {
    const h = flowHost({ snapshot: vi.fn(async () => flowSnapshot({
      current: { phase: 'ready', ownership: 'managed', cwd: '/workspace', pid: 123, host: '127.0.0.1:4000' },
      saved: undefined,
    })) })
    mocks.warning.mockResolvedValueOnce('Restart Runtime').mockResolvedValueOnce('Restart Runtime')
    await startManagedRuntimeFlow(h)
    expect(h.startManaged).not.toHaveBeenCalled()
    expect(h.execute).toHaveBeenCalledWith('restart')
  })

  it('does nothing when the warning is dismissed', async () => {
    const h = flowHost()
    await startManagedRuntimeFlow(h)
    expect(h.startManaged).not.toHaveBeenCalled()
    expect(h.saveSaved).not.toHaveBeenCalled()
  })

  it('refuses without a workspace before starting', async () => {
    const h = flowHost({ workspaceOpen: false })
    await startManagedRuntimeFlow(h)
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Open a folder'))
    expect(h.startManaged).not.toHaveBeenCalled()
  })

  it('reports a snapshot failure with redaction and starts nothing', async () => {
    const h = flowHost({ snapshot: vi.fn(async () => { throw new Error('record failed for http://127.0.0.1:4000/?token=secret-token') }) })
    await startManagedRuntimeFlow(h)
    const message = String(mocks.error.mock.calls[0]![0])
    expect(message).toContain('Could not read DSH runtimes')
    expect(message).not.toContain('secret-token')
    expect(h.startManaged).not.toHaveBeenCalled()
  })
})
