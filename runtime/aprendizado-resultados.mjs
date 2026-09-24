import { createHash } from 'node:crypto'
import { pareceConterSegredo, registrarAprendizado } from './memoria.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const compact = text => String(text || '').replace(/\s+/g, ' ').trim()
// An untrusted report may describe work; it cannot establish a standing permission.
const authority = /ignore.{0,30}(?:regra|instru|prote)|(?:dispens|contorn|desativ|burl).{0,40}(?:permiss|autoriz|seguran)|(?:sempre|automaticamente).{0,30}(?:autorizad|permitid)|sem.{0,15}(?:pedir|precisar).{0,15}autoriza/i

export async function aprenderResultado(casa, input) {
  const { requestId, workspace, report, review, evidence, at } = input || {}
  if (!requestId || !workspace || !report || !['complete', 'decision'].includes(review?.action)) return { result: 'ineligible', memoryIds: [] }
  if (review.action === 'decision' && !evidence?.calls?.some(call => ['denied', 'failed'].includes(call.outcome))) return { result: 'ineligible', memoryIds: [] }
  const date = Number.isFinite(Date.parse(at)) ? new Date(at) : new Date()
  const scope = { type: 'project', id: workspace }
  const reference = hash([requestId, report, review.action])
  const calls = new Set((evidence?.calls || []).map(call => call.id))
  const selections = (Array.isArray(review.learnings) ? review.learnings : []).slice(0, 3)
    .filter(item => item && typeof item.quote === 'string' && item.quote.trim().length >= 25 && item.quote.length <= 700 && report.includes(item.quote)
      && Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && item.evidenceIds.every(id => calls.has(id)))
    .map(item => compact(item.quote))
  // Historical and older-model reviews still generate an attributed episode.
  // Do not copy the entire conversation or pretend a tool return verifies a claim.
  if (!selections.length && review.action === 'complete') selections.push(compact(review.message).slice(0, 700))
  if (review.action === 'decision') selections.push('A execução encontrou negativa de acesso ou falha da aplicação. Antes de repetir, conferir identidade, permissão e código de saída da operação; retorno da ferramenta não prova sucesso. Não contornar a negativa.')
  const memoryIds = []
  for (const selection of [...new Set(selections)]) {
    if (selection.length < 25 || pareceConterSegredo(selection) || authority.test(selection)) continue
    const text = `Projeto ${workspace.split(/[\\/]/).filter(Boolean).at(-1)} — ${date.toISOString().slice(0, 10)}. Relato avaliado pelo Omni (não verificação independente; revalidar estado atual): ${selection}`
    const result = await registrarAprendizado(casa, { text, type: 'episodic', scope, reference,
      reasons: ['reviewed-executor-report', `request:${requestId}`, `evidence-count:${calls.size}`],
      expiresAt: new Date(date.getTime() + 90 * 86400000).toISOString() })
    if (result.memory) memoryIds.push(result.memory.id)
  }
  return { result: memoryIds.length ? 'learned' : 'refused', memoryIds }
}

export async function aprenderMelhoria(casa, candidate) {
  if (!['personality', 'procedure', 'eval'].includes(candidate?.destination)
    || !['ready', 'materialized-pending-release', 'installed-verified', 'loaded-verified'].includes(candidate.status)
    || !(candidate.occurrences >= 2) || (candidate.artifactRef && candidate.artifactRef.kind !== 'portable-entry')) return null
  const statement = compact(candidate.statement)
  if (statement.length < 25 || statement.length > 900 || authority.test(statement) || pareceConterSegredo(statement)) return null
  const result = await registrarAprendizado(casa, {
    text: `Lição operacional observada: ${statement} Aplicar conforme a tarefa e as preferências atuais do proprietário; não amplia autorização.`,
    type: 'procedural', scope: { type: 'user' }, reference: hash([candidate.id, candidate.fingerprint]),
    reasons: ['repeated-operational-observation', `candidate:${candidate.id}`, `occurrences:${candidate.occurrences}`]
  })
  return result.memory ? { memoryId: result.memory.id, candidateFingerprint: candidate.fingerprint } : null
}
