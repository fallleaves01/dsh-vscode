import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    providers: [] as { scheme: string; provider: { provideTextDocumentContent(uri: any): string } }[],
    providerDispose: vi.fn(),
    command: vi.fn(),
    showTextDocument: vi.fn(),
    register: vi.fn(),
  }
  state.register = vi.fn((scheme: string, provider: (typeof state)['providers'][number]['provider']) => {
    state.providers.push({ scheme, provider })
    return { dispose: state.providerDispose }
  })
  return state
})

vi.mock('vscode', () => ({
  workspace: { registerTextDocumentContentProvider: mocks.register },
  Uri: { parse: (value: string) => {
    const index = value.indexOf(':')
    const scheme = index < 0 ? '' : value.slice(0, index)
    const rest = index < 0 ? '' : value.slice(index + 1)
    return { scheme, path: rest, toString: () => value }
  } },
  commands: { executeCommand: mocks.command },
  window: { showTextDocument: mocks.showTextDocument },
}))

import { PLUGIN_DETAIL_SCHEME, PLUGIN_DETAIL_UNAVAILABLE, PluginDetailViewer } from '../src/plugin-detail.js'

const viewers: PluginDetailViewer[] = []
function viewer(): PluginDetailViewer {
  const created = new PluginDetailViewer()
  viewers.push(created)
  return created
}
const found = (markdown = '# Details', extra: Record<string, unknown> = {}) =>
  ({ status: 'found', origin: 'readme', path: 'README.md', markdown, ...extra }) as const
const openedUri = (call = 0): any => mocks.command.mock.calls[call]![1]
const provider = () => mocks.providers.at(-1)!.provider
const content = (uri: any): string => provider().provideTextDocumentContent(uri)

beforeEach(() => {
  mocks.providers.length = 0
  mocks.register.mockClear()
  mocks.providerDispose.mockClear()
  mocks.command.mockReset()
  mocks.command.mockImplementation(async () => undefined)
  mocks.showTextDocument.mockReset()
  mocks.showTextDocument.mockImplementation(async () => ({}))
})
afterEach(() => { viewers.splice(0).forEach(instance => instance.dispose()) })

