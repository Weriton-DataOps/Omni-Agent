import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { ResultDeliveryQueue } from '../src/main/result-delivery'
import type { EditorSessionReturn } from '../src/shared/contracts'
async function until(check: () => boolean) { const deadline = Date.now() + 4000; while (!check()) { if (Date.now() > deadline) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 5)) } }
async function fixture(run: (s: Store) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), 'omni-delivery-')); try { const s = new Store(dir); await s.load(); await run(s); await s.save() } finally { await rm(dir, { recursive: true }) } }
async function task(s: Store, parent: string, title: string) { const c = s.get(await s.create(s.directory, 'task', parent)); c.title = title; c.phase = 'completed'; c.deliveryState = 'ready'; c.resultText = `${title}: evidência completa`; return c }
const directResponse = (id = 'new-answer'): EditorSessionReturn => ({ id, sessionId: 'growth-session', turnId: 'owner-turn', evidenceId: id, at: '2026-09-14T17:53:22.000Z', objective: 'Preciso das respostas da LP nova', report: 'Resposta atual: formulário em modo mock.', deliveryState: 'ready' })

test('síntese ocorre antes do clique, fica oculta e só anuncia ready depois de persistir', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A')
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve }), active = new Map<string, AbortController>(); let calls = 0
  const queue = new ResultDeliveryQueue(s, async (_c, _o, _r, _out, _abort, onText) => { calls++; onText('Parcial oculto'); await gate; return 'Resposta pronta' }, () => {}, active)
  assert.equal(queue.tickets()[0].state, 'preparing')
  await assert.rejects(queue.release(a.id), /preparado/); assert.equal(calls, 0)
  const job = queue.prepare(a.id); await until(() => calls === 1)
  assert.equal(parent.messages.length, 0); assert.equal(queue.tickets()[0].state, 'preparing')
  finish(); await job
  assert.equal(queue.tickets()[0].state, 'ready'); assert.equal(parent.messages.length, 0); assert.equal(a.acknowledgedAt, undefined)
  const restored = new Store(s.directory); await restored.load(); assert.equal(restored.get(a.id).preparedDelivery?.text, 'Resposta pronta')
  await queue.release(a.id)
  assert.equal(calls, 1); assert.equal(parent.messages[0].text, 'Resposta pronta'); assert.ok(!parent.messages[0].streaming); assert.equal(active.size, 0)
}))

test('vários retornos preparados são publicados na ordem dos cliques, sem nova inferência nem duplicação', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'), b = await task(s, parent.id, 'B')
  let calls = 0
  const queue = new ResultDeliveryQueue(s, async (_c, title) => { calls++; return `${title} pronto` }, () => {}, new Map())
  await Promise.all([queue.prepare(a.id), queue.prepare(b.id)])
  assert.equal(parent.messages.length, 0)
  await Promise.all([queue.release(b.id), queue.release(a.id), queue.release(b.id)])
  assert.deepEqual(parent.messages.map(m => m.text), ['B pronto', 'A pronto']); assert.equal(calls, 2)
  assert.ok(parent.messages.every(m => !m.streaming)); await queue.release(a.id); assert.equal(parent.messages.length, 2)
}))

test('retornos pendentes do mesmo card também são preparados e preservados em ordem', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external')); editor.host = 'vscode'
  editor.editorRequests = [
    { id: 'first', at: '2026-09-14T10:00:00Z', text: 'Primeiro', status: 'completed', report: 'Primeiro retorno', deliveryState: 'ready' },
    { id: 'second', at: '2026-09-14T10:01:00Z', text: 'Segundo', status: 'completed', report: 'Segundo retorno', deliveryState: 'ready' }
  ]
  const calls: string[] = []
  const queue = new ResultDeliveryQueue(s, async (_c, _objective, report) => { calls.push(report); return report }, () => {}, new Map())
  queue.preparePending(); await until(() => queue.tickets().every(ticket => ticket.state === 'ready'))
  assert.deepEqual(calls, ['Segundo retorno', 'Primeiro retorno'])
  await queue.release('first'); await queue.release('second')
  assert.deepEqual(editor.messages.map(message => message.text), ['Primeiro retorno', 'Segundo retorno'])
}))

