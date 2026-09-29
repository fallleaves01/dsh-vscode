/**
 * Account sign-in state for the sidebar (DSH 0.2.0-rc.2).
 *
 * The Host owns the whole OAuth exchange; this module only interprets the
 * credential-free `AccountView` it publishes and derives what the sidebar shows.
 * Nothing here ever sees a token.
 */

export type AccountSignInPhase =
  | 'initializing' | 'waiting-browser' | 'exchanging' | 'committing'
  | 'succeeded' | 'cancelled' | 'expired' | 'failed'

export type AccountSignInErrorCode = 'network' | 'protocol' | 'expired' | 'storage'

export interface AccountWallet {
  currency: 'CNY' | 'USD'
  balance: string
}

export interface AccountProfileView {
  id: string | null
  name: string | null
  contact: string | null
  avatarUrl?: string | null
}

export interface AccountState {
  /** Whether this runtime mounts the account service at all. */
  available: boolean
  signedIn: boolean
  /** Identity of the newest attempt, needed to cancel it. */
  attemptId?: string
  /** Identity of the current step of the newest attempt, when one exists. */
  phase?: AccountSignInPhase
  /** Browser URL the user must open to authorize; present while waiting. */
  authorizeUrl?: string
  /** Unix epoch milliseconds when the waiting attempt stops being valid. */
  expiresAt?: number
  errorCode?: AccountSignInErrorCode
  profile?: AccountProfileView
  wallets?: AccountWallet[]
  bonusWallets?: AccountWallet[]
  usageUrl?: string
  topUpUrl?: string
}

export function unavailableAccountState(): AccountState {
  return { available: false, signedIn: false }
}

/** Attempt phases during which the user still has a browser step to finish. */
const ACTIVE_PHASES: readonly AccountSignInPhase[] = ['initializing', 'waiting-browser', 'exchanging', 'committing']

const PHASES: readonly AccountSignInPhase[] = [...ACTIVE_PHASES, 'succeeded', 'cancelled', 'expired', 'failed']

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Whether this state is mid-flight, so the sidebar keeps refreshing it. */
export function accountAttemptActive(state: AccountState | undefined): boolean {
  return state !== undefined && state.available && state.phase !== undefined && ACTIVE_PHASES.includes(state.phase)
}

/** Whether the attempt ended in a way the user must act on. */
export function accountAttemptFailed(state: AccountState | undefined): boolean {
  return state?.phase === 'failed' || state?.phase === 'expired'
}

export function accountWalletText(wallets: readonly AccountWallet[]): string {
  return wallets.map(wallet => `${wallet.currency === 'CNY' ? '¥' : '$'}${wallet.balance}`).join(' · ')
}

function phaseOf(value: unknown): AccountSignInPhase | undefined {
  return PHASES.find(phase => phase === value)
}

/**
 * Read one `AccountView` plus its optional details into the sidebar's state.
 * @param view - the credential-free value `account/getState` returns.
 * @param details - profile and balance, absent while signed out or on failure.
 */
export function accountStateOf(
  view: unknown,
  details: { profile?: unknown; balance?: unknown } = {},
): AccountState {
  const source = record(view)
  if (source === undefined || (source.status !== 'signed-out' && source.status !== 'credential-stored')) {
    return unavailableAccountState()
  }
  const links = record(source.links)
  const attempt = record(source.attempt)
  const errorCode = attempt?.errorCode
  const state: AccountState = {
    available: true,
    signedIn: source.status === 'credential-stored',
    ...(text(attempt?.id) === undefined ? {} : { attemptId: text(attempt?.id) as string }),
    ...(phaseOf(attempt?.phase) === undefined ? {} : { phase: phaseOf(attempt?.phase) as AccountSignInPhase }),
    ...(text(attempt?.authorizeUrl) === undefined ? {} : { authorizeUrl: text(attempt?.authorizeUrl) as string }),
    ...(typeof attempt?.expiresAt === 'number' && Number.isFinite(attempt.expiresAt) ? { expiresAt: attempt.expiresAt } : {}),
    ...(errorCode === 'network' || errorCode === 'protocol' || errorCode === 'expired' || errorCode === 'storage'
      ? { errorCode } : {}),
    ...(text(links?.usageUrl) === undefined ? {} : { usageUrl: text(links?.usageUrl) as string }),
    ...(text(links?.topUpUrl) === undefined ? {} : { topUpUrl: text(links?.topUpUrl) as string }),
  }
  // Profile and balance are separate calls whose failure is not fatal, so a
  // missing detail only means the sidebar shows less.
  const profile = record(details.profile)
  if (profile?.status === 'ready') {
    const value = record(profile.value)
    if (value !== undefined) {
      state.profile = {
        id: text(value.id) ?? null,
        name: text(value.name) ?? null,
        contact: text(value.contact) ?? null,
        ...(value.avatarUrl === undefined ? {} : { avatarUrl: text(value.avatarUrl) ?? null }),
      }
    }
  }
  const balance = record(details.balance)
  if (balance?.status === 'ready') {
    const wallets = Array.isArray(balance.value) ? balance.value : []
    const bonuses = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
    state.wallets = wallets.flatMap(wallet => {
      const entry = record(wallet)
      const currency = entry?.currency === 'CNY' || entry?.currency === 'USD' ? entry.currency : undefined
      const amount = text(entry?.balance)
      return currency === undefined || amount === undefined ? [] : [{ currency, balance: amount }]
    })
    state.bonusWallets = bonuses.flatMap(wallet => {
      const entry = record(wallet)
      const currency = entry?.currency === 'CNY' || entry?.currency === 'USD' ? entry.currency : undefined
      const amount = text(entry?.balance)
      return currency === undefined || amount === undefined ? [] : [{ currency, balance: amount }]
    })
  }
  return state
}

/** Identity of the requesting UI, derived from what DSH asks the client to declare. */
export function accountClientMetadata(version: string, locale: string): Record<string, unknown> {
  return {
    version,
    // DSH selects the Platform wire locale from the primary subtag only.
    locale: locale === '' ? 'en' : locale,
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}
