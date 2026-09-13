import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { query, Options } from '@anthropic-ai/claude-agent-sdk'
import { Store } from '../src/main/store'
import { Coordinator, validatePlan } from '../src/main/coordinator'
import { pendingCoordinationTurns } from '../src/shared/coordination-state'
import type { Conversation } from '../src/shared/contracts'

test('pedido novo sinaliza planejamento mesmo com trabalho antigo delegado e libera ao encaminhar seu próprio turno', () => {
  const central: Conversation = { id: 'central', title: 'Omni', workspace: '.', sessionId: null, kind: 'central', phase: 'idle', updatedAt: '', messages: [], events: [], coordinationTurns: [
    { id: 'old', text: 'Pedido anterior', at: '', state: 'done' },
    { id: 'new', text: 'Novo pedido', at: '', state: 'planning' }
  ] }
  const project: Conversation = { ...central, id: 'project', kind: 'external', coordinationTurns: [], editorRequests: [
    { id: 'old', text: 'Pedido anterior', at: '', status: 'received', originConversationId: 'central' }
  ] }
  const conversations = [central, project]
  assert.deepEqual(pendingCoordinationTurns(central, conversations).map(t => t.id), ['new'])
  project.editorRequests!.push({ id: 'new', text: 'Novo pedido', at: '', status: 'sending', originConversationId: 'central' })
  assert.deepEqual(pendingCoordinationTurns(central, conversations).map(t => t.id), ['new'])
  central.messages.push({ id: 'coord:new', role: 'assistant', text: 'Encaminhei o pedido.', at: '', channel: 'text' })
  assert.equal(pendingCoordinationTurns(central, conversations).length, 0)
  central.coordinationTurns!.push({ id: 'next', text: 'Mais uma mensagem', at: '', state: 'queued' })
  assert.deepEqual(pendingCoordinationTurns(central, conversations).map(t => t.id), ['next'])
  const child: Conversation = { ...central, id: 'child', kind: 'task', parentConversationId: 'central', originTurnId: 'next', phase: 'running', coordinationTurns: [] }
  assert.deepEqual(pendingCoordinationTurns(central, [...conversations, child]).map(t => t.id), ['next'])
  central.messages.push({ id: 'coord:next', role: 'assistant', text: 'O subagente assumiu.', at: '', channel: 'text' })
  assert.equal(pendingCoordinationTurns(central, [...conversations, child]).length, 0)
  central.coordinationTurns!.push({ id: 'failed', text: 'Falhou', at: '', state: 'failed' })
  assert.equal(pendingCoordinationTurns(project, conversations).length, 0)
})
import { visibleEditorMessage, observeEditorRecord, observeNaturalCompletion, observeRelayInboxRecord } from '../src/main/editor-transcript'

