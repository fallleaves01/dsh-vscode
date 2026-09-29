// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

const live: Harness[] = []
afterEach(async () => {
  // Let the scheduled render frame drain before the document goes away.
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  instance.sendState()
  instance.posts.length = 0
  return instance
}

/** Reads back the payload of the first posted message of one type. */
function first(instance: Harness, type: string): Record<string, unknown> | undefined {
  return instance.posts.find(post => post.type === type)
}

describe('webview drag and drop', () => {
  it('turns an Explorer file drop into a context reference', async () => {
    const h = open()
    h.drop({
      types: ['resourceurls'],
      data: { ResourceURLs: JSON.stringify(['file:///workspace/src/app.ts', 'file:///workspace/src/util.ts#L4-L9']) },
    })
    await vi.waitFor(() => expect(first(h, 'attach-resources')).toBeDefined())

    expect(first(h, 'attach-resources')?.uris).toEqual([
      { uri: 'file:///workspace/src/app.ts' },
      { uri: 'file:///workspace/src/util.ts', startLine: 4, endLine: 9 },
    ])
    expect(first(h, 'attach-files')).toBeUndefined()
    expect(first(h, 'attach-images')).toBeUndefined()
  })

  it('reads an editor tab drop as a resource with its selection range', async () => {
    const h = open()
    h.drop({ types: ['codeeditors'], data: { CodeEditors: JSON.stringify([{ resource: 'file:///workspace/a.ts', options: { selection: { fragment: 'L12' } } }]) } })
    await vi.waitFor(() => expect(first(h, 'attach-resources')).toBeDefined())
    expect(first(h, 'attach-resources')?.uris).toEqual([{ uri: 'file:///workspace/a.ts', startLine: 12, endLine: 12 }])
  })

  it('never treats an OS drop as a workspace reference, even though it also sets text/uri-list', async () => {
    const h = open()
    h.drop({
      types: ['Files', 'text/uri-list'],
      data: { 'text/uri-list': 'file:///Users/someone/Downloads/report.pdf' },
      files: [new File([new Uint8Array([1, 2, 3])], 'report.pdf', { type: 'application/pdf' })],
    })
    await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())

    expect(first(h, 'attach-resources')).toBeUndefined()
    expect((first(h, 'attach-files')?.files as Array<{ name: string }>)[0]?.name).toBe('report.pdf')
  })

  it('routes an OS image to the image path rather than the file path', async () => {
    const h = open()
    h.drop({ types: ['Files'], files: [new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })] })
    await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
    expect(first(h, 'attach-files')).toBeUndefined()
  })

  it('warns instead of uploading when a folder is dropped from the OS', async () => {
    const h = open()
    h.drop({ types: ['Files'], files: [new File([], 'src', { type: '' })] })
    await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
    expect(String(first(h, 'attachment-error')?.message)).toContain('Explorer')
    expect(first(h, 'attach-files')).toBeUndefined()
  })

  it('refuses a drop before the runtime is ready instead of dropping it silently', async () => {
    const h = harness()
    live.push(h)
    h.sendState({ phase: 'loading' })
    h.posts.length = 0
    h.drop({ types: ['Files'], files: [new File([new Uint8Array([1])], 'a.bin', { type: 'application/octet-stream' })] })
    await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
    expect(first(h, 'attach-files')).toBeUndefined()
  })

  it('leaves a dragged hyperlink alone instead of swallowing it as an attachment', async () => {
    const h = open()
    const event = h.drop({ types: ['text/uri-list'], data: { 'text/uri-list': 'https://example.com/page' } })
    // Not intercepted: the composer keeps the browser's normal link behaviour.
    expect(event.defaultPrevented).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.posts.filter(post => String(post.type).startsWith('attach-'))).toEqual([])
  })

  it('refuses to send while a dropped file is still being read', async () => {
    const h = open()
    h.drop({ types: ['Files'], files: [new File([new Uint8Array([1, 2])], 'a.bin', { type: 'application/octet-stream' })] })
    // Enter is pressed before the upload can settle.
    h.enter()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(first(h, 'send')).toBeUndefined()
  })

  it('sends once the upload has settled', async () => {
    const h = open()
    h.drop({ types: ['Files'], files: [new File([new Uint8Array([1, 2])], 'a.bin', { type: 'application/octet-stream' })] })
    await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'f1', name: 'a.bin', bytes: 2 }], uploads: 0 })
    await new Promise(resolve => setTimeout(resolve, 0))
    h.enter('summarize this')
    await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
    expect(first(h, 'send')?.text).toBe('summarize this')
  })

  it('keeps the send gate closed while the runtime still reports an outstanding upload', async () => {
    const h = open()
    h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 2 })
    await new Promise(resolve => setTimeout(resolve, 0))
    h.enter('too early')
    expect(first(h, 'send')).toBeUndefined()
  })
})