test('cache preparado sobrevive ao reinício e não chama o modelo ao ler', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A')
  const queue = new ResultDeliveryQueue(s, async () => 'Texto persistido', () => {}, new Map())
  await queue.prepare(a.id)
  const restored = new Store(s.directory); await restored.load(); let calls = 0
  const resumed = new ResultDeliveryQueue(restored, async () => { calls++; return 'Não usar' }, () => {}, new Map())
  await resumed.prepare(a.id); assert.equal(resumed.tickets()[0].state, 'ready')
  await resumed.release(a.id); assert.equal(calls, 0); assert.equal(restored.get(parent.id).messages[0].text, 'Texto persistido')
}))

test('retorno externo usa o chat de destino, com origens distintas compartilhando a mesma fila', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), editor = s.get(await s.create(s.directory, 'external')); editor.host = 'vscode'
  editor.editorRequests = [
    { id: 'central', at: '', text: 'Primeiro', status: 'completed', report: 'Resposta central', originConversationId: parent.id, deliveryConversationId: editor.id, deliveryState: 'ready' },
    { id: 'card', at: '', text: 'Segundo', status: 'completed', report: 'Resposta card', originConversationId: editor.id, deliveryConversationId: editor.id, deliveryState: 'ready' }
  ]
  const destinations: string[] = []
  const queue = new ResultDeliveryQueue(s, async (destination, _o, report) => { destinations.push(destination.id); return report }, () => {}, new Map())
  await Promise.all(editor.editorRequests.map(r => queue.prepare(r.id)))
  await Promise.all([queue.release('central'), queue.release('card')])
  assert.deepEqual(destinations, [editor.id, editor.id]); assert.equal(parent.messages.length, 0)
  assert.deepEqual(editor.messages.map(m => m.text), ['Resposta central', 'Resposta card']); assert.equal(editor.editorRequests[0].originConversationId, parent.id)
}))

test('preparação lenta numa sessão não impede leitura de outra sessão do mesmo workspace', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'), b = await task(s, parent.id, 'B')
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve }); const active = new Map<string, AbortController>()
  const queue = new ResultDeliveryQueue(s, async (_c, title) => { if (title === 'A') await gate; return title }, () => {}, active)
  const slow = queue.prepare(a.id); await queue.prepare(b.id); await queue.release(b.id)
  assert.equal(parent.messages[0].text, 'B'); assert.equal(queue.tickets().find(t => t.id === a.id)?.state, 'preparing')
  finish(); await slow; await queue.release(a.id); assert.deepEqual(parent.messages.map(m => m.text), ['B', 'A'])
}))

test('falha na síntese prepara relato original identificado; clique não repete a tentativa', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'); let calls = 0
  const queue = new ResultDeliveryQueue(s, async (_c, _o, _r, _out, _abort, onText) => { calls++; onText('Parcial inválido'); throw Error('Falha') }, () => {}, new Map())
  await queue.prepare(a.id)
  assert.equal(a.preparedDelivery?.original, true); assert.equal(parent.messages.length, 0)
  await queue.release(a.id); assert.equal(calls, 1); assert.match(parent.messages[0].text, /relato preservado/); assert.match(parent.messages[0].text, /evidência completa/); assert.doesNotMatch(parent.messages[0].text, /Parcial inválido/)
}))

test('evidência e avaliação completas entram na preparação, inclusive etapas anteriores', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'Publicação')
  a.resultText = 'Último teste passou'; a.reportSummary = 'Publicação confirmada'
  a.supervision = { objective: 'Publicar e testar', executionBrief: 'Publicar versão autorizada', state: 'settled', retries: 1, evidenceReports: ['Push remoto abc123'] }
  let objective = '', evidence = ''
  const queue = new ResultDeliveryQueue(s, async (_c, o, report) => { objective = o; evidence = report; return 'Publicação e teste prontos' }, () => {}, new Map())
  await queue.prepare(a.id)
  assert.match(objective, /versão autorizada/); for (const text of ['Último teste passou', 'Publicação confirmada', 'Push remoto abc123']) assert.ok(evidence.includes(text))
  assert.equal(parent.messages.length, 0)
}))

