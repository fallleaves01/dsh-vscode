import { spawn } from 'node:child_process'
import * as vscode from 'vscode'
import { DshConnectionError } from './dsh-connection.js'
import { pickRuntimeSettingsNamespace } from './runtime-settings-picker.js'
import { PLUGIN_STATUS_ICONS, PLUGIN_STATUS_LABELS, runtimePluginGroups } from './runtime-plugin-inventory.js'
import { resolveLaunch } from './launch.js'
import { redactDshSecrets } from './runtime-output.js'
import { terminateProcessTree } from './process-tree.js'
import {
  isCurrentRuntimeTarget,
  restartAfterRuntimeChange,
  runtimeChangeTarget,
  runtimeIsNotOurs,
  type RuntimeChangeController,
  type RuntimeChangeTarget,
} from './runtime-change.js'
import {
  COMMUNITY_REGISTRY_URL,
  parseCommunityRuntimePlugins,
  type CommunityRuntimePlugin,
} from './plugin-catalog.js'
import {
  findAddedPlugin,
  installedPluginStatus,
  normalizePluginSpec,
  readInstalledPlugins,
  resolveDshHome,
  type InstalledPlugin,
  type PluginInventorySnapshot,
} from './plugin-profile.js'
import {
  hasSettingsOverrides,
  parseRuntimeSetting,
  runtimeSettingFields,
  settingConstantOptions,
  type RuntimeSettingField,
  type SettingsDescription,
  type SettingsMutation,
  type SettingsNamespace,
} from './runtime-settings.js'

const CATALOG_CACHE_KEY = 'deepseekHarness.communityRuntimePlugins'
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024

/** Upper bound for one official plugin CLI process before it is terminated. */
export const PLUGIN_COMMAND_TIMEOUT_MS = 120_000

/** Collected stdout/stderr bytes retained and written for one plugin command. */
export const PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES = 256 * 1024

/** Environment variable families a plugin CLI must not inherit. */
const SENSITIVE_ENV_EXACT = new Set(['DEEPSEEK_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'VSCE_PAT', 'SSH_AUTH_SOCK'])

function isSensitivePluginEnvKey(key: string): boolean {
  const upper = key.toUpperCase()
  return SENSITIVE_ENV_EXACT.has(upper)
    || /^DEEPSEEK_.*_KEY$/.test(upper)
    || /(?:^|_)TOKEN$/.test(upper)
    || upper.startsWith('AZURE_')
    || upper.startsWith('AWS_')
}

/**
 * Environment for one official `dsh plugin` / pnpm child process.
 *
 * Runtime and package-manager credentials are removed from the inherited
 * environment; only variables the CLI needs to find its own home, the network
 * proxy/CA setup and the user's shell remain. The function is pure so the
 * sanitization can be tested without spawning a process.
 */
export function pluginCommandEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || isSensitivePluginEnvKey(key)) continue
    env[key] = value
  }
  return env
}

/** One OutputChannel line: secrets redacted, control characters removed, no newline. */
function pluginOutputLine(value: string): string {
  return redactDshSecrets(value)
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/[\r\n\u2028\u2029]+/gu, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
}

interface CatalogCache {
  fetchedAt: number
  plugins: CommunityRuntimePlugin[]
}

interface PluginController extends RuntimeChangeController {
  readonly onDidChangeRuntimeSettings: vscode.Event<void>
  pluginInventory(): Promise<PluginInventorySnapshot>
  settings(): Promise<SettingsDescription>
  mutateSettings(namespace: SettingsNamespace, ops: SettingsMutation[]): Promise<SettingsNamespace>
}

type PluginPick = vscode.QuickPickItem & (
  | { action: 'install' }
  | { action: 'browse' }
  | { action: 'configure' }
  | { action: 'inventory' }
  | { action: 'refresh' }
  | { action: 'plugin'; plugin: InstalledPlugin }
  | { action: 'empty' }
)

