/** Metadata only. Secret resolution and authentication belong to a trusted adapter. */
export const CREDENTIAL_STATUSES = ['unverified', 'active', 'expired', 'suspect', 'invalid', 'revoked', 'disabled', 'replaced'] as const
export type CredentialStatus = typeof CREDENTIAL_STATUSES[number]
export const CREDENTIAL_OBSERVATIONS = ['authenticated', 'invalid-token', 'revoked', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'reported-not-working', 'disabled', 'replaced'] as const
export type CredentialObservationKind = typeof CREDENTIAL_OBSERVATIONS[number]

export interface CredentialMetadata {
  readonly credentialId: string
  readonly version: number
  readonly revision: number
  readonly providerRef: string
  readonly accountRef: string
  readonly environmentRef: string
  readonly secretRef: string
  readonly issuedAt: string | null
  readonly expiryKind: 'known' | 'non_expiring' | 'unknown'
  readonly expirySource: 'provider' | 'owner-attestation' | 'unknown'
  readonly expiresAt: string | null
  readonly status: CredentialStatus
  readonly statusChangedAt: string
  readonly lastCheckedAt: string | null
  readonly lastSuccessAt: string | null
  readonly unusableSince: string | null
  readonly lastFailureAt: string | null
  readonly failureCode: Exclude<CredentialObservationKind, 'authenticated'> | null
  readonly evidenceRef: string | null
  readonly revokedAt: string | null
  readonly replacedById: string | null
  readonly renewalMode: 'none' | 'refresh' | 'rotate' | 'reauthenticate'
  readonly renewBeforeSeconds: number
  readonly nextCheckAt: string | null
  readonly nextRetryAt: string | null
}

/** Produced by provider-specific verification, not by decoding a JWT or mapping every 401 alike. */
export interface CredentialObservation {
  readonly eventId: string
  readonly credentialId: string
  readonly version: number
  readonly providerRef: string
  readonly accountRef: string
  readonly environmentRef: string
  readonly startedAt: string
  readonly completedAt: string
  readonly kind: CredentialObservationKind
  readonly evidenceRef: string
  readonly replacedById?: string
}

export type CredentialUseDecision =
  | { readonly outcome: 'usable'; readonly reason: 'verified-current-version' }
  | { readonly outcome: 'verify-first'; readonly reason: 'unverified' | 'suspect' | 'verification-stale' }
  | { readonly outcome: 'blocked'; readonly reason: 'expired' | 'invalid' | 'revoked' | 'disabled' | 'replaced' | 'not-yet-issued' }

const TERMINAL: ReadonlySet<CredentialStatus> = new Set(['expired', 'invalid', 'revoked', 'disabled', 'replaced'])

function instant(value: string): number {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid credential timestamp')
  return milliseconds
}

function later(left: string | null, right: string): string {
  return left !== null && instant(left) > instant(right) ? left : right
}

/** Called again immediately before each effect, even when the expiration scheduler is delayed. */
export function evaluateCredentialUse(
  credential: CredentialMetadata,
  now: string,
  policy: { readonly unknownExpiryMaxVerificationAgeMs: number; readonly safetyMarginMs: number }
): CredentialUseDecision {
  if (!Number.isSafeInteger(policy.unknownExpiryMaxVerificationAgeMs) || policy.unknownExpiryMaxVerificationAgeMs < 1 ||
      !Number.isSafeInteger(policy.safetyMarginMs) || policy.safetyMarginMs < 0) throw new Error('Invalid verification policy')
  const timestamp = instant(now)
  if (credential.status === 'invalid' || credential.status === 'revoked' || credential.status === 'disabled' || credential.status === 'replaced') {
    return { outcome: 'blocked', reason: credential.status }
  }
  if (credential.status === 'expired' || (credential.expiresAt !== null && instant(credential.expiresAt) <= timestamp + policy.safetyMarginMs)) {
    return { outcome: 'blocked', reason: 'expired' }
  }
  if (credential.issuedAt !== null && instant(credential.issuedAt) > timestamp) return { outcome: 'blocked', reason: 'not-yet-issued' }
  if (credential.status === 'unverified' || credential.status === 'suspect') return { outcome: 'verify-first', reason: credential.status }
  if (credential.lastSuccessAt === null || instant(credential.lastSuccessAt) > timestamp ||
      (credential.expiryKind === 'unknown' && timestamp - instant(credential.lastSuccessAt) >= policy.unknownExpiryMaxVerificationAgeMs)) {
    return { outcome: 'verify-first', reason: 'verification-stale' }
  }
  return { outcome: 'usable', reason: 'verified-current-version' }
}