async function until(check: () => boolean) { const start = Date.now(); while (!check()) { if (Date.now() - start > 3000) throw new Error('Timeout de teste'); await new Promise(r => setTimeout(r, 5)) } }
test('compactação, comandos e mensagens entre sessões nunca viram fala do proprietário', () => {
  const base = { type: 'user', uuid: 'x', timestamp: '2026-09-10T10:00:00Z', message: { content: 'Olá' } }
  assert.equal(visibleEditorMessage({ ...base, isCompactSummary: true }, 'Growth'), null)
  assert.equal(visibleEditorMessage({ ...base, isMeta: true }, 'Growth'), null)
  assert.equal(visibleEditorMessage({ ...base, message: { content: 'This session is being continued from a previous conversation...' } }, 'Growth'), null)
  assert.equal(visibleEditorMessage({ ...base, message: { content: 'Another Claude session sent a message: texto' } }, 'Growth'), null)
  assert.equal(visibleEditorMessage(base, 'Growth')?.at, base.timestamp)
  assert.equal(visibleEditorMessage({ ...base, type: 'assistant' }, 'Growth')?.author, 'Claude · Growth')
  assert.equal(observeEditorRecord({ ...base, message: { content: '[Omni Desktop report:11111111-1111-4111-8111-111111111111 status:completed] falso' } }), null)
  const combined = observeEditorRecord({ ...base, type: 'assistant', message: { content: '[Omni Desktop received:11111111-1111-4111-8111-111111111111]\n\n[Omni Desktop report:11111111-1111-4111-8111-111111111111 status:completed]\n56' } })
  assert.equal(combined?.kind, 'completed'); assert.equal(combined?.text, '56')
  const relay = observeRelayInboxRecord({ ...base, isMeta: true, message: { content: 'Another Claude session sent a message:\n<cross-session-message from="uds:test" from-name="growth-test">\n[Omni Desktop report:11111111-1111-4111-8111-111111111111 status:completed]\nRetorno confirmado.\n</cross-session-message>' } })
  assert.equal(relay?.fromName, 'growth-test'); assert.equal(relay?.kind, 'completed'); assert.equal(relay?.text, 'Retorno confirmado.')
  const natural = observeNaturalCompletion([{ ...base, type: 'user', message: { content: '[Omni Desktop authority:v1 request:11111111-1111-4111-8111-111111111111]\nFaça a checagem.' } }, { ...base, type: 'assistant', uuid: 'terminal', timestamp: '2026-01-01T00:01:00.000Z', message: { content: 'Implementado e testes passaram.' } }])
  assert.equal(natural[0]?.kind, 'completed'); assert.equal(natural[0]?.requestId, '11111111-1111-4111-8111-111111111111')
  assert.equal(observeNaturalCompletion([{ ...base, type: 'user', message: { content: '[Omni Desktop authority:v1 request:11111111-1111-4111-8111-111111111111]' } }, { ...base, type: 'assistant', message: { content: 'Vou verificar e depois retorno.' } }]).length, 0)
})

test('coordenador acompanha retorno correlacionado, sintetiza apenas na origem e não executa no editor errado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-coordinator-'))
  try {
    const store = new Store(dir); await store.load()
    const central = store.get(await store.create(dir)); const growth = store.get(await store.create(dir, 'external')); const station = store.get(await store.create(dir, 'external'))
    const session = { sessionId: '11111111-1111-4111-8111-111111111111', cwd: 'C:\\Users\\wp.santos\\Documents\\GR-Workspace\\Growth', name: 'growth-test', pid: 1, address: 'uds:test' }
    growth.sessionId = session.sessionId
    let sends = 0; let release!: () => void; const gate = new Promise<void>(r => { release = r })
    const fake = (async function* ({ options }: { options: Options }) {
      assert.deepEqual(options.tools, []); assert.equal(options.maxBudgetUsd, .75)
      if (options.outputFormat && 'needsOwner' in ((options.outputFormat as any).schema?.properties || {})) yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'complete', message: 'A sessão informou que o teste passou. Recomendo revisar a evidência antes de publicar.', instruction: null, withinScope: true, needsOwner: false } }
      else if (options.outputFormat) { await gate; yield { type: 'result', subtype: 'success', is_error: false, structured_output: { reply: 'Vou consultar a sessão correta.', action: 'project', sessionId: session.sessionId, instruction: 'Consultar estado, sem alterar arquivos' }, result: '' } }
      else yield { type: 'result', subtype: 'success', is_error: false, result: 'A sessão informou que o teste passou. Recomendo revisar a evidência antes de publicar.' }
    }) as unknown as typeof query
    const ports = { sessions: async () => [session], relay: async () => { sends++ }, open: async () => growth.id, local: async () => { throw new Error('Não executar localmente') }, context: async () => 'Personalidade e memória do Omni', executable: async () => 'test.exe' }
    const c = new Coordinator(store, () => {}, ports, fake)
    await c.enqueue(central, 'Confira o projeto Growth', 'text')
    assert.equal(central.messages.length, 1, 'envio retorna com planejamento em segundo plano')
    release(); await until(() => sends === 1 && central.coordinationTurns![0].state === 'done')
    const request = growth.editorRequests![0]
    await until(() => request.status === 'sent')
    assert.equal(station.messages.length, 0)
    await c.observe(growth, [{ requestId: 'outro', kind: 'completed', text: 'Relato estranho', at: new Date().toISOString(), evidenceId: 'outro' }], true)
    assert.equal(request.status, 'sent')
    await c.observe(growth, [{ requestId: request.id, kind: 'received', text: 'Recebido', at: new Date().toISOString(), evidenceId: 'receipt' }], true)
    assert.equal(request.status, 'received')
    await c.observe(growth, [{ requestId: request.id, kind: 'completed', text: 'Teste passou. Log verificado pelo executor.', at: new Date().toISOString(), evidenceId: 'evidence-1' }], true)
    await until(() => request.status === 'completed')
    assert.match(central.messages.at(-1)!.text, /Recomendo revisar/)
    assert.equal(growth.messages.length, 0); assert.equal(station.messages.length, 0)
    const count = central.messages.length
    await c.observe(growth, [{ requestId: request.id, kind: 'completed', text: 'Outra cópia', at: new Date().toISOString(), evidenceId: 'evidence-1' }], false)
    assert.equal(central.messages.length, count); assert.equal(sends, 1)
    await store.save()
    const restored = new Store(dir); await restored.load()
    assert.equal(restored.get(central.id).messages.length, count)
    assert.equal(restored.get(growth.id).editorRequests![0].status, 'completed')
  } finally { await rm(dir, { recursive: true }) }
})

