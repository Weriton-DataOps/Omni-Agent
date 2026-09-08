import { normalizeWorkspaceAlias } from '../../core/workspace/workspace-alias.js'
import type { ResolvedWorkspaceTarget } from '../../core/workspace/workspace.js'
import type { WorkspaceFileSystem } from '../../ports/workspace-filesystem.js'
import type { WorkspacePathPolicy } from '../../ports/workspace-path-policy.js'

const PROJECT_ALIASES: Readonly<Record<string, 'OMNI_PROJECT_HUB_ROOT'>> = Object.freeze({
  hub: 'OMNI_PROJECT_HUB_ROOT',
  'hub-wp': 'OMNI_PROJECT_HUB_ROOT',
  'projeto hub': 'OMNI_PROJECT_HUB_ROOT'
})

export interface ResolveWorkspaceTargetDependencies {
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly defaultHubRoot: string | null
  readonly fileSystem: Pick<WorkspaceFileSystem, 'stat'>
  readonly pathPolicy: Pick<WorkspacePathPolicy, 'isAbsolute' | 'resolve'>
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object' && 'code' in error ? error.code : null
}

export function resolveWorkspaceTarget(
  literalTarget: unknown,
  dependencies: ResolveWorkspaceTargetDependencies
): ResolvedWorkspaceTarget {
  if (typeof literalTarget !== 'string' || !literalTarget.trim()) {
    throw new Error('A abertura do VS Code exige alvo literal ou alias de projeto explicito.')
  }
  const requested = literalTarget.trim()
  const aliasVariable = PROJECT_ALIASES[normalizeWorkspaceAlias(requested)]
  const configured = aliasVariable ? dependencies.environment[aliasVariable] : null
  const selected = dependencies.pathPolicy.isAbsolute(requested)
    ? requested
    : aliasVariable
      ? configured || dependencies.defaultHubRoot
      : null
  if (!selected || !dependencies.pathPolicy.isAbsolute(selected)) {
    throw new Error(`Projeto desconhecido: ${requested}. Informe um caminho absoluto; o cwd nunca e usado como fallback.`)
  }

  const canonicalPath = dependencies.pathPolicy.resolve(selected)
  let info
  try {
    info = dependencies.fileSystem.stat(canonicalPath)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') throw new Error(`Projeto inexistente: ${canonicalPath}.`)
    throw error
  }
  if (!info.isDirectory()) throw new Error(`Alvo do projeto nao e um diretorio: ${canonicalPath}.`)
  return {
    literalTarget: requested,
    alias: aliasVariable ? 'hub' : null,
    canonicalPath,
    resolution: dependencies.pathPolicy.isAbsolute(requested) ? 'literal-path' : 'explicit-alias',
    cwdFallbackUsed: false
  }
}
