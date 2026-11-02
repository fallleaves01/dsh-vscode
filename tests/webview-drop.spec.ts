// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatHtml, harness, type Harness } from './webview-harness.js'

/**
 * Drop handling mirrors DSH's two audiences: a resource the extension host can
 * resolve becomes an `@` reference, while bytes the Webview received from the OS
 * are staged through the Host's upload path. The payloads below are the shapes
 * VS Code actually writes (see artifacts/team/drop-vscode-capabilities.md).
 */
const live: Harness[] = []
afterEach(async () => {
  vi.useRealTimers()
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
/** Reads back every posted message of one type. */
function all(instance: Harness, type: string): Array<Record<string, unknown>> {
  return instance.posts.filter(post => post.type === type)
}
function first(instance: Harness, type: string): Record<string, unknown> | undefined {
  return all(instance, type)[0]
}

interface DragItem {
  kind?: string
  type?: string
  getAsFile?: () => File | null
  webkitGetAsEntry?: () => { isDirectory: boolean } | null
  getAsFileSystemHandle?: () => Promise<{ kind: string }>
}
interface DragPayload {
  types: string[]
  data?: Record<string, string>
  files?: File[]
  items?: DragItem[]
}
function transfer(payload: DragPayload): Record<string, unknown> {
  const files = payload.files ?? []
  return {
    types: payload.types,
    files,
    items: payload.items ?? [],
    dropEffect: 'none',
    getData: (format: string) => payload.data?.[format] ?? '',
  }
}
function fireDrag(type: string, payload: DragPayload, relatedTarget: EventTarget | null = null, target: EventTarget = document): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; relatedTarget: unknown }
  Object.defineProperty(event, 'dataTransfer', { value: transfer(payload) })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  target.dispatchEvent(event)
  return event
}
const drop = (payload: DragPayload, target: EventTarget = document): Event => fireDrag('drop', payload, null, target)
/** One OS file plus the matching item metadata a real drag would expose. */
function osDrop(items: DragItem[], files: File[], extra: Partial<DragPayload> = {}): Event {
  return drop({ types: ['Files', ...(extra.types ?? [])], data: extra.data, files, items })
}
/** Drive the hidden local picker: give it the selected File objects and fire change. */
function selectLocalFiles(h: Harness, files: File[]): HTMLInputElement {
  const input = h.document.getElementById('localFiles') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return input
}

