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
