import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { query, Options } from '@anthropic-ai/claude-agent-sdk'
import { Store } from '../src/main/store'
import { Coordinator, planConflict, validatePlan } from '../src/main/coordinator'
import { pendingCoordinationTurns } from '../src/shared/coordination-state'
import type { Conversation } from '../src/shared/contracts'

type Plan = ReturnType<typeof validatePlan>
const successPlan = (plan: Plan) => ({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: plan })
async function routingFixture(run: (fixture: { store: Store; origin: Conversation; target: Conversation; session: { sessionId: string; cwd: string; name: string; pid: number; address: string }; dir: string }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'omni-routing-receipt-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)), target = store.get(await store.create(dir, 'external'))
    const session = { sessionId: 'project-session', cwd: dir, name: 'projeto-validado', pid: 1, address: 'uds:test' }
    target.sessionId = session.sessionId
    await run({ store, origin, target, session, dir })
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
}

test('checagem de coerência exige revisão, sem remapear código do Crachá ou frase negada', () => {
  const plan: Plan = { action: 'project', sessionId: 'project-session', instruction: 'Conferir apenas metadados.', reply: 'mudo a rota: puxo a listagem pra um subagente meu, direto na máquina' }
  assert.match(planConflict(plan, 'central', 'cadê a lista?')!, /promete um subagente pessoal/)
  assert.equal(planConflict({ ...plan, reply: 'Não vou usar um subagente local; vou encaminhar à sessão.' }, 'central', 'Confira o projeto'), null)
  assert.equal(planConflict({ ...plan, reply: 'Vou pedir a implementação na sessão.' }, 'central', 'Implemente a interface para listar os acessos do Crachá.'), null)
  assert.match(planConflict({ ...plan, reply: 'Vou pedir a listagem.' }, 'central', 'Liste os metadados dos acessos do Crachá.' )!, /inventário local/)
  assert.equal(planConflict({ ...plan, reply: 'Vou pedir a listagem nesta sessão.' }, 'external', 'Liste os acessos do Crachá.'), null)
})

test('duas versões estruturadas não vazam a primeira promessa nem trocam o executor após fala pública', async () => routingFixture(async ({ store, origin, target, session }) => {
  let emitted!: () => void; const first = new Promise<void>(resolve => { emitted = resolve })
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
  let sends = 0, locals = 0, calls = 0
  const fake = (async function* () {
    calls++
    yield { type: 'stream_event', event: { type: 'message_start' } }
    yield { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify({ action: 'local', reply: 'Vou usar um subagente meu.', sessionId: null, instruction: 'Plano antigo.' }) } } }
    emitted(); await gate
    yield { type: 'stream_event', event: { type: 'message_start' } }
    yield successPlan({ action: 'project', reply: 'Vou encaminhar à sessão.', sessionId: session.sessionId, instruction: 'Confira o código autorizado.' })
  }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async () => { sends++ }, open: async () => target.id, local: async () => { locals++; return origin.id }, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  await coordinator.enqueue(origin, 'Confira o código do projeto', 'text')
  await first
  assert.equal(origin.messages.length, 1); assert.equal(sends, 0); assert.equal(locals, 0)
  release(); await until(() => origin.coordinationTurns![0].state === 'done')
  assert.equal(calls, 1); assert.equal(sends, 1); assert.equal(locals, 0)
  assert.match(origin.messages.at(-1)!.text, /card projeto-validado/)
  assert.doesNotMatch(origin.messages.at(-1)!.text, /subagente meu|Vou encaminhar|assumiu/)
}))

