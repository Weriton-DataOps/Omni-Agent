import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { query, Options } from '@anthropic-ai/claude-agent-sdk'
import { Store } from '../src/main/store'
import { Controller } from '../src/main/controller'
import { Coordinator } from '../src/main/coordinator'
import { validateReview } from '../src/shared/supervision'

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) { if (Date.now() > deadline) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 5)) }
}
const result = (action: string, message: string, instruction: string | null = null) => ({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action, message, instruction, withinScope: true, needsOwner: false } })
const modules = {
  loadModule: async (name: string) => name.includes('activation-store') ? { ClaudeActivationStore: class { async activate() { return { gravados: true } } } } : name.includes('hook-contexto') ? { tratarHook: async () => ({ hookSpecificOutput: { additionalContext: 'Omni' } }) } : { sincronizarMemoriaDuravel: async () => {}, sincronizarMissoesDuraveis: async () => {}, lerMemoria: async () => ({ confirmed: [], candidates: [] }) },
  getBroker: async () => ({ health: async () => ({ status: 'ready' }), listActiveMissions: async () => [] }) as any,
  executable: async () => 'test.exe', sessions: async () => []
}

test('falha local é corrigida automaticamente; resultado final só entra após liberação', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-supervision-'))
  try {
    const store = new Store(dir); await store.load()
    const parent = store.get(await store.create(dir))
    const other = store.get(await store.create(dir, 'external'))
    let executions = 0; let reviews = 0
    const sessions: string[] = []
    let release!: () => void; const gate = new Promise<void>(r => { release = r })
    const fake = (async function* ({ options, prompt }: { options: Options; prompt: string }) {
      if (options.outputFormat) {
        reviews++
        yield reviews === 1 ? result('retry', 'Faltou o teste real. Vou mandar executar e conferir.', 'Execute o teste real e confira o resultado.') : result('complete', 'Teste executado; resultado conferido pelo executor.')
      } else {
        if (prompt !== 'Teste autorizado' && !prompt.startsWith('Continue o mesmo pedido')) { yield { type: 'result', subtype: 'success', is_error: false, result: 'Teste executado; resultado conferido pelo executor.' }; return }
        executions++; sessions.push(options.sessionId || options.resume || '')
        if (executions === 1) yield { type: 'result', subtype: 'error_max_turns', is_error: true }
        else { assert.match(prompt, /Objetivo original e limites: Teste autorizado/); await gate; yield { type: 'result', subtype: 'success', is_error: false, result: 'Teste real passou.' } }
      }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules)
    const id = await controller.delegate(parent.id, 'Teste autorizado')
    await until(() => executions === 2 && parent.messages.some(m => m.id.startsWith('task-correction:')))
    assert.equal(controller.active.has(parent.id), false)
    assert.equal(store.get(id).phase, 'running')
    assert.equal(controller.snapshot().state.activities.find(a => a.conversationId === id)?.status, 'running')
    assert.equal(store.conversations.filter(c => c.kind === 'task').length, 1)
    assert.equal(sessions[0], sessions[1])
    release()
    await until(() => store.get(id).deliveryState === 'ready')
    assert.equal(store.get(id).acknowledgedAt, undefined)
    assert.equal(parent.messages.some(m => m.id === `report:${id}`), false)
    await controller.releaseResult(id)
    await until(() => !!store.get(id).acknowledgedAt)
    assert.match(parent.messages.at(-1)!.text, /Teste executado/)
    assert.equal(other.messages.length, 0)
    const count = parent.messages.length
    await controller.consumeTask(id)
    assert.equal(parent.messages.length, count)
    await until(() => controller.active.size === 0)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('retorno externo incompleto volta à mesma sessão uma vez, com origem preservada e sem clique', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-supervision-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)); const target = store.get(await store.create(dir, 'external'))
    const session = { sessionId: 'executor', cwd: dir, name: 'project', pid: 1, address: 'uds:executor' }
    target.sessionId = session.sessionId
    const sent: { id: string; sessionId: string; text: string }[] = []
    let reviews = 0
    const fake = (async function* () { reviews++; yield reviews === 1 ? result('retry', 'O teste ficou faltando.', 'Concluir somente o teste autorizado.') : result('complete', 'Teste concluído.') }) as unknown as typeof query
    const ports = { sessions: async () => [session], relay: async (s: typeof session, text: string, id: string) => { sent.push({ sessionId: s.sessionId, text, id }) }, open: async () => target.id, local: async () => { throw new Error('Não executar localmente') }, context: async () => 'Omni', executable: async () => 'test.exe' }
    const coordinator = new Coordinator(store, () => {}, ports, fake)
    const request = { id: 'original', text: 'Teste autorizado', at: new Date().toISOString(), status: 'sent' as const, originConversationId: origin.id, targetSessionId: session.sessionId, targetName: session.name }
    target.editorRequests = [request]
    const event = { requestId: request.id, kind: 'blocked' as const, text: 'Faltou executar o teste.', at: new Date().toISOString(), evidenceId: 'report-1' }
    await coordinator.observe(target, [event], true)
    await until(() => !!target.editorRequests![0].summary)
    assert.equal(sent.length, 1); assert.equal(sent[0].sessionId, session.sessionId)
    assert.match(sent[0].text, /Teste autorizado/)
    assert.match(target.messages.at(-1)!.text, /Correção encaminhada/)
    assert.equal(target.messages.filter(message => message.id === 'editor-forwarded:original').length, 1)
    assert.equal(origin.messages.length, 0)
    await coordinator.observe(target, [event], true)
    assert.equal(sent.length, 1)
    const next = target.editorRequests![1]
    assert.equal(next.followupOf, request.id)
    assert.equal(next.originConversationId, origin.id); assert.equal(next.deliveryConversationId, target.id)
    await coordinator.observe(target, [{ requestId: next.id, kind: 'completed', text: 'Teste passou com evidência.', at: new Date().toISOString(), evidenceId: 'report-2' }], true)
    await until(() => next.status === 'completed')
    await store.save()
    const restored = new Store(dir); await restored.load()
    new Coordinator(restored, () => {}, ports, fake).resume()
    assert.equal(sent.length, 1)
    assert.equal(next.deliveryState, 'ready')
    assert.equal(origin.messages.some(m => m.id === `editor-report:${next.id}`), false)
  } finally { await rm(dir, { recursive: true }) }
})

