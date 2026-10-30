import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  progress: vi.fn(),
  terminateProcessTree: vi.fn(),
}))
vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Separator: -1 },
  window: { withProgress: mocks.progress },
  workspace: {
    workspaceFolders: [],
    getWorkspaceFolder: () => undefined,
    getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
  },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../src/launch.js', () => ({
  resolveLaunch: () => ({ command: 'dsh', args: ['plugin', '--profile', 'web'], sourceCheckout: false }),
}))
vi.mock('../src/process-tree.js', () => ({ terminateProcessTree: mocks.terminateProcessTree }))
import { DshPluginManager, PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES, PLUGIN_COMMAND_TIMEOUT_MS, pluginCommandEnv } from '../src/plugin-manager.js'

interface FakeChild extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  pid: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill: () => boolean
}

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  })
}

function harness() {
  const lines: string[] = []
  const controller = {
    runtimeOwnership: 'managed', cwd: '/workspace', state: { phase: 'ready', statusText: '', running: false },
    runtimeIdentity: {}, backgroundRunning: false, isDisposed: false,
    get hasRunningTasks() { return this.state.running || this.backgroundRunning },
    pluginInventory: vi.fn(async () => ({ entries: [], agentPresets: [] })),
    restart: vi.fn(async () => true), mutateSettings: vi.fn(),
  }
  const manager = new DshPluginManager({ extensionUri: { fsPath: '/extension' } } as any, controller as any,
    { appendLine: (line: string) => { lines.push(line) }, append: vi.fn() } as any)
  return { controller, manager, lines }
}

function run(manager: DshPluginManager, args: readonly string[] = ['add', '@example/plugin']): Promise<unknown> {
  return (manager as unknown as { runOfficialPluginCommand(a: readonly string[], title: string): Promise<unknown> })
    .runOfficialPluginCommand(args, 'Installing @example/plugin')
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.progress.mockImplementation((_options: unknown, operation: (progress: unknown, token: unknown) => unknown) =>
    operation({}, { onCancellationRequested: () => ({ dispose() {} }) }))
})
afterEach(() => { vi.useRealTimers() })

describe('plugin command environment', () => {
  it('removes runtime, package-manager and provider credentials but keeps the CLI runtime variables', () => {
    const env = pluginCommandEnv({
      PATH: '/usr/bin', HOME: '/home/user', DSH_HOME: '/home/user/.dsh', DSH_AGENTS_HOME: '/home/user/.dsh-agents',
      PNPM_HOME: '/home/user/.pnpm', XDG_CONFIG_HOME: '/home/user/.config', LANG: 'en_US.UTF-8', TMPDIR: '/tmp', CI: 'true',
      DEEPSEEK_API_KEY: 'dsk-secret', DEEPSEEK_CHAT_KEY: 'dsk-chat', GITHUB_TOKEN: 'ghp-secret', GH_TOKEN: 'gh-token',
      NPM_TOKEN: 'npm-secret', VSCE_PAT: 'vsce-secret', AZURE_CLIENT_SECRET: 'azure-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret', SSH_AUTH_SOCK: '/tmp/agent.sock', SOME_TOKEN: 'some-secret',
      TOKENIZER: 'keep-me', SAFE_VALUE: 'keep-me-too',
    })
    expect(env).toMatchObject({
      PATH: '/usr/bin', HOME: '/home/user', DSH_HOME: '/home/user/.dsh', DSH_AGENTS_HOME: '/home/user/.dsh-agents',
      PNPM_HOME: '/home/user/.pnpm', XDG_CONFIG_HOME: '/home/user/.config', LANG: 'en_US.UTF-8', TMPDIR: '/tmp', CI: 'true',
      TOKENIZER: 'keep-me', SAFE_VALUE: 'keep-me-too',
    })
    for (const removed of ['DEEPSEEK_API_KEY', 'DEEPSEEK_CHAT_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN',
      'VSCE_PAT', 'AZURE_CLIENT_SECRET', 'AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK', 'SOME_TOKEN']) {
      expect(env, removed).not.toHaveProperty(removed)
    }
  })

  it('is case-insensitive for inherited environment names', () => {
    const env = pluginCommandEnv({ Path: '/bin', DEEPSEEK_X_KEY: 'x', aws_region: 'us-east-1', Azure_Key: 'k' })
    expect(env).toMatchObject({ Path: '/bin' })
    expect(env).not.toHaveProperty('DEEPSEEK_X_KEY')
    expect(env).not.toHaveProperty('aws_region')
    expect(env).not.toHaveProperty('Azure_Key')
  })
})

