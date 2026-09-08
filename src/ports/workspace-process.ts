export interface WorkspaceProcessResult {
  readonly status: number | null
  readonly stdout?: string
  readonly stderr?: string
}

export interface WorkspaceProcess {
  run(
    executable: string,
    args: readonly string[],
    environment?: Readonly<Record<string, string>>
  ): WorkspaceProcessResult
}
