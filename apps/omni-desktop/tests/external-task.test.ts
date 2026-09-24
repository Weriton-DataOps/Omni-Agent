import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import type { query } from '@anthropic-ai/claude-agent-sdk'
import { Coordinator, validatePlan } from '../src/main/coordinator'
import { externalTaskNoticeId, externalTaskReceipt } from '../src/main/external-task-receipt'
import { Store } from '../src/main/store'
import { Controller } from '../src/main/controller'

test('Desktop despacha decisões e respostas pela porta externa na mesma conversa, sem outro executor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-external-task-'))
  try {
    const store = new Store(dir); await store.load()
    const c = store.get(await store.create(dir, 'central')); c.coordinationSessionId = 'owner-conversation'
    const commands: unknown[] = [], sessions: string[] = []
    const active = new Map<string, AbortController>()
    let action = { operation: 'prepare' }
    const model = (async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'overcore', sessionId: null, taskId: null, instruction: JSON.stringify(action), reply: 'Não usar promessa como recibo' } }
    }) as unknown as typeof query
    const coordinator = new Coordinator(store, () => {}, {
      sessions: async () => [], relay: async () => { throw new Error('Não delegar ao VS Code') }, open: async () => { throw new Error('Não abrir card') }, local: async () => { throw new Error('Não duplicar executor') },
      context: async () => 'PORTA DE TAREFAS', executable: async () => 'test.exe',
      externalTask: async (session, command, key) => {
        assert.ok(key); commands.push(command); sessions.push(session)
        return commands.length === 1
          ? { flowId: 'flow-same', status: 'decisions-required', decisions: [{ question: 'Formato?', options: [{ label: 'Em memória' }] }, { question: 'Critério?', options: [{ label: 'JSON legível' }] }] }
          : { flowId: 'flow-same', status: 'succeeded', taskId: 'task-one', result: { resultId: 'result-one', summary: 'Dois contratos conferidos.', evidence: [{ id: 'ev-one' }] } }
      }
    }, model, active)
    async function finish() {
      const until = Date.now() + 5000
      while (active.size && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(active.size, 0)
      assert.equal(c.coordinationTurns?.at(-1)?.state, 'done')
    }
    await coordinator.enqueue(c, 'Mande o Overcore conferir os contratos.', 'text'); await finish()
    assert.match(c.messages.at(-1)!.text, /Formato\?/); assert.match(c.messages.at(-1)!.text, /Critério\?/)
    action = { operation: 'answer' }
    await coordinator.enqueue(c, 'Em memória; conferir JSON legível.', 'text'); await finish()
    assert.deepEqual(sessions, ['owner-conversation', 'owner-conversation'])
    assert.match(c.messages.at(-1)!.text, /Dois contratos conferidos/)
    assert.deepEqual(c.externalResultNotices, ['external-return:flow-same:result-one'])
    assert.equal(commands.length, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('recibo distingue admissão e conclusão; identidade de retorno permite deduplicação durável', () => {
  assert.match(externalTaskReceipt({ status: 'running', taskId: 'task-one' }), /entrou em execução/)
  assert.equal(externalTaskNoticeId({ status: 'running' }), null)
  assert.equal(externalTaskNoticeId({ status: 'succeeded', flowId: 'flow-one', result: { resultId: 'result-one' } }), 'external-return:flow-one:result-one')
  assert.throws(() => validatePlan({ reply: '', action: 'overcore', sessionId: 'foreign-session', taskId: null, instruction: '{}' }))
  const report = '# Mapa\n\n|Contrato|Função|\n|---|---|\n|task-request|Pedido|\n\nAnálise entregue pela porta.'
  assert.ok(externalTaskReceipt({status:'succeeded', taskId:'task-one', result:{summary:'Inspeção concluída.',report:{content:report}}}).includes(report))
})

test('retorno em segundo plano entra somente na conversa de origem e não repete depois do reinício', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-external-return-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir, 'central')); origin.coordinationSessionId = 'session-origin'
    const other = store.get(await store.create(dir, 'central')); other.coordinationSessionId = 'session-other'
    const dependencies = {
      loadModule: async () => ({ observarFluxosOvercore: async (_home: string, session: string) => session === 'session-origin' ? [{ flowId: 'flow-origin', status: 'succeeded', taskId: 'task-one', result: { resultId: 'result-one', summary: 'Resultado verificado.' } }] : [] }),
      getBroker: async () => { throw new Error('Não consultar broker neste teste') }, executable: async () => 'test.exe'
    }
    const controller = new Controller(store, () => {}, undefined, dependencies)
    await controller['refreshExternalTasks']()
    assert.equal(origin.messages.filter(m => m.text.includes('Resultado verificado')).length, 1)
    assert.equal(other.messages.length, 0)
    const reloaded = new Store(dir); await reloaded.load()
    await new Controller(reloaded, () => {}, undefined, dependencies)['refreshExternalTasks']()
    assert.equal(reloaded.get(origin.id).messages.filter(m => m.text.includes('Resultado verificado')).length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
