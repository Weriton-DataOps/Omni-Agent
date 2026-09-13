// Explicit live validation only. No real project commands, tools, credentials or memory payloads.
import { build } from 'esbuild'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const app = resolve(import.meta.dirname, '..')
const out = join(app, 'out/live-coordination')
await build({ entryPoints: ['src/main/coordinator.ts', 'src/main/store.ts', 'src/main/result-delivery.ts', 'src/main/vscode-sessions.ts', 'src/main/runtime.ts'].map(p => join(app, p)), outdir: out, bundle: true, packages: 'external', platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } })
const { Coordinator } = await import(pathToFileURL(join(out, 'coordinator.mjs')))
const { Store } = await import(pathToFileURL(join(out, 'store.mjs')))
const { ResultDeliveryQueue } = await import(pathToFileURL(join(out, 'result-delivery.mjs')))
const { readEditor, relayToEditor } = await import(pathToFileURL(join(out, 'vscode-sessions.mjs')))
const { claudeExecutable } = await import(pathToFileURL(join(out, 'runtime.mjs')))
const home = await mkdtemp(join(app, 'out/live-coordination-home-'))
const receiverId = randomUUID(), name = `omni-test-${receiverId.slice(0, 8)}`
const abort = new AbortController()
const env = { ...process.env, OMNI_HOME: home }
for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CLAUDECODE', 'ELECTRON_RUN_AS_NODE']) delete env[key]
let finishInput
const inputDone = new Promise(resolve => { finishInput = resolve })
async function* input() { yield { type: 'user', message: { role: 'user', content: 'Responda somente PRONTO. Aguarde o próximo pedido desta sessão de teste.' }, parent_tool_use_id: null }; await inputDone }
const receiver = query({ prompt: input(), options: { cwd: app, sessionId: receiverId, extraArgs: { name }, pathToClaudeCodeExecutable: await claudeExecutable(), env, tools: [], settingSources: [], mcpServers: {}, strictMcpConfig: true, persistSession: true, permissionMode: 'default', maxBudgetUsd: .75, maxTurns: 4, abortController: abort, systemPrompt: 'Você é um executor isolado de teste do Omni. Nenhuma ferramenta disponível ou autorizada. Responda a cálculos e siga o protocolo de retorno [Omni Desktop report:ID status:completed] em uma mensagem de texto. Não inicie trabalhos nem altere arquivos.' } })
const receiverLoop = (async () => { for await (const event of receiver) if (event.type === 'result') console.log(JSON.stringify({ receiverResult: event.subtype, cost: event.total_cost_usd })) })().catch(error => { if (!abort.signal.aborted) console.log(JSON.stringify({ receiverError: error.message })) })
let session
try {
  const started = Date.now()
  while (!session && Date.now() - started < 25000) {
    for (const file of await readdir(join(homedir(), '.claude/sessions'))) {
      if (!/^\d+\.json$/.test(file)) continue
      const r = JSON.parse(await readFile(join(homedir(), '.claude/sessions', file), 'utf8'))
      if (r.sessionId === receiverId && r.messagingSocketPath) session = { sessionId: receiverId, cwd: app, name: r.name, pid: r.pid, address: `uds:${r.messagingSocketPath}` }
    }
    if (!session) await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(session, 'A sessão isolada não disponibilizou um canal de mensagens; nenhum projeto real foi usado como alternativa.')
  console.log(JSON.stringify({ isolatedReceiver: receiverId, ready: true }))
  const store = new Store(join(home, 'desktop')); await store.load()
  const central = store.get(await store.create(app))
  const target = store.get(await store.create(app, 'external')); target.sessionId = receiverId; target.editorProjectionVersion = 2
  const foreign = store.get(await store.create(app, 'external'))
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: relayToEditor, open: async () => target.id, local: async () => { throw new Error('Execução local proibida no teste') }, context: async () => 'Omni: coordenador pessoal. Preserve origem, evidência e limites. Contexto sintético de teste, sem memória privada.', executable: claudeExecutable })
  const activeDeliveries = new Map()
  const deliveries = new ResultDeliveryQueue(store, (destination, objective, report, outcome, abort, onText) => coordinator.summarize(destination, objective, report, outcome, abort, onText), () => {}, activeDeliveries)
  await coordinator.enqueue(central, `Encaminhe para a sessão ${session.name} uma tarefa de teste: responder quanto é 7 vezes 8, sem ferramentas nem alterações. Não calcule você mesmo: preciso validar o retorno da sessão vinculada.`, 'text')
  const deadline = Date.now() + 100000
  let previous = ''
  while (Date.now() < deadline) {
    const state = await readEditor(session)
    await coordinator.observe(target, state.observations, true)
    const request = target.editorRequests?.[0]
    const status = request?.status || central.coordinationTurns?.[0]?.state
    if (status !== previous) { console.log(JSON.stringify({ status })); previous = status }
    if (request?.deliveryState === 'ready') {
      assert.match(request.report, /56/)
      assert.equal(request.originConversationId, central.id)
      assert.equal(request.deliveryConversationId, target.id)
      assert.equal(central.messages.some(message => message.id === `editor-report:${request.id}`), false)
      assert.equal(target.messages.some(message => message.id === `editor-report:${request.id}`), false)
      assert.equal(await deliveries.release(request.id), target.id)
      while (!request.acknowledgedAt && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      assert.ok(request.acknowledgedAt, 'A apresentação final não terminou dentro do prazo.')
      assert.match(target.messages.find(message => message.id === `editor-report:${request.id}`).text, /56/)
      assert.equal(foreign.messages.length, 0)
      assert.equal(central.messages.some(message => message.id === `editor-report:${request.id}`), false)
      console.log(JSON.stringify({ ok: true, realDispatchAndReturn: true, summarizedInTarget: true, authorizationOriginPreserved: true, foreignUntouched: true, sessionId: receiverId, requestId: request.id }))
      break
    }
    if (central.coordinationTurns?.[0]?.state === 'failed') throw new Error(central.coordinationTurns[0].error)
    await new Promise(resolve => setTimeout(resolve, 600))
  }
  assert.ok(target.editorRequests?.[0]?.acknowledgedAt, 'Não houve ciclo completo dentro do prazo. Não declarar sucesso.')
} finally { finishInput(); abort.abort(); receiver.close(); await receiverLoop }
