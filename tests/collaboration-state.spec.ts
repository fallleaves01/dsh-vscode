import { describe, expect, it } from 'vitest'
import {
  effectivePlanMode,
  permissionCatalogOf,
  permissionConfirmationFor,
  permissionPresetsFromCatalog,
  permissionPresetsOf,
  requiresPermissionConfirmation,
  typedCommandPermissionPreset,
  typedCommandRequestsFullAccess,
  planModeCommand,
  planModeStateOf,
  planModeWithCommandAvailability,
  requiresFullAccessConfirmation,
} from '../src/collaboration-state.js'

describe('collaboration state projections', () => {
  it('uses the official permission projection as the selector source', () => {
    expect(permissionPresetsOf({
      currentValue: 'workspace-write',
      options: [
        { value: 'read-only', name: 'read-only', description: 'Read without modifying files.' },
        { value: 'workspace-write', name: 'workspace-write', description: 'Write in this workspace.' },
        { value: 'danger-full-access', name: 'danger-full-access', description: 'No sandbox.' },
        { value: 'custom', name: 'custom' },
      ],
    })).toEqual([
      { value: 'read-only', label: 'Read Only', description: 'Read without modifying files.', selected: false },
      { value: 'workspace-write', label: 'Workspace', description: 'Write in this workspace.', selected: true },
      { value: 'danger-full-access', label: 'Full Access', description: 'No sandbox.', selected: false },
    ])
  })

  it('offers the shipped presets when the projection carries no catalogue', () => {
    // The exact shape a live 0.1.7-rc.2 runtime returns: DSH publishes only the
    // current value and leaves the catalogue to the client, so requiring
    // `options` left the sidebar with no permissions to show at all.
    expect(permissionPresetsOf({ currentValue: 'workspace-write' })).toEqual([
      { value: 'read-only', label: 'Read Only', description: 'Read files and run read-only commands.', selected: false },
      { value: 'workspace-write', label: 'Workspace', description: 'Edit files inside this project.', selected: true },
      { value: 'danger-full-access', label: 'Full Access', description: 'Run anything, including outside the project, with no approval prompts.', selected: false },
    ])
  })

  it('still prefers a catalogue when the runtime sends one', () => {
    const presets = permissionPresetsOf({
      currentValue: 'read-only',
      options: [{ value: 'read-only', name: 'Locked down', description: 'Custom wording.' }],
    })
    expect(presets).toEqual([{ value: 'read-only', label: 'Read Only', description: 'Custom wording.', selected: true }])
  })

  it('shows a profile-pinned value without offering it as a choice', () => {
    // `custom` and `auto` are never switch targets, but the current state must
    // not be invisible just because the profile pinned it.
    const presets = permissionPresetsOf({ currentValue: 'custom' })
    expect(presets).toHaveLength(4)
    expect(presets.at(-1)).toEqual({
      value: 'custom', label: 'custom', description: 'Pinned by this profile.', selected: true,
    })
    expect(presets.filter(preset => preset.selected)).toHaveLength(1)
  })

  it('reports nothing for a runtime that has no permissions projection', () => {
    expect(permissionPresetsOf(undefined)).toEqual([])
  })

  it('selects a pinned value even when the runtime lists a catalogue', () => {
    // A catalogue may omit `custom`/`auto` while a profile pins one of them; with
    // no selected row the UI showed the first preset as if it were current.
    const presets = permissionPresetsOf({
      currentValue: 'custom',
      options: [
        { value: 'read-only', name: 'read-only' },
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
        { value: 'custom', name: 'custom' },
      ],
    })
    expect(presets.filter(preset => preset.selected)).toEqual([
      { value: 'custom', label: 'custom', description: 'Pinned by this profile.', selected: true },
    ])
  })

  it('asks for confirmation however the command is spaced', () => {
    // Routing splits on runs of whitespace, so an exact-string comparison let
    // `/permission  danger-full-access` reach the runtime without the dialog.
    expect(typedCommandRequestsFullAccess('/permission danger-full-access')).toBe(true)
    expect(typedCommandRequestsFullAccess('/permission  danger-full-access')).toBe(true)
    expect(typedCommandRequestsFullAccess('  /permission\tdanger-full-access  ')).toBe(true)
    expect(typedCommandRequestsFullAccess('/permission workspace-write')).toBe(false)
    expect(typedCommandRequestsFullAccess('/permission danger-full-access extra')).toBe(false)
    expect(typedCommandRequestsFullAccess('/permissions danger-full-access')).toBe(false)
  })

  it('distinguishes an unavailable plan capability from normal mode', () => {
    expect(planModeStateOf(undefined)).toEqual({ available: false, active: false, pending: false })
    expect(planModeStateOf({ active: false, pending: false })).toEqual({ available: true, active: false, pending: false })
    expect(planModeStateOf({ active: true, pending: false })).toEqual({ available: true, active: true, pending: false })
  })

  it('shows the target mode while an official plan transition is pending', () => {
    expect(effectivePlanMode({ available: true, active: false, pending: true })).toBe(true)
    expect(effectivePlanMode({ available: true, active: true, pending: true })).toBe(false)
  })

  it('discovers plan availability from the official command list', () => {
    expect(planModeWithCommandAvailability(
      { available: false, active: false, pending: false },
      true,
    )).toEqual({ available: true, active: false, pending: false })
  })

  it('uses an empty plan command instead of sending on as a message', () => {
    expect(planModeCommand('plan')).toBe('/plan')
    expect(planModeCommand('normal')).toBe('/plan off')
  })

  it('removes Plan controls when the official command disappears without inventing a mode transition', () => {
    expect(planModeWithCommandAvailability({ available: true, active: true, pending: false }, false))
      .toEqual({ available: false, active: true, pending: false })
  })

  it('requires confirmation only for the official full-access preset', () => {
    expect(requiresFullAccessConfirmation('danger-full-access')).toBe(true)
    expect(requiresFullAccessConfirmation('workspace-write')).toBe(false)
  })
})

