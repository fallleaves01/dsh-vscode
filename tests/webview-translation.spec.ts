// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * DSH cot-translation in the sidebar: an expanded reasoning body shows the
 * translation by default, keeps the original for fragments that are not done,
 * and reports failure instead of silently showing English.
 */

const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

const CAPABILITY = { provider: 'bing', targetLanguage: 'zh', available: true, maxTextChars: 4000 }
const message = (reasoning: string, streaming = false): Record<string, unknown> =>
  ({ id: 'm1', role: 'assistant', text: '', reasoning, streaming })

async function show(h: Harness, reasoning: string, options: { streaming?: boolean; translation?: unknown } = {}): Promise<Record<string, unknown>> {
  const value = message(reasoning, options.streaming === true)
  h.sendState({ sessionId: 'session-a', messages: [value], translation: options.translation === undefined ? CAPABILITY : options.translation })
  await h.settle()
  return value
}

function openThinking(h: Harness): void {
  const root = h.document.querySelector<HTMLElement>('.thinking')
  if (root === null) throw new Error('The thinking disclosure was not rendered.')
  root.open = true
  root.dispatchEvent(new Event('toggle'))
}

function translation(h: Harness): HTMLElement | null {
  return h.document.querySelector<HTMLElement>('.thinking-translation')
}
function translatedText(h: Harness): string {
  return h.document.querySelector<HTMLElement>('.thinking-translation-text')?.textContent ?? ''
}
function thinkingBody(h: Harness): string {
  return h.document.querySelector<HTMLElement>('.thinking-body')?.textContent ?? ''
}
function requests(h: Harness): Record<string, unknown>[] {
  return h.posts.filter(post => post.type === 'translate-reasoning')
}
function requestTexts(h: Harness): string[] {
  return requests(h).map(post => String(post.text))
}
function reply(h: Harness, text: string, index = requests(h).length - 1): void {
  const request = requests(h)[index]
  if (request === undefined) throw new Error('No translate-reasoning request is pending.')
  h.send({ type: 'translate-reasoning-result', requestId: request.requestId, ok: true, text })
}
function fail(h: Harness, index = requests(h).length - 1): void {
  const request = requests(h)[index]
  if (request === undefined) throw new Error('No translate-reasoning request is pending.')
  h.send({ type: 'translate-reasoning-result', requestId: request.requestId, ok: false, error: 'Translation failed' })
}

