import { spawnSync } from 'node:child_process'

import type { WorkspaceProcess, WorkspaceProcessResult } from '../../ports/workspace-process.js'

export interface WorkspaceSpawnOptions {
  readonly encoding: 'utf8'
  readonly windowsHide: true
  readonly shell: false
  readonly env: NodeJS.ProcessEnv
  readonly timeout: 15_000
  readonly maxBuffer: 2_097_152
}

export type WorkspaceSpawn = (
  executable: string,
  args: readonly string[],
  options: WorkspaceSpawnOptions
) => WorkspaceProcessResult

const defaultSpawn: WorkspaceSpawn = (executable, args, options) => {
  const result = spawnSync(executable, [...args], options)
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

export class NodeWorkspaceProcess implements WorkspaceProcess {
  constructor(
    private readonly spawn: WorkspaceSpawn = defaultSpawn,
    private readonly baseEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
  ) {}

  run(
    executable: string,
    args: readonly string[],
    environment: Readonly<Record<string, string>> = {}
  ): WorkspaceProcessResult {
    return this.spawn(executable, [...args], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      env: { ...this.baseEnvironment, ...environment },
      timeout: 15_000,
      maxBuffer: 2_097_152
    })
  }
}
