import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Controller } from '../src/main/controller'
import { Store } from '../src/main/store'
import { bodyContext, loadBodyContract } from '../src/main/body-contract'
import { relayToEditor } from '../src/main/vscode-sessions'
import { root } from '../src/main/runtime'
import type { Options, query } from '@anthropic-ai/claude-agent-sdk'
import type { EditorRequest } from '../src/shared/contracts'
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
      assert.match(String(options.systemPrompt), /"postgresql":"local via broker"/)
      assert.match(String(options.systemPrompt), /"secretBoundary":"senhas admin\/runtime: cofre do Windows, nunca Crachá\/chat"/)
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
    await until(() => ['done', 'failed'].includes(store.get(id).coordinationTurns?.[0].state || '') && store.get(id).messages.some(message => message.role === 'assistant' && !message.streaming) && controller.active.size === 0)
    assert.equal(store.get(id).coordinationTurns?.[0].state, 'done', store.get(id).coordinationTurns?.[0].error)
    assert.match(store.get(id).messages.at(-1)!.text, /Corpo reconhecido/)
    assert.equal(planCalls, 1)
    assert.equal(publicCalls, 1)
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
const modules = (context: string, calls: string[]) => ({
  loadModule: async (path: string) => {
    if (path.includes('automacao-melhorias')) return { ativarAprendizadosOperacionais: async () => ({ memoryIds: [] }) }
    if (path.includes('aprendizado-resultados')) return { aprenderResultado: async () => ({ result: 'ineligible', memoryIds: [] }) }
    if (path.includes('auditoria-desktop')) return { auditarDesktop: async () => ({ findings: 0, recorded: 0 }) }
    if (path.includes('activation-store')) return { ClaudeActivationStore: class { async activate() { calls.push('activate'); return { gravados: 1 } } } }
    if (path.includes('hook-contexto')) return { tratarHook: async () => { calls.push('context'); return { hookSpecificOutput: { additionalContext: context } } } }
    if (path.includes('sincronizacao-memoria')) return { sincronizarMemoriaDuravel: async () => { calls.push('memory-sync'); return { result: 'synced' } } }
    if (path.includes('sincronizacao-missoes')) return { sincronizarMissoesDuraveis: async () => { calls.push('mission-sync') } }
    if (path.includes('sincronizacao-aprendizado-operacional')) return { sincronizarAprendizadoOperacional: async () => { calls.push('learning-sync') } }
    return { lerMemoria: async () => ({ confirmed: [], candidates: [] }) }
  },
  getBroker: async () => ({ health: async () => ({ status: 'ready' }), listActiveMissions: async () => [] }),
  executable: async () => 'claude-test.exe'
})

