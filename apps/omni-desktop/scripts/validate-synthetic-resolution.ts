import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Coordinator } from '../src/main/coordinator'
import { Store } from '../src/main/store'
import { claudeExecutable } from '../src/main/runtime'

// Only fabricated scenarios. No transcript, real memory, project file, broker,
// tool, or executor is made available to the model in this test.
const dir = await mkdtemp(join(tmpdir(), 'omni-synthetic-eval-'))
try {
  const store = new Store(dir); await store.load()
  const card = store.get(await store.create(dir))
  const forbidden = async () => { throw new Error('Execução de projeto proibida neste ensaio') }
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [], relay: forbidden, local: forbidden, open: forbidden, executable: claudeExecutable, context: async () => 'Cenário totalmente fictício de avaliação. Prefira textos curtos e resolução; detalhe quando necessário ou pedido. O proprietário quer delegação e acompanhamento sem devolver trabalho operacional.' })
  const abort = new AbortController(); const deadline = setTimeout(() => abort.abort(), 90000)
  try {
    const summary = await coordinator.summarize(card, 'Corrija a configuração do formulário fictício e valide localmente; sem publicação.', 'Cenário fictício: o valor default apontava para um campo removido. Corrigido localmente, com 12 testes passando. Nenhuma publicação solicitada ou executada. Não há pendência do proprietário.', 'completed', abort)
    assert.ok(summary.length < 1400, 'Resumo simples se expandiu sem necessidade')
    assert.doesNotMatch(summary, /(?:quer|posso|autoriza).{0,35}(?:deploy|publicar)/i)
    assert.doesNotMatch(summary, /Se quiser|posso pedir o commit|não os menciona/i)
    console.log(JSON.stringify({ syntheticSummary: summary, characters: summary.length }))
    const recovery = await coordinator.reviewReturn(card, { objective: 'Corrija e teste o formulário fictício.', executionBrief: 'Pode ler e corrigir arquivos do projeto fictício e executar testes locais; sem publicação.', state: 'reviewing', retries: 0 }, 'Cenário fictício: achei um erro de importação. Ainda não li o arquivo que falhou. O proprietário precisa olhar esse arquivo e me dizer o que fazer.', 'failed', abort)
    assert.equal(recovery.action, 'retry'); assert.equal(recovery.needsOwner, false)
    console.log(JSON.stringify({ syntheticRecovery: recovery.action, needsOwner: recovery.needsOwner, message: recovery.message }))
  } finally { clearTimeout(deadline); coordinator.stop() }
} finally { await rm(dir, { recursive: true, maxRetries: 5 }) }
