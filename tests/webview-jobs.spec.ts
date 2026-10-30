// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * DSH 0.2.2-alpha.2's background-jobs menu: Running/Finished groups with a
 * local Clear, live progress and duration, the two-press Stop state machine
 * with pending/failed states, and an inline, bounded output panel that only
 * observes while it is expanded.
 */
const live: Harness[] = []
afterEach(async () => {
  vi.useRealTimers()
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
function open(): Harness { const h = harness(); live.push(h); return h }
const now = (): number => Date.now()
const running = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, sessionId: 'session-a', kind: 'process', label: 'Command ' + id,
  status: 'running', startedAt: now() - 5_000, ...overrides,
})
const finished = (id: string, status = 'completed', overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, sessionId: 'session-a', kind: 'process', label: 'Command ' + id,
  status, startedAt: now() - 9_000, finishedAt: now() - 2_000, ...overrides,
})
const text = (h: Harness, selector = '#jobsMenu'): string => h.document.querySelector(selector)?.textContent ?? ''
const buttonByText = (h: Harness, label: string): HTMLButtonElement | undefined =>
  [...h.document.querySelectorAll<HTMLButtonElement>('#jobsMenu button')].find(button => button.textContent === label)
function menu(h: Harness): void { h.click('#jobsTrigger') }