test('promessa local com action project faz uma revisão antes de qualquer despacho', async () => routingFixture(async ({ store, origin, target, session }) => {
  let calls = 0, sends = 0, locals = 0
  const fake = (async function* ({ prompt }: { prompt: string }) {
    calls++
    if (calls === 1) yield successPlan({ action: 'project', reply: 'mudo a rota: puxo a listagem pra um subagente meu, direto na máquina', sessionId: session.sessionId, instruction: 'Inspecionar o projeto.' })
    else {
      assert.match(prompt, /Revisão única antes de qualquer execução/)
      assert.equal(sends, 0); assert.equal(locals, 0); assert.equal(origin.messages.length, 1)
      yield successPlan({ action: 'project', reply: 'A consulta continua na sessão explicitamente selecionada.', sessionId: session.sessionId, instruction: 'Conferir o estado do pedido anterior, sem repetir seus efeitos.' })
    }
  }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async () => { sends++ }, open: async () => target.id, local: async () => { locals++; return origin.id }, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  await coordinator.enqueue(origin, 'cadê a lista?', 'text')
  await until(() => origin.coordinationTurns![0].state === 'done')
  assert.equal(calls, 2); assert.equal(sends, 1); assert.equal(locals, 0)
  assert.doesNotMatch(origin.messages.at(-1)!.text, /mudo a rota|subagente meu/)
}))

test('contradição persistente e plano legado contraditório não despacham silenciosamente', async () => routingFixture(async ({ store, origin, target, session }) => {
  let calls = 0, sends = 0
  const contradictory: Plan = { action: 'project', reply: 'Vou usar um subagente meu.', sessionId: session.sessionId, instruction: 'Conferir o pedido.' }
  const fake = (async function* () { calls++; yield successPlan(contradictory) }) as unknown as typeof query
  const forbidden = async () => { sends++; throw new Error('Não deveria executar') }
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: forbidden, open: async () => target.id, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  await coordinator.enqueue(origin, 'Confira', 'text')
  await until(() => origin.coordinationTurns![0].state === 'failed')
  assert.equal(calls, 2); assert.equal(sends, 0)
  assert.match(origin.messages.at(-1)!.text, /nenhum executor foi iniciado/)
  origin.coordinationTurns!.push({ id: 'legacy-plan', text: 'Confira novamente', at: '', state: 'planned', plan: contradictory })
  coordinator.resume()
  await until(() => origin.coordinationTurns![1].state === 'failed')
  assert.equal(calls, 3, 'plano já existente ganha uma revisão, não outro ciclo de tentativas')
  assert.equal(sends, 0)
}))

test('inventário pessoal central é reavaliado como local sem ler valores de credenciais', async () => routingFixture(async ({ store, origin, target, session, dir }) => {
  let calls = 0, sends = 0, locals = 0
  const fake = (async function* ({ prompt }: { prompt: string }) {
    calls++
    assert.match(prompt, /listar\/consultar metadados/)
    assert.match(prompt, /não autoriza extrair senhas\/tokens/)
    if (calls === 1) yield successPlan({ action: 'project', reply: 'Vou consultar a sessão Omni.', sessionId: session.sessionId, instruction: 'Consultar metadados do cofre.' })
    else yield successPlan({ action: 'local', reply: 'Vou consultar apenas metadados locais.', sessionId: null, instruction: 'Listar somente nomes e tipos de acessos locais; não ler nem revelar senhas ou tokens.' })
  }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async () => { sends++ }, open: async () => target.id, local: async (parent, text, turnId) => {
    locals++; assert.match(text, /somente nomes e tipos/)
    const child = store.get(await store.create(dir, 'task', parent)); child.originTurnId = turnId; child.title = 'Inventário de metadados'; return child.id
  }, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  await coordinator.enqueue(origin, 'Liste os metadados dos acessos do Crachá e do Cofre do Windows.', 'text')
  await until(() => origin.coordinationTurns![0].state === 'done')
  assert.equal(calls, 2); assert.equal(sends, 0); assert.equal(locals, 1)
  assert.match(origin.messages.at(-1)!.text, /card Inventário de metadados/)
}))

test('envio técnico com falha nunca anuncia que o executor recebeu ou assumiu', async () => routingFixture(async ({ store, origin, target, session }) => {
  const fake = (async function* () { yield successPlan({ action: 'project', reply: 'A sessão assumiu tudo.', sessionId: session.sessionId, instruction: 'Conferir o projeto.' }) }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async () => { throw new Error('Canal indisponível') }, open: async () => target.id, local: async () => origin.id, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  await coordinator.enqueue(origin, 'Conferir o projeto', 'text')
  await until(() => origin.coordinationTurns![0].state === 'done' && target.editorRequests?.[0]?.status === 'uncertain')
  assert.match(origin.messages.at(-1)!.text, /registrado|não foi confirmado/)
  assert.doesNotMatch(origin.messages.at(-1)!.text, /assumiu|confirmou o recebimento|foi enviado/)
}))

test('reinício usa o recibo incerto existente mesmo se o plano antigo promete outra rota', async () => routingFixture(async ({ store, origin, target, session }) => {
  const plan: Plan = { action: 'local', reply: 'Vou mudar de rota.', sessionId: null, instruction: 'Repetir a tarefa.' }
  origin.coordinationTurns = [{ id: 'recorded', text: 'Pedido original', at: '', state: 'planned', plan }]
  target.editorRequests = [{ id: 'recorded', text: 'Pedido original', at: '', status: 'uncertain', originConversationId: origin.id, deliveryConversationId: target.id, targetSessionId: session.sessionId, targetName: session.name }]
  let effects = 0
  const forbidden = async () => { effects++; throw new Error('Não repetir') }
  const fake = (async function* () { effects++; throw new Error('Não replanejar') }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, { sessions: forbidden, relay: forbidden, open: forbidden, local: forbidden, context: forbidden, executable: forbidden }, fake)
  coordinator.resume()
  await until(() => origin.coordinationTurns![0].state === 'done')
  assert.equal(effects, 0)
  assert.match(origin.messages.at(-1)!.text, /não foi confirmado; não enviei outra cópia/)
  assert.match(origin.messages.at(-1)!.text, /card projeto-validado/)
  assert.doesNotMatch(origin.messages.at(-1)!.text, /subagente|mudar de rota/)
}))

test('recibo local retomado distingue falha, interrupção e relato ainda em conferência', async () => routingFixture(async ({ store, origin, dir }) => {
  const phases = ['failed', 'interrupted', 'completed'] as const
  let effects = 0
  const forbidden = async () => { effects++; throw new Error('Não repetir') }
  const fake = (async function* () { effects++; throw new Error('Não replanejar') }) as unknown as typeof query
  for (const phase of phases) {
    const child = store.get(await store.create(dir, 'task', origin.id)); child.originTurnId = phase; child.phase = phase; child.title = phase
    child.supervision = { objective: 'Pedido', retries: 0, state: 'reviewing' }
    origin.coordinationTurns = [...(origin.coordinationTurns || []), { id: phase, text: 'Pedido', at: '', state: 'planned', plan: { action: 'local', reply: 'Assumiu.', sessionId: null, instruction: 'Pedido' } }]
  }
  const coordinator = new Coordinator(store, () => {}, { sessions: forbidden, relay: forbidden, open: forbidden, local: forbidden, context: forbidden, executable: forbidden }, fake)
  coordinator.resume()
  await until(() => origin.coordinationTurns!.every(turn => turn.state === 'done'))
  assert.equal(effects, 0)
  assert.match(origin.messages.find(message => message.id === 'coord:failed')!.text, /falhou; não iniciei outra execução/)
  assert.match(origin.messages.find(message => message.id === 'coord:interrupted')!.text, /interrompido; não iniciei outra execução/)
  const reviewing = origin.messages.find(message => message.id === 'coord:completed')!.text
  assert.match(reviewing, /conclusão ainda não foi confirmada/)
  assert.doesNotMatch(reviewing, /foi concluído|assumiu/)
}))

test('porta não pode substituir o card externo por outra sessão nem criar falso subagente', async () => routingFixture(async ({ store, origin, target, session }) => {
  let action: Plan['action'] = 'project', sends = 0
  const fake = (async function* () { yield successPlan({ action, reply: 'Encaminhar.', sessionId: action === 'project' ? session.sessionId : null, instruction: 'Conferir.' }) }) as unknown as typeof query
  target.sessionId = 'outra-sessao'
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async () => { sends++ }, open: async () => target.id, local: async () => target.id, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
  await coordinator.enqueue(origin, 'Conferir o projeto', 'text')
  await until(() => origin.coordinationTurns![0].state === 'failed')
  assert.equal(sends, 0); assert.equal(target.editorRequests?.length || 0, 0)
  assert.match(origin.messages.at(-1)!.text, /card retornado não corresponde/)
  action = 'local'
  await coordinator.enqueue(origin, 'Conferir tarefa pessoal', 'text')
  await until(() => origin.coordinationTurns![1].state === 'failed')
  assert.match(origin.messages.at(-1)!.text, /subagente retornado não corresponde/)
  assert.doesNotMatch(origin.messages.at(-1)!.text, /assumiu/)
}))

test('pedido novo sinaliza planejamento mesmo com trabalho antigo delegado e libera ao encaminhar seu próprio turno', () => {
  const central: Conversation = { id: 'central', title: 'Omni', workspace: '.', sessionId: null, kind: 'central', phase: 'idle', updatedAt: '', messages: [], events: [], coordinationTurns: [
    { id: 'old', text: 'Pedido anterior', at: '', state: 'done' },
    { id: 'new', text: 'Novo pedido', at: '', state: 'planning' }
  ] }
  const project: Conversation = { ...central, id: 'project', kind: 'external', coordinationTurns: [], editorRequests: [
    { id: 'old', text: 'Pedido anterior', at: '', status: 'received', originConversationId: 'central' }
  ] }
  const conversations = [central, project]
  assert.deepEqual(pendingCoordinationTurns(central, conversations).map(t => t.id), ['new'])
  project.editorRequests!.push({ id: 'new', text: 'Novo pedido', at: '', status: 'sending', originConversationId: 'central' })
  assert.deepEqual(pendingCoordinationTurns(central, conversations).map(t => t.id), ['new'])
  central.messages.push({ id: 'coord:new', role: 'assistant', text: 'Encaminhei o pedido.', at: '', channel: 'text' })
  assert.equal(pendingCoordinationTurns(central, conversations).length, 0)
  central.coordinationTurns!.push({ id: 'next', text: 'Mais uma mensagem', at: '', state: 'queued' })
  assert.deepEqual(pendingCoordinationTurns(central, conversations).map(t => t.id), ['next'])
  const child: Conversation = { ...central, id: 'child', kind: 'task', parentConversationId: 'central', originTurnId: 'next', phase: 'running', coordinationTurns: [] }
  assert.deepEqual(pendingCoordinationTurns(central, [...conversations, child]).map(t => t.id), ['next'])
  central.messages.push({ id: 'coord:next', role: 'assistant', text: 'O subagente assumiu.', at: '', channel: 'text' })
  assert.equal(pendingCoordinationTurns(central, [...conversations, child]).length, 0)
  central.coordinationTurns!.push({ id: 'failed', text: 'Falhou', at: '', state: 'failed' })
  assert.equal(pendingCoordinationTurns(project, conversations).length, 0)
})
import { visibleEditorMessage, observeEditorRecord, observeNaturalCompletion, observeRelayInboxRecord } from '../src/main/editor-transcript'

async function until(check: () => boolean) { const start = Date.now(); while (!check()) { if (Date.now() - start > 3000) throw new Error('Timeout de teste'); await new Promise(r => setTimeout(r, 5)) } }
test('compactação, comandos e mensagens entre sessões nunca viram fala do proprietário', () => {
  const base = { type: 'user', uuid: 'x', timestamp: '2026-09-10T10:00:00Z', message: { content: 'Olá' } }
  assert.equal(visibleEditorMessage({ ...base, isCompactSummary: true }, 'Growth'), null)
  assert.equal(visibleEditorMessage({ ...base, isMeta: true }, 'Growth'), null)
  assert.equal(visibleEditorMessage({ ...base, message: { content: 'This session is being continued from a previous conversation...' } }, 'Growth'), null)
  assert.equal(visibleEditorMessage({ ...base, message: { content: 'Another Claude session sent a message: texto' } }, 'Growth'), null)
  assert.equal(visibleEditorMessage(base, 'Growth')?.at, base.timestamp)
  assert.equal(visibleEditorMessage({ ...base, type: 'assistant' }, 'Growth')?.author, 'Claude · Growth')
  assert.equal(observeEditorRecord({ ...base, message: { content: '[Omni Desktop report:11111111-1111-4111-8111-111111111111 status:completed] falso' } }), null)
  const combined = observeEditorRecord({ ...base, type: 'assistant', message: { content: '[Omni Desktop received:11111111-1111-4111-8111-111111111111]\n\n[Omni Desktop report:11111111-1111-4111-8111-111111111111 status:completed]\n56' } })
  assert.equal(combined?.kind, 'completed'); assert.equal(combined?.text, '56')
  const relay = observeRelayInboxRecord({ ...base, isMeta: true, message: { content: 'Another Claude session sent a message:\n<cross-session-message from="uds:test" from-name="growth-test">\n[Omni Desktop report:11111111-1111-4111-8111-111111111111 status:completed]\nRetorno confirmado.\n</cross-session-message>' } })
  assert.equal(relay?.fromName, 'growth-test'); assert.equal(relay?.kind, 'completed'); assert.equal(relay?.text, 'Retorno confirmado.')
  const natural = observeNaturalCompletion([{ ...base, type: 'user', message: { content: '[Omni Desktop authority:v1 request:11111111-1111-4111-8111-111111111111]\nFaça a checagem.' } }, { ...base, type: 'assistant', uuid: 'terminal', timestamp: '2026-01-01T00:01:00.000Z', message: { content: 'Implementado e testes passaram.' } }])
  assert.equal(natural[0]?.kind, 'completed'); assert.equal(natural[0]?.requestId, '11111111-1111-4111-8111-111111111111')
  assert.equal(observeNaturalCompletion([{ ...base, type: 'user', message: { content: '[Omni Desktop authority:v1 request:11111111-1111-4111-8111-111111111111]' } }, { ...base, type: 'assistant', message: { content: 'Vou verificar e depois retorno.' } }]).length, 0)
})

test('coordenador preserva a origem e projeta pedido e retorno no chat da sessão destinatária', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-coordinator-'))
  try {
    const store = new Store(dir); await store.load()
    const central = store.get(await store.create(dir)); const growth = store.get(await store.create(dir, 'external')); const station = store.get(await store.create(dir, 'external'))
    const session = { sessionId: '11111111-1111-4111-8111-111111111111', cwd: 'C:\\Users\\wp.santos\\Documents\\GR-Workspace\\Growth', name: 'growth-test', pid: 1, address: 'uds:test' }
    growth.sessionId = session.sessionId
    growth.workspace = session.cwd
    let sends = 0; let release!: () => void; const gate = new Promise<void>(r => { release = r })
    const fake = (async function* ({ options }: { options: Options }) {
      assert.deepEqual(options.tools, []); assert.equal(options.maxBudgetUsd, .75)
      if (options.outputFormat && 'needsOwner' in ((options.outputFormat as any).schema?.properties || {})) yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'complete', message: 'A sessão informou que o teste passou. Recomendo revisar a evidência antes de publicar.', instruction: null, withinScope: true, needsOwner: false } }
      else if (options.outputFormat) { await gate; yield { type: 'result', subtype: 'success', is_error: false, structured_output: { reply: 'Vou consultar a sessão correta.', action: 'project', sessionId: session.sessionId, instruction: 'Consultar estado, sem alterar arquivos' }, result: '' } }
      else yield { type: 'result', subtype: 'success', is_error: false, result: 'A sessão informou que o teste passou. Recomendo revisar a evidência antes de publicar.' }
    }) as unknown as typeof query
    const ports = { sessions: async () => [session], relay: async () => { sends++ }, open: async () => growth.id, local: async () => { throw new Error('Não executar localmente') }, context: async () => 'Personalidade e memória do Omni', executable: async () => 'test.exe' }
    const c = new Coordinator(store, () => {}, ports, fake)
    await c.enqueue(central, 'Confira o projeto Growth', 'text')
    assert.equal(central.messages.length, 1, 'envio retorna com planejamento em segundo plano')
    release(); await until(() => sends === 1 && central.coordinationTurns![0].state === 'done')
    const request = growth.editorRequests![0]
    await until(() => request.status === 'sent')
    assert.equal(request.originConversationId, central.id)
    assert.equal(request.deliveryConversationId, growth.id)
    assert.equal(growth.messages[0].id, `editor-forwarded:${request.id}`)
    assert.equal(growth.messages[0].role, 'assistant'); assert.equal(growth.messages[0].origin, 'omni')
    assert.equal(growth.messages[0].author, 'Omni · encaminhamento')
    assert.match(growth.messages[0].text, /Confira o projeto Growth/)
    assert.doesNotMatch(growth.messages[0].text, /Consultar estado, sem alterar arquivos/)
    assert.match(central.messages.at(-1)!.text, /card growth-test/)
    assert.equal(station.messages.length, 0)
    await c.observe(growth, [{ requestId: 'outro', kind: 'completed', text: 'Relato estranho', at: new Date().toISOString(), evidenceId: 'outro' }], true)
    assert.equal(request.status, 'sent')
    await c.observe(growth, [{ requestId: request.id, kind: 'received', text: 'Recebido', at: new Date().toISOString(), evidenceId: 'receipt' }], true)
    assert.equal(request.status, 'received')
    await c.observe(growth, [{ requestId: request.id, kind: 'completed', text: 'Teste passou. Log verificado pelo executor.', at: new Date().toISOString(), evidenceId: 'evidence-1' }], true)
    await until(() => request.status === 'completed')
    assert.match(request.summary!, /Recomendo revisar/)
    assert.equal(request.deliveryState, 'ready')
    assert.equal(central.messages.some(m => m.id === `editor-report:${request.id}`), false)
    assert.equal(growth.messages.length, 1); assert.equal(station.messages.length, 0)
    const count = central.messages.length
    await c.observe(growth, [{ requestId: request.id, kind: 'completed', text: 'Outra cópia', at: new Date().toISOString(), evidenceId: 'evidence-1' }], false)
    assert.equal(central.messages.length, count); assert.equal(sends, 1)
    await store.save()
    const restored = new Store(dir); await restored.load()
    assert.equal(restored.get(central.id).messages.length, count)
    assert.equal(restored.get(growth.id).editorRequests![0].status, 'completed')
    assert.equal(restored.get(growth.id).messages.filter(message => message.id === `editor-forwarded:${request.id}`).length, 1)
  } finally { await rm(dir, { recursive: true }) }
})