test('aprendizado pendente retoma após falha do banco sem reexecutar a tarefa', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-result-learning-'))
  try {
    const store = new Store(dir); await store.load()
    const card = store.get(await store.create(dir, 'external'))
    const supervision = { objective: 'Conferir projeto', state: 'settled' as const, retries: 0,
      review: { action: 'complete' as const, message: 'Resultado conferido no projeto.', instruction: null, withinScope: true, needsOwner: false } }
    card.editorRequests = [{ id: 'r-learning', text: supervision.objective, at: new Date().toISOString(), status: 'completed', report: 'Resultado conferido no projeto.', supervision }]
    const dependencies = modules('Contexto', [])
    let writes = 0; let syncs = 0
    const controller = new Controller(store, () => {}, (() => { throw new Error('Não deve consultar modelo nem reenviar tarefa') }) as typeof query, {
      ...dependencies,
      loadModule: async path => {
        if (path.includes('aprendizado-resultados')) return { aprenderResultado: async (_home: string, input: { requestId: string }) => {
          writes++
          if (input.requestId === 'bad-learning') throw new Error('Falha isolada de gravação')
          return { result: 'learned', memoryIds: ['mem-learning'] }
        } }
        if (path.includes('sincronizacao-memoria')) return { sincronizarMemoriaDuravel: async () => ({ result: ++syncs === 1 ? 'partial' : 'synced' }) }
        return dependencies.loadModule(path)
      }
    })
    const internal = controller as unknown as { resumeLearning(): Promise<void> }
    await internal.resumeLearning()
    assert.equal(card.editorRequests[0].supervision?.learningReceipt?.synchronized, false)
    await internal.resumeLearning()
    assert.equal(card.editorRequests[0].supervision?.learningReceipt?.synchronized, true)
    assert.equal(card.editorRequests[0].status, 'completed')
    assert.equal(writes, 2)
    assert.equal(card.events.filter(event => event.kind === 'result-learning').length, 1)
    await internal.resumeLearning()
    assert.equal(writes, 2)
    const reopened = new Store(dir); await reopened.load()
    assert.deepEqual(reopened.get(card.id).editorRequests![0].supervision!.learningReceipt!.memoryIds, ['mem-learning'])
    const makeRequest = (id: string): EditorRequest => ({ id, text: 'Conferir', at: new Date().toISOString(), status: 'completed', report: 'Resultado conferido.', supervision: { ...supervision, learningReceipt: undefined } })
    card.editorRequests.push(makeRequest('good-learning'), makeRequest('bad-learning'))
    await internal.resumeLearning()
    assert.equal(card.editorRequests.find(r => r.id === 'good-learning')?.supervision?.learningReceipt?.synchronized, true)
    assert.ok(card.editorRequests.find(r => r.id === 'bad-learning')?.supervision?.learningRetryAt)
    const attempts = writes
    await internal.resumeLearning()
    assert.equal(writes, attempts, 'registro com falha respeita backoff e não bloqueia os demais')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

for (const failure of ['assertIdle', 'stat'] as const) test(`delegação comunica falha de preflight ${failure} sem iniciar executor nem manter card rodando`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-delegate-preflight-'))
  try {
    const store = new Store(dir); await store.load()
    const parent = store.get(await store.create(dir))
    let executorCalls = 0; let reviewCalls = 0; let preparationCalls = 0
    const fake = (async function* ({ options }: { options: Options }) {
      if (!options.outputFormat) {
        if (Array.isArray(options.tools) && options.tools.length === 0) { preparationCalls++; yield { type: 'result', subtype: 'success', is_error: false, result: 'O pedido foi preservado sem execução.' }; return }
        executorCalls++; throw new Error('Executor não deve iniciar.')
      }
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
    await until(() => controller.snapshot().results?.find(ticket => ticket.id === taskId)?.state === 'ready' && child.supervision?.state === 'settled' && controller.active.size === 0)
    assert.equal(child.phase, 'failed')
    assert.equal(child.sessionId, null)
    assert.equal(executorCalls, 0)
    assert.equal(reviewCalls, 1)
    assert.equal(preparationCalls, 1)
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('delegação coordenada usa o pedido do proprietário e a raiz do Omni quando o card central tem caminho antigo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-delegate-runtime-workspace-'))
  try {
    const store = new Store(dir); await store.load()
    const parent = store.get(await store.create(join(dir, 'central-antiga-inexistente')))
    parent.coordinationTurns = [{ id: 'owner-turn', at: new Date().toISOString(), text: 'Pesquise e compare os provedores de e-mail.', state: 'planned' }]
    const prompts: string[] = []
    const fake = (async function* ({ prompt, options }: { prompt: string; options: Options }) {
      prompts.push(prompt)
      if (options.outputFormat) {
        yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'complete', message: 'Resultado conferido.', instruction: null, withinScope: true, needsOwner: false } }
      } else yield { type: 'result', subtype: 'success', is_error: false, result: 'Pesquisa concluída.' }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules('Contexto', []))
    const taskId = await controller.delegate(parent.id, 'Compare opções; não use C:\\caminho-modelo-inexistente como destino.', 'text', 'owner-turn')
    const task = store.get(taskId)
    assert.equal(task.workspace, root)
    await until(() => task.deliveryState === 'ready' && controller.active.size === 0)
    // The delivery queue is scheduled by emit(); let its final persistence
    // settle before this fixture removes its temporary store.
    await new Promise(resolve => setTimeout(resolve, 30))
    controller.prepareShutdown()
    assert.match(prompts[0], /caminho-modelo-inexistente/)
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('projeção do corpo cabe no limite mesmo com muitos resultados simultâneos', async () => {
  const contract = await loadBodyContract()
  const c = { id: 'central', kind: 'central', sessionId: null, workspace: '.', editorRequests: Array.from({ length: 40 }, (_, i) => ({ targetName: `Sessão ${i}`, status: 'completed', report: 'Relato', deliveryState: 'ready' })) } as any
  const state = { voice: false, activities: Array.from({ length: 40 }, (_, i) => ({ conversationId: 'central', source: 'omni', status: 'ready', title: `Tarefa ${i}`, detail: 'Retorno aguardando leitura '.repeat(10) })) } as any
  const projected = bodyContext(contract, c, state)
  assert.ok(projected.length <= contract.projection.maximumCharacters)
  assert.match(projected, /liberar-retorno-final/)
  assert.match(projected, /"activityCount":40/)
  assert.match(projected, /"postgresql":"local via broker"/)
  assert.match(projected, /"secretBoundary":"senhas admin\/runtime: cofre do Windows, nunca Crachá\/chat"/)
})

test('execução longa mantém azul e end_turn apaga mesmo com recibo recente pendente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-activity-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: '99999999-9999-4999-8999-999999999999', name: 'financas', cwd: dir, address: 'uds:financas', pid: 1 }
    conversation.sessionId = session.sessionId; conversation.host = 'vscode'
    conversation.editorRequests = [{
      id: 'request-activity', text: 'Estruturar a base financeira.', at: new Date(Date.now() - 4 * 60_000).toISOString(),
      lastObservedAt: new Date(Date.now() - 4 * 60_000).toISOString(), status: 'received', originConversationId: id,
      deliveryConversationId: id, targetSessionId: session.sessionId, targetName: session.name
    }]
    let execution: 'running' | 'idle' = 'running'
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: execution, at: new Date(Date.now() - 60 * 60_000).toISOString() } })
    })
    await controller.refresh()
    assert.equal(controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)?.status, 'running')

    conversation.editorRequests[0].lastObservedAt = new Date().toISOString()
    execution = 'idle'
    await controller.refresh()
    const activity = controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)
    assert.equal(activity?.status, 'waiting')
    assert.equal(activity?.detail, 'Pedido recebido · aguardando início da execução')
    assert.doesNotMatch(activity!.detail, /ociosa/)
    assert.equal(conversation.editorRequests[0].status, 'received', 'ociosidade não prova conclusão da tarefa')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('planejamento de mensagem em card VS Code fica no próprio card, nunca em OMNI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-card-planning-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: '99999999-9999-4999-8999-999999999999', name: 'tracking', cwd: dir, address: 'uds:tracking', pid: 1 }
    conversation.sessionId = session.sessionId; conversation.host = 'vscode'
    conversation.coordinationTurns = [{ id: 'turn-tracking', text: 'Conferir os três sites.', at: new Date().toISOString(), state: 'planning' }]
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: 'idle', at: new Date().toISOString() } })
    })
    await controller.refresh()
    const card = controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)!
    assert.equal(card.source, 'vscode'); assert.equal(card.status, 'running')
    assert.match(card.detail, /entendendo o pedido neste card/)
    assert.equal(controller.snapshot().state.activities.some(activity => activity.source === 'omni' && activity.conversationId === id), false)
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('pergunta antiga de acompanhamento não mantém o card VS Code em execução', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-status-probe-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: '99999999-9999-4999-8999-999999999999', name: 'station', cwd: dir, address: 'uds:station', pid: 1 }
    conversation.sessionId = session.sessionId
    conversation.editorRequests = [{ id: 'status-probe', text: 'já finalizou lá?', at: new Date().toISOString(), status: 'sent', originConversationId: id, deliveryConversationId: id, targetSessionId: session.sessionId, targetName: session.name }]
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, { ...modules('Contexto', []), sessions: async () => [session] })
    await controller.refresh()
    assert.equal(controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)?.status, 'waiting')
    assert.equal(controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)?.detail, 'Estado da execução indisponível')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('monitor prepara resposta atual e clique publica sem nova inferência, reenvio ou confirmação do pedido antigo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-current-return-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: '99999999-9999-4999-8999-999999999999', name: 'growth-test', cwd: dir, address: 'uds:growth', pid: 1 }
    conversation.sessionId = session.sessionId; conversation.host = 'vscode'
    conversation.editorRequests = [{ id: 'older-request', text: 'Proposta antiga', at: '2026-09-14T13:51:00.000Z', status: 'completed', report: 'Fontes', summary: 'Resumo antigo', deliveryState: 'ready' }]
    let response = { id: `editor-response:${session.sessionId}:one`, sessionId: session.sessionId, turnId: 'direct-user', evidenceId: 'one', at: '2026-09-14T17:53:22.000Z', objective: 'LP atual', report: 'Diagnóstico atual', deliveryState: 'ready' as const }
    let execution: 'running' | 'idle' = 'running'
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência ou executor esperado') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: execution }, latestReturn: { ...response } })
    })
    let preparations = 0
    controller.coordinator.summarize = async (_c, _objective, report) => { preparations++; return report }
    await controller.refresh()
    await until(() => controller.snapshot().results?.find(ticket => ticket.id === response.id)?.state === 'ready' && controller.active.size === 0)
    const card = controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)!
    assert.equal(card.status, 'running'); assert.equal(card.attention, undefined, 'execução tem prioridade; não mostra verde para resposta anterior')
    assert.equal(controller.snapshot().results![0].id, response.id)
    const oldId = response.id
    response = { ...response, id: `editor-response:${session.sessionId}:two`, evidenceId: 'two', at: '2026-09-14T18:01:00.000Z', report: 'Resultado novo' }
    await assert.rejects(controller.releaseResult(oldId), /outra execução|atualizada/)
    assert.equal(conversation.messages.length, 0)
    await until(() => controller.snapshot().results?.find(ticket => ticket.id === response.id)?.state === 'ready' && controller.active.size === 0)
    const beforeClick = preparations
    await assert.rejects(controller.releaseResult(response.id), /outra execução/)
    execution = 'idle'
    await controller.releaseResult(response.id)
    await until(() => !!conversation.editorReturn?.acknowledgedAt && !controller.active.size)
    execution = 'running'
    await controller.refresh()
    assert.equal(conversation.messages.length, 1); assert.equal(conversation.messages[0].text, 'Resultado novo')
    assert.equal(preparations, beforeClick)
    assert.equal(controller.snapshot().results!.some(ticket => ticket.id === response.id), false)
    assert.equal(conversation.editorRequests.length, 1); assert.equal(conversation.editorRequests[0].acknowledgedAt, undefined)
    assert.equal(controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)?.status, 'running')
    await store.save()
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('comando apenas enviado aguarda confirmação sem acender o sinal azul', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-sent-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: '88888888-8888-4888-8888-888888888888', name: 'station', cwd: dir, address: 'uds:station', pid: 1 }
    conversation.sessionId = session.sessionId
    conversation.editorRequests = [{ id: 'sent-command', text: 'Corrigir template.', at: new Date().toISOString(), lastObservedAt: new Date().toISOString(), status: 'sent', originConversationId: id, deliveryConversationId: id, targetSessionId: session.sessionId, targetName: session.name }]
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, { ...modules('Contexto', []), sessions: async () => [session] })
    await controller.refresh()
    const activity = controller.snapshot().state.activities.find(activity => activity.sessionId === session.sessionId)
    assert.equal(activity?.status, 'waiting')
    assert.equal(activity?.detail, 'Comando enviado · aguardando início no VS Code')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('sessão VS Code desconectada mantém amarelo para entrega sem confirmação', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-offline-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    conversation.sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    conversation.editorOnline = true
    conversation.editorRequests = [{ id: 'offline-command', text: 'Corrigir a integração.', at: new Date().toISOString(), status: 'sent', originConversationId: id, deliveryConversationId: id, targetSessionId: conversation.sessionId, targetName: 'serra' }]
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: 'unknown', at: new Date().toISOString() } })
    })
    await controller.refresh()
    const activity = controller.snapshot().state.activities.find(item => item.conversationId === id)
    assert.equal(conversation.editorOnline, false)
    assert.equal(activity?.status, 'waiting')
    assert.equal(activity?.detail, 'Entrega não confirmada · sessão desconectada')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('sessão VS Code reiniciada religa um único card pendente sem repetir a entrega antiga', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-rebind-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const oldSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const replacement = { sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'serra', cwd: dir, address: 'uds:serra', pid: 1 }
    conversation.sessionId = oldSession
    conversation.editorRequests = [{ id: 'prior-command', text: 'Ajustar domínio.', at: new Date().toISOString(), status: 'sent', originConversationId: id, deliveryConversationId: id, targetSessionId: oldSession, targetName: 'serra' }]
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [replacement],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: 'idle', at: new Date().toISOString() } })
    })
    await controller.refresh()
    assert.equal(store.conversations.filter(item => item.kind === 'external').length, 1)
    assert.equal(conversation.sessionId, replacement.sessionId)
    assert.equal(conversation.editorOnline, true)
    assert.equal(conversation.editorRequests?.[0].targetSessionId, oldSession, 'uma entrega anterior não pode mudar de destinatário')
    assert.equal(conversation.editorRequests?.[0].disconnected, true)
    const activity = controller.snapshot().state.activities.find(item => item.conversationId === id)
    assert.equal(activity?.status, 'waiting')
    assert.equal(activity?.detail, 'Entrega anterior não confirmada · nova sessão vinculada')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('relato devolvido sem conclusão confirmada permanece amarelo até a tarefa encerrar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-returned-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'growth', cwd: dir, address: 'uds:growth', pid: 1 }
    conversation.sessionId = session.sessionId
    conversation.editorRequests = [{ id: 'returned', text: 'Validar publicação.', at: new Date().toISOString(), status: 'reported', originConversationId: id, deliveryConversationId: id, targetSessionId: session.sessionId, targetName: session.name }]
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: 'idle', at: new Date().toISOString() } })
    })
    await controller.refresh()
    let activity = controller.snapshot().state.activities.find(item => item.sessionId === session.sessionId)
    assert.equal(activity?.status, 'waiting')
    assert.equal(activity?.detail, 'Atividade devolvida · aguardando continuidade')
    conversation.editorRequests![0].status = 'completed'
    await controller.refresh()
    activity = controller.snapshot().state.activities.find(item => item.sessionId === session.sessionId)
    assert.equal(activity?.status, 'ready')
    assert.equal(activity?.detail, 'Último trabalho concluído')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('correção devolvida fica amarela e só fica azul quando o VS Code volta a executar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-correction-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'), conversation = store.get(id)
    const session = { sessionId: '77777777-7777-4777-8777-777777777777', name: 'tracking', cwd: dir, address: 'uds:tracking', pid: 1 }
    conversation.sessionId = session.sessionId
    conversation.editorRequests = [
      { id: 'original', text: 'Validar rastreamento.', at: new Date().toISOString(), status: 'reported', originConversationId: id, deliveryConversationId: id, targetSessionId: session.sessionId, targetName: session.name },
      { id: 'correction', text: 'Executar typecheck.', at: new Date().toISOString(), status: 'reported', followupOf: 'original', originConversationId: id, deliveryConversationId: id, targetSessionId: session.sessionId, targetName: session.name }
    ]
    let execution: 'idle' | 'running' = 'idle'
    const controller = new Controller(store, () => {}, (() => { throw new Error('Nenhuma inferência esperada') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: execution, at: new Date().toISOString() } })
    })
    await controller.refresh()
    let activity = controller.snapshot().state.activities.find(item => item.sessionId === session.sessionId)
    assert.equal(activity?.status, 'waiting')
    assert.equal(activity?.detail, 'Correção devolvida · aguardando nova execução')
    execution = 'running'
    await controller.refresh()
    activity = controller.snapshot().state.activities.find(item => item.sessionId === session.sessionId)
    assert.equal(activity?.status, 'running')
    assert.equal(activity?.detail, 'Sessão executando no VS Code')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
    assert.equal(calls.filter(c => c === 'learning-sync').length, 3, 'duas rodadas e uma auditoria periódica deduplicada')
    assert.equal(store.get(id).messages[2].channel, 'voice')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
