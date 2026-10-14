/** The target must come from the view that rendered the change, not current UI state. */
interface ChangeActionHost {
  readonly state: { sessionId: string; cwd: string }
  reviewFile(path: string, turn?: number): Promise<void>
  reviewAll(): Promise<void>
  keepFile(path: string, turn: number): void
  keepAll(): void
  revertFile(path: string, turn: number): Promise<void>
  revertAll(): Promise<void>
}

export async function dispatchChangeAction(value: Record<string, unknown>, host: ChangeActionHost): Promise<void> {
  if (typeof value.sessionId !== 'string' || value.sessionId === '' || typeof value.cwd !== 'string'
    || value.sessionId !== host.state.sessionId || value.cwd !== host.state.cwd) return
  const turn = typeof value.turn === 'number' && Number.isSafeInteger(value.turn) && value.turn >= 0 ? value.turn : undefined
  switch (value.type) {
    case 'review-all': await host.reviewAll(); return
    case 'keep-all': host.keepAll(); return
    case 'revert-all': await host.revertAll(); return
    case 'review-file':
      if (typeof value.path === 'string' && value.path !== '') await host.reviewFile(value.path, turn)
      return
    case 'keep-file':
      if (typeof value.path === 'string' && value.path !== '' && turn !== undefined) host.keepFile(value.path, turn)
      return
    case 'revert-file':
      if (typeof value.path === 'string' && value.path !== '' && turn !== undefined) await host.revertFile(value.path, turn)
  }
}
