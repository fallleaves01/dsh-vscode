// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createMarkdownScanState, parseFileLink, renderMarkdown, scanMarkdownStream } from '../src/markdown.mjs'

describe('fenced code blocks', () => {
  const fence = (body: string, info = 'ts') => '```' + info + '\n' + body + '\n```'

  it('highlights a known language into token spans', () => {
    const root = renderMarkdown(fence('const answer: number = 42'))
    const code = root.querySelector('.code-block pre code')
    expect(code).not.toBeNull()
    // Real highlighting, not just an escaped block.
    expect(code!.querySelectorAll('span[class^="hljs-"]').length).toBeGreaterThan(0)
    expect(code!.textContent).toBe('const answer: number = 42')
  })

  it('labels the block and offers a copy button that survives sanitizing', () => {
    const root = renderMarkdown(fence('print("hi")', 'python'))
    expect(root.querySelector('.code-block-language')?.textContent).toBe('python')
    const button = root.querySelector('button.code-copy')
    // DOMPurify strips anything outside its allowlist, so this asserts the
    // button and its aria-label are actually permitted.
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-label')).toBe('Copy code')
    expect(button!.textContent).toBe('Copy')
  })

  it('resolves common fence aliases to a language', () => {
    for (const [info, expected] of [['ts', 'typescript'], ['sh', 'bash'], ['yml', 'yaml'], ['py', 'python']]) {
      const root = renderMarkdown(fence('x = 1', info))
      expect(root.querySelector('code')?.getAttribute('class'), info).toContain('language-' + expected)
    }
  })

  it('keeps an unknown language readable instead of guessing', () => {
    const root = renderMarkdown(fence('%%% not a language %%%', 'brainfuck'))
    const code = root.querySelector('.code-block pre code')
    expect(code?.textContent).toBe('%%% not a language %%%')
    expect(code?.querySelectorAll('span[class^="hljs-"]').length).toBe(0)
    // An unlabelled fence still gets the chrome, so it can be copied.
    expect(root.querySelector('.code-block-language')?.textContent).toBe('brainfuck')
    expect(root.querySelector('button.code-copy')).not.toBeNull()
  })

  it('escapes model-supplied markup inside a code block', () => {
    const root = renderMarkdown(fence('<img src=x onerror=alert(1)>', 'html'))
    const code = root.querySelector('.code-block pre code')
    expect(code?.querySelector('img')).toBeNull()
    expect(code?.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('copies the source text, not the highlighted markup', () => {
    const root = renderMarkdown(fence('const a = 1', 'javascript'))
    // The handler reads textContent, so what the user copies is what the model wrote.
    expect(root.querySelector('.code-block pre code')?.textContent).toBe('const a = 1')
  })
})

describe('streamed fences', () => {
  it('does not cut a fence that is indented for a list item', () => {
    // A fence inside a list item is indented; treating it as plain text made
    // every blank line inside it a stream boundary, so the committed output
    // differed from the same text rendered as history.
    const text = '- item\n\n  - inner\n\n    ```ts\n    const a = 1\n\n    const b = 2\n    ```\n\n- next\n'
    const state = createMarkdownScanState()
    const boundaries: number[] = []
    for (let index = 0; index < text.length; index += 1) {
      scanMarkdownStream(state, text.slice(0, index + 1))
      boundaries.push(state.safeBoundary)
    }
    // No boundary may fall between the opening and closing fence.
    const open = text.indexOf('```ts')
    const close = text.lastIndexOf('```')
    const inside = boundaries.slice(open, close)
    expect(inside.every(boundary => boundary <= open)).toBe(true)
  })
})

describe('Markdown rendering', () => {
  it('renders GFM tables with alignment, escaped pipes and inline formatting', () => {
    const root = renderMarkdown('| Name | Value | Status |\n| :--- | ---: | :---: |\n| **Total** | `36` | A\\|B |')
    expect(root.querySelectorAll('table')).toHaveLength(1)
    expect(root.querySelectorAll('th')).toHaveLength(3)
    expect(root.querySelectorAll('td')).toHaveLength(3)
    expect(root.querySelectorAll('th')[1]?.getAttribute('align')).toBe('right')
    expect(root.querySelectorAll('td')[2]?.textContent).toBe('A|B')
    expect(root.querySelector('td strong')?.textContent).toBe('Total')
    expect(root.querySelector('td code')?.textContent).toBe('36')
    expect(root.querySelector('.markdown-table')?.getAttribute('tabindex')).toBe('0')
  })

  it('lets a narrow table fill the column and keeps a wide one scrollable', () => {
    // DSH's own split: under four columns the table wraps to the column width,
    // from four up it keeps its natural width and scrolls inside the wrapper.
    const narrow = renderMarkdown('| Name | Value |\n| --- | --- |\n| a | b |')
    expect(narrow.querySelector('.markdown-table')?.classList.contains('md-table-fill')).toBe(true)

    const wide = renderMarkdown('| Name | Value | Status | Owner |\n| --- | --- | --- | --- |\n| a | b | c | d |')
    const wrapper = wide.querySelector('.markdown-table')!
    expect(wrapper.classList.contains('md-table-fill')).toBe(false)
    expect(wrapper.querySelectorAll('th')).toHaveLength(4)
  })

  it.each([
    ['inline dollars', 'Energy: $E = mc^2$.', false],
    ['inline parentheses', String.raw`Energy: \(E = mc^2\).`, false],
    ['display dollars', '$$\n\\frac{a}{b}\n$$', true],
    ['display brackets', '\\[\n\\sum_{i=1}^{n} i\n\\]', true],
    ['display within text', 'Formula: $$x^2$$ done.', true],
    ['matrix', String.raw`\[\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}\]`, true],
  ])('renders %s as math', (_label, text, display) => {
    const root = renderMarkdown(text as string)
    expect(root.querySelectorAll('.katex')).toHaveLength(1)
    expect(root.querySelector('math')).not.toBeNull()
    expect(root.querySelectorAll('.markdown-math-display')).toHaveLength(display ? 1 : 0)
    expect(root.querySelector('.katex-error')).toBeNull()
  })

  it('renders math inside tables, lists and emphasis', () => {
    const root = renderMarkdown('| Formula |\n| --- |\n| $x_1$ |\n\n- **Result: $a + b$**')
    expect(root.querySelector('td .katex')).not.toBeNull()
    expect(root.querySelector('li strong .katex')).not.toBeNull()
  })

  it('keeps code, currency, escaped dollars and incomplete formulas as text', () => {
    const source = 'Cost: $5 and $10. Escaped: \\$x\\$. Unfinished: $x + y\n\n`$x$`\n\n~~~tex\n$$x$$\n\\(y\\)\n~~~'
    const root = renderMarkdown(source)
    expect(root.querySelector('.katex')).toBeNull()
    expect(root.textContent).toContain('Cost: $5 and $10.')
    expect(root.textContent).toContain('Escaped: $x$.')
    expect(root.querySelector('pre code')?.textContent).toContain('$$x$$')
  })

  it('retains ordinary Markdown and treats source HTML as literal text', () => {
    const root = renderMarkdown('# Heading\n\n> **bold** and *italic*\n\n1. first\n2. second\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(root.querySelector('h1')?.textContent).toBe('Heading')
    expect(root.querySelector('blockquote strong')?.textContent).toBe('bold')
    expect(root.querySelectorAll('ol li')).toHaveLength(2)
    expect(root.querySelector('script, img')).toBeNull()
    expect(root.textContent).toContain('<script>alert(1)</script>')
  })

  it('blocks unsafe links, remote images, and trusted KaTeX HTML commands', () => {
    const root = renderMarkdown('[bad](javascript:alert%281%29) [command](command:workbench.action.closeWindow) ![image](https://example.com/pixel.png)\n\n' + String.raw`$\href{javascript:alert(1)}{bad}$ $\includegraphics{https://example.com/pixel.png}$ $\htmlStyle{position:fixed}{x}$`)
    expect(root.querySelector('a, img, script, iframe, style')).toBeNull()
    expect(root.querySelector('[style*="position:fixed"], [style*="position: fixed"]')).toBeNull()
    expect(root.textContent).toContain('bad')
  })

  it('handles invalid TeX without breaking the rest of the message', () => {
    const root = renderMarkdown('$\\notARealCommand{x}$\n\n**Still here**')
    expect(root.textContent).toContain('notARealCommand')
    expect(root.querySelector('strong')?.textContent).toBe('Still here')
  })

  it('preserves file-link and external-link integration without touching code blocks or formulas', () => {
    const seen: string[] = []
    const root = renderMarkdown('src/a.ts:42 and `src/b.ts`\n\n| Link |\n| --- |\n| [**docs**](https://example.com) |\n\n```ts\nsrc/c.ts\n```\n\n$\\text{src/d.ts}$', {
      appendFileText(parent, text) { seen.push(text); parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; anchor.dataset.handled = 'true'; return anchor },
    })
    expect(seen.join('')).toContain('src/a.ts:42')
    expect(seen.join('')).not.toMatch(/src\/[bcd]\.ts/)
    expect(root.querySelector('button')?.textContent).toBe('src/b.ts')
    expect(root.querySelector('a[data-handled] strong')?.textContent).toBe('docs')
    expect(root.querySelector('pre code')?.textContent).toContain('src/c.ts')
  })

  it('opens the destination a local link names, not its label', () => {
    const files: Array<{ path: string; line?: number }> = []
    const root = renderMarkdown('See [rdma.cuh](csrc/kernels/rdma.cuh#L42), [the fix](src/a.ts#L7-L9) and [MIT](LICENSE).', {
      appendFileText(parent, text) { parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; return anchor },
      fileLink(path, line) {
        files.push({ path, ...(line === undefined ? {} : { line }) })
        const button = document.createElement('button')
        button.className = 'file-link'
        return button
      },
    })
    // The label is what the reader sees; the destination is what the click opens.
    expect(files).toEqual([
      { path: 'csrc/kernels/rdma.cuh', line: 42 },
      { path: 'src/a.ts', line: 7 },
      { path: 'LICENSE' },
    ])
    expect([...root.querySelectorAll('button.file-link')].map(button => button.textContent))
      .toEqual(['rdma.cuh', 'the fix', 'MIT'])
    expect(root.querySelector('a')).toBeNull()
  })

  it('keeps the label markup inside the file link it belongs to', () => {
    const root = renderMarkdown('[**the handler**](src/a.ts#L3)', {
      appendFileText(parent, text) { parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; return anchor },
      fileLink() {
        const button = document.createElement('button')
        button.className = 'file-link'
        return button
      },
    })
    const button = root.querySelector('button.file-link')
    expect(button?.querySelector('strong')?.textContent).toBe('the handler')
    // The walker must not wrap the link's own label in a second link.
    expect(root.querySelectorAll('button.file-link')).toHaveLength(1)
  })

  it('leaves a label that is itself path-shaped as the label, not as a second link', () => {
    // `src/a.ts` matches the bare-text linkifier, so a walker that entered the
    // button would nest a link whose click answers with the label instead of the
    // destination. An inline code label is the other way to nest one.
    const files: string[] = []
    const root = renderMarkdown('[src/a.ts](docs/README.md) and [`src/b.ts`](docs/GUIDE.md)', {
      appendFileText(parent, text) { parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; return anchor },
      fileLink(path) {
        files.push(path)
        const button = document.createElement('button')
        button.className = 'file-link'
        return button
      },
    })
    expect(files).toEqual(['docs/README.md', 'docs/GUIDE.md'])
    expect(root.querySelectorAll('button.file-link')).toHaveLength(2)
    expect(root.querySelectorAll('button.code-link')).toHaveLength(0)
    expect(root.querySelector('button.file-link code')?.textContent).toBe('src/b.ts')
  })

  it('labels a file link that carries no text, instead of leaving an invisible button', () => {
    const root = renderMarkdown('[](csrc/a.ts#L3)', {
      appendFileText(parent, text) { parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; return anchor },
      fileLink(path, line) {
        const button = document.createElement('button')
        button.className = 'file-link'
        button.textContent = path + (line === undefined ? '' : ':' + String(line))
        return button
      },
    })
    const button = root.querySelector('button.file-link')
    expect(button?.textContent).toBe('csrc/a.ts:3')
  })

  it('keeps a Windows destination, which the sanitizer must not read as a URL scheme', () => {
    const files: string[] = []
    const root = renderMarkdown('[fix](C:/proj/a.ts#L3) [other](C:\\proj\\b.ts) [bad](javascript:alert%281%29) [mail](mailto:a@b.com)', {
      appendFileText(parent, text) { parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; return anchor },
      fileLink(path, line) {
        files.push(path + (line === undefined ? '' : ':' + String(line)))
        const button = document.createElement('button')
        button.className = 'file-link'
        return button
      },
    })
    // marked percent-encodes the backslash form, which the parse decodes again.
    expect(files).toEqual(['C:/proj/a.ts:3', 'C:\\proj\\b.ts'])
    expect(root.textContent?.trim()).toBe('fix other bad mail')
  })

  it('decodes an escaped destination and refuses a fragment, query or URL that is not a file', () => {
    const files: string[] = []
    const root = renderMarkdown('[spaced](My%20Project/src/a.ts) [section](#heading) [scheme](mailto:a@b.com) '
      + '[url](https://example.com/a.ts) [bad](src/a.ts#L0)', {
      appendFileText(parent, text) { parent.append(document.createTextNode(text)) },
      inlineCode(text) { const button = document.createElement('button'); button.textContent = text; return button },
      link(href) { const anchor = document.createElement('a'); anchor.href = href; return anchor },
      fileLink(path) {
        files.push(path)
        const button = document.createElement('button')
        button.className = 'file-link'
        return button
      },
    })
    expect(files).toEqual(['My Project/src/a.ts'])
    // Everything else stays inert text: no dead link for the user to click.
    expect(root.textContent?.trim()).toBe('spaced section scheme url bad')
  })

  it.each([
    ['', undefined],
    ['a.ts', { path: 'a.ts' }],
    ['a.ts#L42', { path: 'a.ts', line: 42 }],
    ['a.ts#L42-L50', { path: 'a.ts', line: 42 }],
    ['a%20b.ts', { path: 'a b.ts' }],
    ['%E4%B8%AD.ts', { path: '中.ts' }],
    ['C:/x.ts', { path: 'C:/x.ts' }],
    ['C:x.ts', undefined],
    ['#L1', undefined],
    ['a.ts#L0', undefined],
    ['a.ts#L2-L1', undefined],
    ['a.ts#1', undefined],
    ['a.ts?x=1', undefined],
    ['//host/share/a.ts', undefined],
    ['file:///etc/passwd', undefined],
    ['javascript:alert%281%29', undefined],
    ['mailto:a@b.com', undefined],
    ['%ZZ', undefined],
    ['a%00b.ts', undefined],
  ])('parses %s the way DSH does', (href, expected) => {
    expect(parseFileLink(href)).toEqual(expected)
  })
})

describe('streaming Markdown boundaries', () => {
  it.each(['$$', '\\[', '```', '~~~~'])('does not split %s blocks at internal blank lines, even one character at a time', open => {
    const close = open === '\\[' ? '\\]' : open
    const state = createMarkdownScanState()
    const prefix = 'Hello\n\n'
    const block = `${open}\nx = 1\n\ny = 2\n${close}`
    let text = ''
    for (const character of prefix + block) {
      text += character
      scanMarkdownStream(state, text)
      expect(state.safeBoundary).toBeLessThanOrEqual(prefix.length)
    }
    expect(state.safeBoundary).toBe(prefix.length)
    text += '\n\nTail'
    scanMarkdownStream(state, text)
    expect(state.safeBoundary).toBe(text.length - 4)
  })

  it('ignores math delimiters inside inline code, escaped text and fenced code', () => {
    const source = '`$$` and \\$$\n\n~~~js\n$$\n~~~\n\nDone\n\n'
    const state = createMarkdownScanState()
    scanMarkdownStream(state, source)
    expect(state.safeBoundary).toBe(source.length)
    expect(state.math).toBe('')
    expect(state.fence).toBe('')
  })

  it('does not close a longer fence with three backticks', () => {
    const state = createMarkdownScanState()
    const text = '````md\n```\n\nstill code\n````\n\n'
    scanMarkdownStream(state, text.slice(0, -6))
    expect(state.safeBoundary).toBe(0)
    scanMarkdownStream(state, text)
    expect(state.safeBoundary).toBe(text.length)
  })

  it('renders completed streaming tables and math identically to history', () => {
    const text = 'Intro\n\n| A | B |\n| --- | ---: |\n| $x$ | 36 |\n\n$$\nx + y\n\n+ z\n$$\n\nDone'
    const state = createMarkdownScanState()
    const root = document.createElement('div')
    let committed = 0
    for (let end = 1; end <= text.length; end += 1) {
      scanMarkdownStream(state, text.slice(0, end))
      if (state.safeBoundary > committed) {
        root.append(...renderMarkdown(text.slice(committed, state.safeBoundary)).childNodes)
        committed = state.safeBoundary
      }
    }
    root.append(...renderMarkdown(text.slice(committed)).childNodes)
    expect(root.innerHTML).toBe(renderMarkdown(text).innerHTML)
  })
})