test('migração preserva histórico bruto fora da conversa e reinício não reenvia tentativa incerta', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-migration-'))
  try {
    const store = new Store(dir); await store.load()
    const id = await store.create(dir, 'external'); const c = store.get(id)
    c.editorProjectionVersion = undefined
    c.messages.push({ id: 'internal', role: 'user', text: 'Resumo técnico antigo', at: '', channel: 'text' })
    c.editorRequests = [{ id: 'request', text: 'Pedido real', at: '', status: 'sending' }]
    await store.save()
    const loaded = new Store(dir); await loaded.load()
    assert.match(loaded.get(id).messages[0].text, /Pedido encaminhado pelo Omni/)
    assert.equal(loaded.get(id).messages[0].role, 'assistant'); assert.equal(loaded.get(id).messages[0].origin, 'omni')
    assert.equal(loaded.get(id).archivedMessages![0].text, 'Resumo técnico antigo')
    assert.equal(loaded.get(id).editorRequests![0].status, 'uncertain')
    assert.throws(() => validatePlan({ action: 'project', reply: 'falso', instruction: 'agir', sessionId: null }), /não identificou/)
  } finally { await rm(dir, { recursive: true }) }
})

test('dois comandos durante o planejamento permanecem na fila e conversa simples não vira subagente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-queue-'))
  try {
    const store = new Store(dir); await store.load(); const central = store.get(await store.create(dir))
    let release!: () => void; const gate = new Promise<void>(r => { release = r }); let count = 0
    const fake = (async function* ({ prompt, options }: { prompt: string; options: Options }) {
      await gate
      if (options.outputFormat) { count++; yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'reply', reply: `Resposta ${count}`, instruction: null, sessionId: null } } }
      else {
        if (count === 1) { assert.match(prompt, /Qual sua recomendação/); assert.doesNotMatch(prompt, /Explique o risco também/) }
        else assert.match(prompt, /Explique o risco também/)
        yield { type: 'result', subtype: 'success', is_error: false, result: `Resposta ${count}` }
      }
    }) as unknown as typeof query
    const forbidden = async () => { throw new Error('Conversa simples não delega') }
    const coordinator = new Coordinator(store, () => {}, { sessions: async () => [], relay: forbidden, open: forbidden, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await coordinator.enqueue(central, 'Qual sua recomendação?', 'text')
    await coordinator.enqueue(central, 'Explique o risco também', 'text')
    assert.equal(central.messages.length, 2)
    release(); await until(() => central.coordinationTurns!.every(t => t.state === 'done'))
    assert.equal(count, 2); assert.equal(central.messages.length, 4)
    assert.equal(store.conversations.length, 1)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('plano que tenta trocar a sessão vinculada é recusado sem envio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-target-'))
  try {
    const store = new Store(dir); await store.load(); const external = store.get(await store.create(dir, 'external')); external.sessionId = 'expected'
    let sends = 0
    const fake = (async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'project', reply: 'Enviar', instruction: 'Fazer', sessionId: 'wrong' } } }) as unknown as typeof query
    const coordinator = new Coordinator(store, () => {}, { sessions: async () => [{ sessionId: 'wrong', cwd: dir, pid: 1, name: 'wrong', address: 'uds:wrong' }], relay: async () => { sends++ }, open: async () => external.id, local: async () => external.id, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await coordinator.enqueue(external, 'Execute na sessão vinculada', 'text')
    await until(() => external.coordinationTurns![0].state === 'failed')
    assert.equal(sends, 0); assert.equal(external.editorRequests?.length || 0, 0)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('chat da sessão consulta pedidos iniciados na central sem mudar sua proveniência', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-followup-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)), target = store.get(await store.create(dir, 'external'))
    target.sessionId = 'linked'
    target.editorRequests = [{ id: 'from-central', at: '', text: 'Teste autorizado', status: 'received', originConversationId: origin.id, deliveryConversationId: target.id, targetSessionId: 'linked' }]
    const fake = (async function* ({ prompt, options }: { prompt: string; options: Options }) {
      if (options.outputFormat) {
        assert.match(prompt, /from-central/)
        assert.match(prompt, /uncertain não prova que a execução falhou/)
        yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'reply', reply: 'O pedido foi recebido pela sessão.', instruction: null, sessionId: null } }
      } else yield { type: 'result', subtype: 'success', is_error: false, result: 'O pedido foi recebido pela sessão.' }
    }) as unknown as typeof query
    const forbidden = async () => { throw new Error('Consulta não executa novamente') }
    const c = new Coordinator(store, () => {}, { sessions: async () => [], relay: forbidden, open: forbidden, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await c.enqueue(target, 'Como está o pedido?', 'text')
    await until(() => target.coordinationTurns![0].state === 'done')
    assert.equal(target.editorRequests![0].originConversationId, origin.id)
    assert.equal(origin.messages.length, 0)
    assert.match(target.messages.at(-1)!.text, /recebido pela sessão/)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('erro de revisão é informado somente no chat da sessão destinatária', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-editor-review-error-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)), target = store.get(await store.create(dir, 'external'))
    target.sessionId = 'linked'
    target.editorRequests = [{ id: 'report', at: new Date().toISOString(), text: 'Briefing interno.', status: 'sent', originConversationId: origin.id, targetSessionId: 'linked', supervision: { objective: 'Conferir o serviço.', retries: 0, state: 'executing' } }]
    const fake = (async function* () { yield { type: 'result', subtype: 'error_max_turns', is_error: true } }) as unknown as typeof query
    const c = new Coordinator(store, () => {}, { sessions: async () => [], relay: async () => {}, open: async () => target.id, local: async () => '', context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await c.observe(target, [{ requestId: 'report', kind: 'completed', text: 'Serviço conferido.', at: new Date().toISOString(), evidenceId: 'report-id' }], true)
    await until(() => !!target.editorRequests![0].summaryError)
    assert.equal(origin.messages.length, 0)
    assert.equal(target.messages.filter(message => message.id === 'editor-review-error:report').length, 1)
    assert.equal(target.editorRequests![0].deliveryState, 'ready')
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})
