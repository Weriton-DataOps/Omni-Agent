import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCredentialObservation, evaluateCredentialUse } from '../src/core/access/credential.js'
import type { CredentialMetadata, CredentialObservation, CredentialObservationKind } from '../src/core/access/credential.js'
import { parseCredentialMetadata } from '../src/contracts/credential-metadata.js'

const at = (hour: number): string => `2026-09-08T${String(hour).padStart(2, '0')}:00:00.000Z`
const policy = { unknownExpiryMaxVerificationAgeMs: 3_600_000, safetyMarginMs: 30_000 }
function credential(patch: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return parseCredentialMetadata({ credentialId: 'test-credential', version: 1, revision: 1, providerRef: 'test-provider', accountRef: 'test-account', environmentRef: 'test', secretRef: 'credential-ref:synthetic', issuedAt: at(9), expiryKind: 'known', expirySource: 'provider', expiresAt: at(14), status: 'active', statusChangedAt: at(10), lastCheckedAt: at(10), lastSuccessAt: at(10), unusableSince: null, lastFailureAt: null, failureCode: null, evidenceRef: 'evidence:synthetic', revokedAt: null, replacedById: null, renewalMode: 'refresh', renewBeforeSeconds: 60, nextCheckAt: null, nextRetryAt: null, ...patch })
}
function observation(kind: CredentialObservationKind, patch: Partial<CredentialObservation> = {}): CredentialObservation {
  return { eventId: 'event:test', credentialId: 'test-credential', version: 1, providerRef: 'test-provider', accountRef: 'test-account', environmentRef: 'test', startedAt: at(11), completedAt: at(11), kind, evidenceRef: 'evidence:event', ...patch }
}

test('Crachá valida metadados fechados, validade explícita e referências sem payload de segredo', () => {
  assert.equal(credential().expiryKind, 'known')
  for (const patch of [{ token: 'synthetic' }, { expiresAt: null }, { expiryKind: 'unknown' }, { expiryKind: 'non_expiring', expiresAt: null, expirySource: 'unknown' }, { secretRef: 'password=synthetic' }, { issuedAt: at(15) }, { status: 'active', lastSuccessAt: null }, { expiresAt: '2026-02-30T14:00:00.000Z' }]) {
    assert.throws(() => parseCredentialMetadata({ ...credential(), ...patch }))
  }
  assert.equal(credential({ expiryKind: 'unknown', expiresAt: null, expirySource: 'unknown' }).expiryKind, 'unknown')
})

test('vencimento bloqueia no uso mesmo sem scheduler; validade desconhecida exige verificação recente', () => {
  assert.equal(evaluateCredentialUse(credential(), at(13), policy).outcome, 'usable')
  assert.deepEqual(evaluateCredentialUse(credential(), at(14), policy), { outcome: 'blocked', reason: 'expired' })
  assert.equal(evaluateCredentialUse(credential(), '2026-09-08T13:59:40.000Z', policy).outcome, 'blocked')
  assert.deepEqual(evaluateCredentialUse(credential(), at(8), policy), { outcome: 'blocked', reason: 'not-yet-issued' })
  const unknown = credential({ expiryKind: 'unknown', expiresAt: null, expirySource: 'unknown' })
  assert.equal(evaluateCredentialUse(unknown, '2026-09-08T10:30:00.000Z', policy).outcome, 'usable')
  assert.equal(evaluateCredentialUse(unknown, at(11), policy).outcome, 'verify-first')
})

test('rejeição confirmada bloqueia só a versão/alvo observado e não inventa revogação', () => {
  const rejected = applyCredentialObservation(credential(), observation('invalid-token')).credential
  assert.equal(rejected.status, 'invalid')
  assert.equal(rejected.revokedAt, null)
  assert.equal(rejected.unusableSince, at(11))
  assert.equal(rejected.failureCode, 'invalid-token')
  assert.equal(evaluateCredentialUse(rejected, at(12), policy).outcome, 'blocked')
  assert.deepEqual(applyCredentialObservation(credential({ version: 2 }), observation('invalid-token')), { applied: false, credential: credential({ version: 2 }) })
  assert.throws(() => applyCredentialObservation(credential(), observation('invalid-token', { environmentRef: 'production' })), /target mismatch/)
})

test('timeout, indisponibilidade, rate limit e falta de escopo não invalidam o segredo', () => {
  for (const kind of ['timeout', 'unavailable', 'rate-limited', 'insufficient-scope'] as const) {
    const next = applyCredentialObservation(credential(), observation(kind)).credential
    assert.equal(next.status, 'active', kind)
    assert.equal(next.lastSuccessAt, at(10))
    assert.equal(next.lastFailureAt, at(11))
    assert.equal(next.failureCode, kind)
    assert.equal(next.revision, 2)
  }
})

test('sucesso tardio não reativa credencial inválida, revogada, desabilitada ou substituída', () => {
  for (const kind of ['invalid-token', 'revoked', 'disabled', 'replaced'] as const) {
    const stopped = applyCredentialObservation(credential(), observation(kind, { replacedById: 'replacement' })).credential
    const late = applyCredentialObservation(stopped, observation('authenticated', { startedAt: at(10), completedAt: at(12) })).credential
    assert.equal(late.status, stopped.status)
    assert.equal(evaluateCredentialUse(late, at(13), policy).outcome, 'blocked')
    assert.equal(late.failureCode, kind)
  }
})

test('relato não verificado vira suspeita; somente nova verificação posterior resolve a suspeita', () => {
  const suspect = applyCredentialObservation(credential(), observation('reported-not-working')).credential
  assert.equal(suspect.status, 'suspect')
  assert.equal(suspect.lastCheckedAt, at(10))
  const delayed = applyCredentialObservation(suspect, observation('authenticated', { startedAt: at(10), completedAt: at(12) })).credential
  assert.equal(delayed.status, 'suspect')
  const current = applyCredentialObservation(delayed, observation('authenticated', { startedAt: at(13), completedAt: at(13) })).credential
  assert.equal(current.status, 'active')
  assert.equal(current.unusableSince, null)
  assert.equal(current.failureCode, 'reported-not-working', 'o histórico de falha não é apagado por sucesso')
  assert.throws(() => applyCredentialObservation(current, observation('timeout', { completedAt: at(9) })), /precedes/)
})
