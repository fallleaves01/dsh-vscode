export interface RuntimeLaunchContext {
  readonly workspacePath: string
  readonly configuredExecutable: string
  readonly configuredArguments: readonly string[]
  readonly sharedRuntimeDirectory?: string
}

/**
 * A launch overlay may share a matching managed runtime. Window-bound bridges
 * remain exclusive unless the contributor explicitly declares compatibility.
 */
export interface RuntimeLaunchPreparation {
  readonly sharing?: 'compatible' | 'exclusive'
  transformArguments(args: readonly string[], dshVersion: string | undefined): readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  dispose?(): void | Promise<void>
}

export interface RuntimeLaunchContributor {
  prepare(context: RuntimeLaunchContext): Promise<RuntimeLaunchPreparation | undefined>
}

export function applyRuntimeLaunchPreparation(
  args: readonly string[],
  dshVersion: string | undefined,
  preparation: RuntimeLaunchPreparation | undefined,
): string[] {
  return preparation === undefined
    ? [...args]
    : [...preparation.transformArguments(args, dshVersion)]
}
