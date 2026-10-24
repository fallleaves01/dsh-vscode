export interface PermissionPresetItem {
  value: string
  label: string
  description?: string
  /**
   * True for a preset the runtime advertises as experimental.
   *
   * Auto review is a live, revocable integration rather than one of the presets
   * the runtime ships, so the selector marks it apart from the stable set.
   */
  experimental?: boolean
  selected: boolean
}

/** One selectable permission preset as the Host advertises it. */
export interface PermissionCatalogOption {
  value: string
  name: string
  description?: string
}

/**
 * The process-level preset catalogue served by `permissionPresets/catalog`.
 *
 * The `permissions` projection carries only `currentValue`, so this read is the
 * only way the experimental `auto` preset becomes selectable. Runtimes older
 * than DSH 0.2.1-rc.3 do not serve the RPC at all; the caller then keeps the
 * built-in presets instead. `defaultOptions` is deliberately not modelled: this
 * client switches the current conversation and never seeds a session default.
 */
export interface PermissionCatalog {
  options: PermissionCatalogOption[]
  /** Preset the Host applies to future sessions, when it reports one. */
  defaultPreset?: string
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

/** Canonical identity of the experimental per-call review preset. */
const AUTO_PRESET = 'auto'
const AUTO_PRESET_LABEL = 'Auto review'
/** Wording agreed for the experimental preset; it is not one of the shipped three. */
const AUTO_PRESET_DESCRIPTION = 'Auto review: the current model reviews each tool call (experimental).'

/**
 * Validate a `permissionPresets/catalog` answer.
 *
 * A missing list, no usable option, or a malformed entry must not leave a
 * half-parsed selector behind, so an unusable answer is rejected as a whole:
 * the caller falls back to the presets DSH ships instead of showing a menu that
 * silently lost values. `custom` is a derived current state, never a switch
 * target, which is why the runtime may list it but the selector must not.
 */
export function permissionCatalogOf(value: unknown): PermissionCatalog | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const catalog = value as Record<string, unknown>
  if (!Array.isArray(catalog.options)) return undefined
  const options: PermissionCatalogOption[] = []
  const seen = new Set<string>()
  for (const raw of catalog.options) {
    const option = catalogOptionOf(raw)
    if (option === undefined || seen.has(option.value)) continue
    seen.add(option.value)
    options.push(option)
  }
  if (options.length === 0) return undefined
  const defaultPreset = typeof catalog.defaultPreset === 'string' ? catalog.defaultPreset : ''
  return { options, ...(defaultPreset === '' ? {} : { defaultPreset }) }
}

function catalogOptionOf(value: unknown): PermissionCatalogOption | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const option = value as Record<string, unknown>
  if (typeof option.value !== 'string' || option.value === '' || option.value === 'custom') return undefined
  const name = typeof option.name === 'string' && option.name !== '' ? option.name : option.value
  const description = typeof option.description === 'string' && option.description !== ''
    ? option.description
    : undefined
  return { value: option.value, name, ...(description === undefined ? {} : { description }) }
}

/** One candidate switch target, before the display facts are derived. */
interface PresetSource {
  value: string
  name?: string
  description?: string
}

export function permissionPresetsOf(value: unknown): PermissionPresetItem[] {
  return permissionPresetsFrom(value, undefined)
}

/**
 * Build the selector from the runtime's process-level catalogue.
 *
 * The catalogue wins over the projection and the built-in set because it is the
 * only source that can name the experimental `auto` preset. Passing `undefined`
 * is the runtime-without-catalogue case and behaves exactly like
 * {@link permissionPresetsOf}.
 */
export function permissionPresetsFromCatalog(value: unknown, catalog: PermissionCatalog | undefined): PermissionPresetItem[] {
  return permissionPresetsFrom(value, catalog)
}

function permissionPresetsFrom(value: unknown, catalog: PermissionCatalog | undefined): PermissionPresetItem[] {
  if (typeof value !== 'object' || value === null) return []
  const select = value as Record<string, unknown>
  const current = typeof select.currentValue === 'string' ? select.currentValue : ''
  const items = presetSourcesOf(select, catalog).map(source => presetItemOf(source, current))
  // A profile may pin `custom`/`auto`. Neither is a switch target in the
  // built-in set, but the current state must not be invisible, so it is shown
  // as the selected row.
  if (current !== '' && !items.some(item => item.value === current)) items.push(pinnedItemOf(current))
  return items
}