describe('reasoning translation', () => {
  it('keeps the original thinking without controls when no capability exists', async () => {
    const h = open()
    await show(h, 'Plain thought.', { translation: null })
    openThinking(h)
    expect(translation(h)).toBeNull()
    expect(thinkingBody(h)).toBe('Plain thought.')
    expect(requests(h)).toEqual([])
  })

  it('still translates when the preferred provider is flagged unavailable', async () => {
    const h = open()
    // DSH's own client does not pre-check availability for a request; the flag
    // only labels a choice in settings. A failing provider fails the fragment.
    await show(h, 'Plain thought.', { translation: { provider: 'google', targetLanguage: 'zh', available: false, maxTextChars: 4000 } })
    openThinking(h)
    expect(translation(h)).not.toBeNull()
    expect(requestTexts(h)).toEqual(['Plain thought.'])
    fail(h)
    expect(translation(h)!.dataset.translationState).toBe('failed')
    expect(translatedText(h)).toBe('Plain thought.')
    expect(h.document.querySelector('.thinking-translation-retry')!.hidden).toBe(false)
    h.document.querySelector<HTMLButtonElement>('.thinking-translation-retry')!.click()
    reply(h, '简单想法。')
    expect(translatedText(h)).toBe('简单想法。')
  })

  it('requests nothing until the body is expanded, then shows a pending original', async () => {
    const h = open()
    await show(h, 'Plain thought.')
    expect(requests(h)).toEqual([])
    openThinking(h)
    expect(requestTexts(h)).toEqual(['Plain thought.'])
    const wrapper = translation(h)!
    expect(wrapper.dataset.translationState).toBe('pending')
    expect(wrapper.dataset.translationView).toBe('translated')
    expect(translatedText(h)).toBe('Plain thought.')
    const spinner = h.document.querySelector<HTMLElement>('.thinking-translation-spinner')!
    expect(spinner.hidden).toBe(false)
    expect(spinner.getAttribute('aria-label')).toBe('Translating reasoning')
    expect(h.document.querySelector('.thinking-translation-toggle')!.textContent).toBe('View original')
  })

  it('renders the translation and toggles between both views', async () => {
    const h = open()
    await show(h, 'Plain thought.')
    openThinking(h)
    reply(h, '简单想法。')
    const wrapper = translation(h)!
    expect(wrapper.dataset.translationState).toBe('ready')
    expect(wrapper.dataset.translationView).toBe('translated')
    expect(translatedText(h)).toBe('简单想法。')
    expect(h.document.querySelector<HTMLElement>('.thinking-translation-spinner')!.hidden).toBe(true)

    const toggle = h.document.querySelector<HTMLButtonElement>('.thinking-translation-toggle')!
    toggle.click()
    expect(wrapper.dataset.translationView).toBe('original')
    expect(translatedText(h)).toBe('Plain thought.')
    expect(toggle.textContent).toBe('View translation')

    toggle.click()
    expect(wrapper.dataset.translationView).toBe('translated')
    expect(translatedText(h)).toBe('简单想法。')
    expect(toggle.textContent).toBe('View original')
    expect(h.posts.filter(post => post.type === 'translate-reasoning')).toHaveLength(1)
  })

  it('translates blank-line paragraphs one at a time', async () => {
    const h = open()
    await show(h, 'First part.\n\nSecond part.')
    openThinking(h)
    expect(requestTexts(h)).toEqual(['First part.'])
    reply(h, '第一部分。')
    expect(requestTexts(h)).toEqual(['First part.', 'Second part.'])
    reply(h, '第二部分。')
    expect(translatedText(h)).toBe('第一部分。\n\n第二部分。')
  })

  it('keeps each message serial while different messages translate concurrently', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', translation: CAPABILITY, messages: [
      { id: 'm1', role: 'assistant', text: '', reasoning: 'One A.\n\nTwo A.' },
      { id: 'm2', role: 'assistant', text: '', reasoning: 'One B.' },
    ] })
    await h.settle()
    for (const root of h.document.querySelectorAll<HTMLElement>('.thinking')) {
      root.open = true
      root.dispatchEvent(new Event('toggle'))
    }
    // One in-flight request per message, and both messages start together.
    expect(requestTexts(h).sort()).toEqual(['One A.', 'One B.'])
    const firstA = requests(h).find(request => request.text === 'One A.')!
    const firstB = requests(h).find(request => request.text === 'One B.')!
    h.send({ type: 'translate-reasoning-result', requestId: firstB.requestId, ok: true, text: '乙一。' })
    // B's settlement must not advance A's queue past its own first fragment.
    expect(requestTexts(h)).toEqual(['One A.', 'One B.'])
    h.send({ type: 'translate-reasoning-result', requestId: firstA.requestId, ok: true, text: '甲一。' })
    expect(requestTexts(h)).toContain('Two A.')
    const secondA = requests(h).find(request => request.text === 'Two A.')!
    h.send({ type: 'translate-reasoning-result', requestId: secondA.requestId, ok: true, text: '甲二。' })
    const bodies = [...h.document.querySelectorAll<HTMLElement>('.thinking-translation-text')].map(node => node.textContent)
    expect(bodies).toEqual(['甲一。\n\n甲二。', '乙一。'])
  })

  it('splits over-long paragraphs at request boundaries and keeps their whitespace', async () => {
    const h = open()
    await show(h, 'abcd  efghij')
    // Re-limit the request size through the capability object.
    h.sendState({ sessionId: 'session-a', messages: [message('abcd  efghij')], translation: { ...CAPABILITY, maxTextChars: 6 } })
    await h.settle()
    openThinking(h)
    expect(requestTexts(h)).toEqual(['abcd'])
    reply(h, 'A')
    expect(requestTexts(h).at(-1)).toBe('efghij')
    reply(h, 'B')
    expect(translatedText(h)).toBe('A  B')
  })

  it('never splits a surrogate pair across two requests', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', messages: [message('abc😀de')], translation: { ...CAPABILITY, maxTextChars: 4 } })
    await h.settle()
    openThinking(h)
    expect(requestTexts(h)).toEqual(['abc'])
    reply(h, '甲')
    // The emoji stays whole in the second request instead of being cut in half.
    expect(requestTexts(h).at(-1)).toBe('😀de')
    reply(h, '乙')
    expect(translatedText(h)).toBe('甲乙')
  })

  it('does not request an unfinished streaming tail, then continues when it completes', async () => {
    const h = open()
    await show(h, 'First part.\n\nSecond part is still growing', { streaming: true })
    openThinking(h)
    expect(requestTexts(h)).toEqual(['First part.'])
    reply(h, '第一部分。')
    // The streaming append closes the second paragraph; the node stays open.
    h.send({ type: 'state-update', update: { messages: { appends: [
      { id: 'm1', text: '', reasoning: '\n\n', streaming: true },
    ] } } })
    await h.settle()
    expect(requestTexts(h)).toEqual(['First part.', 'Second part is still growing'])
    reply(h, '第二部分仍在增长。')
    // The appended newlines are the original text's own suffix and stay visible.
    expect(translatedText(h)).toBe('第一部分。\n\n第二部分仍在增长。\n\n')
  })

  it('reuses cached fragments when the same thought is rendered or reopened', async () => {
    const h = open()
    await show(h, 'Only thought.')
    openThinking(h)
    reply(h, '唯一想法。')
    const count = requests(h).length
    // Re-render the same conversation and open the freshly built body again.
    await show(h, 'Only thought.')
    openThinking(h)
    expect(requests(h)).toHaveLength(count)
    expect(translatedText(h)).toBe('唯一想法。')
  })

  it('drops the cache when the translation selection changes', async () => {
    const h = open()
    await show(h, 'Stable thought.')
    openThinking(h)
    reply(h, '稳定想法。')
    expect(h.document.querySelector('.thinking-translation')!.getAttribute('data-translation-view')).toBe('translated')
    h.sendState({ sessionId: 'session-a', messages: [message('Stable thought.')], translation: { ...CAPABILITY, provider: 'google' } })
    await h.settle()
    openThinking(h)
    // The old translation belonged to Bing, so the same fragment is requested again.
    expect(requestTexts(h)).toEqual(['Stable thought.', 'Stable thought.'])
    reply(h, '稳定想法（谷歌）。')
    expect(translatedText(h)).toBe('稳定想法（谷歌）。')
  })

  it('shows the original plus a failure notice and retries on request', async () => {
    const h = open()
    await show(h, 'Fragile thought.')
    openThinking(h)
    fail(h)
    const wrapper = translation(h)!
    expect(wrapper.dataset.translationState).toBe('failed')
    expect(wrapper.dataset.translationView).toBe('original')
    expect(translatedText(h)).toBe('Fragile thought.')
    const failure = h.document.querySelector<HTMLElement>('.thinking-translation-failure')!
    expect(failure.hidden).toBe(false)
    expect(failure.textContent).toBe('Translation failed. Showing the original.')
    const toggle = h.document.querySelector<HTMLButtonElement>('.thinking-translation-toggle')!
    expect(toggle.disabled).toBe(true)
    const retry = h.document.querySelector<HTMLButtonElement>('.thinking-translation-retry')!
    expect(retry.hidden).toBe(false)

    const before = requests(h).length
    retry.click()
    expect(requests(h)).toHaveLength(before + 1)
    reply(h, '脆弱想法。')
    expect(wrapper.dataset.translationState).toBe('ready')
    expect(wrapper.dataset.translationView).toBe('translated')
    expect(translatedText(h)).toBe('脆弱想法。')
    expect(failure.hidden).toBe(true)
    expect(retry.hidden).toBe(true)
    expect(toggle.disabled).toBe(false)
  })

  it('adds the controls when the capability arrives after the transcript', async () => {
    const h = open()
    const value = await show(h, 'Late capability.', { translation: null })
    openThinking(h)
    expect(translation(h)).toBeNull()
    expect(requests(h)).toEqual([])
    h.sendState({ sessionId: 'session-a', messages: [value], translation: CAPABILITY })
    await h.settle()
    expect(translation(h)).not.toBeNull()
    expect(requestTexts(h)).toEqual(['Late capability.'])
    reply(h, '迟到的能力。')
    expect(translatedText(h)).toBe('迟到的能力。')
  })

  it('renders hostile reasoning and translation as text, never as markup', async () => {
    const h = open()
    await show(h, 'Reasoning <img src=x onerror="window.pwned=1">')
    openThinking(h)
    expect(translation(h)!.querySelector('img')).toBeNull()
    reply(h, '<script>window.pwned=1</script>')
    expect(translatedText(h)).toBe('<script>window.pwned=1</script>')
    expect(translation(h)!.querySelector('script')).toBeNull()
    expect(h.document.querySelector('.thinking-translation-text')!.children).toHaveLength(0)
  })
})
