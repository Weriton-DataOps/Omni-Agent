import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { query } from '@anthropic-ai/claude-agent-sdk'
import { editorExecution, latestEditorReturn, observeNaturalCompletion, visibleEditorMessage, type TranscriptRecord } from '../src/main/editor-transcript'
import { Coordinator, isStatusInquiry } from '../src/main/coordinator'
import { Controller } from '../src/main/controller'
import { Store } from '../src/main/store'
import { attachmentPrompt, modelPrompt } from '../src/main/attachment-content'
import { normalizeComposer, pastedTextAttachments } from '../src/shared/composer-content'
import { ResultDeliveryQueue } from '../src/main/result-delivery'

const sid = randomUUID(), request = randomUUID()
const user = (text: string, at = '2026-09-16T10:00:00Z', isMeta = false): TranscriptRecord => ({ type: 'user', uuid: randomUUID(), timestamp: at, isMeta, message: { content: text } })
const answer = (text: string, at = '2026-09-16T10:01:00Z'): TranscriptRecord => ({ type: 'assistant', uuid: randomUUID(), timestamp: at, message: { content: text, stop_reason: 'end_turn' } })
const noModel = (async function* () { throw Error('Modelo não permitido') }) as unknown as typeof query
async function until(done: () => boolean) { for (let i = 0; i < 150; i++) { if (done()) return; await new Promise(r => setTimeout(r, 10)) }; assert.fail('Operação não terminou') }

test('resposta nova a outra sessão substitui a antiga sem expor o envelope como pedido do dono', () => {
  const old = answer('Antiga')
  const incoming = user('<cross-session-message from-name="peer">Dados recebidos</cross-session-message>', '2026-09-16T11:00:00Z', true)
  const fresh = answer('Resultado atual', '2026-09-16T11:01:00Z')
  const records = [user('Pedido antigo'), old, incoming, fresh]
  const result = latestEditorReturn(records, sid)!
  assert.equal(result.evidenceId, fresh.uuid); assert.doesNotMatch(result.report, /Antiga/)
  assert.doesNotMatch(result.objective, /cross-session-message|Dados recebidos/)
  assert.equal(editorExecution(records).turnStartedAt, incoming.timestamp)
  assert.equal(visibleEditorMessage(incoming, 'projeto'), null)
})

test('notificação técnica não substitui objetivo nem reacende execução terminada', () => {
  const initial = user('Pedido real'), done = answer('Resposta real')
  const notification = user('<task-notification>terminou</task-notification>', '2026-09-16T11:00:00Z')
  assert.equal(visibleEditorMessage(notification, 'projeto'), null)
  assert.equal(latestEditorReturn([initial, done, notification], sid)?.objective, 'Pedido real')
  assert.equal(editorExecution([initial, done, notification]).state, 'idle')
})

test('conclusão natural nunca migra de um pedido antigo para uma nova mensagem', () => {
  const authority = user(`[Omni Desktop authority:v1 request:${request}] Pedido A`)
  assert.equal(observeNaturalCompletion([authority, user('Pedido B'), answer('Feito.')]).length, 0)
  assert.equal(observeNaturalCompletion([authority, answer('Não implementado.')]).length, 0)
  assert.equal(observeNaturalCompletion([authority, { ...answer('Feito.'), message: { content: 'Feito.' } }]).length, 0)
  assert.equal(observeNaturalCompletion([authority, user('<cross-session-message from-name="p">Pedido B</cross-session-message>', undefined, true), answer('Feito.')]).length, 0)
  assert.equal(observeNaturalCompletion([authority, { ...user('resumo'), isCompactSummary: true }, answer('Feito.')]).length, 0)
  const receipt = user(`<cross-session-message from-name="courier">\n[Omni Desktop authority:v1 request:${request}] Pedido A</cross-session-message>`, undefined, true)
  assert.equal(observeNaturalCompletion([receipt, answer('Feito.')])[0]?.requestId, request)
})

test('status em comando não é consulta; cobranças sem instrução continuam sem reenvio', () => {
  for (const text of ['Adicione o campo status no formulário', 'Corrija o status do pedido', 'Verifique o pedido que não chegou']) assert.equal(isStatusInquiry(text), false)
  for (const text of ['qual o status?', 'já finalizou lá?', 'cadê o retorno?', 'a sessão não te encontrou']) assert.equal(isStatusInquiry(text), true)
})

test('normalização no envio preserva texto grande e respeita limites', () => {
  const text = 'Instrução completa. '.repeat(400)
  const next = normalizeComposer(text, [])
  assert.equal(next.text, ''); assert.equal(next.attachments[0].text, text)
  assert.equal(normalizeComposer('Complemento', next.attachments).text, 'Complemento')
  assert.throws(() => normalizeComposer(text, Array.from({ length: 8 }, () => ({ kind: 'image' as const }))), /rascunho/)
  assert.throws(() => normalizeComposer('a'.repeat(256001), []), /limite/)
})

