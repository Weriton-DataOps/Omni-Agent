import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store.ts'
test('histórico sobrevive ao reinício e rodada interrompida não vira sucesso', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-desktop-store-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create('C:/projeto')
    store.get(id).sessionId = '12345678-1234-1234-1234-123456789abc'
    store.get(id).phase = 'running'
    store.get(id).messages.push({ id: '1', role: 'user', text: 'Continuar missão', channel: 'text', at: new Date().toISOString() })
    await store.save()
    const reopened = new Store(dir); await reopened.load()
    assert.equal(reopened.get(id).phase, 'interrupted')
    assert.equal(reopened.get(id).sessionId, store.get(id).sessionId)
    assert.equal(reopened.get(id).messages[0].text, 'Continuar missão')
  } finally { await rm(dir, { recursive: true }) }
})
test('escritas concorrentes preservam a última versão inteira', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-desktop-store-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create('C:/projeto')
    const writes = Array.from({ length: 10 }, (_, i) => { store.get(id).title = `Revisão ${i}`; return store.save() })
    await Promise.all(writes)
    assert.equal(JSON.parse(await readFile(join(dir, 'conversations.json'), 'utf8')).conversations[0].title, 'Revisão 9')
  } finally { await rm(dir, { recursive: true }) }
})
test('histórico inválido é preservado e impede sobrescrita no arranque', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-desktop-store-'))
  try {
    await writeFile(join(dir, 'conversations.json'), 'corrompido')
    await assert.rejects(new Store(dir).load())
    assert.equal(await readFile(join(dir, 'conversations.json'), 'utf8'), 'corrompido')
  } finally { await rm(dir, { recursive: true }) }
})

test('migração projeta só pedidos externos ativos ou prontos, sem mover nem duplicar histórico entregue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-projection-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)), target = store.get(await store.create(dir, 'external'))
    origin.coordinationTurns = [
      { id: 'active', text: 'Verifique o serviço.', at: '', state: 'done' },
      { id: 'ready', text: 'Confira a publicação.', at: '', state: 'done' }
    ]
    origin.messages.push({ id: 'editor-report:old', text: 'Relato antigo já apresentado.', role: 'assistant', origin: 'omni', at: '', channel: 'text' })
    target.messages.push({ id: 'existing', text: 'Conversa anterior da sessão.', role: 'assistant', origin: 'omni', at: '', channel: 'text' })
    target.editorRequests = [
      { id: 'active', text: 'BRIEFING INTERNO GRANDE', at: '', status: 'sent', originConversationId: origin.id },
      { id: 'ready', text: 'OUTRO BRIEFING INTERNO', at: '', status: 'completed', deliveryState: 'ready', originConversationId: origin.id },
      { id: 'old', text: 'Trabalho antigo.', at: '', status: 'completed', summary: 'Relato antigo já apresentado.', originConversationId: origin.id },
      { id: 'delivered', text: 'Outro trabalho entregue.', at: '', status: 'completed', deliveryState: 'delivered', acknowledgedAt: '2026-01-01', originConversationId: origin.id }
    ]
    await store.save()
    const restored = new Store(dir); await restored.load()
    const session = restored.get(target.id)
    assert.deepEqual(restored.get(origin.id).messages, origin.messages)
    assert.deepEqual(session.messages[0], target.messages[0])
    assert.equal(session.messages.length, 3)
    assert.equal(session.messages.filter(message => message.role === 'user').length, 0)
    assert.match(session.messages[1].text, /Verifique o serviço/)
    assert.match(session.messages[2].text, /Confira a publicação/)
    assert.equal(session.messages.some(message => /BRIEFING/.test(message.text)), false)
    assert.equal(session.editorRequests![0].originConversationId, origin.id)
    assert.equal(session.editorRequests![0].deliveryConversationId, target.id)
    assert.equal(session.editorRequests![1].deliveryConversationId, target.id)
    assert.equal(session.editorRequests![2].deliveryConversationId, undefined)
    const again = new Store(dir); await again.load()
    assert.deepEqual(again.get(target.id).messages, session.messages)
  } finally { await rm(dir, { recursive: true }) }
})

test('correções compartilham a projeção original e mensagens diretas do proprietário não são duplicadas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-projection-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)), target = store.get(await store.create(dir, 'external'))
    const original = { id: 'initial', text: 'Briefing interno.', at: '', status: 'sent' as const, originConversationId: origin.id, supervision: { objective: 'Faça e confira o pedido inteiro.', retries: 0, state: 'executing' as const } }
    const correction = { ...original, id: 'correction', followupOf: original.id }
    target.editorRequests = [original, correction]
    assert.equal(store.projectEditorRequest(target, correction), true)
    assert.equal(store.projectEditorRequest(target, original), false)
    assert.equal(target.messages.length, 1); assert.equal(target.messages[0].id, 'editor-forwarded:initial')
    const direct = { id: 'direct', text: 'Briefing.', at: '', status: 'sent' as const, originConversationId: target.id }
    target.messages.push({ id: direct.id, role: 'user', origin: 'owner', text: 'Meu pedido direto.', at: '', channel: 'text' })
    assert.equal(store.projectEditorRequest(target, direct), false)
    assert.equal(target.messages.length, 2)
  } finally { await rm(dir, { recursive: true }) }
})
