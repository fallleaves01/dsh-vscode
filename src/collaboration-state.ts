export interface PermissionPresetItem {
  value: string
  label: string
  description?: string
  selected: boolean
}

export interface PlanModeState {
  available: boolean
  active: boolean
  pending: boolean
}

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'read-only': 'Read Only',
  'workspace-write': 'Workspace',
  'danger-full-access': 'Full Access',
}

/**
 * The presets DSH ships.
 *
 * The `permissions` projection carries only `currentValue` — the catalogue is
 * the client's business, which is why DSH's own UI derives one locally. Sending
 * no options at all left the sidebar with nothing to show, so the current
 * preset was invisible and unchangeable from the UI.
 */
const PERMISSION_PRESETS: readonly { value: string; description: string }[] = [
  { value: 'read-only', description: 'Read files and run read-only commands.' },
  { value: 'workspace-write', description: 'Edit files inside this project.' },
  { value: 'danger-full-access', description: 'Run anything, including outside the project, with no approval prompts.' },
]

export function permissionPresetsOf(value: unknown): PermissionPresetItem[] {
  if (typeof value !== 'object' || value === null) return []
  const select = value as Record<string, unknown>
  const current = typeof select.currentValue === 'string' ? select.currentValue : ''
  // Accept a catalogue when a composition supplies one; otherwise use the set
  // DSH ships, so a plain runtime still offers the choice.
  if (!Array.isArray(select.options)) {
    const presets: PermissionPresetItem[] = PERMISSION_PRESETS.map(preset => ({
      value: preset.value,
      label: PERMISSION_LABELS[preset.value] ?? preset.value,
      description: preset.description,
      selected: preset.value === current,
    }))
    // A profile may pin `custom`/`auto`. Neither is a switch target, but the
    // current state must not be invisible, so it is shown as the selected row.
    if (current !== '' && !presets.some(preset => preset.value === current)) {
      presets.push({
        value: current, label: PERMISSION_LABELS[current] ?? current,
        description: 'Pinned by this profile.', selected: true,
      })
    }
    return presets
  }
  return select.options.flatMap((value): PermissionPresetItem[] => {
    if (typeof value !== 'object' || value === null) return []
    const option = value as Record<string, unknown>
    if (typeof option.value !== 'string' || option.value === 'custom') return []
    return [{
      value: option.value,
      label: PERMISSION_LABELS[option.value]
        ?? (typeof option.name === 'string' ? option.name : option.value),
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
      selected: option.value === current,
    }]
  })
}

export function planModeStateOf(value: unknown): PlanModeState {
  if (typeof value !== 'object' || value === null) {
    return { available: false, active: false, pending: false }
  }
  const plan = value as Record<string, unknown>
  if (typeof plan.active !== 'boolean' || typeof plan.pending !== 'boolean') {
    return { available: false, active: false, pending: false }
  }
  return { available: true, active: plan.active, pending: plan.pending }
}

export function effectivePlanMode(plan: PlanModeState): boolean {
  return plan.pending ? !plan.active : plan.active
}

export function planModeWithCommandAvailability(plan: PlanModeState, available: boolean): PlanModeState {
  return { ...plan, available }
}

export function planModeCommand(mode: 'normal' | 'plan'): '/plan' | '/plan off' {
  return mode === 'plan' ? '/plan' : '/plan off'
}

export function requiresFullAccessConfirmation(value: string): boolean {
  return value === 'danger-full-access'
}