test('somente o texto longo do clipboard vira anexo sem alterar anexos anteriores', () => {
  const previous = [{ kind: 'text' as const, name: 'anterior.txt', text: 'Anexo anterior' }]
  const pasted = '  Conversa colada com acentos e quebras.\r\n'.repeat(200) + '\n'
  const next = pastedTextAttachments(pasted, previous)!
  assert.equal(previous.length, 1)
  assert.equal(next.length, 2)
  assert.equal(next[0], previous[0])
  assert.equal(next[1].text, pasted)
  assert.equal(pastedTextAttachments('texto curto', next), null)
  assert.equal(pastedTextAttachments('a'.repeat(6000), next), null)
  assert.equal(pastedTextAttachments('a'.repeat(6001), next)!.length, 3)
})

test('colagem longa recusada mantém anexos anteriores intactos', () => {
  const full = Array.from({ length: 8 }, () => ({ kind: 'text' as const, text: 'Existente' }))
  const before = JSON.stringify(full)
  assert.throws(() => pastedTextAttachments('a'.repeat(6001), full), /rascunho foi preservado/)
  assert.throws(() => pastedTextAttachments('a'.repeat(256001), []), /limite/)
  assert.equal(JSON.stringify(full), before)
})

test('anexos chegam ao executor vinculado e imagens ao coordenador como visão, não rótulo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-audit-attachments-'))
  const store = new Store(dir); const active = new Map<string, AbortController>()
  let coordinator: Coordinator | undefined
  try {
    await store.load(); const target = store.get(await store.create(dir, 'external')); target.sessionId = sid
    const textAttachment = { id: randomUUID(), kind: 'text' as const, name: 'brief.txt', mime: 'text/plain', size: 7000 }
    const imageAttachment = { id: randomUUID(), kind: 'image' as const, name: 'imagem.png', mime: 'image/png', size: 8 }
    const folder = join(dir, 'attachments', target.id); await mkdir(folder, { recursive: true })
    const content = 'CONTEUDO INTEGRAL '.repeat(450)
    await writeFile(join(folder, textAttachment.id + '.txt'), content)
    await writeFile(join(folder, imageAttachment.id + '.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    const session = { sessionId: sid, cwd: dir, name: 'projeto', pid: 1, address: 'uds:fixture' }
    let relayed = ''
    const planner = (async function* ({ options }: { options: { outputFormat?: unknown } }) {
      assert.ok(options.outputFormat, 'anexo também deve passar pelo planejamento antes do relay')
      yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'project', sessionId: sid, reply: 'Briefing validado.', instruction: 'Execute o anexo fornecido, preserve o escopo nele definido e devolva evidências da conclusão.' } }
    }) as unknown as typeof query
    coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async (_s, text) => { relayed = text }, open: async () => target.id, local: async () => { throw Error('Não pode delegar fora') }, context: async () => '', executable: async () => '' }, planner, active)
    await coordinator.enqueue(target, 'Execute o anexo.', 'text', [textAttachment, imageAttachment])
    await until(() => target.coordinationTurns?.[0].state === 'done' && !active.size)
    assert.ok(relayed.includes(content)); assert.ok(relayed.includes(imageAttachment.id + '.png'))
    assert.match(target.editorRequests?.[0].text || '', /Execute o anexo fornecido/)
    assert.equal(target.messages.some(m => m.text.includes(content)), false)
    const vision = await modelPrompt('Descreva a imagem', dir, target.id, [imageAttachment])
    assert.notEqual(typeof vision, 'string')
    for await (const message of vision as AsyncIterable<any>) {
      assert.equal(message.message.content[1].type, 'image')
      assert.equal(message.message.content[1].source.data, Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'))
    }
    await assert.rejects(attachmentPrompt(dir, target.id, [{ ...textAttachment, id: randomUUID() }]), /não será encaminhado/)
  } finally { coordinator?.stop(); await until(() => !active.size); await store.save(); await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('projeto nomeado vence caminho antigo e pedido desconectado não vira execução', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-audit-routing-'))
  const store = new Store(dir)
  try {
    await store.load(); const central = store.get(await store.create(dir))
    const alpha = join(dir, 'alpha-audit'), beta = join(dir, 'beta-audit'); await mkdir(alpha); await mkdir(beta)
    central.messages.push({ id: randomUUID(), role: 'user', text: beta, at: '', channel: 'text' })
    const session = { sessionId: sid, cwd: alpha, name: 'alpha', pid: 1, address: 'uds:fixture' }
    const opened: string[] = []
    const controller = new Controller(store, () => {}, noModel, { loadModule: async () => ({}), getBroker: async () => ({}), executable: async () => '', sessions: async () => [session], openWorkspace: async path => { opened.push(path) } })
    await controller.send(central.id, 'abra o projeto alpha-audit no vs code')
    assert.deepEqual(opened, [alpha])
    await assert.rejects(controller.send(central.id, 'abra o projeto desconhecido no vs code'), /Não identifiquei/)
    await assert.rejects(controller.send(central.id, `abra o projeto ${alpha} inexistente no vs code`), /caminho informado/)
    assert.equal(opened.length, 1)
    const external = store.get(await store.create(alpha, 'external')); external.sessionId = sid
    external.editorRequests = [{ id: request, text: 'Pedido antigo', at: '2026-09-01T00:00:00Z', status: 'received', disconnected: true }]
    const queue = new ResultDeliveryQueue(store, async () => '', () => {}, new Map())
    assert.equal(queue.tickets().find(t => t.id === request)?.state, 'waiting')
  } finally { await store.save(); await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