/** Repository must atomically append the event and CAS the revision, deduplicating eventId. */
export function applyCredentialObservation(
  credential: CredentialMetadata,
  event: CredentialObservation
): { readonly applied: boolean; readonly credential: CredentialMetadata } {
  if (credential.credentialId !== event.credentialId || credential.version !== event.version) {
    return { applied: false, credential }
  }
  if (credential.providerRef !== event.providerRef || credential.accountRef !== event.accountRef || credential.environmentRef !== event.environmentRef) {
    throw new Error('Credential observation target mismatch')
  }
  if (instant(event.startedAt) > instant(event.completedAt)) throw new Error('Credential observation precedes its attempt')
  if (event.kind === 'replaced' && (!event.replacedById || event.replacedById === credential.credentialId)) {
    throw new Error('Replacement requires a different credential identity')
  }
  let status = credential.status
  let unusableSince = credential.unusableSince
  let revokedAt = credential.revokedAt
  let replacedById = credential.replacedById
  // Administrative terminal states dominate delayed observations, including successful requests.
  if (!['revoked', 'disabled', 'replaced'].includes(status)) {
    if (event.kind === 'revoked') { status = 'revoked'; revokedAt = event.completedAt }
    else if (event.kind === 'disabled') status = 'disabled'
    else if (event.kind === 'replaced') { status = 'replaced'; replacedById = event.replacedById ?? null }
    else if (event.kind === 'invalid-token') status = 'invalid'
    else if (!TERMINAL.has(status) && instant(event.startedAt) >= instant(credential.statusChangedAt)) {
      if (event.kind === 'reported-not-working') status = 'suspect'
      else if (event.kind === 'authenticated') {
        status = credential.expiresAt !== null && instant(credential.expiresAt) <= instant(event.completedAt) ? 'expired' : 'active'
        if (status === 'active') unusableSince = null
      }
    }
  }
  if (TERMINAL.has(status) || status === 'suspect') unusableSince ??= event.completedAt
  const isFailure = event.kind !== 'authenticated'
  const isNewestFailure = isFailure && (credential.lastFailureAt === null || instant(event.completedAt) >= instant(credential.lastFailureAt))
  const isVerification = !['reported-not-working', 'disabled', 'replaced'].includes(event.kind)
  const next: CredentialMetadata = {
    ...credential,
    revision: credential.revision + 1,
    status,
    statusChangedAt: status === credential.status ? credential.statusChangedAt : later(credential.statusChangedAt, event.completedAt),
    unusableSince,
    revokedAt,
    replacedById,
    lastCheckedAt: isVerification ? later(credential.lastCheckedAt, event.completedAt) : credential.lastCheckedAt,
    lastSuccessAt: event.kind === 'authenticated' ? later(credential.lastSuccessAt, event.completedAt) : credential.lastSuccessAt,
    lastFailureAt: isNewestFailure ? event.completedAt : credential.lastFailureAt,
    failureCode: isNewestFailure ? event.kind : credential.failureCode,
    evidenceRef: isNewestFailure || credential.evidenceRef === null ? event.evidenceRef : credential.evidenceRef
  }
  return { applied: true, credential: next }
}