test('reinício durante devolução preserva o envio já registrado e publica a atualização uma única vez', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-recover-supervision-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)); const target = store.get(await store.create(dir, 'external'))
    const session = { sessionId: 'executor', cwd: dir, name: 'project', pid: 1, address: 'uds:executor' }
    target.sessionId = session.sessionId
    target.editorRequests = [
      { id: 'original', text: 'Teste autorizado', at: '', status: 'summarizing', report: 'Faltou teste.', originConversationId: origin.id, targetSessionId: session.sessionId, supervision: { objective: 'Teste autorizado', retries: 0, state: 'retry-ready', nextRequestId: 'correction', review: { action: 'retry', message: 'Faltou teste.', instruction: 'Completar o teste.', withinScope: true, needsOwner: false } } },
      { id: 'correction', text: 'Completar o teste.', at: '', status: 'sent', originConversationId: origin.id, targetSessionId: session.sessionId }
    ]
    await store.save()
    const restored = new Store(dir); await restored.load()
    const forbidden = async () => { throw new Error('Não pode reenviar nem planejar outra execução') }
    const c = new Coordinator(restored, () => {}, { sessions: async () => [session], relay: forbidden, open: forbidden, local: forbidden, context: forbidden, executable: forbidden })
    c.resume()
    await until(() => restored.get(target.id).editorRequests![0].supervision?.state === 'settled')
    assert.equal(restored.get(target.id).editorRequests!.length, 2)
    assert.equal(restored.get(origin.id).messages.length, 0)
    const notices = () => restored.get(target.id).messages.filter(message => message.id === 'editor-report:original')
    assert.equal(notices().length, 1); assert.match(notices()[0].text, /Correção encaminhada/)
    c.resume()
    assert.equal(notices().length, 1)
    await restored.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('avaliação não permite ampliar escopo e respeita cancelamento e ausência de progresso', async () => {
  assert.throws(() => validateReview({ action: 'retry', message: 'Expandir', instruction: 'Novo projeto', withinScope: false, needsOwner: false }))
  assert.throws(() => validateReview({ action: 'retry', message: 'Credencial ausente', instruction: 'Continuar', withinScope: true, needsOwner: true }))
  const store = new Store('unused')
  const forbidden = async () => { throw new Error('Não deveria consultar modelo/executor') }
  const fake = (async function* () { yield result('retry', 'Falta o teste.', 'Verificar o teste.') }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, { sessions: forbidden, relay: forbidden, open: forbidden, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  for (const extra of [{ retries: 3 }, { cancelled: true }, { previousReport: 'Mesmo erro' }]) {
    const review = await coordinator.reviewReturn({ messages: [] } as any, { objective: 'Mesmo pedido', retries: 0, state: 'executing', ...extra }, 'Mesmo erro', 'failed')
    assert.equal(review.action, 'decision'); assert.equal(review.instruction, null)
  }
  const complete = (async function* () { yield result('complete', 'Concluiu na última correção.') }) as unknown as typeof query
  const finalCoordinator = new Coordinator(store, () => {}, { sessions: forbidden, relay: forbidden, open: forbidden, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, complete)
  assert.equal((await finalCoordinator.reviewReturn({ messages: [] } as any, { objective: 'Mesmo pedido', retries: 3, state: 'executing' }, 'Teste passou.', 'completed')).action, 'complete')
})
