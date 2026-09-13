import assert from 'node:assert/strict'
import test from 'node:test'

import { criarAchadoOperacionalSanitizado } from '../runtime/sincronizacao-aprendizado-operacional.mjs'

test('o ledger operacional envia somente identificadores controlados e fingerprints', () => {
  const finding = criarAchadoOperacionalSanitizado({
    id: 'improvement-12345678-1234-1234-1234-123456789abc',
    fingerprint: 'a'.repeat(64),
    category: 'owner-correction',
    destination: 'routing',
    status: 'loaded-verified',
    occurrences: 2,
    statement: 'Nunca registrar esta frase literal nem o segredo que ela poderia conter.',
    sourceRefs: [{ kind: 'personality-eval', evalRoundFingerprint: 'b'.repeat(64) }],
    artifact: 'runtime/ciclo-operacional.mjs',
    artifactRef: { semanticFingerprint: 'c'.repeat(64) },
    loadedReadback: { version: '0.23.1' },
    updatedAt: '2026-09-13T12:00:00.000Z'
  })
  assert.deepEqual(Object.keys(finding).sort(), ['artifactFingerprint', 'candidateFingerprint', 'category', 'destination', 'eventId', 'findingId', 'observedAt', 'occurrences', 'releaseVersion', 'sourceFingerprint', 'state', 'statementFingerprint'])
  assert.equal(finding.statement, undefined)
  assert.equal(finding.artifact, undefined)
  assert.equal(finding.statementFingerprint.length, 64)
  assert.equal(finding.sourceFingerprint.length, 64)
  assert.equal(finding.artifactFingerprint, 'c'.repeat(64))
  assert.equal(finding.releaseVersion, '0.23.1')
})