test('migração preserva histórico bruto fora da conversa e reinício não reenvia tentativa incerta', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-migration-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'); const c = store.get(id)
    c.messages.push({ id: 'internal', role: 'user', text: 'Resumo técnico antigo', at: '', channel: 'text' })
    c.editorRequests = [{ id: 'request', text: 'Pedido real', at: '', status: 'sending' }]
    await store.save()
    const loaded = new Store(dir); await loaded.load()
    assert.equal(loaded.get(id).messages[0].text, 'Pedido real')
    assert.equal(loaded.get(id).archivedMessages![0].text, 'Resumo técnico antigo')
    assert.equal(loaded.get(id).editorRequests![0].status, 'uncertain')
    assert.throws(() => validatePlan({ action: 'project', reply: 'falso', instruction: 'agir', sessionId: null }), /não identificou/)
  } finally { await rm(dir, { recursive: true }) }
})

test('dois comandos durante o planejamento permanecem na fila e conversa simples não vira subagente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-queue-'))
  try {
    const store = new Store(dir); await store.load(); const central = store.get(await store.create(dir))
    let release!: () => void; const gate = new Promise<void>(r => { release = r }); let count = 0
    const fake = (async function* () { await gate; count++; yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'reply', reply: `Resposta ${count}`, instruction: null, sessionId: null } } }) as unknown as typeof query
    const forbidden = async () => { throw new Error('Conversa simples não delega') }
    const coordinator = new Coordinator(store, () => {}, { sessions: async () => [], relay: forbidden, open: forbidden, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await coordinator.enqueue(central, 'Qual sua recomendação?', 'text')
    await coordinator.enqueue(central, 'Explique o risco também', 'text')
    assert.equal(central.messages.length, 2)
    release(); await until(() => central.coordinationTurns!.every(t => t.state === 'done'))
    assert.equal(count, 2); assert.equal(central.messages.length, 4)
    assert.equal(store.conversations.length, 1)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('plano que tenta trocar a sessão vinculada é recusado sem envio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-target-'))
  try {
    const store = new Store(dir); await store.load(); const external = store.get(await store.create(dir, 'external')); external.sessionId = 'expected'
    let sends = 0
    const fake = (async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'project', reply: 'Enviar', instruction: 'Fazer', sessionId: 'wrong' } } }) as unknown as typeof query
    const coordinator = new Coordinator(store, () => {}, { sessions: async () => [{ sessionId: 'wrong', cwd: dir, pid: 1, name: 'wrong', address: 'uds:wrong' }], relay: async () => { sends++ }, open: async () => external.id, local: async () => external.id, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await coordinator.enqueue(external, 'Execute na sessão vinculada', 'text')
    await until(() => external.coordinationTurns![0].state === 'failed')
    assert.equal(sends, 0); assert.equal(external.editorRequests?.length || 0, 0)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})