/** Manage runtime-capability bundles through the official DSH profile CLI. */
export class DshPluginManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: PluginController,
    private readonly output: vscode.OutputChannel,
    private readonly openSettingsPage?: () => void,
  ) {}

  private outputLine(text: string): void {
    this.output.appendLine(pluginOutputLine(text))
  }

  async show(): Promise<void> {
    while (true) {
      // An external server need not use this machine's web profile.
      const external = runtimeIsNotOurs(this.controller.runtimeOwnership)
      const plugins = external ? [] : readInstalledPlugins(resolveDshHome())
      const inventory = await this.tryInventory()
      const selected = await vscode.window.showQuickPick(this.items(plugins, inventory), {
        title: 'DeepSeek Harness Runtime Plugins',
        placeHolder: runtimeIsNotOurs(this.controller.runtimeOwnership)
          ? 'Connected DSH runtime · use its CLI to install or remove plugins'
          : 'Tools, skills, MCP, memory, and agent hooks loaded by the DSH web profile',
        matchOnDescription: true,
        matchOnDetail: true,
      })
      if (selected === undefined || selected.action === 'empty') return
      if (selected.action === 'browse') {
        await this.browseCatalog()
        return
      }
      if (selected.action === 'configure') {
        if (this.openSettingsPage) { this.openSettingsPage(); return }
        await this.configureSettings()
        continue
      }
      if (selected.action === 'inventory') {
        await this.showInventory()
        continue
      }
      if (selected.action === 'refresh') continue
      if (selected.action === 'install') {
        await this.install()
        continue
      }
      await this.pluginActions(selected.plugin)
    }
  }

  private items(
    plugins: readonly InstalledPlugin[],
    inventory: PluginInventorySnapshot | undefined,
  ): PluginPick[] {
    const items: PluginPick[] = [
      {
        action: 'install',
        label: '$(add) Install runtime plugin…',
        detail: 'Install an npm package, GitHub source, tarball, or local DSH bundle',
      },
      {
        action: 'browse',
        label: '$(search) Find community runtime plugins…',
        detail: runtimeIsNotOurs(this.controller.runtimeOwnership)
          ? 'Browse plugin sources; install using the external runtime’s CLI'
          : 'Search tools, skills, MCP integrations, memory, and agent hooks; install with one click',
      },
      {
        action: 'configure',
        label: '$(settings-gear) Configure runtime settings…',
        detail: 'Edit settings namespaces registered by built-in and community DSH plugins',
      },
      {
        action: 'inventory',
        label: '$(list-tree) View runtime plugin inventory…',
        detail: 'Read-only plugin status, grouped by Agent preset and global runtime',
      },
      {
        action: 'refresh',
        label: '$(refresh) Refresh',
        detail: runtimeIsNotOurs(this.controller.runtimeOwnership)
          ? 'Read the connected runtime’s Loader status again'
          : 'Read the current web profile and Loader status again',
      },
      { action: 'empty', label: 'Installed for the DSH web profile', kind: vscode.QuickPickItemKind.Separator },
    ]

    if (runtimeIsNotOurs(this.controller.runtimeOwnership)) {
      return items.filter(item => item.action !== 'install' && item.action !== 'empty')
    }
    if (plugins.length === 0) {
      items.push({
        action: 'empty',
        label: '$(info) No community runtime plugins installed',
        detail: 'The built-in DSH runtime remains available.',
      })
      return items
    }

    for (const plugin of plugins) {
      const status = plugin.bundle ? installedPluginStatus(plugin.name, inventory) : 'inactive'
      items.push({
        action: 'plugin',
        plugin,
        label: `$(${PLUGIN_STATUS_ICONS[status]}) ${plugin.name}`,
        description: plugin.bundle ? PLUGIN_STATUS_LABELS[status] : 'Not a DSH bundle',
        detail: `${plugin.spec} · Applies to every project using the web profile`,
      })
    }
    return items
  }

  private async showInventory(): Promise<void> {
    while (true) {
      const inventory = await this.tryInventory()
      if (inventory === undefined) {
        await vscode.window.showWarningMessage('Runtime inventory is unavailable. Connect to DSH and try again.')
        return
      }
      const rows = runtimePluginGroups(inventory).flatMap(group => [
        { label: group.label, kind: vscode.QuickPickItemKind.Separator },
        ...group.rows,
        ...(group.rows.length === 0 ? [{ label: 'No entries in this group' }] : []),
      ])
      const refresh = { label: '$(refresh) Refresh inventory' }
      const selected = await vscode.window.showQuickPick([refresh, ...rows], {
        title: 'DSH Runtime Plugin Inventory',
        placeHolder: 'Loader status only; an active MCP plugin does not confirm its server is connected',
        matchOnDescription: true,
        matchOnDetail: true,
      })
      if (selected === undefined) return
      // All rows are informational; reopening also fetches a fresh owner snapshot.
    }
  }

  private async tryInventory(): Promise<PluginInventorySnapshot | undefined> {
    if (this.controller.state.phase !== 'ready') return undefined
    try {
      return await this.controller.pluginInventory()
    } catch (error) {
      this.outputLine(`[plugins] Runtime inventory unavailable: ${this.message(error)}`)
      return undefined
    }
  }

  private async install(): Promise<void> {
    if (!await this.requireIdle()) return
    const before = readInstalledPlugins(resolveDshHome())
    const input = await vscode.window.showInputBox({
      title: 'Install DSH Runtime Plugin',
      prompt: 'Enter an npm package, GitHub source, tarball, or local DSH plugin path.',
      placeHolder: '@scope/plugin or github:owner/repository',
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          normalizePluginSpec(value)
          return undefined
        } catch (error) {
          return this.message(error)
        }
      },
    })
    if (input === undefined) return
    const spec = normalizePluginSpec(input)
    const confirmed = await vscode.window.showWarningMessage(
      `Install ${spec}?`,
      {
        modal: true,
        detail: 'Third-party DSH plugins run with your user permissions and may access files, credentials, and the network. This changes the shared web profile for every VS Code project. Only install sources you trust.',
      },
      'Install',
    )
    if (confirmed !== 'Install') return
    await this.installConfirmed(spec, spec, before)
  }

  private async installConfirmed(
    spec: string,
    displayName: string,
    before: readonly InstalledPlugin[] = readInstalledPlugins(resolveDshHome()),
  ): Promise<void> {
    const target = await this.runOfficialPluginCommand(['add', spec], `Installing ${displayName}`)
    const installed = readInstalledPlugins(resolveDshHome())
    const added = findAddedPlugin(before, installed)
    if (added !== undefined && !added.bundle) {
      await vscode.window.showWarningMessage(
        `${added.name} installed, but it does not declare a DSH bundle and was not activated.`,
      )
    }
    await this.restartAfterChange(`Installed ${added?.name ?? spec}`, target)
  }

  private async browseCatalog(): Promise<void> {
    const plugins = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading DSH community runtime plugins…',
    }, async () => this.loadCatalog())
    const installed = new Set(runtimeIsNotOurs(this.controller.runtimeOwnership)
      ? [] : readInstalledPlugins(resolveDshHome()).map(plugin => plugin.name))
    const selected = await vscode.window.showQuickPick(plugins.map(plugin => {
      const alreadyInstalled = installed.has(plugin.npm ?? plugin.name)
      const stars = plugin.stars === undefined ? '' : ` · ★ ${String(plugin.stars)}`
      return {
        label: `${alreadyInstalled ? '$(pass-filled) ' : ''}${plugin.name}`,
        description: `${plugin.categoryLabel}${stars}`,
        detail: `${plugin.description} · ${plugin.owner}`,
        plugin,
        alreadyInstalled,
      }
    }), {
      title: 'Community Runtime Plugins',
      placeHolder: 'Search tools, skills, MCP, memory, integrations, and agent hooks',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (selected === undefined) return
    const actions = selected.alreadyInstalled || runtimeIsNotOurs(this.controller.runtimeOwnership)
      ? [{ label: '$(github) Open on GitHub', action: 'open' as const }]
      : [
          { label: '$(cloud-download) Install', action: 'install' as const },
          { label: '$(github) Open on GitHub', action: 'open' as const },
        ]
    const action = await vscode.window.showQuickPick(actions, {
      title: `${selected.plugin.owner}/${selected.plugin.name}`,
      placeHolder: selected.alreadyInstalled ? 'Already installed in the DSH web profile' : selected.plugin.description,
    })
    if (action?.action === 'open') {
      await vscode.env.openExternal(vscode.Uri.parse(selected.plugin.url))
      return
    }
    if (action?.action !== 'install' || !await this.requireIdle()) return
    const confirmed = await vscode.window.showWarningMessage(
      `Install ${selected.plugin.name}?`,
      {
        modal: true,
        detail: `${selected.plugin.description}\n\nSource: ${selected.plugin.url}\nInstall: ${selected.plugin.installSpec}\n\nThird-party DSH plugins run with your user permissions and may access files, credentials, and the network. The community catalog is not a security review.`,
      },
      'Install',
    )
    if (confirmed !== 'Install') return
    await this.installConfirmed(selected.plugin.installSpec, selected.plugin.name)
  }

  private async loadCatalog(): Promise<CommunityRuntimePlugin[]> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try {
        response = await fetch(COMMUNITY_REGISTRY_URL, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
      if (!response.ok) throw new Error(`Community registry returned HTTP ${String(response.status)}.`)
      const source = await response.text()
      if (Buffer.byteLength(source, 'utf8') > MAX_REGISTRY_BYTES) {
        throw new Error('Community registry response is unexpectedly large.')
      }
      const plugins = parseCommunityRuntimePlugins(JSON.parse(source) as unknown, { locale: vscode.env.language })
      if (plugins.length === 0) throw new Error('Community registry contains no compatible runtime plugins.')
      await this.context.globalState.update(CATALOG_CACHE_KEY, { fetchedAt: Date.now(), plugins } satisfies CatalogCache)
      return plugins
    } catch (error) {
      const cached = this.context.globalState.get<CatalogCache>(CATALOG_CACHE_KEY)
      if (cached !== undefined && Array.isArray(cached.plugins) && cached.plugins.length > 0) {
        this.outputLine(`[plugins] Community registry unavailable; using cache from ${new Date(cached.fetchedAt).toISOString()}: ${this.message(error)}`)
        return cached.plugins
      }
      throw new Error(`Could not load community runtime plugins: ${this.message(error)}`)
    }
  }

  private async pluginActions(plugin: InstalledPlugin): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      {
        label: '$(trash) Remove plugin',
        description: plugin.name,
        detail: 'Remove it from the shared DSH web profile and restart the runtime',
        action: 'remove' as const,
      },
    ], {
      title: plugin.name,
      placeHolder: plugin.spec,
    })
    if (selected?.action !== 'remove' || !await this.requireIdle()) return
    const confirmed = await vscode.window.showWarningMessage(
      `Remove ${plugin.name} from the DSH web profile?`,
      { modal: true, detail: 'The change applies to every VS Code project using this profile.' },
      'Remove',
    )
    if (confirmed !== 'Remove') return
    const target = await this.runOfficialPluginCommand(['remove', plugin.name], `Removing ${plugin.name}`)
    await this.restartAfterChange(`Removed ${plugin.name}`, target)
  }

  private async configureSettings(): Promise<void> {
    if (this.controller.state.phase !== 'ready') {
      await vscode.window.showWarningMessage('Start DeepSeek Harness before configuring runtime settings.')
      return
    }
    while (true) {
      const selected = await pickRuntimeSettingsNamespace(this.controller)
      if (selected === undefined) return
      const target = this.changeTarget()
      let changed: boolean
      try {
        changed = await this.configureNamespace(selected)
      } catch (error) {
        if (!(error instanceof DshConnectionError) || error.code !== 'settings/conflict') throw error
        await vscode.window.showWarningMessage('These runtime settings changed elsewhere. Nothing was overwritten; choose the setting again to edit the latest version.')
        continue
      }
      if (!changed) continue
      if (selected.applies === 'restart') {
        await this.restartAfterChange(`${selected.ns} updated`, target)
        return
      }
      await vscode.window.showInformationMessage(`${selected.ns} updated.`)
    }
  }

  private async configureNamespace(namespace: SettingsNamespace): Promise<boolean> {
    if (namespace.applies === 'restart' && !await this.requireIdle()) return false
    const fields = runtimeSettingFields(namespace)
    type FieldPick = vscode.QuickPickItem & (
      | { action: 'field'; field: RuntimeSettingField }
      | { action: 'reset-all' }
    )
    const items: FieldPick[] = fields.map(field => ({
      action: 'field',
      field,
      label: field.path.join('.'),
      description: this.settingSummary(field),
      detail: `${field.overridden ? 'Customized' : 'Inherited'}${field.node.meta?.description === undefined ? '' : ` · ${field.node.meta.description}`}`,
    }))
    if (hasSettingsOverrides(namespace)) {
      items.unshift({
        action: 'reset-all',
        label: '$(discard) Reset all overrides',
        description: namespace.ns,
        detail: 'Use the values supplied by DSH and its plugins',
      })
    }
    const selected = await vscode.window.showQuickPick(items, {
      title: namespace.ns,
      placeHolder: namespace.applies === 'restart' ? 'Changes restart the DSH runtime' : 'Changes apply immediately',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (selected === undefined) return false
    if (selected.action === 'reset-all') {
      const resets: SettingsMutation[] = fields
        .filter(field => field.overridden)
        .map(field => ({ op: 'unset', path: field.path }))
      if (resets.length === 0) return false
      await this.controller.mutateSettings(namespace, resets)
      return true
    }
    const mutation = await this.editSetting(namespace, selected.field)
    if (mutation === undefined) return false
    await this.controller.mutateSettings(namespace, [mutation])
    return true
  }

  private async editSetting(
    namespace: SettingsNamespace,
    field: RuntimeSettingField,
  ): Promise<SettingsMutation | undefined> {
    if (field.secretSet !== undefined) return this.editSecret(field)
    const options = settingConstantOptions(field, namespace.schema)
    if (options !== undefined) {
      type ValuePick = vscode.QuickPickItem & ({ value: unknown } | { reset: true })
      const choices: ValuePick[] = options.map(value => ({
        label: this.settingValue(value),
        ...(Object.is(value, field.value) ? { description: 'Current' } : {}),
        value,
      }))
      const choiceItems: ValuePick[] = [
        ...choices,
        ...(field.overridden ? [{
          label: '$(discard) Use inherited value',
          description: this.settingValue(field.inherited),
          reset: true as const,
        }] : []),
      ]
      const selected = await vscode.window.showQuickPick(choiceItems, {
        title: field.path.join('.'), placeHolder: 'Choose a value',
      })
      if (selected === undefined) return undefined
      if ('reset' in selected) return { op: 'unset', path: field.path }
      return { op: 'set', path: field.path, value: selected.value }
    }
    const action = await vscode.window.showQuickPick([
      { label: '$(edit) Change value', action: 'edit' as const },
      ...(field.overridden ? [{
        label: '$(discard) Use inherited value',
        description: this.settingValue(field.inherited),
        action: 'reset' as const,
      }] : []),
    ], { title: field.path.join('.'), placeHolder: this.settingSummary(field) })
    if (action === undefined) return undefined
    if (action.action === 'reset') return { op: 'unset', path: field.path }
    const input = await vscode.window.showInputBox({
      title: field.path.join('.'),
      prompt: field.node.type === 'string' ? 'Enter a string value.' : 'Enter the new value as JSON.',
      value: field.value === undefined ? '' : field.node.type === 'string' ? String(field.value) : JSON.stringify(field.value),
      ignoreFocusOut: true,
      validateInput: source => {
        try {
          parseRuntimeSetting(field, source)
          return undefined
        } catch (error) {
          return this.message(error)
        }
      },
    })
    if (input === undefined) return undefined
    return { op: 'set', path: field.path, value: parseRuntimeSetting(field, input) }
  }

  private async editSecret(field: RuntimeSettingField): Promise<SettingsMutation | undefined> {
    if (field.secretSet) {
      const action = await vscode.window.showQuickPick([
        { label: '$(key) Replace secret', action: 'replace' as const },
        { label: '$(trash) Clear secret', action: 'clear' as const },
      ], { title: field.path.join('.'), placeHolder: 'The current secret value is never exposed by DSH' })
      if (action === undefined) return undefined
      if (action.action === 'clear') return { op: 'unset', path: field.path }
    }
    const value = await vscode.window.showInputBox({
      title: field.path.join('.'),
      prompt: 'Enter the secret. DSH stores it without returning the value to this extension.',
      password: true,
      ignoreFocusOut: true,
      validateInput: source => source.length === 0 ? 'Secret cannot be empty.' : undefined,
    })
    return value === undefined ? undefined : { op: 'set', path: field.path, value }
  }

  private settingSummary(field: RuntimeSettingField): string {
    if (field.secretSet !== undefined) return field.secretSet ? 'Configured secret' : 'Secret not set'
    return this.settingValue(field.value)
  }

  private settingValue(value: unknown): string {
    if (value === undefined) return 'Not set'
    if (typeof value === 'string') return value === '' ? 'Empty string' : value
    const rendered = JSON.stringify(value)
    return rendered === undefined ? String(value) : rendered.length > 80 ? `${rendered.slice(0, 77)}…` : rendered
  }

  private async requireIdle(): Promise<boolean> {
    if (this.controller.isDisposed) return false
    if (this.controller.state.phase === 'loading'
      || (this.controller.runtimeOwnership !== undefined && this.controller.state.phase !== 'ready')) {
      await vscode.window.showWarningMessage('Wait for DeepSeek Harness to reconnect before changing runtime plugins.')
      return false
    }
    if (this.controller.hasRunningTasks) {
      await vscode.window.showWarningMessage('Finish or stop all running DeepSeek tasks, including background conversations and Background Jobs, before changing runtime plugins.')
      return false
    }
    return true
  }

  private changeTarget(): RuntimeChangeTarget {
    return runtimeChangeTarget(this.controller)
  }

  private isCurrentTarget(target: RuntimeChangeTarget): boolean {
    return isCurrentRuntimeTarget(this.controller, target)
  }

  private async restartAfterChange(successMessage: string, target: RuntimeChangeTarget): Promise<void> {
    await restartAfterRuntimeChange(this.controller, target, successMessage)
  }

  private async runOfficialPluginCommand(args: readonly string[], title: string): Promise<RuntimeChangeTarget> {
    if (runtimeIsNotOurs(this.controller.runtimeOwnership)) {
      throw new Error('Install or remove plugins using the CLI of the external DSH runtime, or switch to a managed runtime. No local profile was changed.')
    }
    if (!await this.requireIdle()) throw new Error('Plugin operation cancelled. Reconnect DSH or finish its running tasks before trying again.')
    const target = this.changeTarget()
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri
    const cwd = this.controller.cwd || defaultWorkspace?.fsPath || process.cwd()
    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd))?.uri ?? defaultWorkspace
    const config = vscode.workspace.getConfiguration('deepseekHarness', workspace)
    const executable = config.get<string>('executable', '')
    const launch = resolveLaunch(
      this.context.extensionUri.fsPath,
      executable,
      ['plugin', '--profile', 'web', ...args],
      { cwd },
    )
    const rendered = [launch.command, ...launch.args].map(part => JSON.stringify(part)).join(' ')
    this.outputLine(`[plugins] cwd: ${cwd}`)
    this.outputLine(`[plugins] launch: ${rendered}`)

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    }, async (_progress, token) => new Promise<void>((resolvePromise, rejectPromise) => {
      if (!this.isCurrentTarget(target) || runtimeIsNotOurs(this.controller.runtimeOwnership)
        || this.controller.state.phase === 'loading' || this.controller.hasRunningTasks
        || (this.controller.runtimeOwnership !== undefined && this.controller.state.phase !== 'ready')) {
        rejectPromise(new Error('The runtime changed or a task started. Reopen plugin management before making changes.'))
        return
      }
      let diagnostics = ''
      let outputBytes = 0
      let truncated = false
      let lineBuffer = ''
      let settled = false
      let cancelled = false
      let timeout: NodeJS.Timeout | undefined
      let cancellation: vscode.Disposable | undefined
      let outputFinished = false

      const writeOutputLine = (line: string): void => {
        if (line !== '') this.outputLine(line)
      }
      const flushOutput = (): void => {
        if (outputFinished) return
        outputFinished = true
        if (lineBuffer !== '') { writeOutputLine(lineBuffer); lineBuffer = '' }
        if (truncated) writeOutputLine(`[plugins] output truncated after ${String(PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES / 1024)} KiB.`)
      }
      const appendOutput = (value: Buffer | string): void => {
        if (settled || outputBytes >= PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES) {
          if (!settled) truncated = true
          return
        }
        const text = String(value)
        const bytes = Buffer.from(text)
        const remaining = PLUGIN_COMMAND_OUTPUT_LIMIT_BYTES - outputBytes
        const accepted = bytes.length > remaining ? bytes.subarray(0, remaining).toString('utf8') : text
        if (bytes.length > remaining) truncated = true
        outputBytes += Buffer.byteLength(accepted)
        diagnostics = `${diagnostics}${accepted}`.slice(-16_000)
        lineBuffer += accepted
        const lines = lineBuffer.split(/\r\n|\r|\n/)
        lineBuffer = lines.pop() ?? ''
        for (const line of lines) writeOutputLine(line)
      }
      const disposeCancellation = (): void => {
        cancellation?.dispose()
        cancellation = undefined
      }
      const clearTimer = (): void => {
        if (timeout !== undefined) clearTimeout(timeout)
        timeout = undefined
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimer()
        disposeCancellation()
        flushOutput()
        rejectPromise(new Error(pluginOutputLine(error.message)))
      }
      const succeed = (): void => {
        if (settled) return
        settled = true
        clearTimer()
        disposeCancellation()
        flushOutput()
        resolvePromise()
      }

      const child = spawn(launch.command, launch.args, {
        cwd,
        env: { ...pluginCommandEnv({ ...process.env, ...launch.env }), NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      })
      child.stdout.on('data', appendOutput)
      child.stderr.on('data', appendOutput)
      timeout = setTimeout(() => {
        if (settled) return
        writeOutputLine(`[plugins] command timed out after ${String(PLUGIN_COMMAND_TIMEOUT_MS / 1000)} seconds; terminating it.`)
        terminateProcessTree(child)
        fail(new Error(`The official DSH plugin command timed out after ${String(PLUGIN_COMMAND_TIMEOUT_MS / 1000)} seconds. Open DeepSeek Harness output for details.`))
      }, PLUGIN_COMMAND_TIMEOUT_MS)
      timeout.unref?.()
      cancellation = token.onCancellationRequested(() => {
        cancelled = true
        terminateProcessTree(child)
      })
      child.once('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)))
      })
      child.once('close', (code) => {
        if (cancelled) {
          fail(new Error('Plugin operation cancelled.'))
          return
        }
        if (code === 0) {
          succeed()
          return
        }
        if (/pnpm not found|ENOENT.*pnpm/i.test(diagnostics) || code === 127) {
          fail(new Error('DSH plugin management requires pnpm on PATH. Install or enable pnpm, then try again.'))
          return
        }
        fail(new Error(`The official DSH plugin command failed with code ${String(code)}. Open DeepSeek Harness output for details.`))
      })
    }))
    return target
  }

  private message(error: unknown): string {
    return pluginOutputLine(error instanceof Error ? error.message : String(error))
  }
}