test('nova evidência durante preparação descarta o texto antigo sem levá-lo ao chat', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external')); editor.host = 'vscode'; editor.sessionId = 'growth-session'; editor.editorReturn = directResponse()
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve })
  const queue = new ResultDeliveryQueue(s, async (_c, _o, report) => { await gate; return report }, () => {}, new Map())
  const job = queue.prepare('new-answer'); editor.editorReturn = { ...directResponse('newer-answer'), report: 'Resposta nova' }; finish(); await job
  assert.equal(editor.messages.length, 0); assert.equal(editor.editorReturn.preparedDelivery, undefined)
  assert.equal(queue.tickets()[0].state, 'preparing'); await queue.prepare('newer-answer'); await queue.release('newer-answer')
  assert.equal(editor.messages[0].text, 'Resposta nova')
}))

test('mudança de conteúdo no mesmo pedido invalida o cache antes do clique', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'); let calls = 0
  const queue = new ResultDeliveryQueue(s, async (_c, _o, report) => { calls++; return report }, () => {}, new Map())
  await queue.prepare(a.id); a.resultText = 'Resultado atualizado'
  assert.equal(queue.tickets()[0].state, 'preparing'); await assert.rejects(queue.release(a.id), /preparado/); assert.equal(calls, 1)
  await queue.prepare(a.id); await queue.release(a.id); assert.equal(parent.messages[0].text, 'Resultado atualizado'); assert.equal(calls, 2)
}))

test('revisão ou correção ainda em andamento impede preparação prematura', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'), editor = s.get(await s.create(s.directory, 'external'))
  a.supervision = { objective: 'A', state: 'reviewing', retries: 0 }
  editor.editorRequests = [{ id: 'review', at: '', text: 'Teste', status: 'summarizing', deliveryState: 'ready', report: 'Relato' }]
  let calls = 0; const queue = new ResultDeliveryQueue(s, async () => { calls++; return 'Não usar' }, () => {}, new Map())
  await queue.prepare(a.id); await queue.prepare('review'); assert.equal(calls, 0)
  assert.ok(queue.tickets().every(t => t.state === 'reviewing')); await assert.rejects(queue.release('review'), /conferência/)
  a.supervision.state = 'retry-ready'; a.phase = 'running'; assert.equal(queue.tickets().find(t => t.id === a.id)?.state, 'working')
}))

test('bloqueio e falha de despacho sem sucessor também podem ter retorno preparado', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external'))
  editor.editorRequests = [{ id: 'blocked', at: '', text: 'Teste', status: 'blocked', report: 'Sessão indisponível', deliveryState: 'ready', supervision: { objective: 'Teste', retries: 0, state: 'retry-ready', nextRequestId: 'missing' } }]
  const queue = new ResultDeliveryQueue(s, async () => 'Bloqueio preservado', () => {}, new Map())
  await queue.prepare('blocked'); assert.equal(queue.tickets()[0].state, 'ready'); assert.equal(editor.messages.length, 0)
  await queue.release('blocked'); assert.equal(editor.messages[0].text, 'Bloqueio preservado')
}))