test('texto longo vira anexo privado: não ocupa o corpo, mas chega ao executor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-long-attachment-'))
  try {
    const body = `API de teste: ${'detalhe confidencial '.repeat(420)}`
    let prompt = ''
    const fake = (async function* (input: { prompt: string }) {
      prompt = input.prompt
      yield { type: 'result', subtype: 'success', result: 'Anexo compreendido.', is_error: false }
    }) as unknown as typeof query
    const store = new Store(dir); await store.load(); const id = await store.create(dir, 'task')
    const controller = new Controller(store, () => {}, fake, modules('Contexto', []))
    await controller.send(id, body)
    const owner = store.get(id).messages.find(message => message.role === 'user')!
    assert.equal(owner.text, '')
    assert.equal(owner.attachments?.length, 1)
    assert.equal(owner.attachments?.[0].kind, 'text')
    assert.equal(owner.attachments?.[0].preview, body.slice(0, 240))
    assert.match(prompt, /API de teste/)
    assert.match(prompt, /detalhe confidencial/)
    assert.ok(!JSON.stringify(store.get(id)).includes(body.slice(500)))
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
test('chat central planeja com o texto anexado sem devolver o rótulo vazio ao proprietário', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-central-attachment-'))
  let persistence: Store | undefined
  try {
    const body = `API para finanças: ${'definir contrato e validação '.repeat(300)}`
    let planningPrompt = ''
    const fake = (async function* (input: { prompt: string; options: Options }) {
      if (input.options.outputFormat) {
        planningPrompt = input.prompt
        yield { type: 'result', subtype: 'success', result: '', is_error: false, structured_output: { reply: 'Vou organizar a API financeira.', action: 'reply', sessionId: null, instruction: null } }
      } else yield { type: 'result', subtype: 'success', result: 'Entendi a API financeira.', is_error: false }
    }) as unknown as typeof query
    const store = persistence = new Store(dir); await store.load(); const id = await store.create(dir)
    const controller = new Controller(store, () => {}, fake, modules('Contexto', []))
    await controller.send(id, body)
    await until(() => ['done', 'failed'].includes(store.get(id).coordinationTurns?.[0].state || '') && store.get(id).messages.some(message => message.role === 'assistant' && !message.streaming) && controller.active.size === 0)
    const owner = store.get(id).messages.find(message => message.role === 'user')!
    assert.equal(owner.text, '')
    assert.equal(owner.attachments?.[0].preview, body.slice(0, 240))
    assert.match(planningPrompt, /API para finanças/)
    assert.match(planningPrompt, /definir contrato e validação/)
  } finally { await persistence?.save().catch(() => {}); await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
test('verbo abre Claude direto na janela já aberta, sem criar subagente ou planejamento', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-open-claude-'))
  try {
    const workspace = join(dir, 'Financas'); await mkdir(workspace)
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    const central = store.get(id)
    central.messages.push({ id: 'financas', role: 'user', text: `${workspace} - abrir VS Code para financas`, at: '', channel: 'text' })
    let opened = ''
    const controller = new Controller(store, () => {}, (() => { throw new Error('Planejador nao deveria rodar') }) as typeof query, { ...modules('Contexto', []), openClaude: async target => { opened = target } })
    await controller.send(id, 'abra uma sessao do claude la')
    assert.equal(opened, workspace)
    assert.equal(central.coordinationTurns?.length || 0, 0)
    assert.equal(store.conversations.filter(conversation => conversation.kind === 'task').length, 0)
    assert.match(central.messages.at(-1)!.text, /Claude aberto/)
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
    await until(() => controller.snapshot().results?.find(ticket => ticket.id === childId)?.state === 'ready')
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('complemento do proprietário retoma a mesma sessão do subagente depois da rodada ativa', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-task-addendum-'))
  try {
    const store = new Store(dir); await store.load(); const parentId = await store.create(dir)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const prompts: string[] = []
    const fake = (async function* (input: { prompt: string; options: Options }) {
      if (input.options.outputFormat) {
        yield { type: 'result', subtype: 'success', result: '', is_error: false, structured_output: { action: 'complete', message: 'Entrega conferida.', instruction: null, withinScope: true, needsOwner: false } }
        return
      }
      prompts.push(input.prompt)
      if (input.prompt === 'Tarefa principal') await gate
      yield { type: 'result', subtype: 'success', result: `Resultado ${prompts.length}`, is_error: false }
    }) as unknown as typeof query
    const controller = new Controller(store, () => {}, fake, modules('Contexto', []))
    const childId = await controller.delegate(parentId, 'Tarefa principal')
    await until(() => controller.active.has(childId))
    await controller.appendToTask(parentId, childId, 'Inclua o filtro por cotas A e B antes de concluir.', 'owner-addendum-1')
    assert.equal(store.get(childId).supervision?.ownerAddenda?.length, 1)
    release()
    await until(() => prompts.length === 2)
    await until(() => store.get(childId).supervision?.state === 'settled' && store.get(childId).deliveryState === 'ready' && controller.active.size === 0)
    // The result-delivery queue is started by the final emit and can still be
    // persisting while the task state is already ready.
    await new Promise(resolve => setTimeout(resolve, 30))
    controller.prepareShutdown()
    const child = store.get(childId)
    assert.equal(store.conversations.filter(item => item.kind === 'task' && item.parentConversationId === parentId).length, 1)
    assert.equal(child.messages.filter(message => message.role === 'user').length, 2)
    assert.match(prompts[1], /Complementos novos do proprietário/)
    assert.match(prompts[1], /filtro por cotas A e B/)
    assert.equal(child.supervision?.ownerAddenda?.length, 0)
    assert.ok(store.get(parentId).messages.some(message => message.id.startsWith(`task-addendum:${childId}:owner-addendum-1`)))
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
    assert.equal(mailboxReads, 1); assert.equal(store.conversations.some(c => c.sessionId === inbox.sessionId), true)
    online = false
    await controller.refresh()
    assert.equal(second.status, 'received'); assert.equal(rejected.status, 'sent'); assert.equal(mailboxReads, 2)
    assert.equal(target.editorRequests[0].originConversationId, originId)
    assert.equal(target.editorRequests[0].deliveryConversationId, targetId)
    assert.equal(store.conversations.length, 3)
    const restored = new Store(dir); await restored.load()
    assert.equal(restored.get(targetId).editorRequests?.[1].status, 'received')
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('sessão recém-aberta é vinculada sem clique, azul acompanha execução e verde só acende após resumo persistido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-auto-observe-'))
  let controller: Controller | undefined
  try {
    const store = new Store(dir); await store.load(); await store.create(dir)
    const session = { sessionId: '99999999-9999-4999-8999-999999999991', name: 'new-session', cwd: dir, address: 'uds:new', pid: 1 }
    let online = true, finished = false, calls = 0, finish!: (text: string) => void
    const response = { id: `editor-response:${session.sessionId}:final`, sessionId: session.sessionId, turnId: 'owner', evidenceId: 'final', at: '2026-09-15T12:00:00Z', objective: 'Trabalho atual', report: 'Resultado atual', deliveryState: 'ready' as const }
    controller = new Controller(store, () => {}, (() => { throw Error('Nenhum executor autorizado no teste') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => online ? [session] : [],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution: { state: finished ? 'idle' : 'running' }, ...(finished ? { latestReturn: response } : {}) }),
      relay: async () => { throw Error('Monitor não deve enviar comandos') }
    })
    controller.coordinator.summarize = async () => { calls++; return new Promise<string>(resolve => { finish = resolve }) }
    await controller.refresh()
    const conversation = store.conversations.find(c => c.sessionId === session.sessionId)!
    assert.ok(conversation, 'vinculada sem abrir card')
    assert.equal(controller.snapshot().state.activities.find(a => a.sessionId === session.sessionId)?.status, 'running')
    assert.equal(conversation.messages.length, 0); assert.equal(calls, 0)
    finished = true; await controller.refresh()
    await until(() => calls === 1)
    assert.equal(controller.snapshot().results?.find(t => t.id === response.id)?.state, 'preparing')
    assert.equal(controller.snapshot().state.activities.find(a => a.sessionId === session.sessionId)?.attention, undefined)
    assert.equal(conversation.messages.length, 0, 'preparação não publica mensagem')
    finish('## Resultado\n\nTrabalho finalizado.\n\n## Evidência\n\nDados da sessão.')
    await until(() => controller!.snapshot().state.activities.find(a => a.sessionId === session.sessionId)?.attention === 'return')
    const restored = new Store(dir); await restored.load()
    assert.ok(restored.get(conversation.id).editorReturn?.preparedDelivery?.text)
    await controller.releaseResult(response.id); await controller.refresh()
    assert.equal(calls, 1); assert.equal(conversation.messages.length, 1)
    assert.equal(controller.snapshot().state.activities.find(a => a.sessionId === session.sessionId)?.attention, undefined)
    await controller.releaseResult(response.id)
    assert.equal(conversation.messages.length, 1, 'reclique não duplica')
    assert.equal(store.conversations.filter(c => c.sessionId === session.sessionId).length, 1)
    online = false; await controller.refresh()
    assert.equal(controller.snapshot().state.activities.some(a => a.sessionId === session.sessionId), false)
    assert.equal(conversation.messages.length, 1, 'fechar sessão preserva leitura')
    await store.save()
  } finally { controller?.deliveries.stop(); await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('card não anuncia resposta antiga após interrupção nem sem telemetria da sessão', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-card-latest-turn-'))
  let controller: Controller | undefined
  try {
    const store = new Store(dir); await store.load()
    const session = { sessionId: '99999999-9999-4999-8999-999999999992', name: 'cancelled-test', cwd: dir, address: 'uds:test', pid: 1 }
    let execution: { state: 'idle' | 'unknown'; turnStartedAt?: string } = { state: 'idle', turnStartedAt: '2026-09-15T11:00:00Z' }
    const response = { id: `editor-response:${session.sessionId}:old`, sessionId: session.sessionId, evidenceId: 'old', turnId: 'old', at: '2026-09-15T10:00:00Z', objective: 'Resposta anterior', report: 'Anterior', deliveryState: 'ready' as const }
    controller = new Controller(store, () => {}, (() => { throw Error('Não executar') }) as typeof query, {
      ...modules('Contexto', []), sessions: async () => [session],
      readEditor: async () => ({ messages: [], observations: [], relayInbox: [], execution, latestReturn: response })
    })
    controller.coordinator.summarize = async () => 'Resumo anterior'
    await controller.refresh()
    await until(() => controller!.snapshot().results?.[0]?.state === 'ready')
    assert.equal(controller.snapshot().state.activities.find(a => a.sessionId === session.sessionId)?.attention, undefined)
    execution = { state: 'unknown' }; await controller.refresh()
    assert.equal(controller.snapshot().state.activities.find(a => a.sessionId === session.sessionId)?.attention, undefined)
    assert.equal(store.conversations[0].messages.length, 0)
    await store.save()
  } finally { controller?.deliveries.stop(); await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
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
    assert.match(approved.updatedInput.message, /responda nesta mesma sessão/)
    assert.doesNotMatch(approved.updatedInput.message, /ROTA EXPLÍCITA DE RETORNO|omni-0b/)
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

test('abre projeto no VS Code pelo caminho sanitizado, sem delegar tarefa', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-open-workspace-'))
  try {
    const station = join(dir, 'Station'); await mkdir(station)
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    let opened = ''
    const controller = new Controller(store, () => {}, (() => { throw new Error('No inference expected') }) as typeof query, {
      ...modules('Contexto', []), openWorkspace: async workspace => { opened = workspace }
    })
    await controller.send(id, `abra o projeto do Station no VS Code - ${station} - aqui`)
    assert.equal(opened, station)
    assert.equal(store.conversations.length, 1)
    assert.match(store.get(id).messages.at(-1)!.text, /ação direta/)
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('rota de projeto consulta memória operacional verificada e a reforça após abrir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-memory-workspace-'))
  try {
    const growth = join(dir, 'Growth'); await mkdir(growth)
    const store = new Store(dir); await store.load(); const id = await store.create(dir)
    let opened = ''; const remembered: string[] = []
    const base = modules('Contexto', [])
    const controller = new Controller(store, () => {}, (() => { throw new Error('No inference expected') }) as typeof query, {
      ...base,
      loadModule: async path => {
        if (path.includes('memoria.mjs')) return {
          lerMemoria: async () => ({
            confirmed: [{ source: 'runtime-verified-workspace', text: `Projeto Growth: ${growth}` }],
            candidates: []
          }),
          registrarFatoOperacional: async (_home: string, text: string) => { remembered.push(text) }
        }
        return base.loadModule(path)
      },
      openWorkspace: async workspace => { opened = workspace }
    })
    await controller.send(id, 'abra o projeto Growth no VS Code')
    assert.equal(opened, growth)
    assert.deepEqual(remembered, [`Projeto Growth: ${growth}`])
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