describe('experimental Auto review preset', () => {
  // The shape an rc.3 runtime with dsh-experimental-auto-review enabled returns.
  const CATALOG = permissionCatalogOf({
    options: [
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'danger-full-access', name: 'danger-full-access' },
      { value: 'auto', name: 'auto' },
    ],
    defaultOptions: [{ value: 'workspace-write', name: 'workspace-write' }],
    defaultPreset: 'workspace-write',
  })

  it('parses the runtime catalogue and rejects unusable answers', () => {
    expect(CATALOG).toEqual({
      options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
        { value: 'auto', name: 'auto' },
      ],
      defaultPreset: 'workspace-write',
    })
    // A malformed entry is dropped: `custom` is derived state, not a switch
    // target, and an entry without a string value cannot be selected.
    expect(permissionCatalogOf({
      options: [
        { value: 'read-only', name: 'read-only', description: 'Read without modifying files.' },
        { value: 'auto', name: 'auto' },
        { value: 'auto', name: 'duplicate' },
        { value: 'custom', name: 'Custom' },
        { name: 'no value' },
      ],
    })).toEqual({
      options: [
        { value: 'read-only', name: 'read-only', description: 'Read without modifying files.' },
        { value: 'auto', name: 'auto' },
      ],
    })
    for (const value of [
      undefined, null, {}, { options: 'auto' }, { options: [] },
      { options: [{ name: 'no value' }] }, { options: [{ value: 'custom', name: 'Custom' }] },
    ]) {
      expect(permissionCatalogOf(value)).toBeUndefined()
    }
  })

  it('offers the experimental preset with its own label, description and marker', () => {
    expect(permissionPresetsFromCatalog({ currentValue: 'workspace-write' }, CATALOG)).toEqual([
      { value: 'workspace-write', label: 'Workspace', description: 'Edit files inside this project.', selected: true },
      {
        value: 'danger-full-access', label: 'Full Access',
        description: 'Run anything, including outside the project, with no approval prompts.', selected: false,
      },
      {
        value: 'auto', label: 'Auto review',
        description: 'Auto review: the current model reviews each tool call (experimental).',
        experimental: true, selected: false,
      },
    ])
  })

  it('selects the catalogue row that matches the projection', () => {
    const presets = permissionPresetsFromCatalog({ currentValue: 'auto' }, CATALOG)
    expect(presets.filter(preset => preset.selected)).toEqual([{
      value: 'auto', label: 'Auto review',
      description: 'Auto review: the current model reviews each tool call (experimental).',
      experimental: true, selected: true,
    }])
  })

  it('keeps the description the runtime reports for a preset it configures', () => {
    const catalog = permissionCatalogOf({
      options: [{ value: 'workspace-write', name: 'workspace-write', description: 'Host wording.' }],
    })
    expect(permissionPresetsFromCatalog({ currentValue: 'workspace-write' }, catalog)).toEqual([
      { value: 'workspace-write', label: 'Workspace', description: 'Host wording.', selected: true },
    ])
  })

  it('falls back to the shipped presets when the runtime has no catalogue', () => {
    const projection = { currentValue: 'workspace-write' }
    expect(permissionPresetsFromCatalog(projection, undefined)).toEqual(permissionPresetsOf(projection))
    // An empty catalogue is a missing one, not a selector with no options.
    expect(permissionPresetsFromCatalog(projection, { options: [] })).toEqual(permissionPresetsOf(projection))
  })

  it('still shows a profile-pinned auto value when no catalogue lists it', () => {
    const presets = permissionPresetsOf({ currentValue: 'auto' })
    expect(presets).toHaveLength(4)
    expect(presets.at(-1)).toEqual({
      value: 'auto', label: 'Auto review',
      description: 'Auto review: the current model reviews each tool call (experimental).',
      experimental: true, selected: true,
    })
    expect(presets.filter(preset => preset.selected)).toHaveLength(1)
  })

  it('gates Auto review with a risk acknowledgement like Full access', () => {
    expect(requiresPermissionConfirmation('auto')).toBe(true)
    expect(requiresPermissionConfirmation('danger-full-access')).toBe(true)
    expect(requiresPermissionConfirmation('workspace-write')).toBe(false)
    expect(requiresPermissionConfirmation('read-only')).toBe(false)

    expect(permissionConfirmationFor('read-only')).toBeUndefined()
    expect(permissionConfirmationFor('auto')).toMatchObject({ value: 'auto', action: 'Enable Auto review' })
    expect(permissionConfirmationFor('auto')?.title).toContain('Experimental')
    expect(permissionConfirmationFor('auto')?.detail).toContain('experimental')
    expect(permissionConfirmationFor('danger-full-access')?.action).toBe('Enable Full Access')
  })

  it('recognises Auto review in a typed permission command however it is spaced', () => {
    expect(typedCommandPermissionPreset('/permission auto')).toBe('auto')
    expect(typedCommandPermissionPreset('/permission  auto ')).toBe('auto')
    expect(typedCommandPermissionPreset('/permission workspace-write')).toBe('workspace-write')
    expect(typedCommandPermissionPreset('/permission auto extra')).toBeUndefined()
    expect(typedCommandPermissionPreset('/permissions auto')).toBeUndefined()
    // The typed path applies the same gate as a menu click.
    const typed = typedCommandPermissionPreset('  /permission\tauto  ')
    expect(typed !== undefined && requiresPermissionConfirmation(typed)).toBe(true)
  })
  it('bounds a hostile preset catalogue before it reaches the menu', () => {
    const options = Array.from({ length: 20 }, (_, index) => ({ value: `p${String(index)}`, name: 'n'.repeat(1000), description: 'd'.repeat(2000) }))
    const catalog = permissionCatalogOf({ options })
    expect(catalog?.options).toHaveLength(16)
    expect(catalog!.options[0]!.name.length).toBe(300)
    expect(catalog!.options[0]!.description!.length).toBe(300)
    expect(permissionCatalogOf({ options: [{ value: 'v'.repeat(65), name: 'Long' }] })).toBeUndefined()
  })
})
