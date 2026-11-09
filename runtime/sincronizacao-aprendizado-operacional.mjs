import { createHash } from 'node:crypto'

import { comBancoDaCasa } from './casa/banco.mjs'
import { gravarAchados } from './casa/loja-operacao.mjs'
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
 * O ciclo local (runs/operational-cycle.json) é o cache de trabalho. O omni.db recebe só o livro
 * sanitizado (ids e impressões), necessário para auditar aprendizado e releases.
 */
export async function sincronizarAprendizadoOperacional(casa) {
  const cycle = await lerCicloOperacional(casa)
  const candidates = [...(cycle.improvementCandidates ?? [])]
    .filter((candidate) => candidate?.lifecycleVersion === 2)
    .sort((left, right) => left.id.localeCompare(right.id))
  if (candidates.length === 0) return { result: 'empty', findings: 0 }
  const achados = candidates.map(criarAchadoOperacionalSanitizado)
  const contagem = comBancoDaCasa(casa, 'omni', (db) => gravarAchados(db, achados))
  return { result: 'synced', findings: achados.length, ...contagem }
}