describe('webview drag and drop', () => {
  describe('workspace resources become DSH references', () => {
    it('merges ResourceURLs into a resolve-references request instead of attach-resources', async () => {
      const h = open()
      drop({
        types: ['resourceurls'],
        data: { ResourceURLs: JSON.stringify(['file:///workspace/src/app.ts', 'file:///workspace/src/util.ts#L4-L9']) },
      })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      const request = first(h, 'resolve-references')!
      expect(request.sessionId).toBe('session-a')
      expect(request.resources).toEqual([
        { uri: 'file:///workspace/src/app.ts', source: 'internal' },
        { uri: 'file:///workspace/src/util.ts', source: 'internal', startLine: 4, endLine: 9 },
      ])
      expect(all(h, 'attach-resources')).toEqual([])
      expect(all(h, 'attach-files')).toEqual([])
    })

    it('merges every source, dedupes by URI and reads the editor selection object', async () => {
      const h = open()
      drop({
        types: ['codeeditors', 'resourceurls', 'application/vnd.code.uri-list'],
        data: {
          CodeEditors: JSON.stringify([{ resource: 'file:///workspace/a.ts', options: { selection: { startLineNumber: 3, startColumn: 1, endLineNumber: 7, endColumn: 2 } } }]),
          ResourceURLs: JSON.stringify(['file:///workspace/b.ts#L4-L9', 'file:///workspace/a.ts']),
          'application/vnd.code.uri-list': ['file:///workspace/dir/'].join('\n'),
        },
      })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      const resources = first(h, 'resolve-references')!.resources as Array<Record<string, unknown>>
      // The editor range is the object field, not options.selection.fragment.
      expect(resources.find(item => item.uri === 'file:///workspace/a.ts')).toEqual({ uri: 'file:///workspace/a.ts', source: 'internal', startLine: 3, endLine: 7 })
      expect(resources.find(item => item.uri === 'file:///workspace/b.ts')).toEqual({ uri: 'file:///workspace/b.ts', source: 'internal', startLine: 4, endLine: 9 })
      expect(resources.find(item => item.uri === 'file:///workspace/dir/')).toEqual({ uri: 'file:///workspace/dir/', source: 'internal' })
      // Every URI appears once even though Explorer set several formats.
      expect(resources.map(item => item.uri)).toEqual(['file:///workspace/a.ts', 'file:///workspace/b.ts', 'file:///workspace/dir/'])
    })

    it('accepts CodeFiles absolute paths as internal candidates', async () => {
      const h = open()
      const event = drop({ types: ['codefiles'], data: { CodeFiles: JSON.stringify(['/workspace/src/c.ts']) } })
      expect(event.defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      expect(first(h, 'resolve-references')!.resources).toEqual([{ uri: 'file:///workspace/src/c.ts', source: 'internal' }])
    })

    it('normalizes a Windows drive path from CodeFiles', async () => {
      const h = open()
      drop({ types: ['codefiles'], data: { CodeFiles: JSON.stringify(['C:\\Users\\dev\\a.ts']) } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      expect(first(h, 'resolve-references')!.resources).toEqual([{ uri: 'file:///C:/Users/dev/a.ts', source: 'internal' }])
    })

    it('falls back to the legacy fragment spelling when the object is absent', async () => {
      const h = open()
      drop({ types: ['codeeditors'], data: { CodeEditors: JSON.stringify([{ resource: 'file:///workspace/a.ts', options: { selection: 'L12' } }]) } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      expect(first(h, 'resolve-references')!.resources).toEqual([{ uri: 'file:///workspace/a.ts', source: 'internal', startLine: 12, endLine: 12 }])
    })

    it('splits a text/uri-list Explorer payload (CR/LF, comments) and shows the overlay', async () => {
      const h = open()
      const uriList = '# Explorer selection\r\nfile:///workspace/a.ts\rfile:///workspace/b.ts\nfile:///workspace/c.ts'
      const enter = fireDrag('dragenter', { types: ['text/uri-list'], data: { 'text/uri-list': uriList } })
      expect(enter.defaultPrevented).toBe(true)
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
      drop({ types: ['text/uri-list'], data: { 'text/uri-list': uriList } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      expect(first(h, 'resolve-references')!.resources).toEqual([
        { uri: 'file:///workspace/a.ts', source: 'uri-list' },
        { uri: 'file:///workspace/b.ts', source: 'uri-list' },
        { uri: 'file:///workspace/c.ts', source: 'uri-list' },
      ])
    })

    it('accepts a resource application/vnd.code.* kind only when it carries a workspace URI', async () => {
      const h = open()
      const tree = fireDrag('dragenter', { types: ['application/vnd.code.tree.explorer'], data: { 'application/vnd.code.tree.explorer': 'file:///workspace/a.ts' } })
      expect(tree.defaultPrevented).toBe(true)
      const other = fireDrag('dragenter', { types: ['application/vnd.code.symbols'], data: { 'application/vnd.code.symbols': '{"symbol":"x"}' } })
      expect(other.defaultPrevented).toBe(false)
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
    })

    it('merges CodeFiles, ResourceURLs and the internal URI list without duplicates', async () => {
      const h = open()
      drop({
        types: ['resourceurls', 'codefiles', 'application/vnd.code.uri-list'],
        data: {
          ResourceURLs: JSON.stringify(['file:///workspace/a.ts', 'file:///workspace/b.ts']),
          CodeFiles: JSON.stringify(['/workspace/c.ts', '/workspace/d.ts']),
          'application/vnd.code.uri-list': 'file:///workspace/b.ts\rfile:///workspace/c.ts',
        },
      })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      expect((first(h, 'resolve-references')!.resources as Array<{ uri: string }>).map(item => item.uri)).toEqual([
        'file:///workspace/a.ts', 'file:///workspace/b.ts', 'file:///workspace/c.ts', 'file:///workspace/d.ts',
      ])
    })

    it('offers the generic uri-list as a uri-list candidate only without OS files', async () => {
      const h = open()
      drop({
        types: ['resourceurls', 'text/uri-list'],
        data: {
          ResourceURLs: JSON.stringify(['file:///workspace/src/app.ts']),
          'text/uri-list': 'file:///workspace/src/other.ts',
        },
      })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      expect(first(h, 'resolve-references')!.resources).toEqual([
        { uri: 'file:///workspace/src/app.ts', source: 'internal' },
        { uri: 'file:///workspace/src/other.ts', source: 'uri-list' },
      ])
    })

    it('inserts resolved references at the caret and reports errors through the toast', async () => {
      const h = open()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'summarize '
      prompt.setSelectionRange(prompt.value.length, prompt.value.length)
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      h.posts.length = 0
      drop({ types: ['resourceurls'], data: { ResourceURLs: JSON.stringify(['file:///workspace/src/app.ts']) } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      const requestId = first(h, 'resolve-references')!.requestId as number
      h.send({ type: 'references-resolved', requestId, references: [{ text: '@src/app.ts', label: 'app.ts', kind: 'file' }, { text: '@"src/my file.ts"', label: 'my file.ts', kind: 'file' }], pinned: 0, errors: [] })
      const inserted = prompt.value
      expect(inserted).toBe('summarize @src/app.ts @"src/my file.ts"')
      expect(prompt.selectionStart).toBe(inserted.length)
      expect(h.document.activeElement).toBe(prompt)

      // The second batch fails: the first error is shown in the existing toast.
      h.posts.length = 0
      drop({ types: ['resourceurls'], data: { ResourceURLs: JSON.stringify(['file:///workspace/src/outside.ts']) } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      h.send({ type: 'references-resolved', requestId: first(h, 'resolve-references')!.requestId as number, references: [], pinned: 0, errors: ['That item is outside the DeepSeek project.'] })
      await vi.waitFor(() => expect(h.document.getElementById('sessionNotice')!.classList.contains('hidden')).toBe(false))
      expect(h.document.getElementById('sessionNotice')!.textContent).toContain('outside the DeepSeek project')
    })

    it('ignores a references answer for a conversation that was switched away from', async () => {
      const h = open()
      await h.settle()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'keep this draft'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      h.posts.length = 0
      drop({ types: ['resourceurls'], data: { ResourceURLs: JSON.stringify(['file:///workspace/old.ts']) } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      const requestId = first(h, 'resolve-references')!.requestId as number

      // Switching away clears the wait; an answer that arrives afterwards must
      // neither insert text nor toast into the conversation the user is in.
      h.sendState({ sessionId: 'session-b' })
      await h.settle()
      h.send({ type: 'references-resolved', requestId, references: [{ text: '@old.ts', label: 'old.ts', kind: 'file' }], pinned: 0, errors: ['late error'] })
      expect(h.document.getElementById('sessionNotice')!.classList.contains('hidden')).toBe(true)

      // Switching back must not replay the old answer either.
      h.sendState({ sessionId: 'session-a' })
      await h.settle()
      expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('keep this draft')
      expect(h.document.getElementById('prompt') as HTMLTextAreaElement).not.toBeNull()
      expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).not.toContain('@old.ts')
    })

    it('applies one references answer exactly once', async () => {
      const h = open()
      await h.settle()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'draft'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      h.posts.length = 0
      drop({ types: ['resourceurls'], data: { ResourceURLs: JSON.stringify(['file:///workspace/first.ts']) } })
      await vi.waitFor(() => expect(first(h, 'resolve-references')).toBeDefined())
      const requestId = first(h, 'resolve-references')!.requestId as number
      h.send({ type: 'references-resolved', requestId, references: [{ text: '@first.ts', label: 'first.ts', kind: 'file' }], pinned: 0, errors: ['first error'] })
      expect(prompt.value).toBe('draft @first.ts')
      expect(h.document.getElementById('sessionNotice')!.textContent).toContain('first error')

      // A repeated answer is ignored: no second insertion and no second toast.
      h.send({ type: 'references-resolved', requestId, references: [{ text: '@second.ts', label: 'second.ts', kind: 'file' }], pinned: 0, errors: ['second error'] })
      expect(prompt.value).toBe('draft @first.ts')
      expect(h.document.getElementById('sessionNotice')!.textContent).toContain('first error')
      expect(h.document.getElementById('sessionNotice')!.textContent).not.toContain('second error')
    })

    it('times out a resolve-references wait and ignores the late answer', async () => {
      const h = open()
      await h.settle()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'summarize'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      h.posts.length = 0
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      drop({ types: ['resourceurls'], data: { ResourceURLs: JSON.stringify(['file:///workspace/a.ts']) } })
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
      const request = first(h, 'resolve-references')!
      expect(request).toBeDefined()
      vi.advanceTimersByTime(10_000)
      expect(h.document.getElementById('sessionNotice')!.classList.contains('hidden')).toBe(false)
      expect(h.document.getElementById('sessionNotice')!.textContent).toContain('did not answer')

      // A late answer must not edit the prompt after the timeout notice.
      h.send({ type: 'references-resolved', requestId: request.requestId as number, references: [{ text: '@a.ts', label: 'a.ts', kind: 'file' }], pinned: 0, errors: [] })
      expect(prompt.value).toBe('summarize')
      // The gate is free again: the request no longer blocks Send.
      h.enter('send without references')
      expect(first(h, 'send')).toBeDefined()
      vi.useRealTimers()
    })

    it('leaves a dragged hyperlink alone instead of swallowing it as a reference', () => {
      const h = open()
      const event = fireDrag('drop', { types: ['text/uri-list'], data: { 'text/uri-list': 'https://example.com/page' } })
      // A pure link drag is not a file drag: the composer keeps normal behaviour.
      expect(event.defaultPrevented).toBe(false)
      expect(h.posts).toEqual([])
    })
  })

  describe('operating-system files are uploaded', () => {
    it('reads and sends at most eight OS files per drop and tells the user', async () => {
      const h = open()
      const files = Array.from({ length: 20 }, (_value, index) => new File([new Uint8Array([index])], 'f' + String(index) + '.bin', { type: 'application/octet-stream' }))
      osDrop(files.map(() => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) })), files)
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      expect((first(h, 'attach-files')!.files as Array<{ name: string }>).map(file => file.name)).toEqual([
        'f0.bin', 'f1.bin', 'f2.bin', 'f3.bin', 'f4.bin', 'f5.bin', 'f6.bin', 'f7.bin',
      ])
      expect(first(h, 'attachment-error')!.message).toBe('You can attach up to 8 files at once.')
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(8)
    })

    it('caps a twenty-image drop at eight reads', async () => {
      const h = open()
      const files = Array.from({ length: 20 }, (_value, index) => new File([new Uint8Array([137, 80, 78, 71])], 'img' + String(index) + '.png', { type: 'image/png' }))
      osDrop(files.map(() => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) })), files)
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      expect((first(h, 'attach-images')!.images as unknown[])).toHaveLength(8)
      expect(first(h, 'attachment-error')!.message).toBe('You can attach up to 8 files at once.')
      expect(all(h, 'attach-files')).toEqual([])
    })

    it('refuses an oversized file before reading any bytes', async () => {
      const h = open()
      const huge = { name: 'huge.bin', size: 33 * 1024 * 1024, type: 'application/octet-stream' } as unknown as File
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [huge])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toContain('larger than the 32 MB attachment limit')
      expect(String(first(h, 'attachment-error')!.message)).not.toContain('could not be read')
      expect(all(h, 'attach-files')).toEqual([])
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
    })

    it('refuses an oversized image before reading any bytes', async () => {
      const h = open()
      const huge = { name: 'huge.png', size: 40 * 1024 * 1024, type: 'image/png' } as unknown as File
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [huge])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toContain('larger than the 32 MB attachment limit')
      expect(all(h, 'attach-images')).toEqual([])
    })

    it('never treats an OS drop as a workspace reference', async () => {
      const h = open()
      osDrop(
        [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }],
        [new File([new Uint8Array([1, 2, 3])], 'report.pdf', { type: 'application/pdf' })],
        { types: ['text/uri-list'], data: { 'text/uri-list': 'file:///Users/someone/Downloads/report.pdf' } },
      )
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      const files = first(h, 'attach-files')!.files as Array<{ name: string; data: string }>
      expect(files[0]!.name).toBe('report.pdf')
      expect(files[0]!.data).not.toBe('')
      expect(all(h, 'resolve-references')).toEqual([])
    })

    it('shows an uploading card, then a ready chip once the Host stages it', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1, 2])], 'a.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      const requestId = first(h, 'attach-files')!.requestId as number
      expect(h.document.querySelector('.attachment-chip.uploading')).not.toBeNull()
      expect(h.document.getElementById('attachments')!.textContent).toContain('Uploading…')
      // The Host repeats the uploading phase; it must stay a pending card.
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'a.bin', state: 'uploading' })
      expect(h.document.querySelector('.attachment-chip.uploading')).not.toBeNull()
      // Upload in progress: the send gate stays closed.
      h.enter('ready yet?')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(first(h, 'send')).toBeUndefined()

      h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'a.bin', state: 'ready', id: 'receipt-1', bytes: 2 })
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'draft-1', name: 'a.bin', bytes: 2 }], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelector('.attachment-chip.uploading')).toBeNull()
      expect(h.document.getElementById('attachments')!.textContent).toContain('a.bin')
      h.enter('send now')
      await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
      expect(first(h, 'send')!.text).toBe('send now')
    })

    it('keeps the original bytes for Retry and removes only the failed card', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([9, 8, 7])], 'retry.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      const firstData = (first(h, 'attach-files')!.files as Array<{ data: string }>)[0]!.data
      const requestId = first(h, 'attach-files')!.requestId as number
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'retry.bin', state: 'error', error: 'network down' })
      expect(h.document.querySelector('.attachment-chip.upload-error')).not.toBeNull()
      expect(h.document.getElementById('attachments')!.textContent).toContain('Upload failed')
      // A failed card also blocks the send gate, like DSH's draft rail.
      h.enter('blocked')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(first(h, 'send')).toBeUndefined()

      h.click('.attachment-retry')
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      const retry = all(h, 'attach-files')[1]!
      expect((retry.files as Array<{ name: string; data: string }>)[0]).toEqual({ name: 'retry.bin', data: firstData })
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: retry.requestId as number, name: 'retry.bin', state: 'ready', id: 'receipt-2', bytes: 3 })
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'draft-2', name: 'retry.bin', bytes: 3 }], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelector('.attachment-chip.upload-error')).toBeNull()
      h.enter('send retried')
      await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
    })

    it('refuses a directory entry without trying to read it', async () => {
      const h = open()
      // The Entry API is authoritative: this zero-byte item is a directory.
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }], [new File([], 'src', { type: '' })])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toContain('Explorer')
      expect(all(h, 'attach-files')).toEqual([])
    })

    it('treats a readable empty file as a file, not a directory', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([], 'empty.txt', { type: 'text/plain' })])
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(1))
      expect((first(h, 'attach-files')!.files as Array<{ name: string }>)[0]!.name).toBe('empty.txt')
    })

    it('removes a failed local card without inventing a Host id and then re-gates normally', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([4])], 'bad.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      const requestId = first(h, 'attach-files')!.requestId as number
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'bad.bin', state: 'error', error: 'refused' })
      expect(h.document.querySelector('.attachment-chip.upload-error')).not.toBeNull()
      h.click('.attachment-chip.upload-error .attachment-remove')
      expect(all(h, 'remove-attachment')).toEqual([])
      expect(h.document.querySelector('.attachment-chip.upload-error')).toBeNull()
      // The Host's own counter still owns the batch; once it settles Send reopens.
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      h.enter('after removal')
      await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
    })

    it('sends a single retry request for a double-clicked Retry button', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([6])], 'double.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: first(h, 'attach-files')!.requestId as number, name: 'double.bin', state: 'error', error: 'network' })
      const retry = h.document.querySelector<HTMLButtonElement>('.attachment-retry')!
      // A detached double click must not post the file twice.
      retry.click()
      retry.click()
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      expect(all(h, 'attach-files')).toHaveLength(2)
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(1)
      expect(retry.disabled).toBe(true)
    })

    it('turns a settled upload the Host never staged into a retryable failure', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([5])], 'lost.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      // A conversation switch can make the Host abandon the upload; the publish
      // then reports no outstanding uploads and no draft file.
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelector('.attachment-chip.upload-error')).not.toBeNull()
      expect(h.document.getElementById('attachments')!.textContent).toContain('The upload was not completed.')
      expect(h.document.querySelector('.attachment-retry')).not.toBeNull()
    })

    it('uploads from dataTransfer.items.getAsFile when files is empty', async () => {
      const h = open()
      const file = new File([new Uint8Array([1, 2])], 'via-items.bin', { type: 'application/octet-stream' })
      const event = drop({ types: ['Files'], files: [], items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) }] })
      expect(event.defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      expect((first(h, 'attach-files')!.files as Array<{ name: string }>)[0]!.name).toBe('via-items.bin')
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(1)
    })

    it('handles two consecutive OS drops without leaving the overlay stuck', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'one.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(1))
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([2])], 'two.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(2)
    })

    it('resets the overlay when a drag is abandoned', async () => {
      const h = open()
      fireDrag('dragenter', { types: ['Files'], files: [new File([new Uint8Array([1])], 'x.bin', { type: 'application/octet-stream' })] })
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
      // dragend and window blur both clear a gesture whose drop never arrives.
      document.dispatchEvent(new Event('dragend'))
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)
      fireDrag('dragenter', { types: ['Files'] })
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
      window.dispatchEvent(new Event('blur'))
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)
      // A dragleave with no relatedTarget ends the gesture too.
      fireDrag('dragenter', { types: ['Files'] })
      fireDrag('dragleave', { types: ['Files'] }, null)
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)
    })

    it('shows the overlay from dragover alone when dragenter was missed', async () => {
      const h = open()
      const over = fireDrag('dragover', { types: ['files'], files: [new File([new Uint8Array([1])], 'x.bin', { type: 'application/octet-stream' })] })
      expect(over.defaultPrevented).toBe(true)
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
      expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy')
    })

    it('removes a ready card the Host did not publish once the batch settles', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([2])], 'ready.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      const requestId = first(h, 'attach-files')!.requestId as number
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'ready.bin', state: 'ready', id: 'receipt-1', bytes: 1 })
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(1)
      // The batch settles without this file in the Host list: the local ready
      // card is stale and must not survive as a phantom attachment.
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
    })

    it('turns an interrupted upload into a retryable failure when the runtime is lost', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([3])], 'inflight.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(1)
      h.enter('while uploading')
      expect(first(h, 'send')).toBeUndefined()

      h.sendState({ phase: 'error' })
      await h.settle()
      // The uploading card becomes retryable, not stuck behind a dead upload.
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(0)
      expect(h.document.querySelector('.attachment-spinner')).toBeNull()
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(1)
      expect(h.document.getElementById('attachments')!.textContent).toContain('The upload was interrupted. Retry.')
      expect(h.document.querySelector('.attachment-retry')).not.toBeNull()

      h.sendState({ phase: 'ready' })
      await h.settle()
      // A stale "uploading" phase from the lost runtime must not revive the
      // interrupted card and re-gate Send.
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: first(h, 'attach-files')!.requestId as number, name: 'inflight.bin', state: 'uploading' })
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(0)
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(1)
      h.click('.attachment-retry')
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      const retry = all(h, 'attach-files')[1]!
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: retry.requestId as number, name: 'inflight.bin', state: 'ready', id: 'receipt-2', bytes: 3 })
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'draft-2', name: 'inflight.bin', bytes: 3 }], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelector('.attachment-retry')).toBeNull()
      h.enter('after reconnect')
      await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
    })

    it('uses getAsFileSystemHandle when webkitGetAsEntry is unavailable', async () => {
      const h = open()
      osDrop([{ kind: 'file', getAsFileSystemHandle: () => Promise.resolve({ kind: 'directory' }) }], [new File([], 'pictures', { type: '' })])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toContain('Explorer')
    })

    it('refuses a drop before the runtime is ready instead of dropping it silently', async () => {
      const h = harness()
      live.push(h)
      h.sendState({ phase: 'loading' })
      h.posts.length = 0
      drop({ types: ['files'], files: [new File([new Uint8Array([1])], 'a.bin', { type: 'application/octet-stream' })] })
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(first(h, 'attach-files')).toBeUndefined()
    })

    it('refuses to send while a dropped file is still being read', async () => {
      const h = open()
      drop({ types: ['files'], files: [new File([new Uint8Array([1, 2])], 'a.bin', { type: 'application/octet-stream' })] })
      h.enter('too early')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(first(h, 'send')).toBeUndefined()
    })

    it('keeps the send gate closed while the runtime still reports an outstanding upload', async () => {
      const h = open()
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 2 })
      await new Promise(resolve => setTimeout(resolve, 0))
      h.enter('too early')
      expect(first(h, 'send')).toBeUndefined()
    })
  })

  describe('drop resilience', () => {
    it('uploads the same file again after it was removed, three times in a row', async () => {
      const h = open()
      const sameFile = () => new File([new Uint8Array([1, 2, 3])], 'same.bin', { type: 'application/octet-stream' })
      for (let round = 1; round <= 3; round += 1) {
        osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [sameFile()])
        await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(round))
        const request = all(h, 'attach-files')[round - 1]!
        h.send({ type: 'file-upload', sessionId: 'session-a', requestId: request.requestId, name: 'same.bin', state: 'ready', id: 'receipt-' + String(round), bytes: 3 })
        h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'draft-' + String(round), name: 'same.bin', bytes: 3 }], uploads: 0 })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(1)
        // Removing the chip is a Host round trip; the Webview must not keep a
        // local gate that swallows the next drop of the very same file.
        h.click('.attachment-chip .attachment-remove')
        expect(all(h, 'remove-attachment')).toHaveLength(round)
        h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 0 })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
      }
      // Every drop is a fresh upload request, never a reuse of the last one.
      const requestIds = all(h, 'attach-files').map(request => request.requestId)
      expect(new Set(requestIds).size).toBe(3)
      h.enter('send after three drops')
      await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
    })

    it('continues after 500 ms when getAsFileSystemHandle never settles', async () => {
      vi.useFakeTimers()
      try {
        const h = open()
        const file = new File([new Uint8Array([7, 7])], 'pending-handle.bin', { type: 'application/octet-stream' })
        // The Entry API is unavailable here, so the directory probe falls back to
        // a handle promise this host never settles.
        drop({ types: ['Files'], files: [file], items: [{ kind: 'file', getAsFileSystemHandle: () => new Promise(() => {}) }] })
        await vi.advanceTimersByTimeAsync(600)
        expect(all(h, 'attach-files')).toHaveLength(1)
        expect((first(h, 'attach-files')!.files as Array<{ name: string }>)[0]!.name).toBe('pending-handle.bin')
        expect(all(h, 'attachment-error')).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })

    it('reports a timed-out read instead of hanging the drop intake', async () => {
      vi.useFakeTimers()
      class NeverFileReader {
        result: unknown = null
        listeners: Array<() => void> = []
        addEventListener(): void {}
        abort(): void {}
        readAsDataURL(): void {}
      }
      vi.stubGlobal('FileReader', NeverFileReader)
      try {
        const h = open()
        osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'stuck.bin', { type: 'application/octet-stream' })])
        await vi.advanceTimersByTimeAsync(10_100)
        expect(first(h, 'attachment-error')).toBeDefined()
        expect(String(first(h, 'attachment-error')!.message)).toBe('The dropped file could not be read.')
        expect(all(h, 'attach-files')).toEqual([])
        // The intake and its send gate were released with the error.
        h.enter('after the timeout')
        await vi.advanceTimersByTimeAsync(10)
        expect(first(h, 'send')).toBeDefined()
      } finally {
        vi.unstubAllGlobals()
        vi.useRealTimers()
      }
    })

    it('claims the drag at capture on window and document before any bubble handler', () => {
      const h = open()
      const file = (): File => new File([new Uint8Array([1])], 'capture.bin', { type: 'application/octet-stream' })
      // The Webview preload only forwards a dragenter the content did not
      // prevent, and its own handler is a bubble listener; the capture handler
      // must run first for both event targets.
      const onDocument = fireDrag('dragenter', { types: ['Files'], files: [file()] })
      expect(onDocument.defaultPrevented).toBe(true)
      const onWindow = fireDrag('dragenter', { types: ['Files'], files: [file()] }, null, window)
      expect(onWindow.defaultPrevented).toBe(true)
      // A file carried only by items is claimed the same way.
      const itemsOnly = fireDrag('dragenter', { types: [], files: [], items: [{ kind: 'file', getAsFile: () => file() }] })
      expect(itemsOnly.defaultPrevented).toBe(true)
      // A plain text drag is not a file drop: the composer leaves it alone.
      const text = fireDrag('dragenter', { types: ['text/plain'], data: { 'text/plain': 'hello' } })
      expect(text.defaultPrevented).toBe(false)
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
    })

    it('accepts a drop whose types omit Files when the transfer still carries files', async () => {
      const h = open()
      const enter = fireDrag('dragenter', { types: [], files: [new File([new Uint8Array([1])], 'untyped.bin', { type: 'application/octet-stream' })] })
      expect(enter.defaultPrevented).toBe(true)
      // The same guarantee for a payload exposed only through items.
      const itemEnter = fireDrag('dragenter', { types: [], files: [], items: [{ kind: 'file', getAsFile: () => new File([new Uint8Array([1])], 'items.bin', { type: 'application/octet-stream' }) }] })
      expect(itemEnter.defaultPrevented).toBe(true)
      const event = drop({ types: [], files: [new File([new Uint8Array([2])], 'untyped.bin', { type: 'application/octet-stream' })] })
      expect(event.defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      expect((first(h, 'attach-files')!.files as Array<{ name: string }>)[0]!.name).toBe('untyped.bin')

      // The same guarantee through items only: no Files type, no FileList.
      const viaItems = new File([new Uint8Array([3])], 'typed-by-item.bin', { type: 'application/octet-stream' })
      const itemDrop = drop({ types: [], files: [], items: [{ kind: 'file', getAsFile: () => viaItems, webkitGetAsEntry: () => ({ isDirectory: false }) }] })
      expect(itemDrop.defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      expect((all(h, 'attach-files')[1]!.files as Array<{ name: string }>)[0]!.name).toBe('typed-by-item.bin')
    })

    it('handles a drop that an inner element stops propagating', async () => {
      const h = open()
      const prompt = h.document.getElementById('prompt')!
      const blocker = (event: Event): void => { event.stopPropagation() }
      prompt.addEventListener('drop', blocker)
      try {
        const event = drop({ types: ['Files'], files: [new File([new Uint8Array([5])], 'shielded.bin', { type: 'application/octet-stream' })] }, prompt)
        expect(event.defaultPrevented).toBe(true)
        await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
        expect((first(h, 'attach-files')!.files as Array<{ name: string }>)[0]!.name).toBe('shielded.bin')
      } finally {
        prompt.removeEventListener('drop', blocker)
      }
    })

    it('reports a refused drop while the directory view is open', async () => {
      const h = open()
      h.click('#conversationHome')
      h.posts.length = 0
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'refused.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toBe('Open a conversation before adding files.')
      expect(all(h, 'attach-files')).toEqual([])
    })

    it('reports a refused drop while a new conversation is being created', async () => {
      const h = open()
      h.click('#newSession')
      expect(first(h, 'create-conversation')).toBeDefined()
      h.posts.length = 0
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'refused.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toBe('Wait for the conversation to open before adding files.')
      expect(all(h, 'attach-files')).toEqual([])
    })

    it('logs acceptDrop entry and completion for an accepted drop', async () => {
      const h = open()
      const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      try {
        osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'logged.bin', { type: 'application/octet-stream' })])
        await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
        const phases = spy.mock.calls
          .filter(call => call[0] === '[dsh-drop]')
          .map(call => (call[1] as { phase?: string }).phase)
        expect(phases).toContain('acceptDrop:enter')
        expect(phases).toContain('acceptDrop:done')
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('local file picker fallback', () => {
    it('opens the hidden input from the + menu and explains the drag guard', () => {
      const h = open()
      h.click('#attach')
      expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(false)
      expect(h.document.querySelector('.context-menu-hint')!.textContent).toContain('Hold Shift while dragging files')
      const input = h.document.getElementById('localFiles') as HTMLInputElement
      const spy = vi.spyOn(input, 'click').mockImplementation(() => undefined)
      try {
        h.click('#contextUpload')
        expect(spy).toHaveBeenCalledTimes(1)
        expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(true)
      } finally {
        spy.mockRestore()
      }
    })

    it('uploads a picked file through the same card path', async () => {
      const h = open()
      const input = selectLocalFiles(h, [new File([new Uint8Array([1, 2])], 'picked.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      expect((first(h, 'attach-files')!.files as Array<{ name: string }>)[0]!.name).toBe('picked.bin')
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(1)
      // Cleared so the same file can be picked again: the change event fires.
      expect(input.value).toBe('')
      // The Host answers exactly as it does for a drop: a ready chip.
      const requestId = first(h, 'attach-files')!.requestId as number
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'picked.bin', state: 'ready', id: 'receipt-1', bytes: 2 })
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'draft-1', name: 'picked.bin', bytes: 2 }], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(0)
      expect(h.document.getElementById('attachments')!.textContent).toContain('picked.bin')
    })

    it('routes a picked image through the inline image path', async () => {
      const h = open()
      selectLocalFiles(h, [new File([new Uint8Array([137, 80, 78, 71])], 'picked.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      expect(all(h, 'attach-files')).toEqual([])
      const requestId = first(h, 'attach-images')!.requestId as number
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-1', name: 'picked.png' }] })
      h.send({ type: 'attachments-added', sessionId: 'session-a', requestId })
      expect(h.document.querySelector('.attachment-thumb')).not.toBeNull()
    })

    it('uploads the same file again after it was removed', async () => {
      const h = open()
      const picked = (): File => new File([new Uint8Array([3, 4])], 'same-picked.bin', { type: 'application/octet-stream' })
      selectLocalFiles(h, [picked()])
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(1))
      const request = all(h, 'attach-files')[0]!
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: request.requestId, name: 'same-picked.bin', state: 'ready', id: 'receipt-1', bytes: 2 })
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'draft-1', name: 'same-picked.bin', bytes: 2 }], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      h.click('.attachment-chip .attachment-remove')
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [], uploads: 0 })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
      selectLocalFiles(h, [picked()])
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      // A fresh request id: the second pick is a new upload, not a replay.
      expect(new Set(all(h, 'attach-files').map(item => item.requestId)).size).toBe(2)
    })

    it('applies the drop caps and the size preflight to a picked batch', async () => {
      const h = open()
      const huge = { name: 'huge.bin', size: 33 * 1024 * 1024, type: 'application/octet-stream' } as unknown as File
      const files = Array.from({ length: 10 }, (_value, index) => new File([new Uint8Array([index])], 'pick' + String(index) + '.bin', { type: 'application/octet-stream' }))
      selectLocalFiles(h, [huge, ...files])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      // The over-limit file never crosses the boundary; the rest keeps the
      // shared eight-file cap.
      const names = (first(h, 'attach-files')!.files as Array<{ name: string }>).map(file => file.name)
      expect(names).toEqual(['pick0.bin', 'pick1.bin', 'pick2.bin', 'pick3.bin', 'pick4.bin', 'pick5.bin', 'pick6.bin'])
      const messages = all(h, 'attachment-error').map(item => String(item.message))
      expect(messages).toContain('You can attach up to 8 files at once.')
      expect(messages.some(message => message.includes('larger than the 32 MB attachment limit'))).toBe(true)
    })

    it('refuses a picker selection while the runtime is not ready', async () => {
      const h = harness()
      live.push(h)
      h.sendState({ phase: 'loading' })
      h.posts.length = 0
      selectLocalFiles(h, [new File([new Uint8Array([1])], 'early.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toBe('Wait for DeepSeek to reconnect before adding files.')
      expect(all(h, 'attach-files')).toEqual([])
    })

    it('treats an empty picker selection as a no-op', () => {
      const h = open()
      selectLocalFiles(h, [])
      expect(h.posts).toEqual([])
    })
  })

  describe('webview error reporting', () => {
    it('posts a bounded failure report with source and line', () => {
      const h = open()
      h.posts.length = 0
      const event = new Event('error') as Event & { message?: string; filename?: string; lineno?: number; error?: Error }
      Object.defineProperty(event, 'message', { value: 'x'.repeat(5_000) })
      Object.defineProperty(event, 'filename', { value: 'vscode-webview://webview/index.html' })
      Object.defineProperty(event, 'lineno', { value: 42 })
      Object.defineProperty(event, 'error', { value: new Error('render boom') })
      window.dispatchEvent(event)
      const report = first(h, 'webview-error')!
      expect(report).toBeDefined()
      // The whole text stays inside 2 KB, and the source/line survive so the
      // Host log can point at the failing code path.
      expect(String(report.message).length).toBeLessThanOrEqual(2048)
      expect(report.message).not.toContain('undefined')
      expect(report.source).toBe('vscode-webview://webview/index.html')
      expect(report.line).toBe(42)
      expect(String(report.message).length + String(report.stack ?? '').length).toBeLessThanOrEqual(2048)
    })

    it('keeps a short message and its stack inside the 2 KB budget', () => {
      const h = open()
      h.posts.length = 0
      const event = new Event('error') as Event & { message?: string; error?: Error }
      Object.defineProperty(event, 'message', { value: 'render failed: boom' })
      Object.defineProperty(event, 'error', { value: new Error('render failed: boom') })
      window.dispatchEvent(event)
      const report = first(h, 'webview-error')!
      expect(report.message).toBe('render failed: boom')
      expect(String(report.stack)).toContain('Error: render failed: boom')
      expect(String(report.message).length + String(report.stack).length).toBeLessThanOrEqual(2048)
    })

    it('reports an unhandled rejection instead of leaving it silent', () => {
      const h = open()
      h.posts.length = 0
      const event = new Event('unhandledrejection') as Event & { reason?: unknown }
      Object.defineProperty(event, 'reason', { value: new Error('state resync failed') })
      window.dispatchEvent(event)
      const report = first(h, 'webview-error')!
      expect(report.message).toBe('state resync failed')
      expect(String(report.stack)).toContain('Error: state resync failed')
    })
  })

  describe('images', () => {
    it('routes an OS image to the image path and shows a local thumbnail', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      const requestId = first(h, 'attach-images')!.requestId as number
      expect(all(h, 'attach-files')).toEqual([])
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-1', name: 'shot.png' }] })
      h.send({ type: 'attachments-added', sessionId: 'session-a', requestId })
      const thumb = h.document.querySelector<HTMLImageElement>('.attachment-thumb')
      expect(thumb).not.toBeNull()
      expect(thumb!.src).toMatch(/^data:image\/png;base64,/)
      h.click('.attachment-remove')
      expect(first(h, 'remove-attachment')).toMatchObject({ id: 'img-1', sessionId: 'session-a' })
      // The Host confirms the removal with an empty draft list: the base64
      // thumbnail must be released with it.
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [] })
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
    })
  })

  describe('resident state is bounded', () => {
    it('keeps at most eight failed upload cards', async () => {
      const h = open()
      for (let index = 0; index < 10; index += 1) {
        osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([index])], 'bad' + String(index) + '.bin', { type: 'application/octet-stream' })])
        await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(index + 1))
        const requestId = all(h, 'attach-files')[index]!.requestId as number
        h.send({ type: 'file-upload', sessionId: 'session-a', requestId, name: 'bad' + String(index) + '.bin', state: 'error', error: 'refused' })
      }
      expect(h.document.querySelectorAll('.attachment-chip.upload-error').length).toBe(8)
      expect(h.document.querySelectorAll('.attachment-chip').length).toBe(8)
    })

    it('drops the oldest thumbnails beyond eight resident previews', async () => {
      const h = open()
      const names: string[] = []
      for (let batch = 0; batch < 2; batch += 1) {
        const files = Array.from({ length: 5 }, (_value, index) => {
          const name = 'img' + String(batch * 5 + index) + '.png'
          names.push(name)
          return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
        })
        osDrop(files.map(() => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) })), files)
        await vi.waitFor(() => expect(all(h, 'attach-images')).toHaveLength(batch + 1))
        // The Host publishes the staged images before acknowledging the batch.
        h.send({ type: 'draft-images', sessionId: 'session-a', images: names.map((name, index) => ({ id: 'img-' + String(index), name })) })
        h.send({ type: 'attachments-added', sessionId: 'session-a', requestId: all(h, 'attach-images')[batch]!.requestId as number })
      }
      h.send({ type: 'draft-images', sessionId: 'session-a', images: names.map((name, index) => ({ id: 'img-' + String(index), name })) })
      expect(h.document.querySelectorAll('.attachment-chip.image')).toHaveLength(10)
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(8)
    })

    it('clears failed cards and thumbnails on a conversation switch', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'bad.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: first(h, 'attach-files')!.requestId as number, name: 'bad.bin', state: 'error', error: 'refused' })
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-1', name: 'shot.png' }] })
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(1)
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(1)

      h.sendState({ sessionId: 'session-b' })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(0)
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)

      // Back in the old conversation the Host still knows the draft, but the
      // resident thumbnail bytes were released with the switch.
      h.sendState({ sessionId: 'session-a' })
      await h.settle()
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-1', name: 'shot.png' }] })
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
    })

    it('clears failed upload cards and their base64 when the runtime is no longer ready', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([7, 7])], 'bad.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: first(h, 'attach-files')!.requestId as number, name: 'bad.bin', state: 'error', error: 'refused' })
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(1)
      expect(h.document.querySelector('.attachment-retry')).not.toBeNull()

      h.sendState({ phase: 'error' })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(0)
      expect(h.document.querySelector('.attachment-retry')).toBeNull()
      // A late Host publish cannot resurrect the local retry state: the base64
      // needed to resend was dropped with the runtime, so only a Host chip may
      // come back.
      h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ id: 'f1', name: 'bad.bin', bytes: 1 }], uploads: 0 })
      expect(h.document.querySelector('.attachment-retry')).toBeNull()
      // The cleanup is unconditional in the shared branch, not session-only.
      const html = chatHtml()
      const branch = html.slice(html.indexOf('if (jobSessionChanged || jobRuntimeLost) {'))
      expect(branch.slice(0, branch.indexOf('}') + 1)).toContain('clearFailedUploadCards();')
    })

    it('releases upload state when a conversation is archived, leaving the current one alone', async () => {
      const h = open()
      // Conversation A: one failed card, one in-flight card and one thumbnail.
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'bad.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attach-files')).toBeDefined())
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: first(h, 'attach-files')!.requestId as number, name: 'bad.bin', state: 'error', error: 'refused' })
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([2])], 'inflight.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(all(h, 'attach-files')).toHaveLength(2))
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-a', name: 'a.png' }] })
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(1)

      // Switch away: previews/failed cards are already released by the switch,
      // but the in-flight card and the pending counter belong to A alone.
      h.sendState({ sessionId: 'session-b' })
      await h.settle()
      // Seed a thumbnail in the current conversation B.
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'b.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(all(h, 'attach-images')).toHaveLength(2))
      h.send({ type: 'draft-images', sessionId: 'session-b', images: [{ id: 'img-b', name: 'b.png' }] })
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(1)

      // Archiving A must release A's resident state and leave B untouched.
      h.sendState({ sessionId: 'session-b', archivedSessions: [{ id: 'session-a', title: 'Archived A' }] })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(1)

      h.sendState({ sessionId: 'session-a', archivedSessions: [{ id: 'session-a', title: 'Archived A' }] })
      await h.settle()
      // Returning to A revives neither the in-flight card nor the failed card...
      expect(h.document.querySelectorAll('.attachment-chip.uploading')).toHaveLength(0)
      expect(h.document.querySelectorAll('.attachment-chip.upload-error')).toHaveLength(0)
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
      // ...and re-publishing the Host's draft metadata cannot restore base64.
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-a', name: 'a.png' }] })
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
    })

    it('drops stale draft attachments on a runtime loss without touching the text', async () => {
      const h = open()
      await h.settle()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'keep this text'
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'stale.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-1', name: 'stale.png' }] })
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(1)

      // The Host may drop the draft bytes on disconnect without publishing an
      // empty draft; the Webview must not keep ghost attachments visible.
      h.sendState({ phase: 'error' })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
      expect(h.document.getElementById('attachments')!.classList.contains('hidden')).toBe(true)

      h.sendState({ phase: 'ready' })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
      expect(prompt.value).toBe('keep this text')
      // With the stale drafts gone the send gate still accepts the text.
      h.enter('keep this text')
      await vi.waitFor(() => expect(first(h, 'send')).toBeDefined())
      expect(first(h, 'send')!.text).toBe('keep this text')
    })

    it('archives draft attachments away and does not revive them on return', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-a', name: 'a.png' }] })
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(1)

      h.sendState({ sessionId: 'session-b' })
      await h.settle()
      h.sendState({ sessionId: 'session-b', archivedSessions: [{ id: 'session-a', title: 'Archived A' }] })
      await h.settle()
      h.sendState({ sessionId: 'session-a', archivedSessions: [{ id: 'session-a', title: 'Archived A' }] })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-chip')).toHaveLength(0)
      expect(h.document.getElementById('attachments')!.classList.contains('hidden')).toBe(true)
    })

    it('keeps drafts across an ordinary conversation switch', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'keep.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-k', name: 'keep.png' }] })
      h.sendState({ sessionId: 'session-b' })
      await h.settle()
      h.sendState({ sessionId: 'session-a' })
      await h.settle()
      // Drafts belong to their conversation and survive a switch; only the
      // local base64 thumbnail is released with the switch.
      expect(h.document.querySelectorAll('.attachment-chip.image')).toHaveLength(1)
      expect(h.document.getElementById('attachments')!.textContent).toContain('keep.png')
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
    })

    it('clears resident thumbnails when the runtime is no longer ready', async () => {
      const h = open()
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })])
      await vi.waitFor(() => expect(first(h, 'attach-images')).toBeDefined())
      h.send({ type: 'draft-images', sessionId: 'session-a', images: [{ id: 'img-1', name: 'shot.png' }] })
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(1)
      h.sendState({ phase: 'error' })
      await h.settle()
      expect(h.document.querySelectorAll('.attachment-thumb')).toHaveLength(0)
    })
  })

  describe('composer affordances', () => {
    it('logs low-noise drop diagnostics without changing behaviour', () => {
      const h = open()
      const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      try {
        fireDrag('dragenter', { types: ['Files'], files: [new File([new Uint8Array([1])], 'diag.bin', { type: 'application/octet-stream' })], data: { 'text/uri-list': 'file:///workspace/diag.bin' } })
        const enter = spy.mock.calls.find(call => call[0] === '[dsh-drop]')
        expect(enter).toBeDefined()
        expect(enter![1]).toMatchObject({ phase: 'dragenter', files: 1, items: 0 })
        expect(JSON.stringify(enter![1])).toContain('file:///workspace/diag.bin')
        drop({ types: ['Files'], files: [] })
        expect(spy.mock.calls.some(call => call[0] === '[dsh-drop]' && (call[1] as { phase?: string }).phase === 'drop')).toBe(true)
      } finally {
        spy.mockRestore()
      }
    })

    it('adds a general Add files… picker that posts choose-files', () => {
      const h = open()
      h.click('#attach')
      expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(false)
      h.click('#contextFiles')
      expect(first(h, 'choose-files')).toEqual({ type: 'choose-files', sessionId: 'session-a' })
      expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(true)
    })

    it('inserts Host-resolved references at the caret from insert-references', async () => {
      const h = open()
      await h.settle()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'read the files here'
      prompt.setSelectionRange('read the '.length, 'read the '.length)
      h.send({ type: 'insert-references', texts: ['@a.ts', '@"b c.ts"'], errors: [] })
      // Inserted at the caret, space separated, with one space before the tail.
      expect(prompt.value).toBe('read the @a.ts @"b c.ts" files here')
      expect(prompt.selectionStart).toBe('read the @a.ts @"b c.ts" '.length)
      expect(h.document.activeElement).toBe(prompt)
    })

    it('shows only the first insert-references error and leaves text alone when empty', () => {
      const h = open()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'unchanged'
      h.send({ type: 'insert-references', texts: [], errors: ['first failure', 'second failure'] })
      expect(h.document.getElementById('sessionNotice')!.textContent).toContain('first failure')
      expect(h.document.getElementById('sessionNotice')!.textContent).not.toContain('second failure')
      expect(prompt.value).toBe('unchanged')
      h.send({ type: 'insert-references', texts: [], errors: [] })
      expect(prompt.value).toBe('unchanged')
    })

    it('explains what can be dropped and shows a blocked state when it cannot', async () => {
      const h = open()
      fireDrag('dragenter', { types: ['Files'] })
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(false)
      expect(h.document.getElementById('dropTitle')!.textContent).toBe('Drag files or images here to add them')
      expect(h.document.getElementById('dropDesc')!.textContent).toBe('Up to 8 files, 32 MB each · folders from the Explorer')
      fireDrag('dragleave', { types: ['Files'] })
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)

      h.sendState({ phase: 'error' })
      await h.settle()
      fireDrag('dragenter', { types: ['Files'] })
      expect(h.document.getElementById('dropTitle')!.textContent).toBe('Files and images cannot be added right now')
      const over = fireDrag('dragover', { types: ['Files'] })
      // The drop is still requested: refusing at drop time is visible, while a
      // suppressed drop (dropEffect none) looks exactly like a broken Webview.
      expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy')
      osDrop([{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }], [new File([new Uint8Array([1])], 'late.bin', { type: 'application/octet-stream' })])
      await vi.waitFor(() => expect(first(h, 'attachment-error')).toBeDefined())
      expect(String(first(h, 'attachment-error')!.message)).toBe('Wait for DeepSeek to reconnect before adding files.')
      expect(all(h, 'attach-files')).toEqual([])
      expect(h.document.getElementById('dropOverlay')!.classList.contains('hidden')).toBe(true)
    })

    it('surfaces a picker upload failure through the toast, not a native dialog', () => {
      const h = open()
      // choose-files answers with requestId 0 because no local drop card exists.
      h.send({ type: 'file-upload', sessionId: 'session-a', requestId: 0, name: 'locked.bin', state: 'error', error: 'This file could not be read.' })
      expect(h.document.getElementById('sessionNotice')!.textContent).toContain('could not be read')
      expect(h.document.getElementById('sessionNotice')!.classList.contains('hidden')).toBe(false)
    })

    it('does not open the mention menu for a complete @"…" reference', () => {
      const h = open()
      const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
      prompt.value = 'read @"src/my file.ts"'
      prompt.setSelectionRange(prompt.value.length, prompt.value.length)
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      expect(all(h, 'request-mentions')).toEqual([])
      // A normal unquoted mention still asks for candidates.
      prompt.value = '@src/app'
      prompt.setSelectionRange(prompt.value.length, prompt.value.length)
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      expect(all(h, 'request-mentions').at(-1)).toMatchObject({ query: 'src/app' })
    })
  })
})
