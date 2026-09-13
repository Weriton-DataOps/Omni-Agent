import { createHash } from 'node:crypto'

import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'
import { lerCicloOperacional } from './ciclo-operacional.mjs'

function hash(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }

export function criarAchadoOperacionalSanitizado(candidate) {
  const artifactFingerprint = candidate.artifactRef?.semanticFingerprint ??
    (typeof candidate.artifact === 'string' && candidate.artifact ? hash(candidate.artifact) : null)
  const releaseVersion = candidate.loadedReadback?.version ?? candidate.installedReadback?.version ?? null
  const eventSeed = [candidate.id, candidate.updatedAt, candidate.status, candidate.occurrences, artifactFingerprint ?? 'none', releaseVersion ?? 'none'].join(':')
  return {
    eventId: `learning-event-${hash(eventSeed).slice(0, 32)}`,
    findingId: candidate.id,
    candidateFingerprint: candidate.fingerprint,
    category: candidate.category,
    destination: candidate.destination,
    state: candidate.status,
    occurrences: candidate.occurrences,
    statementFingerprint: hash(candidate.statement),
    sourceFingerprint: hash(JSON.stringify(candidate.sourceRefs ?? [])),
    artifactFingerprint,
    releaseVersion,
    observedAt: candidate.updatedAt
  }
}

/**
 * The operational-cycle JSON remains a local working cache. PostgreSQL receives
 * only the durable, sanitized ledger required to audit learning and releases.
 */
export async function sincronizarAprendizadoOperacional(casa) {
  const cycle = await lerCicloOperacional(casa)
  const candidates = [...(cycle.improvementCandidates ?? [])]
    .filter((candidate) => candidate?.lifecycleVersion === 2)
    .sort((left, right) => left.id.localeCompare(right.id))
  if (candidates.length === 0) return { result: 'empty', findings: 0 }
  const broker = new NodeAccessBrokerClient()
  let findings = 0
  for (const candidate of candidates) {
    await broker.recordOperationalLearningFinding(criarAchadoOperacionalSanitizado(candidate))
    findings += 1
  }
  return { result: 'synced', findings }
}
