// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

const live: Harness[] = []
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

const signedOut = {
  available: true,
  signedIn: false,
  usageUrl: 'https://platform.deepseek.com/usage',
  topUpUrl: 'https://platform.deepseek.com/top_up',
}

/** Mirrors what the extension publishes: structure plus rendered text. */
function accountState(account: Record<string, unknown>, notice: string | null = null, failed = false) {
  return { account, accountNotice: notice, accountFailed: failed }
}

describe('webview account surface', () => {
  it('hides the account control entirely when the runtime has no account service', async () => {
    const h = open()
    h.sendState({ account: { available: false, signedIn: false }, accountNotice: null, accountFailed: false })
    await h.settle()
    expect(h.document.getElementById('accountControl')?.classList.contains('hidden')).toBe(true)
  })

  it('offers sign-in for a signed-out account', async () => {
    const h = open()
    h.sendState(accountState(signedOut))
    await h.settle()
    const control = h.document.getElementById('accountControl')
    expect(control?.classList.contains('hidden')).toBe(false)

    h.click('#accountTrigger')
    const menu = h.document.getElementById('accountMenu')
    expect(menu?.textContent).toContain('Sign in with DeepSeek')

    h.posts.length = 0
    const button = [...menu!.querySelectorAll('button')].find(node => node.textContent === 'Sign in with DeepSeek')!
    button.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'sign-in' })
  })

  it('shows the waiting phase and offers a re-open plus cancel while an attempt is live', async () => {
    const h = open()
    h.sendState(accountState({
      ...signedOut,
      attemptId: 'a1',
      phase: 'waiting-browser',
      authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?x=1',
    }, 'Waiting for you to finish in the browser…'))
    await h.settle()
    h.click('#accountTrigger')

    const menu = h.document.getElementById('accountMenu')
    expect(menu?.textContent).toContain('Waiting for you to finish in the browser…')
    expect(h.document.getElementById('accountTrigger')?.classList.contains('working')).toBe(true)

    h.posts.length = 0
    const reopen = [...menu!.querySelectorAll('button')].find(node => node.textContent === 'Open the sign-in page again')!
    reopen.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'open-link', href: 'https://platform.deepseek.com/dsh/authorize?x=1' })

    h.click('#accountTrigger')
    const cancel = [...h.document.getElementById('accountMenu')!.querySelectorAll('button')]
      .find(node => node.textContent === 'Cancel sign-in')!
    h.posts.length = 0
    cancel.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'cancel-sign-in' })
  })

  it('marks a failed attempt as an error and still offers a retry', async () => {
    const h = open()
    h.sendState(accountState({ ...signedOut, attemptId: 'a1', phase: 'failed' }, 'Sign-in failed. Try again.', true))
    await h.settle()
    h.click('#accountTrigger')
    expect(h.document.getElementById('accountTrigger')?.classList.contains('failed')).toBe(true)
    expect(h.document.querySelector('.account-line.failed')?.textContent).toContain('Sign-in failed')
    expect(h.document.getElementById('accountMenu')?.textContent).toContain('Sign in with DeepSeek')
  })

  it('shows the signed-in identity, balance, and the account actions', async () => {
    const h = open()
    h.sendState(accountState({
      available: true,
      signedIn: true,
      profile: { id: 'u1', name: 'Alex', contact: null },
      wallets: [{ currency: 'CNY', balance: '12.50' }],
      usageUrl: 'https://platform.deepseek.com/usage',
      topUpUrl: 'https://platform.deepseek.com/top_up',
    }, 'Alex · ¥12.50'))
    await h.settle()
    expect(h.document.getElementById('accountTrigger')?.classList.contains('signed-in')).toBe(true)

    h.click('#accountTrigger')
    const menu = h.document.getElementById('accountMenu')
    expect(menu?.textContent).toContain('Alex')
    expect(menu?.textContent).toContain('Balance ¥12.50')
    for (const label of ['Usage', 'Top up', 'Sign out']) expect(menu?.textContent).toContain(label)

    h.posts.length = 0
    const signOut = [...menu!.querySelectorAll('button')].find(node => node.textContent === 'Sign out')!
    signOut.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'sign-out' })
  })

  it('explains why the composer is unavailable instead of leaving it silently dead', async () => {
    const h = open()
    h.sendState({
      account: signedOut, accountNotice: null, accountFailed: false,
      routable: false,
      routableNotice: 'No DeepSeek model is available on this runtime. Sign in, or configure an API key, to start a conversation.',
    })
    await h.settle()
    const notice = h.document.getElementById('routableNotice')
    expect(notice?.classList.contains('hidden')).toBe(false)
    expect(notice?.textContent).toContain('No DeepSeek model is available')
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('hides the notice again once a model becomes available', async () => {
    const h = open()
    h.sendState({ account: signedOut, accountNotice: null, accountFailed: false, routable: false, routableNotice: 'nope' })
    await h.settle()
    h.sendState({ routable: true, routableNotice: null })
    await h.settle()
    expect(h.document.getElementById('routableNotice')?.classList.contains('hidden')).toBe(true)
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('closes the account menu when another toolbar menu opens', async () => {
    const h = open()
    h.sendState({
      ...accountState(signedOut),
      jobs: [{ id: 'j1', kind: 'bash', label: 'Build', status: 'running', detail: 'running', startedAt: 1 }],
    })
    await h.settle()
    h.click('#accountTrigger')
    expect(h.document.getElementById('accountMenu')?.classList.contains('hidden')).toBe(false)
    h.click('#jobsTrigger')
    expect(h.document.getElementById('accountMenu')?.classList.contains('hidden')).toBe(true)
  })
})
