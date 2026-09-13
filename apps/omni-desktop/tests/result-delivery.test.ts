import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { ResultDeliveryQueue } from '../src/main/result-delivery'
async function until(check: () => boolean) { const deadline = Date.now() + 4000; while (!check()) { if (Date.now() > deadline) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 5)) } }
async function fixture(run: (s: Store) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), 'omni-delivery-')); try { const s = new Store(dir); await s.load(); await run(s); await s.save() } finally { await rm(dir, { recursive: true }) } }
async function task(s: Store, parent: string, title: string) { const c = s.get(await s.create(s.directory, 'task', parent)); c.title = title; c.phase = 'completed'; c.deliveryState = 'ready'; c.resultText = `${title}: evidência completa`; return c }

test('resultados aguardam autorização; streams seguem a ordem de liberação e não se sobrepõem', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'A'), b = await task(s, origin.id, 'B')
  const starts: string[] = []; let finish!: () => void; const gate = new Promise<void>(r => { finish = r }); const active = new Map<string, AbortController>()
  const queue = new ResultDeliveryQueue(s, async (_o, objective, _r, _out, _abort, onText) => { starts.push(objective); onText(`${objective} parcial`); if (objective === 'B') await gate; onText(`${objective} completo`); return `${objective} completo` }, () => {}, active)
  queue.tickets(); assert.equal(origin.messages.length, 0)
  await queue.release(b.id); await queue.release(a.id); await queue.release(b.id)
  await until(() => origin.messages.length === 1)
  assert.deepEqual(starts, ['B']); assert.equal(origin.messages[0].streaming, true); assert.equal(origin.messages[0].text, 'B parcial')
  assert.equal(a.acknowledgedAt, undefined); finish()
  await until(() => !!a.acknowledgedAt && !active.size)
  assert.deepEqual(starts, ['B', 'A']); assert.deepEqual(origin.messages.map(m => m.text), ['B completo', 'A completo'])
  assert.equal(origin.messages.every(m => !m.streaming), true)
  await queue.release(a.id); assert.equal(origin.messages.length, 2)
}))

test('preferências antigas são apagadas e nenhum resultado final sai sem clique no card', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'A'), editor = s.get(await s.create(s.directory, 'external'))
  Object.assign(a, { autoDeliver: true })
  editor.editorProjectionVersion = 2
  editor.editorRequests = [Object.assign({ id: 'legacy-editor', at: '', text: 'Verificar', status: 'completed' as const, originConversationId: origin.id, deliveryState: 'ready' as const, report: 'Verificação concluída' }, { autoDeliver: true })]
  await s.save()
  const restored = new Store(s.directory); await restored.load()
  assert.equal('autoDeliver' in restored.get(a.id), false)
  assert.equal('autoDeliver' in restored.get(editor.id).editorRequests![0], false)
  const active = new Map<string, AbortController>(); let calls = 0
  const queue = new ResultDeliveryQueue(restored, async () => { calls++; return 'Final' }, () => {}, active)
  assert.equal(queue.tickets().length, 2)
  assert.equal(queue.tickets().every(ticket => !('autoDeliver' in ticket)), true)
  assert.equal(calls, 0); assert.equal(restored.get(origin.id).messages.length, 0)
  await queue.release(a.id)
  await until(() => !!restored.get(a.id).acknowledgedAt && !active.size)
  assert.equal(calls, 1); assert.equal(restored.get(editor.id).editorRequests![0].acknowledgedAt, undefined)
}))

test('retorno VS Code vai ao chat da sessão chamada sem alterar a origem autorizadora', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), editor = s.get(await s.create(s.directory, 'external'))
  editor.host = 'vscode'; editor.editorRequests = [{ id: 'editor-request', at: '', text: 'Publicar e verificar', status: 'completed', report: 'Publicado e conferido', originConversationId: origin.id, deliveryState: 'ready' }]
  const active = new Map<string, AbortController>(); const queue = new ResultDeliveryQueue(s, async (destination, objective, report) => { assert.equal(destination.id, editor.id); assert.equal(objective, 'Publicar e verificar'); return report }, () => {}, active)
  const ticket = queue.tickets()[0]
  assert.equal(ticket.source, 'vscode'); assert.equal(ticket.originConversationId, origin.id); assert.equal(ticket.deliveryConversationId, editor.id)
  assert.equal(await queue.release('editor-request'), editor.id)
  await until(() => !!editor.editorRequests![0].acknowledgedAt && !active.size)
  assert.equal(origin.messages.length, 0); assert.equal(editor.messages[0].id, 'editor-report:editor-request')
  assert.equal(editor.editorRequests![0].originConversationId, origin.id)
  assert.equal(await queue.release('editor-request'), editor.id); assert.equal(editor.messages.length, 1)
}))

