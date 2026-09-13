import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Controller } from '../src/main/controller'
import { Store } from '../src/main/store'
import { relayToEditor } from '../src/main/vscode-sessions'
import type { Options, query } from '@anthropic-ai/claude-agent-sdk'
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timeout de teste')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
test('coordenador recebe o contrato do corpo e o estado tipado da interface', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-body-'))
  try {
    const calls: string[] = []
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    const fake = (async function* ({ options }: { options: Options }) {
      assert.match(String(options.systemPrompt), /CORPO DO OMNI DESKTOP/)
      assert.match(String(options.systemPrompt), /central-chat/)
      assert.match(String(options.systemPrompt), /controller-state-and-typed-ipc/)
      yield { type: 'result', subtype: 'success', result: '', is_error: false, structured_output: { reply: 'Corpo reconhecido.', action: 'reply', sessionId: null, instruction: null } }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules('PERSONALIDADE', calls))
    await controller.send(id, 'Onde estou?')
    await until(() => ['done', 'failed'].includes(store.get(id).coordinationTurns?.[0].state || ''))
    assert.equal(store.get(id).coordinationTurns?.[0].state, 'done', store.get(id).coordinationTurns?.[0].error)
    assert.match(store.get(id).messages.at(-1)!.text, /Corpo reconhecido/)
  } finally { await rm(dir, { recursive: true }) }
})
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
    const store = new Store(dir); await store.load(); const id = await store.create(dir, 'task')
    const controller = new Controller(store, () => {}, fake, modules('PERSONALIDADE E MEMORIA CANONICAS', calls))
    await controller.send(id, 'Primeiro turno', 'text')
    await controller.send(id, 'Segundo turno', 'voice')
    assert.equal(store.get(id).phase, 'completed')
    assert.equal(options[0].permissionMode, 'bypassPermissions')
    assert.equal(options[0].allowDangerouslySkipPermissions, true)
    assert.equal(options[0].canUseTool, undefined)
    assert.equal(options[0].sessionId, options[1].resume)
    assert.equal(calls.filter(c => c === 'memory-sync').length, 2)
    assert.equal(calls.filter(c => c === 'mission-sync').length, 2)
    assert.equal(store.get(id).messages[2].channel, 'voice')
  } finally { await rm(dir, { recursive: true }) }
})
test('falha de contexto impede inferência genérica e preserva o pedido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const id = await store.create(dir, 'task')
    const fake = (() => { throw new Error('NÃO DEVERIA CHAMAR O PROVEDOR') }) as typeof query
    const controller = new Controller(store, () => {}, fake, modules('', []))
    await controller.send(id, 'Pedido preservado')
    assert.equal(store.get(id).phase, 'failed')
    assert.equal(store.get(id).messages[0].text, 'Pedido preservado')
    assert.match(store.get(id).events.at(-1)!.text, /contexto canônico/)
  } finally { await rm(dir, { recursive: true }) }
})
test('resultado final não reescreve texto já transmitido ao proprietário', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const id = await store.create(dir, 'task')
    const fake = (async function* () {
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Resposta transmitida.' } } }
      yield { type: 'result', subtype: 'success', result: 'Resumo regenerado e diferente.', is_error: false }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules('Contexto', []))
    await controller.send(id, 'Pergunta')
    assert.equal(store.get(id).messages.at(-1)!.text, 'Resposta transmitida.')
  } finally { await rm(dir, { recursive: true }) }
})
test('uma sessão não aceita dois envios concorrentes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const id = await store.create(dir, 'task')
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
test('chat central avalia subagente e entrega automaticamente sem clique', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-controller-'))
  try {
    const store = new Store(dir); await store.load(); const parentId = await store.create(dir)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const fake = (async function* (input: { prompt: string; options: Options }) {
      if (input.prompt === 'Tarefa principal') await gate
      yield { type: 'result', subtype: 'success', result: 'ok', is_error: false, ...(input.options.outputFormat ? { structured_output: { action: 'complete', message: 'Entrega conferida pelo executor.', instruction: null, withinScope: true, needsOwner: false } } : {}) }
    }) as unknown as typeof query
    let latest: ReturnType<Controller['snapshot']> | undefined
    const controller = new Controller(store, snapshot => { latest = snapshot }, fake, modules('Contexto', []))
    await controller.delegate(parentId, 'Tarefa principal')
    const childId = store.conversations.find(conversation => conversation.parentConversationId === parentId)!.id
    while (!controller.active.has(childId)) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(controller.active.has(parentId), false)
    assert.ok(latest!.state.activities.some(item => item.conversationId === childId && item.source === 'omni'))
    release()
    while (controller.active.has(childId)) await new Promise(resolve => setTimeout(resolve, 1))
    while (!store.get(parentId).events.some(event => event.kind === 'subagent-ready')) await new Promise(resolve => setTimeout(resolve, 1))
    await until(() => !!store.get(childId).acknowledgedAt && !latest!.state.activities.some(item => item.conversationId === childId))
    assert.equal(store.get(childId).messages[0].text, 'Tarefa principal')
    assert.match(store.get(parentId).messages.at(-1)!.text, /Entrega conferida/)
    assert.ok(!latest!.state.activities.some(item => item.conversationId === childId))
    const count = store.get(parentId).messages.length
    await controller.consumeTask(childId)
    assert.equal(store.get(parentId).messages.length, count)
  } finally { await rm(dir, { recursive: true }) }
})
test('resultado do subagente só vai ao pai central; sessão externa nunca delega nem executa localmente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-routing-'))
  try {
    const store = new Store(dir); await store.load()
    const parent = await store.create(dir)
    const external = await store.create(dir, 'external')
    const child = await store.create(dir, 'task', parent)
    store.get(child).phase = 'completed'
    store.get(child).messages.push({ id: 'result', role: 'assistant', text: 'Relatório exclusivo da tarefa', at: '', channel: 'text' })
    store.get(parent).messages.push({ id: 'legacy-report', role: 'assistant', text: `**${store.get(child).title}** concluiu.\n\nRelatório exclusivo da tarefa`, at: '', channel: 'text' })
    const controller = new Controller(store, () => {}, (() => { throw new Error('Executor local não deveria ser chamado') }) as typeof query, modules('Contexto', []))
    assert.equal(await controller.consumeTask(child), parent)
    assert.match(store.get(parent).messages.at(-1)!.text, /Relatório exclusivo/)
    assert.equal(store.get(parent).messages.length, 1)
    assert.equal(store.get(parent).messages[0].id, `report:${child}`)
    assert.equal(store.get(external).messages.length, 0)
    await assert.rejects(controller.delegate(external, 'Executar no editor'), /só podem ser criados pelo chat central/)
    await assert.rejects(controller.send(external, 'Executar no editor'), /não está ativa/)
  } finally { await rm(dir, { recursive: true }) }
})
test('mensageiro fixa destinatário e conteúdo, bloqueia execução local e não repete envio', async () => {
  const session = { cwd: process.cwd(), sessionId: '22222222-2222-4222-8222-222222222222', name: 'editor', pid: 1, address: 'uds:destination' }
  let calls = 0
  const fake = (async function* ({ options }: { options: Options }) {
    assert.deepEqual(options.tools, ['SendMessage', 'ListAgents', 'ToolSearch'])
    assert.equal(options.maxBudgetUsd, 0.75)
    const permission = options.canUseTool as (tool: string, input: Record<string, unknown>) => Promise<any>
    assert.equal((await permission('Bash', { command: 'executar localmente' })).behavior, 'deny')
    const approved = await permission('SendMessage', { to: 'wrong-session', message: 'wrong-content' })
    assert.equal(approved.updatedInput.to, session.address)
    assert.match(approved.updatedInput.message, /request:request-test/)
    assert.match(approved.updatedInput.message, /Omni Desktop authority:v1/)
    assert.match(approved.updatedInput.message, /Não peça ao proprietário para repetir/)
    assert.match(approved.updatedInput.message, /comando original/)
    assert.equal((await permission('SendMessage', {})).behavior, 'deny')
    calls++
    yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'delivery', name: 'SendMessage' }] } }
    yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'delivery', content: [{ type: 'text', text: '{"success":true}' }] }] } }
  }) as unknown as typeof query
  await relayToEditor(session, 'comando original', 'request-test', new AbortController(), fake)
  assert.equal(calls, 1)
})