test('card Growth separa resposta direta nova de retorno antigo e leitura não conclui outro pedido', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external')); editor.host = 'vscode'; editor.sessionId = 'growth-session'; editor.editorReturn = directResponse()
  editor.editorRequests = [{ id: 'old', at: '2026-09-14T13:52:00.000Z', text: 'Proposta antiga', status: 'completed', report: 'Fontes', deliveryState: 'ready' }]
  const calls: string[] = []; const queue = new ResultDeliveryQueue(s, async (_c, _o, report, outcome) => { calls.push(outcome); return report }, () => {}, new Map())
  await queue.prepare('new-answer')
  assert.deepEqual(queue.tickets().map(t => [t.id, t.previous]), [['new-answer', false], ['old', true]])
  await queue.release('new-answer'); assert.deepEqual(calls, ['editor-response']); assert.match(editor.messages[0].text, /modo mock/); assert.doesNotMatch(editor.messages[0].text, /Fontes/)
  assert.equal(editor.editorRequests[0].acknowledgedAt, undefined); await queue.release('new-answer'); assert.equal(calls.length, 1)
}))

test('reinício recupera entrega interrompida conservando o texto pronto e a evidência direta', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external')); editor.sessionId = 'growth-session'; editor.editorReturn = directResponse()
  const queue = new ResultDeliveryQueue(s, async () => 'Resposta pronta', () => {}, new Map()); await queue.prepare('new-answer')
  editor.editorReturn.deliveryState = 'delivering'
  editor.messages.push({ id: 'new-answer', text: 'Parcial antigo', at: '', role: 'assistant', channel: 'text', streaming: true }); await s.save()
  const restored = new Store(s.directory); await restored.load(); let calls = 0
  const resumed = new ResultDeliveryQueue(restored, async () => { calls++; return 'Não usar' }, () => {}, new Map())
  assert.equal(restored.get(editor.id).editorReturn?.deliveryState, 'ready'); assert.equal(restored.get(editor.id).editorReturn?.evidenceId, 'new-answer')
  assert.equal(restored.get(editor.id).messages[0].interrupted, true)
  await resumed.release('new-answer'); assert.equal(calls, 0); assert.equal(restored.get(editor.id).messages.length, 1); assert.equal(restored.get(editor.id).messages[0].text, 'Resposta pronta')
}))

test('preparação automática é limitada a duas chamadas concorrentes', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), tasks = await Promise.all(['A', 'B', 'C'].map(title => task(s, parent.id, title)))
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve }); let calls = 0
  const active = new Map<string, AbortController>(), queue = new ResultDeliveryQueue(s, async () => { calls++; await gate; return 'Pronto' }, () => {}, active)
  queue.preparePending(); queue.preparePending(); await until(() => calls === 2); assert.equal(active.size, 2); assert.equal(parent.messages.length, 0)
  finish(); await until(() => !active.size); queue.preparePending(); await until(() => calls === 3 && !active.size)
  assert.ok(tasks.every(t => !!t.preparedDelivery)); assert.equal(parent.messages.length, 0)
}))

test('encerramento durante preparação não salva parcial nem cria fallback de cancelamento', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A')
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve })
  const queue = new ResultDeliveryQueue(s, async () => { await gate; return 'Parcial' }, () => {}, new Map())
  const job = queue.prepare(a.id); queue.stop(); finish(); await job
  assert.equal(a.preparedDelivery, undefined); assert.equal(parent.messages.length, 0)
}))

test('falha ao gravar leitura preserva cache e permite novo clique sem chamar o modelo', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'); let calls = 0
  const queue = new ResultDeliveryQueue(s, async () => { calls++; return 'Pronto' }, () => {}, new Map()); await queue.prepare(a.id)
  const save = s.save.bind(s); s.save = async () => { throw Error('Disco indisponível') }
  await assert.rejects(queue.release(a.id), /texto pronto/)
  assert.equal(parent.messages.length, 0); assert.equal(a.acknowledgedAt, undefined); assert.equal(a.preparedDelivery?.text, 'Pronto')
  s.save = save; await queue.release(a.id); assert.equal(calls, 1); assert.equal(parent.messages[0].text, 'Pronto')
}))

test('cache não fica pronto se a persistência da preparação falhar', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A')
  const queue = new ResultDeliveryQueue(s, async () => 'Pronto', () => {}, new Map()), save = s.save.bind(s)
  s.save = async () => { throw Error('Disco indisponível') }; await assert.rejects(queue.prepare(a.id), /Disco/); s.save = save
  assert.equal(a.preparedDelivery, undefined); assert.equal(queue.tickets()[0].state, 'preparing'); assert.equal(parent.messages.length, 0)
}))