describe('background jobs menu', () => {
  it('groups Running and Finished rows, and Clear only removes finished rows', async () => {
    const h = open()
    h.sendState({ jobs: [running('r1'), finished('f1'), finished('f2', 'killed')] })
    await h.settle()
    menu(h)
    expect(text(h)).toContain('Running')
    // A live job keeps Finished collapsed by default, like DSH.
    const toggle = h.document.querySelector<HTMLButtonElement>('.jobs-section-toggle')!
    expect(toggle.textContent).toContain('Finished 2')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(1)
    toggle.click()
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(3)
    expect(text(h)).toContain('Clear')

    buttonByText(h, 'Clear')!.click()
    // Only finished rows disappear; the running one and the trigger stay.
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(1)
    expect(h.document.querySelector('.job-row .job-stop')).not.toBeNull()
    expect(h.document.getElementById('jobsControl')!.classList.contains('hidden')).toBe(false)
    expect(h.document.querySelector('.jobs-section-toggle')).toBeNull()
  })

  it('starts Finished expanded when nothing is running, and shows the empty state after Clear', async () => {
    const h = open()
    h.sendState({ jobs: [finished('f1'), finished('f2')] })
    await h.settle()
    menu(h)
    expect(h.document.querySelector<HTMLButtonElement>('.jobs-section-toggle')!.getAttribute('aria-expanded')).toBe('true')
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(2)
    buttonByText(h, 'Clear')!.click()
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(0)
    expect(text(h)).toContain('No background tasks in this scope')
    // Switching scope keeps the empty state text rather than inventing rows.
    buttonByText(h, 'This chat')!.click()
    expect(text(h)).toContain('No background tasks in this scope')
  })

  it('Clear drops the count to the live total and keeps an expanded running panel', async () => {
    const h = open()
    h.sendState({ jobs: [running('r1', { outputTotal: 8 }), finished('f1'), finished('f2')] })
    await h.settle()
    menu(h)
    expect(h.document.getElementById('jobsCount')!.textContent).toBe('1')
    expect(h.document.getElementById('jobsTrigger')!.getAttribute('title')).toBe('1 background job running')
    // Only the running row is rendered while Finished is collapsed.
    h.document.querySelector<HTMLButtonElement>('.job-chevron')!.click()
    expect(h.posts.filter(post => post.type === 'job-output-open')).toHaveLength(1)
    expect(h.document.querySelector('.job-output')).not.toBeNull()

    buttonByText(h, 'Clear')!.click()
    // The cleared finished rows are gone, but the live row keeps its count and
    // its expanded output panel (VERIFY-JOBS B3).
    expect(h.document.getElementById('jobsCount')!.textContent).toBe('1')
    expect(h.document.getElementById('jobsTrigger')!.getAttribute('title')).toBe('1 background job running')
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(1)
    expect(h.document.querySelector('.jobs-section-toggle')).toBeNull()
    expect(h.document.querySelector('.job-output')).not.toBeNull()
    // Clear must not close the unrelated running row's stream.
    expect(h.posts.some(post => post.type === 'job-output-close')).toBe(false)
  })

  it('hides the trigger once every finished row is cleared, but reports a jobs status', async () => {
    const h = open()
    h.sendState({ jobs: [finished('f1')] })
    await h.settle()
    expect(h.document.getElementById('jobsCount')!.textContent).toBe('1')
    menu(h)
    buttonByText(h, 'Clear')!.click()
    expect(h.document.getElementById('jobsControl')!.classList.contains('hidden')).toBe(true)
    expect(h.document.getElementById('jobsCount')!.textContent).toBe('0')

    // A reported roster error keeps the entry point reachable so it can explain
    // itself; the locally cleared row still does not come back.
    h.sendState({ jobs: [finished('f1')], jobsStatus: 'Background job status is stale' })
    await h.settle()
    expect(h.document.getElementById('jobsControl')!.classList.contains('hidden')).toBe(false)
    expect(h.document.getElementById('jobsMenu')!.textContent).toContain('Background job status is stale')
    expect(h.document.querySelectorAll('.job-item')).toHaveLength(0)
  })

  it('shows progress, the elapsed-time title and the cancelled status', async () => {
    const h = open()
    h.sendState({ jobs: [
      running('r1', { progress: 'Downloading 40%', detail: 'initial detail', startedAt: now() - 61_000 }),
      finished('k1', 'killed', { startedAt: now() - 10_000, finishedAt: now() - 4_000 }),
    ] })
    await h.settle()
    // Trigger: the live count and DSH's sentence, singular or plural.
    expect(h.document.getElementById('jobsCount')!.textContent).toBe('1')
    expect(h.document.getElementById('jobsTrigger')!.getAttribute('title')).toBe('1 background job running')
    expect(h.document.getElementById('jobsMenu')!.getAttribute('aria-label')).toBe('Background jobs')
    menu(h)
    const rows = [...h.document.querySelectorAll<HTMLElement>('.job-row')]
    const liveRow = rows.find(row => row.textContent!.includes('Command r1'))!
    // Progress wins over detail while live.
    expect(liveRow.querySelector('.job-detail')!.textContent).toBe('Downloading 40%')
    expect(liveRow.querySelector('.job-duration')!.getAttribute('title')).toMatch(/^Running for /)
    expect(liveRow.querySelector('.job-duration')!.textContent).toMatch(/^1m \d+s$/)

    h.document.querySelector<HTMLButtonElement>('.jobs-section-toggle')!.click()
    const killedRow = [...h.document.querySelectorAll<HTMLElement>('.job-row')].find(row => row.textContent!.includes('Command k1'))!
    expect(killedRow.querySelector('.job-detail')!.textContent).toBe('cancelled')
    expect(killedRow.querySelector('.job-duration')!.getAttribute('title')).toMatch(/^Took /)
    expect(h.document.getElementById('jobsTrigger')!.getAttribute('title')).toBe('1 background job running')
  })

  it('reports idle jobs in the trigger count and title', async () => {
    const h = open()
    h.sendState({ jobs: [finished('f1'), finished('f2', 'failed')] })
    await h.settle()
    expect(h.document.getElementById('jobsCount')!.textContent).toBe('2')
    expect(h.document.getElementById('jobsTrigger')!.getAttribute('title')).toBe('2 background jobs')
  })

  describe('the two-press stop', () => {
    async function arm(h: Harness): Promise<HTMLButtonElement> {
      h.sendState({ jobs: [running('r1')] })
      await h.settle()
      menu(h)
      // The arm/disarm timer is the only thing this suite fakes; rendering
      // still runs on the real animation frame.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      h.document.querySelector<HTMLButtonElement>('.job-stop')!.click()
      return h.document.querySelector<HTMLButtonElement>('.job-stop')!
    }

    it('arms for three seconds, then disarms without sending anything', async () => {
      const h = open()
      const stop = await arm(h)
      expect(stop.textContent).toBe('Confirm')
      expect(stop.getAttribute('aria-label')).toContain('Click again')
      expect(h.posts.some(post => post.type === 'kill-job')).toBe(false)
      vi.advanceTimersByTime(3_000)
      expect(h.document.querySelector<HTMLButtonElement>('.job-stop')!.textContent).toBe('Stop')
    })

    it('sends the kill on the second press and disables the button while pending', async () => {
      const h = open()
      const stop = await arm(h)
      stop.click()
      const pending = h.document.querySelector<HTMLButtonElement>('.job-stop')!
      expect(pending.disabled).toBe(true)
      expect(h.posts.at(-1)).toEqual({ type: 'kill-job', sessionId: 'session-a', jobId: 'r1' })
      // The pending state has no timer of its own: it waits for the roster.
      vi.advanceTimersByTime(10_000)
      expect(h.document.querySelector<HTMLButtonElement>('.job-stop')!.disabled).toBe(true)
    })

    it('shows a rejected stop inline for four seconds', async () => {
      const h = open()
      const stop = await arm(h)
      stop.click()
      h.send({ type: 'job-kill-result', sessionId: 'session-a', jobId: 'r1', ok: false, error: 'gateway/job-busy: still busy' })
      const failed = h.document.querySelector<HTMLButtonElement>('.job-stop')!
      expect(failed.textContent).toBe('Stop failed')
      expect(failed.getAttribute('title')).toContain('still busy')
      vi.advanceTimersByTime(4_000)
      expect(h.document.querySelector<HTMLButtonElement>('.job-stop')!.textContent).toBe('Stop')
    })

    it('hides Stop once the job is no longer running, and clears arming on Escape', async () => {
      const h = open()
      await arm(h)
      // A status patch from the output stream stops the row from offering Stop.
      h.send({ type: 'job-output-status', sessionId: 'session-a', jobId: 'r1', status: 'stopping' })
      expect(h.document.querySelector('.job-stop')).toBeNull()
      expect(text(h)).toContain('stopping')

      h.send({ type: 'job-output-status', sessionId: 'session-a', jobId: 'r1', status: 'running' })
      const stop = h.document.querySelector<HTMLButtonElement>('.job-stop')!
      stop.click()
      expect(h.document.querySelector<HTMLButtonElement>('.job-stop')!.textContent).toBe('Confirm')
      h.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(h.document.getElementById('jobsMenu')!.classList.contains('hidden')).toBe(true)
      menu(h)
      expect(h.document.querySelector<HTMLButtonElement>('.job-stop')!.textContent).toBe('Stop')
    })

    it('clears the armed state when the menu is dismissed by an outside click', async () => {
      const h = open()
      await arm(h)
      h.document.body.dispatchEvent(new Event('click', { bubbles: true }))
      expect(h.document.getElementById('jobsMenu')!.classList.contains('hidden')).toBe(true)
      menu(h)
      expect(h.document.querySelector<HTMLButtonElement>('.job-stop')!.textContent).toBe('Stop')
    })
  })

  describe('the inline output panel', () => {
    async function expand(h: Harness, job: Record<string, unknown> = running('r1', { outputTotal: 12 })): Promise<void> {
      h.sendState({ jobs: [job] })
      await h.settle()
      menu(h)
      h.document.querySelector<HTMLButtonElement>('.job-chevron')!.click()
    }

    it('opens and closes the observation stream with the right messages', async () => {
      const h = open()
      await expand(h)
      const chevron = h.document.querySelector<HTMLButtonElement>('.job-chevron')!
      expect(chevron.getAttribute('aria-expanded')).toBe('true')
      expect(chevron.getAttribute('aria-label')).toBe('Hide live output of Command r1')
      expect(h.posts.at(-1)).toEqual({ type: 'job-output-open', sessionId: 'session-a', jobId: 'r1' })
      expect(h.document.querySelector('.job-output-pre')!.textContent).toContain('(no output)')

      chevron.click()
      expect(h.posts.at(-1)).toEqual({ type: 'job-output-close', sessionId: 'session-a', jobId: 'r1' })
      expect(h.document.querySelector('.job-output')).toBeNull()
      // Reopening resumes from the last received position.
      h.send({ type: 'job-output', sessionId: 'session-a', jobId: 'r1', chunks: [
        { at: 1, text: 'first line\n' },
        { at: 2, text: 'second line\n', channel: 'stderr' },
        { at: 3, text: 'log line\n', channel: 'log' },
      ], next: 9, lossy: false })
      h.document.querySelector<HTMLButtonElement>('.job-chevron')!.click()
      expect(h.posts.at(-1)).toEqual({ type: 'job-output-open', sessionId: 'session-a', jobId: 'r1', from: 9 })
      expect(h.document.querySelector('.job-output-pre')!.textContent).toContain('first line')
      expect(h.document.querySelectorAll('.job-output-pre .stderr')).toHaveLength(1)
      expect(h.document.querySelectorAll('.job-output-pre .log')).toHaveLength(1)
    })

    it('renders gap and stream-error notices and copies the command line', async () => {
      const h = open()
      await expand(h)
      h.send({ type: 'job-output', sessionId: 'session-a', jobId: 'r1', chunks: [
        { at: 1, text: 'tail\n', gapBefore: true },
      ], next: 2, lossy: true })
      expect(text(h, '.job-output')).toContain('… earlier output dropped …')
      h.send({ type: 'job-output-error', sessionId: 'session-a', jobId: 'r1', error: 'read failed' })
      expect(text(h, '.job-output')).toContain('live output stream interrupted: read failed')

      buttonByText(h, 'Copy command')!.click()
      expect(h.posts.at(-1)).toEqual({ type: 'copy-text', text: 'Command r1' })
      expect(h.document.querySelector('.job-output-actions button')!.textContent).toBe('Copied')
    })

    it('keeps at most 512 chunks and 256 KiB, dropping the oldest with a gap', async () => {
      const h = open()
      await expand(h)
      const chunks = Array.from({ length: 600 }, (_value, index) => ({ at: index, text: 'line ' + String(index) + '\n' }))
      h.send({ type: 'job-output', sessionId: 'session-a', jobId: 'r1', chunks, next: 600, lossy: false })
      const panel = h.document.querySelector('.job-output')!
      expect(panel.textContent).toContain('… earlier output dropped …')
      expect(panel.querySelectorAll('.job-output-pre > *').length).toBeLessThanOrEqual(512)
      expect(panel.textContent).not.toContain('line 0\n')

      // Bytes are bounded too: 200 KiB of payload in 130 chunks stays under the
      // 256 KiB budget, a further 200 KiB pushes the oldest chunks out.
      const payload = 'x'.repeat(1024 * 1024 / 5)
      h.send({ type: 'job-output', sessionId: 'session-a', jobId: 'r1', chunks: Array.from({ length: 260 }, () => ({ at: 0, text: payload })), next: 900, lossy: false })
      const bytes = [...h.document.querySelectorAll('.job-output-pre > *')].reduce((total, node) => total + (node.textContent ?? '').length, 0)
      expect(bytes).toBeLessThanOrEqual(256 * 1024)
    })

    it('applies a status patch to the row and stops the stream when the menu closes', async () => {
      const h = open()
      await expand(h)
      h.send({ type: 'job-output-status', sessionId: 'session-a', jobId: 'r1', status: 'completed' })
      expect(h.document.querySelector('.job-stop')).toBeNull()
      expect(text(h)).toContain('completed')
      h.document.body.dispatchEvent(new Event('click', { bubbles: true }))
      expect(h.posts.at(-1)).toEqual({ type: 'job-output-close', sessionId: 'session-a', jobId: 'r1' })
      expect(h.document.getElementById('jobsMenu')!.classList.contains('hidden')).toBe(true)
    })

    it('closes the stream and clears the stop state when the conversation changes', async () => {
      const h = open()
      await expand(h)
      h.sendState({ sessionId: 'session-b', jobs: [running('r1', { sessionId: 'session-b' })] })
      await h.settle()
      expect(h.posts.some(post => post.type === 'job-output-close' && post.sessionId === 'session-a' && post.jobId === 'r1')).toBe(true)
    })
  })
})
