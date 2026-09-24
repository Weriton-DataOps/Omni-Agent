import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { proporMelhoriaOperacional } from './ciclo-operacional.mjs'

const hash = value => createHash('sha256').update(String(value)).digest('hex')
const catalog = {
  'technical-owner-turn': ['routing', 'Separar notificacoes tecnicas de pedidos do proprietario ao correlacionar retornos do Desktop.'],
  'attachment-not-forwarded': ['runtime-fix', 'Preservar referencias e conteudo integral dos anexos no encaminhamento do Desktop ao executor vinculado.'],
  'dispatch-failed': ['runtime-fix', 'Diagnosticar falhas de encaminhamento do Desktop com evidencia correlacionada antes de repetir efeitos.'],
  'return-review-failed': ['runtime-fix', 'Recuperar falhas de avaliacao do retorno preservando pedido, evidencia e destino, sem inventar conclusao.']
}

/** Projection contains fixed portable statements and hashes, never chat, paths or attachments. */
export function achadosDesktop(conversations) {
  const findings = new Map()
  const add = (code, identity) => {
    const eventFingerprint = hash(identity)
    const [destination, statement] = catalog[code]
    findings.set(`${code}:${eventFingerprint}`, { category: 'desktop-audit', destination, statement,
      sourceRef: { kind: 'desktop-audit', eventFingerprint, reasonCode: code, canonicalCaseId: `desktop-${code}` } })
  }
  for (const c of conversations || []) {
    if (/^<task-(notification|started|progress)\b/.test(c.editorReturn?.objective || '')) add('technical-owner-turn', `${c.id}:${c.editorReturn.id}`)
    for (const turn of c.coordinationTurns || []) {
      if (turn.state === 'failed') add('dispatch-failed', `${c.id}:${turn.id}`)
      const request = conversations.flatMap(target => target.editorRequests || []).find(r => r.id === turn.id)
      if (turn.attachments?.length && request && !request.attachments?.length) add('attachment-not-forwarded', `${c.id}:${turn.id}`)
    }
    for (const request of c.editorRequests || []) if (request.summaryError) add(request.report ? 'return-review-failed' : 'dispatch-failed', `${c.id}:${request.id}:${request.evidenceId || 'no-receipt'}`)
  }
  return [...findings.values()]
}

export async function auditarDesktop(casa) {
  let data
  try { data = JSON.parse(await readFile(join(casa, 'desktop', 'conversations.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { findings: 0, recorded: 0 }; throw error }
  if (data.version !== 1 || !Array.isArray(data.conversations)) throw new Error('Estado do Desktop invalido; auditoria nao alterou o historico.')
  const findings = achadosDesktop(data.conversations)
  let recorded = 0
  for (const input of findings) {
    const result = await proporMelhoriaOperacional(casa, input)
    if (result.result !== 'duplicate-evidence') recorded++
  }
  return { findings: findings.length, recorded }
}
