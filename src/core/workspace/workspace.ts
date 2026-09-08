export interface OpenWorkspaceRequest {
  readonly literalTarget: string
  readonly expectedRepository: string | null
  readonly reuseWindow: boolean
  readonly startClaudeSession: boolean
}

export type OpenWorkspaceRequestResult =
  | { readonly ok: true; readonly value: OpenWorkspaceRequest }
  | { readonly ok: false; readonly issues: readonly string[] }

export interface ResolvedWorkspaceTarget {
  readonly literalTarget: string
  readonly alias: 'hub' | null
  readonly canonicalPath: string
  readonly resolution: 'literal-path' | 'explicit-alias'
  readonly cwdFallbackUsed: false
}

export type WorkspaceOpenState = 'blocked' | 'workspace-open-requested' | 'workspace-opened'

export interface WorkspaceOpenResult extends ResolvedWorkspaceTarget {
  readonly state: WorkspaceOpenState
  readonly success: boolean
  readonly reason?: string
  readonly lastVerifiedState?: 'target-resolved'
  readonly expectedRepository?: string | null
  readonly expectedRepositoryVerified?: boolean
  readonly executable?: string
  readonly args?: readonly string[]
  readonly prefixArgs?: readonly string[]
  readonly verification?: 'code-status-exact-path' | 'code-status-without-exact-path'
  readonly evidenceFingerprint?: string
  readonly claudePanelOpened?: false
  readonly sessionVisible?: false
  readonly briefingDelivered?: false
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

export function parseOpenWorkspaceRequest(value: unknown): OpenWorkspaceRequestResult {
  const input = asRecord(value)
  if (!input) return { ok: false, issues: ['workspace-request:not-object'] }

  const issues: string[] = []
  const literalTarget = input.literalTarget
  if (typeof literalTarget !== 'string' || !literalTarget.trim()) {
    issues.push('literalTarget:required-string')
  }
  const expectedRepository = input.expectedRepository
  if (
    expectedRepository !== undefined && expectedRepository !== null &&
    typeof expectedRepository !== 'string'
  ) {
    issues.push('expectedRepository:expected-string-or-null')
  }
  for (const field of ['reuseWindow', 'startClaudeSession'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') {
      issues.push(`${field}:expected-boolean`)
    }
  }
  if (issues.length > 0 || typeof literalTarget !== 'string') return { ok: false, issues }

  return {
    ok: true,
    value: {
      literalTarget: literalTarget.trim(),
      expectedRepository: typeof expectedRepository === 'string' ? expectedRepository : null,
      reuseWindow: input.reuseWindow === true,
      startClaudeSession: input.startClaudeSession === true
    }
  }
}

export class WorkspaceInputValidationError extends Error {
  override readonly name = 'WorkspaceInputValidationError'

  constructor(readonly issues: readonly string[]) {
    super(`Entrada de workspace invalida: ${issues.join(', ')}.`)
  }
}
