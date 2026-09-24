import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { casaDoOmni, lerMemoria } from '../runtime/memoria.mjs'
import { ativarAprendizadosOperacionais, lerAutomacaoMelhorias, sincronizarAutomacaoMelhorias } from '../runtime/automacao-melhorias.mjs'
import { aprenderResultado } from '../runtime/aprendizado-resultados.mjs'
import { processarExperiencia } from '../runtime/pipeline-memoria.mjs'
import { sincronizarMemoriaDuravel } from '../runtime/sincronizacao-memoria-duravel.mjs'
import { montarContexto } from '../runtime/contexto.mjs'

if (!process.argv.includes('--live')) throw new Error('Requer --live para ativar os aprendizados autorizados no Omni real.')
const casa = casaDoOmni()
const backup = join(casa, 'backups', `learning-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(backup, { recursive: true })
for (const [file, source] of [['memory.json', 'memory'], ['operational-improvement-automation.json', 'runs']]) {
  try { await copyFile(join(casa, source, file), join(backup, file)) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
const before = await lerAutomacaoMelhorias(casa)
const oldPending = before.jobs.filter(job => job.state === 'awaiting-release').map(job => job.id)
await processarExperiencia(casa, 'Quero que o Omni grave e use aprendizados úteis com origem e evidência, sem esperar nova autorização para registrar memória; alterações de código continuam exigindo teste e verificação.')
const activated = await ativarAprendizadosOperacionais(casa)
await sincronizarAutomacaoMelhorias(casa)
const sessionId = process.argv.find(arg => arg.startsWith('--session='))?.slice('--session='.length)
const episodes = []
let workspace
if (sessionId) {
  const data = JSON.parse(await readFile(join(casa, 'desktop', 'conversations.json'), 'utf8'))
  const c = data.conversations.find(item => item.sessionId === sessionId)
  if (!c) throw new Error('Sessão solicitada não encontrada; nenhum histórico foi alterado.')
  workspace = c.workspace
  // Same runtime path used by the Desktop; read-only replay, no model call or resend.
  for (const r of (c.editorRequests || []).filter(r => ['completed', 'blocked'].includes(r.status) && r.supervision?.review && r.report).slice(-6)) {
    const result = await aprenderResultado(casa, { requestId: r.id, workspace, report: r.report, review: r.supervision.review,
      evidence: r.supervision.executionEvidence, at: r.lastObservedAt || r.at })
    episodes.push(...result.memoryIds)
  }
}
const sync = await sincronizarMemoriaDuravel(casa)
const memory = await lerMemoria(casa)
const jobs = (await lerAutomacaoMelhorias(casa)).jobs
const intent = workspace ? 'Como publicar GA4 no Hub, workflow, recusa de acesso, conferir deployment e evitar repetir tentativas?' : 'Conduzir solução com autonomia, conferir evidência e corrigir sem repetir tentativas.'
const context = await montarContexto(casa, { intent, projectId: workspace })
const selected = context.projections[context.routing.selected].selected.filter(id => id.startsWith('mem-'))
console.log(JSON.stringify({ backup, activatedMemoryIds: activated.memoryIds, episodeMemoryIds: episodes,
  priorPending: oldPending.map(id => { const job = jobs.find(job => job.id === id); return { id, state: job.state, memoryId: job.learningReceipt?.memoryId } }),
  confirmed: memory.confirmed.length, synchronization: sync,
  retrieval: { route: context.routing.selected, appliedIds: selected, appliedLearnings: selected.filter(id => activated.memoryIds.includes(id) || episodes.includes(id)) }
}, null, 2))
if (sync.result !== 'synced' || oldPending.some(id => jobs.find(job => job.id === id)?.state === 'awaiting-release')) process.exitCode = 1