test('resposta alterada enquanto aguarda a fila não publica cache antigo', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'), b = await task(s, parent.id, 'B')
  const queue = new ResultDeliveryQueue(s, async (_c, _o, report) => report, () => {}, new Map())
  await Promise.all([queue.prepare(a.id), queue.prepare(b.id)])
  const save = s.save.bind(s); let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve }); let writes = 0
  s.save = async () => { if (++writes === 1) await gate; await save() }
  const first = queue.release(a.id); const second = queue.release(b.id)
  const rejected = assert.rejects(second, /atualizado/)
  await until(() => writes === 1); b.resultText = 'B atualizado'; finish()
  await first; await rejected; s.save = save
  assert.deepEqual(parent.messages.map(m => m.text), ['A: evidência completa'])
  assert.equal(queue.tickets().find(t => t.id === b.id)?.state, 'preparing')
}))

test('falha na persistência de leitura não remove mensagem concorrente de outra demanda', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A')
  const queue = new ResultDeliveryQueue(s, async () => 'Pronto', () => {}, new Map()); await queue.prepare(a.id)
  const save = s.save.bind(s)
  s.save = async () => { parent.messages.push({ id: 'other', role: 'user', text: 'Outro pedido', at: '', channel: 'text' }); throw Error('Disco indisponível') }
  await assert.rejects(queue.release(a.id), /texto pronto/); s.save = save
  assert.deepEqual(parent.messages.map(m => m.id), ['other']); assert.equal(a.acknowledgedAt, undefined)
}))

test('preferências legadas não publicam automaticamente e reports já entregues não ressurgem', () => fixture(async s => {
  const parent = s.get(await s.create(s.directory)), a = await task(s, parent.id, 'A'), editor = s.get(await s.create(s.directory, 'external'))
  Object.assign(a, { autoDeliver: true }); editor.editorRequests = [{ id: 'legacy', at: '', text: 'Antigo', status: 'completed', report: 'Já no chat' }]
  await s.save(); const restored = new Store(s.directory); await restored.load()
  const queue = new ResultDeliveryQueue(restored, async () => 'Pronto', () => {}, new Map()); await queue.prepare(a.id)
  assert.equal('autoDeliver' in restored.get(a.id), false); assert.equal(queue.tickets().length, 1); assert.equal(restored.get(parent.id).messages.length, 0)
}))

test('heartbeat de pedido antigo não transforma resposta atual em retorno anterior', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external')); editor.sessionId = 'growth-session'; editor.editorReturn = directResponse()
  editor.editorRequests = [{ id: 'stale', at: '2026-09-14T12:00:00.000Z', lastObservedAt: '2026-09-14T18:00:00.000Z', text: 'Pedido antigo', status: 'received' }]
  const queue = new ResultDeliveryQueue(s, async () => 'Resposta', () => {}, new Map())
  assert.equal(queue.tickets().find(t => t.id === 'new-answer')?.previous, false)
}))

test('nova versão de relato preserva a mensagem da versão anterior já lida', () => fixture(async s => {
  const editor = s.get(await s.create(s.directory, 'external'))
  editor.messages.push({ id: 'editor-report:request:old', role: 'assistant', at: '', channel: 'text', text: 'Antes estava bloqueado' })
  editor.editorRequests = [{ id: 'request', at: '', text: 'Publicar', status: 'completed', report: 'Agora publicado', evidenceId: 'new', deliveryState: 'ready' }]
  const queue = new ResultDeliveryQueue(s, async () => 'Agora publicado', () => {}, new Map())
  await queue.prepare('request'); await queue.release('request')
  assert.deepEqual(editor.messages.map(m => m.text), ['Antes estava bloqueado', 'Agora publicado'])
  assert.equal(editor.messages[1].id, 'editor-report:request:new')
}))