function presetSourcesOf(select: Record<string, unknown>, catalog: PermissionCatalog | undefined): PresetSource[] {
  if (catalog !== undefined && catalog.options.length > 0) return catalog.options
  // Accept a catalogue when a composition supplies one; otherwise use the set
  // DSH ships, so a plain runtime still offers the choice.
  if (!Array.isArray(select.options)) {
    return PERMISSION_PRESETS.map(preset => ({ value: preset.value, description: preset.description }))
  }
  return select.options.flatMap((value): PresetSource[] => {
    if (typeof value !== 'object' || value === null) return []
    const option = value as Record<string, unknown>
    if (typeof option.value !== 'string' || option.value === 'custom') return []
    return [{
      value: option.value,
      ...(typeof option.name === 'string' ? { name: option.name } : {}),
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
    }]
  })
}

function presetItemOf(source: PresetSource, current: string): PermissionPresetItem {
  const description = presetDescriptionOf(source.value, source.description)
  return {
    value: source.value,
    label: presetLabelOf(source.value, source.name),
    ...(description === undefined ? {} : { description }),
    ...(source.value === AUTO_PRESET ? { experimental: true } : {}),
    selected: source.value === current,
  }
}

function pinnedItemOf(current: string): PermissionPresetItem {
  if (current === AUTO_PRESET) {
    return {
      value: current, label: AUTO_PRESET_LABEL, description: AUTO_PRESET_DESCRIPTION,
      experimental: true, selected: true,
    }
  }
  return {
    value: current, label: PERMISSION_LABELS[current] ?? current,
    description: 'Pinned by this profile.', selected: true,
  }
}

function presetLabelOf(value: string, reported: string | undefined): string {
  if (value === AUTO_PRESET) return AUTO_PRESET_LABEL
  return PERMISSION_LABELS[value] ?? reported ?? value
}

function presetDescriptionOf(value: string, reported: string | undefined): string | undefined {
  if (value === AUTO_PRESET) return AUTO_PRESET_DESCRIPTION
  if (reported !== undefined) return reported
  return PERMISSION_PRESETS.find(preset => preset.value === value)?.description
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

/**
 * Whether switching to this preset must be acknowledged first.
 *
 * DSH's own Web client gates exactly these two values in its UI, and the Host's
 * `/permission` command performs the switch without any prompt. Selecting Auto
 * review runs without a sandbox and delegates each tool-call decision to a model
 * review, so it carries the same class of risk as Full access.
 */
export function requiresPermissionConfirmation(value: string): boolean {
  return requiresFullAccessConfirmation(value) || value === AUTO_PRESET
}

/** The acknowledgement a preset switch must pass, or `undefined` when it needs none. */
export interface PermissionConfirmation {
  value: string
  title: string
  detail: string
  action: string
}

export function permissionConfirmationFor(value: string): PermissionConfirmation | undefined {
  if (value === AUTO_PRESET) {
    return {
      value,
      title: 'Enable Auto review (Experimental)?',
      detail: 'Auto review runs without a sandbox. Before every tool call the same model reviews whether to allow it; calls it denies are sent to you for approval. The feature is experimental, can falsely allow or deny actions, and uses additional tokens. Only use it when you trust the current task.',
      action: 'Enable Auto review',
    }
  }
  if (requiresFullAccessConfirmation(value)) {
    return {
      value,
      title: 'Enable Full access?',
      detail: 'Full access disables workspace confinement and approval prompts. It lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
      action: 'Enable Full Access',
    }
  }
  return undefined
}

/** The preset a well-formed typed `/permission <preset>` line names. */
export function typedCommandPermissionPreset(line: string): string | undefined {
  const match = /^\/permission\s+(\S+)\s*$/.exec(line.trim())
  return match === null ? undefined : match[1]
}

/**
 * Whether a typed line asks for full access.
 *
 * Routing splits a line on runs of whitespace, so the confirmation cannot be a
 * literal comparison: `/permission  danger-full-access` with an extra space is
 * the same command, and comparing the whole string let it skip the dialog.
 */
export function typedCommandRequestsFullAccess(line: string): boolean {
  const preset = typedCommandPermissionPreset(line)
  return preset !== undefined && requiresFullAccessConfirmation(preset)
}