test('pedidos de origens diferentes para o mesmo VS Code compartilham uma fila de apresentação', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), editor = s.get(await s.create(s.directory, 'external'))
  editor.host = 'vscode'; editor.editorRequests = [
    { id: 'from-central', at: '', text: 'Primeiro', status: 'completed', report: 'Retorno da central', originConversationId: origin.id, deliveryConversationId: editor.id, deliveryState: 'ready' },
    { id: 'from-card', at: '', text: 'Segundo', status: 'completed', report: 'Retorno do card', originConversationId: editor.id, deliveryConversationId: editor.id, deliveryState: 'ready' }
  ]
  let finish!: () => void; const gate = new Promise<void>(r => { finish = r }), starts: string[] = [], active = new Map<string, AbortController>()
  const queue = new ResultDeliveryQueue(s, async (destination, objective, report, _out, _abort, onText) => { assert.equal(destination.id, editor.id); starts.push(objective); onText('Parcial'); if (objective === 'Primeiro') await gate; return report }, () => {}, active)
  await queue.release('from-central'); await queue.release('from-card')
  await until(() => editor.messages.length === 1)
  assert.deepEqual(starts, ['Primeiro']); assert.equal(editor.messages[0].streaming, true); assert.equal(origin.messages.length, 0)
  finish(); await until(() => editor.editorRequests!.every(r => !!r.acknowledgedAt) && !active.size)
  assert.deepEqual(starts, ['Primeiro', 'Segundo']); assert.deepEqual(editor.messages.map(m => m.text), ['Retorno da central', 'Retorno do card'])
}))

test('duas sessões no mesmo workspace recebem seus próprios retornos sem bloquear uma à outra', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), first = s.get(await s.create(s.directory, 'external')), second = s.get(await s.create(s.directory, 'external'))
  for (const [i, editor] of [first, second].entries()) {
    editor.host = 'vscode'; editor.sessionId = `session-${i}`
    editor.editorRequests = [{ id: `request-${i}`, at: '', text: `Pedido ${i}`, status: 'completed', report: `Resultado ${i}`, originConversationId: origin.id, deliveryConversationId: editor.id, deliveryState: 'ready' }]
  }
  let finish!: () => void; const gate = new Promise<void>(r => { finish = r }), active = new Map<string, AbortController>()
  const queue = new ResultDeliveryQueue(s, async (destination, _objective, report, _out, _abort, onText) => { onText('Parcial'); if (destination.id === first.id) await gate; return report }, () => {}, active)
  await queue.release('request-0'); await queue.release('request-1')
  await until(() => !!second.editorRequests![0].acknowledgedAt)
  assert.equal(first.messages[0].streaming, true); assert.equal(second.messages[0].text, 'Resultado 1'); assert.equal(origin.messages.length, 0)
  finish(); await until(() => !!first.editorRequests![0].acknowledgedAt && !active.size)
  assert.equal(first.messages[0].text, 'Resultado 0'); assert.equal(second.messages.length, 1)
}))

test('relatório de bloqueio também aguarda liberação manual pelo card', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'A'); a.phase = 'failed'
  let calls = 0
  const queue = new ResultDeliveryQueue(s, async () => { calls++; return 'Bloqueio detalhado' }, () => {}, new Map())
  assert.equal(calls, 0); assert.equal(queue.tickets()[0].state, 'ready')
  await queue.release(a.id); await until(() => !!a.acknowledgedAt); assert.equal(calls, 1)
}))

test('falha de streaming mantém retorno no card e nova tentativa exige outro clique', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'A')
  const active = new Map<string, AbortController>(); let calls = 0
  const queue = new ResultDeliveryQueue(s, async (_o, _obj, _r, _out, _abort, onText) => { calls++; onText('Texto parcial'); if (calls === 1) throw new Error('falha simulada'); return 'Texto completo' }, () => {}, active)
  await queue.release(a.id); await until(() => !!a.deliveryError && !active.size)
  assert.equal(a.deliveryState, 'ready'); assert.equal(a.acknowledgedAt, undefined); assert.equal(origin.messages[0].streaming, false)
  queue.tickets(); assert.equal(calls, 1)
  await s.save(); const restored = new Store(s.directory); await restored.load(); assert.equal(restored.get(a.id).deliveryError, true)
  await queue.release(a.id); await until(() => !!a.acknowledgedAt && !active.size)
  assert.equal(calls, 2); assert.equal(origin.messages.length, 1); assert.equal(origin.messages[0].text, 'Texto completo')
}))

