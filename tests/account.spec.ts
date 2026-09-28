import { describe, expect, it } from 'vitest'
import {
  accountAttemptActive,
  accountAttemptFailed,
  accountClientMetadata,
  accountStateOf,
  accountWalletText,
  unavailableAccountState,
} from '../src/account.js'

/** The exact shape `account/getState` returned from a live 0.1.7-rc.2 runtime. */
const SIGNED_OUT = {
  status: 'signed-out',
  attempt: null,
  links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
}

function view(attempt: unknown, status = 'signed-out') {
  return { ...SIGNED_OUT, status, attempt }
}

describe('account state', () => {
  it('reads the live signed-out view DSH actually returns', () => {
    const state = accountStateOf(SIGNED_OUT)
    expect(state).toMatchObject({
      available: true,
      signedIn: false,
      usageUrl: 'https://platform.deepseek.com/usage',
      topUpUrl: 'https://platform.deepseek.com/top_up',
    })
    expect(state.phase).toBeUndefined()
  })

  it('treats an unknown view as an unavailable account rather than a wrong one', () => {
    expect(accountStateOf(undefined)).toEqual(unavailableAccountState())
    expect(accountStateOf({ status: 'weird' })).toEqual(unavailableAccountState())
    expect(accountStateOf(null)).toEqual(unavailableAccountState())
  })

  it('follows the attempt through its phases and keeps the authorize URL', () => {
    // 0.1.7-rc.2 answers startSignIn with `initializing` and mints the URL later,
    // which is why the sidebar has to keep reading until one appears.
    const starting = accountStateOf(view({ id: 'a1', phase: 'initializing' }))
    expect(starting).toMatchObject({ phase: 'initializing', attemptId: 'a1' })
    expect(starting.authorizeUrl).toBeUndefined()
    expect(accountAttemptActive(starting)).toBe(true)

    const waiting = accountStateOf(view({
      id: 'a1', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?x=1', expiresAt: 123,
    }))
    expect(waiting).toMatchObject({
      phase: 'waiting-browser',
      attemptId: 'a1',
      authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?x=1',
      expiresAt: 123,
    })
    expect(accountAttemptActive(waiting)).toBe(true)
  })

  it('stops polling once an attempt is terminal', () => {
    for (const phase of ['succeeded', 'cancelled', 'expired', 'failed']) {
      expect(accountAttemptActive(accountStateOf(view({ id: 'a1', phase })))).toBe(false)
    }
    expect(accountAttemptActive(undefined)).toBe(false)
    expect(accountAttemptActive(unavailableAccountState())).toBe(false)
  })

  it('flags only the terminal outcomes the user must act on', () => {
    expect(accountAttemptFailed(accountStateOf(view({ id: 'a1', phase: 'failed', errorCode: 'network' })))).toBe(true)
    expect(accountAttemptFailed(accountStateOf(view({ id: 'a1', phase: 'expired' })))).toBe(true)
    expect(accountAttemptFailed(accountStateOf(view({ id: 'a1', phase: 'cancelled' })))).toBe(false)
    expect(accountAttemptFailed(accountStateOf(view({ id: 'a1', phase: 'waiting-browser' })))).toBe(false)
  })

  it('keeps a known sign-in error code and drops an unknown one', () => {
    expect(accountStateOf(view({ id: 'a1', phase: 'failed', errorCode: 'storage' })).errorCode).toBe('storage')
    expect(accountStateOf(view({ id: 'a1', phase: 'failed', errorCode: 'nope' })).errorCode).toBeUndefined()
  })

  it('reads profile and balance from the wrapped detail values', () => {
    const state = accountStateOf(view({ id: 'a1', phase: 'succeeded' }, 'credential-stored'), {
      profile: { status: 'ready', value: { id: 'u1', name: 'Alex', contact: 'z@example.com' } },
      balance: {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '12.50' }],
        bonusWallets: [{ currency: 'USD', balance: '3.00' }],
      },
    })
    expect(state.signedIn).toBe(true)
    expect(state.profile).toEqual({ id: 'u1', name: 'Alex', contact: 'z@example.com' })
    expect(state.wallets).toEqual([{ currency: 'CNY', balance: '12.50' }])
    expect(state.bonusWallets).toEqual([{ currency: 'USD', balance: '3.00' }])
    expect(accountWalletText(state.wallets ?? [])).toBe('¥12.50')
  })

  it('shows less rather than failing when a detail call fails', () => {
    const state = accountStateOf(view({ id: 'a1', phase: 'succeeded' }, 'credential-stored'), {
      profile: { status: 'failed' },
      balance: { status: 'failed' },
    })
    expect(state.signedIn).toBe(true)
    expect(state.profile).toBeUndefined()
    expect(state.wallets).toBeUndefined()
  })

  it('drops a malformed wallet instead of rendering an empty amount', () => {
    const state = accountStateOf(view({ id: 'a1', phase: 'succeeded' }, 'credential-stored'), {
      balance: {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '1.00' }, { currency: 'EUR', balance: '2.00' }, { currency: 'USD' }],
        bonusWallets: [],
      },
    })
    expect(state.wallets).toEqual([{ currency: 'CNY', balance: '1.00' }])
  })

  it('declares the client metadata DSH forwards to the Platform', () => {
    const metadata = accountClientMetadata('0.0.11', 'zh-hans')
    expect(metadata.version).toBe('0.0.11')
    expect(metadata.locale).toBe('zh-hans')
    // Offset is east-positive, the sign the Platform expects.
    expect(metadata.timezoneOffsetSeconds).toBe(-new Date().getTimezoneOffset() * 60)
    expect(accountClientMetadata('0.0.11', '').locale).toBe('en')
  })
})