describe('plugin command output', () => {
  it('redacts CLI output and keeps it on single lines', async () => {
    const h = harness()
    const child = fakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const pending = run(h.manager)
    queueMicrotask(() => {
      child.stdout.write('installing sk-abcdefghijklmnop and Bearer abcdefghijklmnop token=supersecret\nsecond line\n')
      child.emit('close', 0)
    })
    await pending
    const output = h.lines.join('\n')
    expect(output).not.toContain('sk-abcdefghijklmnop')
    expect(output).not.toContain('Bearer abcdefghijklmnop')
    expect(output).not.toContain('supersecret')
    expect(output).toContain('[redacted]')
    expect(h.lines.every(line => !/[\r\n]/.test(line))).toBe(true)
    expect(h.lines.join('\n')).toContain('second line')
  })

  it('passes the minimized environment to the CLI process', async () => {
    const h = harness()
    const child = fakeChild()
    const originalPath = process.env.PATH
    process.env.DEEPSEEK_API_KEY = 'dsk-secret'
    process.env.PATH = '/usr/bin'
    try {
      mocks.spawn.mockReturnValueOnce(child)
      const pending = run(h.manager)
      queueMicrotask(() => child.emit('close', 0))
      await pending
      const options = mocks.spawn.mock.calls[0]![2] as { env: NodeJS.ProcessEnv }
      expect(options.env).not.toHaveProperty('DEEPSEEK_API_KEY')
      expect(options.env.PATH).toBe('/usr/bin')
      expect(options.env.NO_COLOR).toBe('1')
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })

  it('truncates output above 256 KiB and marks the truncation', async () => {
    const h = harness()
    const child = fakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const pending = run(h.manager)
    queueMicrotask(() => {
      child.stdout.write('x'.repeat(PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES + 1024) + 'TAIL')
      child.emit('close', 0)
    })
    await pending
    expect(h.lines.join('')).toContain('output truncated after 256 KiB')
    expect(h.lines.join('')).not.toContain('TAIL')
    expect(h.lines.join('').length).toBeLessThanOrEqual(PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES + 200)
  })

  it('redacts a spawn error message', async () => {
    const h = harness()
    const child = fakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const pending = run(h.manager)
    queueMicrotask(() => child.emit('error', new Error('plugin failed token=supersecret')))
    await expect(pending).rejects.toThrow('plugin failed')
    await expect(pending).rejects.not.toThrow('supersecret')
  })

  it('terminates a CLI process that exceeds the timeout', async () => {
    vi.useFakeTimers()
    const h = harness()
    const child = fakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const pending = run(h.manager)
    const assertion = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(PLUGIN_COMMAND_TIMEOUT_MS)
    await assertion
    expect(mocks.terminateProcessTree).toHaveBeenCalledWith(child)
    expect(h.lines.join('\n')).toContain('timed out')
  })
})

describe('catalog diagnostics', () => {
  it('redacts inventory error messages before writing the output channel', async () => {
    const h = harness()
    h.controller.pluginInventory.mockRejectedValueOnce(new Error('inventory token=supersecret'))
    await (h.manager as unknown as { tryInventory(): Promise<unknown> }).tryInventory()
    expect(h.lines.join('\n')).toContain('[plugins] Runtime inventory unavailable')
    expect(h.lines.join('\n')).not.toContain('supersecret')
  })
})
