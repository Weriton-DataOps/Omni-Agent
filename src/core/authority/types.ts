export const AUTHORITY_CONTROLS = [
  'checkpoint-before-mutation',
  'verify-after-effect',
  'reconcile-before-retry',
  'revocation-check-before-effect',
  'sanitize-output',
  'no-secret-materialization'
] as const

export const AUTHORITY_RISKS = ['low', 'medium', 'high', 'critical'] as const
export const AUTHORITY_BOUNDARIES = [
  'destructive',
  'irreversible',
  'financial',
  'privilege-expansion',
  'external-publication',
  'secret-access'
] as const

export type AuthorityControl = typeof AUTHORITY_CONTROLS[number]
export type AuthorityRisk = typeof AUTHORITY_RISKS[number]
export type AuthorityBoundary = typeof AUTHORITY_BOUNDARIES[number]
export type AuthorityActionScope = 'request-resource' | 'runtime-internal'
export type AuthorityEffectMode = 'none' | 'journaled'
export type AuthorityEffectClass =
  | 'runtime-internal'
  | 'read-only'
  | 'reversible-change'
  | 'irreversible-change'
  | 'external-publication'
  | 'financial'
  | 'privilege-change'
  | 'secret-access'

export interface AuthorityGrant {
  resourceRef: string
  operations: readonly string[]
}

export interface AuthorityCeiling {
  mode: 'proceed-within-scope'
  grants: readonly AuthorityGrant[]
  expansionBoundaries: readonly AuthorityBoundary[]
  expiresAt?: string
}

export interface AuthorityAction {
  actionId: string
  scope: AuthorityActionScope
  resourceRef?: string
  operation: string
  effectMode: AuthorityEffectMode
  effectKey?: string
  effectClass: AuthorityEffectClass
  riskLevel: AuthorityRisk
  requestedControls: readonly AuthorityControl[]
}

export interface AuthorityEnvelope {
  requestRef?: string
  ceiling: AuthorityCeiling
  actions: readonly AuthorityAction[]
  maximumRisk: AuthorityRisk
  triggeredBoundaries: readonly AuthorityBoundary[]
}

export type AuthorityReason =
  | 'within-delegated-authority'
  | 'authority-expired'
  | 'risk-policy'
  | 'plan-mismatch'
  | 'outside-delegated-authority'

export interface AuthorityActionDecision {
  actionId: string
  outcome: 'permit' | 'deny'
  reasonCode: AuthorityReason
  requiredControls: AuthorityControl[]
}

export interface AuthorityEvaluation {
  outcome: 'permit' | 'permit-with-constraints' | 'deny'
  actionDecisions: AuthorityActionDecision[]
  limits: {
    notBefore: string
    expiresAt: string
    maxDurationMs: number
  }
}