describe('plugin detail virtual documents', () => {
  it('opens a found document in the Markdown preview with a sanitized custom-scheme URI', async () => {
    const instance = viewer()
    await expect(instance.open(found('# Hello\n\nBody'), 'Acme Notes')).resolves.toBe(true)
    expect(mocks.register).toHaveBeenCalledWith(PLUGIN_DETAIL_SCHEME, expect.objectContaining({ provideTextDocumentContent: expect.any(Function) }))
    const uri = openedUri()
    expect(mocks.command).toHaveBeenCalledWith('markdown.showPreview', uri)
    const printed = String(uri)
    expect(printed).toMatch(new RegExp(`^${PLUGIN_DETAIL_SCHEME}:/plugin-details/detail-[0-9a-f-]{36}/Acme%20Notes\\.md$`))
    // The package-internal document path never enters the URI or the preview title.
    expect(printed).not.toContain('README.md')
    expect(content(uri)).toBe('# Hello\n\nBody')
  })

  it('reports false and opens nothing when the runtime has no detail', async () => {
    const instance = viewer()
    await expect(instance.open({ status: 'none' }, 'Acme Notes')).resolves.toBe(false)
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.showTextDocument).not.toHaveBeenCalled()
  })

  it('keeps one token and one body per opened document', async () => {
    const instance = viewer()
    await instance.open(found('# First'), 'First')
    await instance.open(found('# Second'), 'Second')
    const first = openedUri(0), second = openedUri(1)
    expect(String(first)).not.toBe(String(second))
    expect(String(first)).toMatch(/\/detail-[0-9a-f-]{36}\//)
    expect(String(second)).toMatch(/\/detail-[0-9a-f-]{36}\//)
    expect(content(first)).toBe('# First')
    expect(content(second)).toBe('# Second')
  })

  it('keeps at most 16 documents and expires the oldest body', async () => {
    const instance = viewer()
    for (let index = 0; index < 17; index++) await instance.open(found(`# Detail ${String(index)}`), `Plugin ${String(index)}`)
    expect(content(openedUri(0))).toBe(PLUGIN_DETAIL_UNAVAILABLE)
    expect(content(openedUri(15))).toBe('# Detail 15')
    expect(content(openedUri(16))).toBe('# Detail 16')
  })

  it('strips control characters, bidi overrides and path separators from the tab label', async () => {
    const instance = viewer()
    await instance.open(found('# Secret'), '../../etc/passwd\u202E<script>\u0085')
    const uri = openedUri()
    const printed = String(uri)
    expect(printed).not.toContain('\u202E')
    expect(printed).not.toContain('\u0085')
    expect(printed).not.toContain('/etc/passwd')
    expect(printed).not.toContain('/Users/')
    const label = decodeURIComponent(String(uri.path).split('/').at(-1)!)
    expect(label.endsWith('.md')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(84)
  })

  it("does not let '#' in a title become a URI fragment", async () => {
    const instance = viewer()
    await instance.open(found('# Fragment'), 'Acme #1 <Notes>')
    const printed = String(openedUri())
    // No '#' may reach the URI outside the encoded label, so the editor title
    // is not cut at a fragment boundary.
    expect(printed.slice(printed.indexOf('dsh-plugin-detail:'))).not.toContain('#')
    const label = decodeURIComponent(String(openedUri().path).split('/').at(-1)!)
    expect(label).toBe('Acme 1 Notes.md')
  })

  it('falls back to the text editor when the Markdown preview command fails', async () => {
    const instance = viewer()
    mocks.command.mockRejectedValueOnce(new Error('preview unavailable'))
    await expect(instance.open(found('# Fallback'), 'Plugin')).resolves.toBe(true)
    expect(mocks.showTextDocument).toHaveBeenCalledWith(openedUri(), { preview: true })
  })

  it('rejects and forgets the body when no editor can open the document', async () => {
    const instance = viewer()
    mocks.command.mockRejectedValueOnce(new Error('preview unavailable'))
    mocks.showTextDocument.mockRejectedValueOnce(new Error('editor unavailable'))
    await expect(instance.open(found('# Lost'), 'Plugin')).rejects.toThrow('editor unavailable')
    expect(content(openedUri())).toBe(PLUGIN_DETAIL_UNAVAILABLE)
  })

  it('registers the scheme once no matter how many viewers are live', () => {
    viewer(); viewer(); viewer()
    expect(mocks.register).toHaveBeenCalledOnce()
    expect(mocks.providers).toHaveLength(1)
  })

  it('serves each live settings surface through the one shared registration', async () => {
    // One viewer stands for a chat settings surface, the other for the standalone
    // settings panel: both are alive at once in the extension host.
    const chat = viewer()
    await chat.open(found('# Chat'), 'Chat')
    const standalone = viewer()
    await standalone.open(found('# Standalone'), 'Standalone')
    expect(mocks.register).toHaveBeenCalledOnce()
    expect(content(openedUri(0))).toBe('# Chat')
    expect(content(openedUri(1))).toBe('# Standalone')
    // Closing one surface keeps the other surface's open document readable.
    standalone.dispose()
    expect(mocks.providerDispose).not.toHaveBeenCalled()
    expect(content(openedUri(0))).toBe('# Chat')
  })

  it('keeps the shared provider alive when one of two viewers is disposed', async () => {
    const first = viewer()
    const second = viewer()
    await first.open(found('# First'), 'First')
    second.dispose()
    expect(mocks.providerDispose).not.toHaveBeenCalled()
    // The surviving viewer keeps opening documents against the same registration.
    await expect(first.open(found('# After'), 'After')).resolves.toBe(true)
    expect(mocks.register).toHaveBeenCalledOnce()
    expect(content(openedUri(1))).toBe('# After')
  })

  it('releases the registration and the shared table only with the last viewer', async () => {
    const first = viewer()
    const second = viewer()
    await first.open(found('# Kept'), 'Kept')
    const uri = openedUri(0)
    first.dispose()
    expect(mocks.providerDispose).not.toHaveBeenCalled()
    second.dispose()
    expect(mocks.providerDispose).toHaveBeenCalledOnce()
    expect(content(uri)).toBe(PLUGIN_DETAIL_UNAVAILABLE)
  })

  it('registers again for a new generation and retires the previous generation tokens', async () => {
    const first = viewer()
    await first.open(found('# Old'), 'Old')
    const oldUri = openedUri(0)
    first.dispose()
    expect(mocks.providerDispose).toHaveBeenCalledOnce()
    const second = viewer()
    expect(mocks.register).toHaveBeenCalledTimes(2)
    expect(mocks.providers).toHaveLength(2)
    // The new registration serves a fresh table, so the old token is unavailable.
    expect(content(oldUri)).toBe(PLUGIN_DETAIL_UNAVAILABLE)
    await second.open(found('# New'), 'New')
    expect(content(openedUri(1))).toBe('# New')
  })

  it('unregisters the provider, forgets documents and refuses to open after disposal', async () => {
    const instance = viewer()
    await instance.open(found('# Body'), 'Plugin')
    const uri = openedUri()
    instance.dispose()
    expect(mocks.providerDispose).toHaveBeenCalledOnce()
    expect(content(uri)).toBe(PLUGIN_DETAIL_UNAVAILABLE)
    await expect(instance.open(found('# Again'), 'Plugin')).rejects.toThrow('viewer is closed')
    instance.dispose()
    expect(mocks.providerDispose).toHaveBeenCalledOnce()
  })
})
