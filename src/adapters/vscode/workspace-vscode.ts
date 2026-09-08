import { openWorkspace } from '../../application/open-workspace/open-workspace.js'
import { resolveWorkspaceTarget } from '../../application/open-workspace/resolve-workspace-target.js'
import type { WorkspaceOpenResult } from '../../core/workspace/workspace.js'
import { NodeWorkspaceEvidenceFingerprinter } from './node-workspace-evidence-fingerprinter.js'
import {
  NodeWorkspaceFileSystem,
  type WorkspaceExists,
  type WorkspaceReadText,
  type WorkspaceStat
} from './node-workspace-filesystem.js'
import {
  NodeWorkspaceProcess,
  type WorkspaceSpawn
} from './node-workspace-process.js'
import { NodeWorkspacePathPolicy } from './node-workspace-path-policy.js'
import { VscodeCliLocator } from './vscode-cli-locator.js'

export interface WorkspaceVscodeDependencies {
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly platform?: NodeJS.Platform
  readonly stat?: WorkspaceStat
  readonly exists?: WorkspaceExists
  readonly readText?: WorkspaceReadText
  readonly run?: WorkspaceSpawn
}

function dependencies(options: WorkspaceVscodeDependencies) {
  const environment = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const fileSystem = new NodeWorkspaceFileSystem(options.stat, options.exists, options.readText)
  const pathPolicy = new NodeWorkspacePathPolicy(platform)
  return {
    environment,
    defaultHubRoot: platform === 'win32' ? 'C:\\hub-wp' : null,
    fileSystem,
    process: new NodeWorkspaceProcess(options.run, environment),
    cliLocator: new VscodeCliLocator(fileSystem, environment, platform),
    pathPolicy,
    evidenceFingerprinter: new NodeWorkspaceEvidenceFingerprinter()
  }
}

export function resolverAlvoProjetoVscode(
  literalTarget: unknown,
  options: WorkspaceVscodeDependencies = {}
) {
  const resolved = dependencies(options)
  return resolveWorkspaceTarget(literalTarget, resolved)
}

export function resolverCodeCmd(options: WorkspaceVscodeDependencies = {}): string {
  return dependencies(options).cliLocator.resolve().executable
}

export function resolverPlanoCliVscode(options: WorkspaceVscodeDependencies = {}) {
  return dependencies(options).cliLocator.resolve()
}

export function statusConfirmaWorkspace(
  statusOutput: unknown,
  canonicalPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return new NodeWorkspacePathPolicy(platform).statusContainsExactPath(statusOutput, canonicalPath)
}

export function abrirProjetoNoVscode(
  request: unknown,
  options: WorkspaceVscodeDependencies = {}
): WorkspaceOpenResult {
  return openWorkspace(request, dependencies(options))
}
