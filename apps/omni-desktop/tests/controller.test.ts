import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Controller } from '../src/main/controller'
import { Store } from '../src/main/store'
import { bodyContext, loadBodyContract } from '../src/main/body-contract'
import { relayToEditor } from '../src/main/vscode-sessions'
import { root } from '../src/main/runtime'
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
    let planCalls = 0; let publicCalls = 0
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    const fake = (async function* ({ options }: { options: Options }) {
      assert.match(String(options.systemPrompt), /CORPO DO OMNI DESKTOP/)
      assert.match(String(options.systemPrompt), /central-chat/)
      assert.match(String(options.systemPrompt), /controller-state-and-typed-ipc/)
      if (options.outputFormat) {
        planCalls++
        yield { type: 'result', subtype: 'success', result: '', is_error: false, structured_output: { reply: 'Corpo reconhecido.', action: 'reply', sessionId: null, instruction: null } }
      } else {
        publicCalls++
        yield { type: 'result', subtype: 'success', result: 'Corpo reconhecido.', is_error: false }
      }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules('PERSONALIDADE', calls))
    await controller.send(id, 'Onde estou?')
    await until(() => ['done', 'failed'].includes(store.get(id).coordinationTurns?.[0].state || ''))
    assert.equal(store.get(id).coordinationTurns?.[0].state, 'done', store.get(id).coordinationTurns?.[0].error)
    assert.match(store.get(id).messages.at(-1)!.text, /Corpo reconhecido/)
    assert.equal(planCalls, 1)
    assert.equal(publicCalls, 1)
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

for (const failure of ['assertIdle', 'stat'] as const) test(`delegação comunica falha de preflight ${failure} sem iniciar executor nem manter card rodando`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-delegate-preflight-'))
  try {
    const store = new Store(dir); await store.load()
    const parent = store.get(await store.create(dir))
    let executorCalls = 0; let reviewCalls = 0
    const fake = (async function* ({ options }: { options: Options }) {
      if (!options.outputFormat) { executorCalls++; throw new Error('Executor não deve iniciar.') }
      reviewCalls++
      yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'decision', message: 'A preparação falhou; o pedido foi preservado sem execução.', instruction: null, withinScope: true, needsOwner: false } }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, { ...modules('CONTEXTO DE TESTE', []), sessions: async () => [] })
    controller.assertIdle = async conversation => {
      if (failure === 'assertIdle') throw new Error('Preflight indisponível sk-ficticia-nao-real')
      conversation.workspace = join(dir, 'workspace-inexistente')
    }
    const taskId = await controller.delegate(parent.id, 'Confira o estado local sem alterar nada.')
    const child = store.get(taskId)
    await until(() => child.deliveryState === 'ready' && child.supervision?.state === 'settled')
    assert.equal(child.phase, 'failed')
    assert.equal(child.sessionId, null)
    assert.equal(executorCalls, 0)
    assert.equal(reviewCalls, 1)
    assert.equal(child.supervision?.retries, 0)
    assert.match(child.resultText!, /não iniciou a execução/)
    assert.equal(child.messages.find(message => message.role === 'user')?.text, 'Confira o estado local sem alterar nada.')
    assert.ok(parent.messages.some(message => message.id === `task-ready:${taskId}`))
    assert.ok(!controller.active.has(taskId))
    assert.ok(!JSON.stringify(child).includes('sk-ficticia-nao-real'))
    await store.save()
    const restored = new Store(dir); await restored.load()
    assert.equal(restored.get(taskId).phase, 'failed')
    assert.equal(restored.get(taskId).deliveryState, 'ready')
  } finally { await rm(dir, { recursive: true }) }
})

test('projeção do corpo cabe no limite mesmo com muitos resultados simultâneos', async () => {
  const contract = await loadBodyContract()
  const c = { id: 'central', kind: 'central', sessionId: null, workspace: '.', editorRequests: Array.from({ length: 40 }, (_, i) => ({ targetName: `Sessão ${i}`, status: 'completed', report: 'Relato', deliveryState: 'ready' })) } as any
  const state = { voice: false, activities: Array.from({ length: 40 }, (_, i) => ({ conversationId: 'central', source: 'omni', status: 'ready', title: `Tarefa ${i}`, detail: 'Retorno aguardando leitura '.repeat(10) })) } as any
  const projected = bodyContext(contract, c, state)
  assert.ok(projected.length <= contract.projection.maximumCharacters)
  assert.match(projected, /liberar-retorno-final/)
  assert.match(projected, /"activityCount":40/)
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
test('chat central avalia subagente e mantém entrega no card até liberação', async () => {
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
    assert.equal(store.get(childId).acknowledgedAt, undefined)
    assert.equal(store.get(parentId).messages.some(m => m.id === `report:${childId}`), false)
    assert.equal(await controller.releaseResult(childId), parentId)
    await until(() => !!store.get(childId).acknowledgedAt && !latest!.state.activities.some(item => item.conversationId === childId))
    assert.equal(store.get(childId).messages[0].text, 'Tarefa principal')
    assert.match(store.get(parentId).messages.at(-1)!.text, /ok/)
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
test('aberturas concorrentes de sessoes no mesmo projeto preservam conversas distintas e identidade exata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-binding-'))
  try {
    const store = new Store(dir); await store.load()
    const a = { sessionId: '11111111-1111-4111-8111-111111111111', name: 'projeto-a', cwd: dir, address: 'uds:a', pid: 1 }
    const b = { ...a, sessionId: '22222222-2222-4222-8222-222222222222', name: 'projeto-b', address: 'uds:b' }
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferencia esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [a, b],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [] })
    })
    await assert.rejects(controller.openVsCodeConversation(dir, 'Projeto'), /várias sessões/)
    const [idA, idB, sameA] = await Promise.all([
      controller.openVsCodeConversation(dir, a.name, a.sessionId),
      controller.openVsCodeConversation(dir, b.name, b.sessionId),
      controller.openVsCodeConversation(dir, a.name, a.sessionId)
    ])
    assert.notEqual(idA, idB); assert.equal(idA, sameA)
    assert.equal(store.get(idA).sessionId, a.sessionId)
    assert.equal(store.get(idB).sessionId, b.sessionId)
    assert.equal(store.conversations.filter(c => c.kind === 'external').length, 2)
    await store.save(); const restored = new Store(dir); await restored.load()
    assert.equal(restored.get(idA).sessionId, a.sessionId)
    assert.equal(restored.get(idB).sessionId, b.sessionId)
  } finally { await rm(dir, { recursive: true }) }
})