test('reinício libera estado delivering para nova escolha do usuário sem perder relato', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'A'); a.deliveryState = 'delivering'
  origin.messages.push({ id: `report:${a.id}`, text: 'Parcial', role: 'assistant', channel: 'text', at: '', streaming: true })
  await s.save(); const restored = new Store(s.directory); await restored.load()
  assert.equal(restored.get(a.id).deliveryState, 'ready'); assert.equal(restored.get(a.id).deliveryError, true); assert.equal(restored.get(origin.id).messages[0].streaming, false)
  assert.equal(restored.get(origin.id).messages[0].interrupted, true)
  assert.equal(restored.get(a.id).resultText, 'A: evidência completa')
}))

test('síntese final recebe evidência anterior e avaliação, sem reduzir entrega ao último teste', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'Publicação')
  a.resultText = 'Último teste passou'; a.reportSummary = 'Publicação e teste concluídos'
  a.supervision = { objective: 'Publicar e testar', executionBrief: 'Publicar a versão autorizada e verificar', state: 'settled', retries: 1, evidenceReports: ['Push remoto confirmado no commit abc123'] }
  const queue = new ResultDeliveryQueue(s, async (_o, objective, report) => {
    assert.match(objective, /Publicar a versão autorizada/); assert.match(report, /Último teste passou/); assert.match(report, /Publicação e teste concluídos/); assert.match(report, /Push remoto confirmado/)
    return 'Publicação e teste prontos'
  }, () => {}, new Map())
  await queue.release(a.id); await until(() => !!a.acknowledgedAt)
}))

test('falha ao despachar correção externa mantém o relato disponível se sucessor não existe', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), editor = s.get(await s.create(s.directory, 'external'))
  editor.editorRequests = [{ id: 'pending-correction', at: '', text: 'Teste', status: 'blocked', deliveryState: 'ready', summaryError: 'Sessão indisponível', originConversationId: origin.id, supervision: { objective: 'Teste completo', state: 'retry-ready', retries: 0, nextRequestId: 'not-dispatched' } }]
  const queue = new ResultDeliveryQueue(s, async () => 'Bloqueio preservado', () => {}, new Map())
  assert.equal(queue.tickets().length, 1); assert.equal(queue.tickets()[0].state, 'ready')
}))

test('reinício durante revisão mantém o card em conferência e recusa liberação prematura', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), a = await task(s, origin.id, 'A')
  a.deliveryState = undefined; a.summaryState = 'running'; a.supervision = { objective: 'A completo', executionBrief: 'Executar e testar A', state: 'reviewing', retries: 0 }
  await s.save(); const restored = new Store(s.directory); await restored.load()
  let calls = 0; const queue = new ResultDeliveryQueue(restored, async () => { calls++; return 'Não deveria sair' }, () => {}, new Map())
  assert.equal(queue.tickets()[0].state, 'reviewing'); assert.equal(calls, 0)
  await assert.rejects(queue.release(a.id), /conferência/)
  const resumed = restored.get(a.id); resumed.supervision!.state = 'retry-ready'; resumed.phase = 'running'
  assert.equal(calls, 0); assert.equal(queue.tickets()[0].state, 'working'); assert.equal(resumed.acknowledgedAt, undefined)
}))

test('nova avaliação de retorno VS Code tem prioridade sobre um estado ready antigo', () => fixture(async s => {
  const origin = s.get(await s.create(s.directory)), editor = s.get(await s.create(s.directory, 'external'))
  editor.editorRequests = [{ id: 'review-again', at: '', text: 'Verificar', status: 'summarizing', report: 'Relato preservado', originConversationId: origin.id, deliveryConversationId: editor.id, deliveryState: 'ready' }]
  let calls = 0; const queue = new ResultDeliveryQueue(s, async () => { calls++; return 'Não deveria sair' }, () => {}, new Map())
  assert.equal(queue.tickets()[0].state, 'reviewing')
  await assert.rejects(queue.release('review-again'), /conferência/)
  assert.equal(calls, 0); assert.equal(editor.messages.length, 0); assert.equal(origin.messages.length, 0)
}))
