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
function fireDrag(type: string, payload: DragPayload, relatedTarget: EventTarget | null = null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; relatedTarget: unknown }
  Object.defineProperty(event, 'dataTransfer', { value: transfer(payload) })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  document.dispatchEvent(event)
  return event
}
const drop = (payload: DragPayload): Event => fireDrag('drop', payload)
/** One OS file plus the matching item metadata a real drag would expose. */
function osDrop(items: DragItem[], files: File[], extra: Partial<DragPayload> = {}): Event {
  return drop({ types: ['Files', ...(extra.types ?? [])], data: extra.data, files, items })
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
    it('adds a general Add files… picker that posts choose-files', () => {
      const h = open()
      h.click('#attach')
      expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(false)
      h.click('#contextFiles')
      expect(first(h, 'choose-files')).toEqual({ type: 'choose-files', sessionId: 'session-a' })
      expect(h.document.getElementById('contextMenu')!.classList.contains('hidden')).toBe(true)
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
      expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none')
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