test('sessao legada sem host conserva conversa e historico sem escolher por workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-legacy-'))
  try {
    const store = new Store(dir); await store.load()
    const existingId = await store.create(dir, 'external'), existing = store.get(existingId)
    const session = { sessionId: '33333333-3333-4333-8333-333333333333', name: 'projeto', cwd: dir, address: 'uds:legacy', pid: 1 }
    existing.sessionId = session.sessionId
    existing.messages.push({ id: 'old', text: 'Historico preservado', role: 'assistant', channel: 'text', at: '' })
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferencia esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [] })
    })
    assert.equal(await controller.openVsCodeConversation(dir, session.name, session.sessionId), existingId)
    assert.equal(store.conversations.length, 1); assert.equal(existing.host, 'vscode')
    assert.equal(existing.messages[0].text, 'Historico preservado')
    existing.workspace = join(dir, 'outro-projeto')
    await assert.rejects(controller.openVsCodeConversation(dir, session.name, session.sessionId), /outro projeto/)
    assert.equal(store.conversations.length, 1); assert.equal(existing.sessionId, session.sessionId)
  } finally { await rm(dir, { recursive: true }) }
})

test('caixa tecnica coleta retorno sem abrir card e mantem correlacao apos fechar a sessao', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-relay-inbox-'))
  try {
    const store = new Store(dir); await store.load()
    const originId = await store.create(dir), targetId = await store.create(dir, 'external'), target = store.get(targetId)
    const editor = { sessionId: '44444444-4444-4444-8444-444444444444', name: 'editor', cwd: dir, address: 'uds:editor', pid: 1 }
    const inbox = { sessionId: '55555555-5555-4555-8555-555555555555', name: 'omni-inbox', cwd: root, address: 'uds:inbox', pid: 2 }
    target.sessionId = editor.sessionId; target.host = 'vscode'; target.editorProjectionVersion = 2
    const makeRequest = (id: string) => ({ id, text: 'Conferir projeto', at: '2026-09-13T00:00:00Z', status: 'sent' as const, originConversationId: originId, deliveryConversationId: targetId, targetSessionId: editor.sessionId, targetName: editor.name })
    const first = makeRequest('66666666-6666-4666-8666-666666666666')
    const second = makeRequest('77777777-7777-4777-8777-777777777777')
    const rejected = makeRequest('88888888-8888-4888-8888-888888888888')
    target.editorRequests = [first, second, rejected]
    let online = true, mailboxReads = 0
    const controller = new Controller(store, () => {}, (() => { throw new Error('Recebimento nao inicia inferencia') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => online ? [editor, inbox] : [editor],
      readEditor: async session => {
        if (session.sessionId !== inbox.sessionId) return { messages: [], observations: [], relayInbox: [] }
        mailboxReads++
        const request = online ? first : second
        return { messages: [], observations: [], relayInbox: [
          { requestId: rejected.id, fromName: 'sessao-alheia', kind: 'received', at: '2026-09-13T00:00:01Z', evidenceId: 'wrong-sender', text: 'Recebido' },
          { requestId: request.id, fromName: editor.name, kind: 'received', at: '2026-09-13T00:00:01Z', evidenceId: online ? 'receipt-a' : 'receipt-b', text: 'Recebido' }
        ] }
      }
    })
    await controller.refresh()
    assert.equal(first.status, 'received'); assert.equal(second.status, 'sent'); assert.equal(rejected.status, 'sent')
    assert.equal(mailboxReads, 1); assert.equal(store.conversations.some(c => c.sessionId === inbox.sessionId), false)
    online = false
    await controller.refresh()
    assert.equal(second.status, 'received'); assert.equal(rejected.status, 'sent'); assert.equal(mailboxReads, 2)
    assert.equal(target.editorRequests[0].originConversationId, originId)
    assert.equal(target.editorRequests[0].deliveryConversationId, targetId)
    assert.equal(store.conversations.length, 2)
    const restored = new Store(dir); await restored.load()
    assert.equal(restored.get(targetId).editorRequests?.[1].status, 'received')
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
