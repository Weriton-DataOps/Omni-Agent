import type {
  AuthorityAction,
  AuthorityActionDecision,
  AuthorityCeiling,
  AuthorityEnvelope,
  AuthorityEvaluation,
  AuthorityReason,
  AuthorityRisk
} from './types.js'

function grantCovers(ceiling: AuthorityCeiling, action: AuthorityAction): boolean {
  if (action.scope === 'runtime-internal') return action.operation === 'runtime.assemble-report'
  return ceiling.grants.some((grant) =>
    grant.resourceRef === action.resourceRef && grant.operations.includes(action.operation)
  )
}

const REQUIRED_REVERSIBLE_MUTATION_CONTROLS = new Set<AuthorityAction['requestedControls'][number]>([
  'checkpoint-before-mutation',
  'verify-after-effect',
  'reconcile-before-retry',
  'revocation-check-before-effect'
])

function isControlledReversibleMutation(action: AuthorityAction, maximumRisk: AuthorityRisk): boolean {
  if (
    maximumRisk !== 'medium' ||
    action.scope !== 'request-resource' ||
    action.operation !== 'filesystem.modify' ||
    action.effectMode !== 'journaled' ||
    action.effectClass !== 'reversible-change' ||
    action.riskLevel !== 'medium'
  ) return false
  const controls = new Set(action.requestedControls)
  return [...REQUIRED_REVERSIBLE_MUTATION_CONTROLS].every((control) => controls.has(control))
}

function reasonFor(
  ceiling: AuthorityCeiling,
  action: AuthorityAction,
  maximumRisk: AuthorityRisk,
  now: Date
): AuthorityReason {
  if (ceiling.expiresAt !== undefined && Date.parse(ceiling.expiresAt) <= now.getTime()) return 'authority-expired'
  if (action.scope === 'runtime-internal' && action.effectClass !== 'runtime-internal') return 'plan-mismatch'
  if (action.scope === 'runtime-internal' && (
    maximumRisk !== 'low' || action.riskLevel !== 'low' || action.effectMode !== 'none'
  )) return 'risk-policy'
  if (action.scope === 'request-resource' && action.effectClass === 'read-only' && (
    maximumRisk !== 'low' || action.riskLevel !== 'low' || action.effectMode !== 'none'
  )) return 'risk-policy'
  if (action.scope === 'request-resource' && action.effectClass === 'reversible-change' &&
    !isControlledReversibleMutation(action, maximumRisk)) return 'risk-policy'
  if (action.scope === 'request-resource' && !['read-only', 'reversible-change'].includes(action.effectClass)) {
    return 'risk-policy'
  }
  if (!grantCovers(ceiling, action)) return 'outside-delegated-authority'
  return 'within-delegated-authority'
}

export function evaluateAuthority(
  envelope: AuthorityEnvelope,
  now: Date
): AuthorityEvaluation {
  const boundaryTriggered = envelope.triggeredBoundaries.length > 0
  const actionDecisions: AuthorityActionDecision[] = envelope.actions.map((action) => {
    const reasonCode: AuthorityReason = boundaryTriggered
      ? 'risk-policy'
      : reasonFor(envelope.ceiling, action, envelope.maximumRisk, now)
    const permitted = reasonCode === 'within-delegated-authority'
    return {
      actionId: action.actionId,
      outcome: permitted ? 'permit' : 'deny',
      reasonCode,
      requiredControls: permitted ? [...action.requestedControls] : []
    }
  })
  const permitted = actionDecisions.every((decision) => decision.outcome === 'permit')
  const constrained = actionDecisions.some((decision) => decision.requiredControls.length > 0)
  const fiveMinutes = now.getTime() + 5 * 60_000
  const ceilingExpiry = envelope.ceiling.expiresAt === undefined
    ? fiveMinutes
    : Date.parse(envelope.ceiling.expiresAt)
  return {
    outcome: permitted ? (constrained ? 'permit-with-constraints' : 'permit') : 'deny',
    actionDecisions,
    limits: {
      notBefore: now.toISOString(),
      expiresAt: new Date(Math.min(fiveMinutes, ceilingExpiry)).toISOString(),
      maxDurationMs: 300_000
    }
  }
}
