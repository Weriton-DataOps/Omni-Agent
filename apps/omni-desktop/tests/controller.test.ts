import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Controller } from '../src/main/controller'
import { Store } from '../src/main/store'
import type { Options, query } from '@anthropic-ai/claude-agent-sdk'
const modules = (context: string, calls: string[]) => ({
  loadModule: async (path: string) => {
    if (path.includes('activation-store')) return { ClaudeActivationStore: class { async activate() { calls.push('activate'); return { gravados: 1 } } } }
    if (path.includes('hook-contexto')) return { tratarHook: async () => { calls.push('context'); return { hookSpecificOutput: { additionalContext: context } } } }
    if (path.includes('sincronizacao-memoria')) return { sincronizarMemoriaDuravel: async () => { calls.push('memory-sync') } }
    if (path.includes('sincronizacao-missoes')) return { sincronizarMissoesDuraveis: async () => { calls.push('mission-sync') } }
    return { lerMemoria: async () => ({ confirmed: [], candidates: [] }) }
  },
  getBroker: async () => ({ health: async () => ({ status: 'ready' }), listActiveMissions: async () => [] }),
  executable: async () => 'claude-test.exe'
})
test('texto e voz recebem contexto antes da inferência, com sincronização e retomada do mesmo ID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const calls: string[] = []; const options: Options[] = []
    const fake = (async function* (input: { options: Options }) {
      assert.equal(calls.at(-1), 'context')
      assert.match((input.options.systemPrompt as { append: string }).append, /PERSONALIDADE E MEMORIA CANONICAS/)
      options.push(input.options); calls.push('query')
      yield { type: 'result', subtype: 'success', result: 'Resposta de teste', session_id: input.options.sessionId || input.options.resume, is_error: false }
    }) as unknown as typeof query
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    const controller = new Controller(store, () => {}, fake, modules('PERSONALIDADE E MEMORIA CANONICAS', calls))
    await controller.send(id, 'Primeiro turno', 'text')
    await controller.send(id, 'Segundo turno', 'voice')
    assert.equal(store.get(id).phase, 'completed')
    assert.equal(options[0].sessionId, options[1].resume)
    assert.equal(calls.filter(c => c === 'memory-sync').length, 2)
    assert.equal(calls.filter(c => c === 'mission-sync').length, 2)
    assert.equal(store.get(id).messages[2].channel, 'voice')
  } finally { await rm(dir, { recursive: true }) }
})
test('falha de contexto impede inferência genérica e preserva o pedido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    const fake = (() => { throw new Error('NÃO DEVERIA CHAMAR O PROVEDOR') }) as typeof query
    const controller = new Controller(store, () => {}, fake, modules('', []))
    await controller.send(id, 'Pedido preservado')
    assert.equal(store.get(id).phase, 'failed')
    assert.equal(store.get(id).messages[0].text, 'Pedido preservado')
    assert.match(store.get(id).events.at(-1)!.text, /contexto canônico/)
  } finally { await rm(dir, { recursive: true }) }
})
test('uma sessão não aceita dois envios concorrentes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const fake = (async function* () { await gate; yield { type: 'result', subtype: 'success', result: 'ok', is_error: false } }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules('Contexto', []))
    const first = controller.send(id, 'Um')
    while (!controller.active.has(id)) await new Promise(resolve => setTimeout(resolve, 1))
    await assert.rejects(controller.send(id, 'Dois'), /trabalhando/)
    release(); await first
    assert.equal(store.get(id).messages.filter(m => m.role === 'user').length, 1)
  } finally { await rm(dir, { recursive: true }) }
})
test('nova instrução pode virar tarefa paralela sem interromper a conversa original', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const parentId = await store.create(dir)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const fake = (async function* (input: { prompt: string }) {
      if (input.prompt === 'Tarefa principal') await gate
      yield { type: 'result', subtype: 'success', result: 'ok', is_error: false }
    }) as unknown as typeof query
    let latest: ReturnType<Controller['snapshot']> | undefined
    const controller = new Controller(store, snapshot => { latest = snapshot }, fake, modules('Contexto', []))
    const main = controller.send(parentId, 'Tarefa principal')
    while (!controller.active.has(parentId)) await new Promise(resolve => setTimeout(resolve, 1))
    const childId = await controller.delegate(parentId, 'Segunda tarefa')
    assert.notEqual(childId, parentId)
    while (!controller.active.has(childId)) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(controller.active.has(parentId), true)
    assert.ok(latest!.state.activities.some(item => item.conversationId === parentId && item.source === 'omni'))
    assert.ok(latest!.state.activities.some(item => item.conversationId === childId && item.source === 'omni'))
    release(); await main
    while (controller.active.has(childId)) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(store.get(childId).messages[0].text, 'Segunda tarefa')
  } finally { await rm(dir, { recursive: true }) }
})
