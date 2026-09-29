import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import katex from 'katex'
import { Marked, type TokenizerExtension } from 'marked'

/**
 * Registered explicitly rather than via `highlight.js`'s all-languages bundle:
 * the Webview ships as one script, so each language costs real download size.
 * Aliases keep common fences (`ts`, `sh`, `html`, `yml`) working.
 */
const LANGUAGES: Readonly<Record<string, unknown>> = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json,
  kotlin, less, lua, markdown, perl, php, python, r, ruby, rust, scss, shell,
  sql, swift, typescript, xml, yaml,
}
const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', python3: 'python', rb: 'ruby', rs: 'rust', golang: 'go',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  yml: 'yaml', toml: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini',
  html: 'xml', xhtml: 'xml', svg: 'xml', vue: 'xml',
  'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', kt: 'kotlin', md: 'markdown',
  docker: 'dockerfile', patch: 'diff', postgres: 'sql', psql: 'sql', mysql: 'sql',
}
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language as never)

/** Language label for a fence, or undefined when it is not one we can highlight. */
function languageOf(info: string | undefined): string | undefined {
  const raw = (info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (raw === '') return undefined
  const name = ALIASES[raw] ?? raw
  return hljs.getLanguage(name) === undefined ? undefined : name
}

/**
 * Render one fenced block: highlighted body plus the copy affordance.
 *
 * Highlighting is synchronous on purpose. The Webview renders a streaming answer
 * a block at a time, and an async highlighter would either reorder blocks or
 * force the whole render path to become async.
 */
function codeBlockHtml(code: string, info: string | undefined): string {
  const language = languageOf(info)
  let body: string
  try {
    body = language === undefined ? escapeHtml(code) : hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    body = escapeHtml(code)
  }
  const label = (info ?? '').trim().split(/\s+/)[0] ?? ''
  return '<div class="code-block">'
    + '<div class="code-block-bar">'
    + '<span class="code-block-language">' + escapeHtml(label === '' ? 'text' : label) + '</span>'
    + '<button class="code-copy" type="button" aria-label="Copy code">Copy</button>'
    + '</div>'
    + '<pre><code class="hljs' + (language === undefined ? '' : ' language-' + language) + '">' + body + '</code></pre>'
    + '</div>'
}

interface MathExpression { raw: string; text: string; display: boolean }

function escaped(source: string, index: number): boolean {
  let slashes = 0
  while (index > 0 && source[--index] === '\\') slashes += 1
  return slashes % 2 === 1
}

function mathExpression(source: string): MathExpression | undefined {
  const open = source.startsWith('$$') ? '$$' : source.startsWith('\\[') ? '\\['
    : source.startsWith('\\(') ? '\\(' : source.startsWith('$') ? '$' : undefined
  if (!open) return undefined
  const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open
  if (open === '$' && (!source[1] || /\s/.test(source[1]))) return undefined
  for (let index = open.length; index < source.length; index += 1) {
    if (open === '$' && source[index] === '\n') return undefined
    if (!source.startsWith(close, index) || escaped(source, index)) continue
    if (open === '$' && (/\s/.test(source[index - 1] ?? '') || /[\d$]/.test(source[index + 1] ?? ''))) continue
    const text = source.slice(open.length, index)
    if (!text.trim()) return undefined
    return { raw: source.slice(0, index + close.length), text, display: open === '$$' || open === '\\[' }
  }
  return undefined
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export interface MarkdownHooks {
  appendFileText(parent: HTMLElement, text: string): void
  inlineCode(text: string): HTMLElement
  link(href: string, label: string): HTMLElement
}

/** Parse Markdown locally. Model HTML is text, not an executable webview surface. */
export function renderMarkdown(text: string, hooks?: MarkdownHooks): HTMLDivElement {
  const expressions: MathExpression[] = []
  const mathToken = (expression: MathExpression, type: string) => {
    const index = expressions.push(expression) - 1
    return { type, raw: expression.raw, index }
  }
  const inlineMath: TokenizerExtension = {
    name: 'mathInline', level: 'inline',
    start: source => /\$|\\[([]/.exec(source)?.index,
    tokenizer(source) {
      const expression = mathExpression(source)
      return expression ? mathToken(expression, 'mathInline') : undefined
    },
  }
  const blockMath: TokenizerExtension = {
    name: 'mathBlock', level: 'block',
    start: source => /(?:^|\n) {0,3}(?:\$\$|\\\[)/.exec(source)?.index,
    tokenizer(source) {
      const indent = /^ {0,3}(?=\$\$|\\\[)/.exec(source)?.[0]
      if (indent === undefined) return undefined
      const expression = mathExpression(source.slice(indent.length))
      if (!expression) return undefined
      const end = indent.length + expression.raw.length
      const trailing = /^(?:[ \t]*(?:\n|$))/.exec(source.slice(end))
      if (!trailing) return undefined
      return { ...mathToken(expression, 'mathBlock'), raw: source.slice(0, end + trailing[0].length) }
    },
  }
  const parser = new Marked({
    gfm: true, async: false,
    renderer: {
      html: ({ text }) => escapeHtml(text),
      // Attachments are handled separately. Never fetch model-supplied remote images.
      image: ({ text }) => escapeHtml(text),
      // A fenced block carries its own chrome, so it is rendered whole here
      // rather than assembled from `code` plus a surrounding `pre` elsewhere.
      code: ({ text, lang }) => codeBlockHtml(text, lang),
    },
    extensions: [
      { ...inlineMath, renderer: token => '<span data-math="' + token.index + '"></span>' },
      { ...blockMath, renderer: token => '<div data-math="' + token.index + '"></div>' },
    ],
  })
  const root = document.createElement('div')
  root.className = 'markdown'
  root.append(DOMPurify.sanitize(parser.parse(text) as string, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del',
      'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input',
      'span', 'div', 'button'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'align', 'start', 'type', 'checked', 'disabled', 'data-math', 'aria-label'],
    ALLOW_DATA_ATTR: false,
  }))

  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') ?? ''
    if (!/^https?:\/\//i.test(href)) { anchor.replaceWith(...anchor.childNodes); continue }
    if (hooks) {
      const replacement = hooks.link(href, '')
      replacement.replaceChildren(...anchor.childNodes)
      anchor.replaceWith(replacement)
    }
  }
  if (hooks) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text
      if (!textNode.parentElement?.closest('a, pre, code, [data-math]')) texts.push(textNode)
    }
    for (const textNode of texts) {
      const container = document.createElement('span')
      hooks.appendFileText(container, textNode.data)
      textNode.replaceWith(...container.childNodes)
    }
    for (const code of root.querySelectorAll('code')) {
      if (!code.closest('pre')) code.replaceWith(hooks.inlineCode(code.textContent ?? ''))
    }
  }
  for (const table of root.querySelectorAll('table')) {
    const container = document.createElement('div')
    container.className = 'markdown-table'
    container.tabIndex = 0
    container.setAttribute('role', 'region')
    container.setAttribute('aria-label', 'Table (scroll horizontally)')
    table.replaceWith(container)
    container.append(table)
  }
  // Only library-generated math is inserted after sanitization; KaTeX trust is disabled.
  for (const element of root.querySelectorAll<HTMLElement>('[data-math]')) {
    const expression = expressions[Number(element.dataset.math)]
    element.removeAttribute('data-math')
    if (!expression) continue
    element.className = expression.display ? 'markdown-math-display' : 'markdown-math-inline'
    if (expression.display) {
      element.tabIndex = 0
      element.setAttribute('role', 'region')
      element.setAttribute('aria-label', 'Formula (scroll horizontally)')
    }
    try {
      katex.render(expression.text, element, {
        displayMode: expression.display, throwOnError: false, trust: false,
        strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml',
      })
    } catch {
      element.textContent = expression.raw
    }
  }
  return root
}

export interface MarkdownScanState {
  scanOffset: number
  safeBoundary: number
  pendingLine: string
  fence: string
  math: string
}

export function createMarkdownScanState(): MarkdownScanState {
  return { scanOffset: 0, safeBoundary: 0, pendingLine: '', fence: '', math: '' }
}

/** Commit only complete blocks; blank lines inside fenced code or display math aren't boundaries. */
export function scanMarkdownStream(state: MarkdownScanState, text: string): void {
  for (let index = state.scanOffset; index < text.length; index += 1) {
    const character = text[index]!
    if (character !== '\n') { state.pendingLine += character; continue }
    const line = state.pendingLine.replace(/\r$/, '')
    state.pendingLine = ''
    // Container indentation is not this scanner's business: a fence inside a
    // list item is indented, and treating it as plain text made every blank line
    // in it a stream cut point. The groups keep their meaning.
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
    if (state.fence) {
      if (fence && fence[1]![0] === state.fence[0] && fence[1]!.length >= state.fence.length && !fence[2]!.trim()) state.fence = ''
      continue
    }
    if (!state.math && fence) { state.fence = fence[1]!; continue }
    let code = ''
    for (let column = 0; column < line.length; column += 1) {
      if (escaped(line, column)) continue
      if (!state.math && line[column] === '`') {
        const ticks = /^`+/.exec(line.slice(column))![0]
        if (!code) code = ticks
        else if (code === ticks) code = ''
        column += ticks.length - 1
        continue
      }
      if (code) continue
      if (state.math) {
        if (line.startsWith(state.math, column)) { column += state.math.length - 1; state.math = '' }
      } else if (line.startsWith('$$', column)) { state.math = '$$'; column += 1 }
      else if (line.startsWith('\\[', column)) { state.math = '\\]'; column += 1 }
      else if (line.startsWith('\\(', column)) { state.math = '\\)'; column += 1 }
    }
    if (!line.trim() && !state.math) state.safeBoundary = index + 1
  }
  state.scanOffset = text.length
}
