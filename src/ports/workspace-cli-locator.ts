export interface WorkspaceCliLaunchPlan {
  readonly executable: string
  readonly prefixArgs: readonly string[]
  readonly environment: Readonly<Record<string, string>>
  readonly source: 'native-cli' | 'windows-cmd-wrapper'
}

export interface WorkspaceCliLocator {
  resolve(): WorkspaceCliLaunchPlan
}
