import { CREDENTIAL_OBSERVATIONS, CREDENTIAL_STATUSES } from '../core/access/credential.js'
import type { CredentialMetadata } from '../core/access/credential.js'
import { closedRecord, integer, matchingString, oneOf } from './validation.js'

const KEYS = ['credentialId', 'version', 'revision', 'providerRef', 'accountRef', 'environmentRef', 'secretRef', 'issuedAt', 'expiryKind', 'expirySource', 'expiresAt', 'status', 'statusChangedAt', 'lastCheckedAt', 'lastSuccessAt', 'unusableSince', 'lastFailureAt', 'failureCode', 'evidenceRef', 'revokedAt', 'replacedById', 'renewalMode', 'renewBeforeSeconds', 'nextCheckAt', 'nextRetryAt'] as const
const REF = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

function nullableRef(value: unknown, path: string): string | null {
  return value === null ? null : matchingString(value, path, REF)
}

function timestamp(value: unknown, path: string): string {
  const result = matchingString(value, path, UTC)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error(`${path}: invalid UTC timestamp`)
  return result
}

function nullableTime(value: unknown, path: string): string | null {
  return value === null ? null : timestamp(value, path)
}

export function parseCredentialMetadata(value: unknown): CredentialMetadata {
  const r = closedRecord(value, 'credential', KEYS)
  const parsed: CredentialMetadata = {
    credentialId: matchingString(r.credentialId, 'credentialId', REF),
    version: integer(r.version, 'version', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    revision: integer(r.revision, 'revision', { min: 1, max: Number.MAX_SAFE_INTEGER }),
    providerRef: matchingString(r.providerRef, 'providerRef', REF),
    accountRef: matchingString(r.accountRef, 'accountRef', REF),
    environmentRef: matchingString(r.environmentRef, 'environmentRef', REF),
    secretRef: matchingString(r.secretRef, 'secretRef', /^credential-ref:[a-zA-Z0-9._:-]{1,140}$/u),
    issuedAt: nullableTime(r.issuedAt, 'issuedAt'),
    expiryKind: oneOf(r.expiryKind, 'expiryKind', ['known', 'non_expiring', 'unknown']),
    expirySource: oneOf(r.expirySource, 'expirySource', ['provider', 'owner-attestation', 'unknown']),
    expiresAt: nullableTime(r.expiresAt, 'expiresAt'),
    status: oneOf(r.status, 'status', CREDENTIAL_STATUSES),
    statusChangedAt: timestamp(r.statusChangedAt, 'statusChangedAt'),
    lastCheckedAt: nullableTime(r.lastCheckedAt, 'lastCheckedAt'),
    lastSuccessAt: nullableTime(r.lastSuccessAt, 'lastSuccessAt'),
    unusableSince: nullableTime(r.unusableSince, 'unusableSince'),
    lastFailureAt: nullableTime(r.lastFailureAt, 'lastFailureAt'),
    failureCode: r.failureCode === null ? null : oneOf(r.failureCode, 'failureCode', CREDENTIAL_OBSERVATIONS.filter(kind => kind !== 'authenticated')),
    evidenceRef: nullableRef(r.evidenceRef, 'evidenceRef'),
    revokedAt: nullableTime(r.revokedAt, 'revokedAt'),
    replacedById: nullableRef(r.replacedById, 'replacedById'),
    renewalMode: oneOf(r.renewalMode, 'renewalMode', ['none', 'refresh', 'rotate', 'reauthenticate']),
    renewBeforeSeconds: integer(r.renewBeforeSeconds, 'renewBeforeSeconds', { min: 0, max: 31_536_000 }),
    nextCheckAt: nullableTime(r.nextCheckAt, 'nextCheckAt'),
    nextRetryAt: nullableTime(r.nextRetryAt, 'nextRetryAt')
  }
  if ((parsed.expiryKind === 'known') !== (parsed.expiresAt !== null)) throw new Error('expiryKind and expiresAt disagree')
  if (parsed.expiryKind !== 'unknown' && parsed.expirySource === 'unknown') throw new Error('Explicit expiry requires provenance')
  if (parsed.issuedAt !== null && parsed.expiresAt !== null && parsed.issuedAt >= parsed.expiresAt) throw new Error('Expiration must follow issuance')
  if (parsed.status === 'active' && parsed.lastSuccessAt === null) throw new Error('Active credential requires verification')
  if (parsed.status === 'revoked' && parsed.revokedAt === null) throw new Error('Revocation requires a timestamp')
  if (parsed.status === 'replaced' && (parsed.replacedById === null || parsed.replacedById === parsed.credentialId)) throw new Error('Replacement requires a new identity')
  return parsed
}
