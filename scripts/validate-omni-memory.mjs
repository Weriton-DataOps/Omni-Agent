import { casaDoOmni, lerMemoria } from '../runtime/memoria.mjs'
import { processarExperiencia } from '../runtime/pipeline-memoria.mjs'
import { sincronizarMemoriaDuravel } from '../runtime/sincronizacao-memoria-duravel.mjs'
import { montarContexto } from '../runtime/contexto.mjs'

// Explicit opt-in: these are the owner's actual enduring directions, not test
// fixtures. No credential, worker assertion, or entire chat is imported.
if (!process.argv.includes('--live')) throw new Error('Use --live somente para registrar as diretrizes autorizadas no Omni real.')
const home = casaDoOmni()
const directions = [
  'Prefiro textos curtos e direcionados à resolução da tarefa, mas quero textos longos quando forem necessários, importantes ou quando eu pedir; não quero um limite rígido de tamanho.',
  'Quero que o Omni conduza a solução: delegue a execução, confira as evidências, resolva pendências dentro do pedido autorizado e me traga somente decisões realmente indispensáveis com uma recomendação.'
]
const ids = []
const existing = await lerMemoria(home)
for (const text of directions) {
  const saved = existing.confirmed.find(item => item.text === text)
  if (saved) { ids.push(saved.id); continue }
  const result = await processarExperiencia(home, text)
  ids.push(...(result.memories || []).map(item => item.id))
}
const sync = await sincronizarMemoriaDuravel(home, { force: true })
if (sync.result !== 'synced') throw new Error(`Persistência incompleta: ${sync.failed} memória(s) pendente(s).`)
const memory = await lerMemoria(home)
const queries = ['Como devo responder ao proprietário sobre uma tarefa bloqueada? Resumo da causa e solução recomendada.', 'Como conduzir uma solução com autonomia, delegar e verificar evidências?']
const retrieval = []
for (const intent of queries) {
  const context = await montarContexto(home, { intent })
  const selected = context.projections?.[context.routing?.selected]?.selected || []
  const projection = context.projections?.[context.routing?.selected]?.text || ''
  retrieval.push({ route: context.routing?.selected, appliedIds: selected.filter(id => id.startsWith('mem-')), relevant: ids.filter(id => selected.includes(id)), directionsPresent: directions.map(text => projection.includes(text)) })
}
console.log(JSON.stringify({ home, ids, confirmed: memory.confirmed.length, candidates: memory.candidates.length, synchronization: sync, retrieval }, null, 2))
if (ids.length !== directions.length || retrieval.some(item => item.relevant.length !== directions.length || item.directionsPresent.some(present => !present))) process.exitCode = 1
