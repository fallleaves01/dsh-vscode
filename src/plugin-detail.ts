import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type { DshBundleDetailRead } from './dsh-client.js'

/**
 * URI scheme for bundle detail documents.
 *
 * The documents are read-only virtual text files served from memory; nothing is
 * written to disk and the URI carries no host path.
 */
export const PLUGIN_DETAIL_SCHEME = 'dsh-plugin-detail'
/** Only the newest documents keep their body; older virtual documents report this text. */
export const PLUGIN_DETAIL_UNAVAILABLE = 'These plugin details are no longer available. Open the plugin details again.'
/** Bounded document table: an open preview holds one token, and every open adds one. */
const MAX_DOCUMENTS = 16
/** The editor tab title comes from the URI, so the sanitized label stays short. */
const MAX_LABEL = 80
/** Characters unsafe in a URI path segment or misleading in an editor title. */
const UNSAFE_LABEL = /[\p{Cc}\p{Cf}]/gu
const PATH_SEPARATOR = /[\\/:*?"<>|#]/g

/** Turn a bundle name or title into one safe URI segment. */
function detailLabel(value: string): string {
  const cleaned = value.replace(UNSAFE_LABEL, '').replace(PATH_SEPARATOR, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
  return cleaned === '' ? 'plugin details' : cleaned
}

/** Pull the opaque document token out of one detail URI. */
function detailToken(uri: vscode.Uri): string | undefined {
  const segments = uri.path.split('/')
  const index = segments.indexOf('plugin-details')
  const token = index === -1 ? undefined : segments[index + 1]
  return token === undefined || token === '' ? undefined : token
}

/** Insertion-order eviction: the oldest document loses its body first. */
function evictDocuments(documents: Map<string, string>): void {
  while (documents.size > MAX_DOCUMENTS) {
    const oldest = documents.keys().next().value
    if (oldest === undefined) return
    documents.delete(oldest)
  }
}

/** The body one virtual document answer carries; shared by every live viewer. */
interface DetailDocuments {
  registration: vscode.Disposable
  documents: Map<string, string>
  /** Number of live viewers; the registration exists while this is positive. */
  references: number
}

/**
 * VS Code keeps one content-provider mapping per scheme, so every viewer in
 * this extension shares one process-level registration and one document table.
 *
 * The first live viewer registers the provider and the last one closes disposes
 * it. Overlapping settings surfaces therefore see each other's documents, while
 * the scheme is never re-registered behind a surface that still serves a tab.
 */
let sharedDocuments: DetailDocuments | undefined

function acquireDocuments(): DetailDocuments {
  if (sharedDocuments !== undefined) {
    sharedDocuments.references += 1
    return sharedDocuments
  }
  const documents = new Map<string, string>()
  const registration = vscode.workspace.registerTextDocumentContentProvider(PLUGIN_DETAIL_SCHEME, {
    provideTextDocumentContent: (uri: vscode.Uri): string => {
      const token = detailToken(uri)
      return token === undefined ? PLUGIN_DETAIL_UNAVAILABLE : documents.get(token) ?? PLUGIN_DETAIL_UNAVAILABLE
    },
  })
  sharedDocuments = { registration, documents, references: 1 }
  return sharedDocuments
}

function releaseDocuments(): void {
  if (sharedDocuments === undefined) return
  sharedDocuments.references -= 1
  if (sharedDocuments.references > 0) return
  sharedDocuments.registration.dispose()
  sharedDocuments.documents.clear()
  sharedDocuments = undefined
}

/**
 * Opens plugin long-description documents in an editor preview.
 *
 * Markdown never leaves memory: a custom-scheme text document content provider
 * serves the bounded token table, so no file, log, or Webview state receives it.
 * Every live viewer holds a reference to the one shared provider registration,
 * so a chat settings surface and the standalone settings panel can serve each
 * other's open documents; closing one releases only its own reference.
 *
 * Known degradation: a detail document's relative images are served by the
 * runtime's authenticated `GET /api/plugin-manager/detail-file` route. The VS
 * Code Markdown preview cannot carry runtime authentication and does not resolve
 * that route, so such images do not render here, and the page therefore does not
 * match the DSH web detail view. The Markdown is handed to the preview unchanged:
 * no data-URI rewriting and no content weakening. The preview applies its own
 * resource policy (and the workspace trust model) to whatever the document links.
 * A third-party document can therefore make the preview request its remote
 * images, which shows that host the reader's address and timing; the sidebar
 * never fetches or rewrites those resources itself.
 */
export class PluginDetailViewer implements vscode.Disposable {
  private readonly shared = acquireDocuments()
  private disposed = false

  /**
   * Show one detail document.
   *
   * @returns false when the runtime reported no detail; true when an editor
   * opened the document. A failed open rejects.
   */
  async open(read: DshBundleDetailRead, label: string): Promise<boolean> {
    if (this.disposed) throw new Error('The plugin detail viewer is closed.')
    if (read.status !== 'found') return false
    // A fresh opaque token per document: a URI is not guessable from an earlier one.
    const token = `detail-${randomUUID()}`
    this.shared.documents.set(token, read.markdown)
    evictDocuments(this.shared.documents)
    const uri = vscode.Uri.parse(`${PLUGIN_DETAIL_SCHEME}:/plugin-details/${token}/${encodeURIComponent(detailLabel(label))}.md`)
    try {
      await vscode.commands.executeCommand('markdown.showPreview', uri)
      return true
    } catch {
      try {
        await vscode.window.showTextDocument(uri, { preview: true })
        return true
      } catch (cause) {
        // The token table is shared, so a failed open must remove only its own body.
        this.shared.documents.delete(token)
        throw cause
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    releaseDocuments()
  }
}
