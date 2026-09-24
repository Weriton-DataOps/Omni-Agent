import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { query } from '@anthropic-ai/claude-agent-sdk'
import { Coordinator, type CoordinationPorts } from '../src/main/coordinator'
import { Store } from '../src/main/store'
import { observedEditorEvidence } from '../src/main/editor-evidence'
import { type TranscriptRecord } from '../src/main/editor-transcript'
import { reportEvidenceGaps, toolOperation, type ExecutionEvidence } from '../src/shared/return-evidence'
import type { Supervision } from '../src/shared/supervision'
import { pendingEditorRequests } from '../src/shared/card-return'

const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
function records(command = 'npx vercel inspect https://example.test'): TranscriptRecord[] {
  return [
    { type: 'user', uuid: 'owner', timestamp: '2026-09-22T21:03:00Z', message: { content: `[Omni Desktop authority:v1 request:${requestId}]\nConfira a publicação` } },
    { type: 'assistant', uuid: 'tool', timestamp: '2026-09-22T21:04:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command, description: 'Production Deploy', token: 'must-not-survive' } }] } },
    { type: 'user', uuid: 'result', timestamp: '2026-09-22T21:05:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Permission denied by auto mode classifier [Production Deploy]; token=must-not-survive', is_error: true }] } },
    { type: 'assistant', uuid: 'report', timestamp: '2026-09-22T21:06:00Z', message: { content: `[Omni Desktop report:${requestId} status:blocked]\nQuarta recusa do deploy nesta rodada.` } }
  ]
}
async function fixture(run: (s: Store, c: ReturnType<Store['get']>, ports: CoordinationPorts) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'omni-resolution-'))
  try {
    const store = new Store(dir); await store.load()
    const card = store.get(await store.create(dir))
    await run(store, card, { context: async () => '', sessions: async () => [], relay: async () => {}, open: async () => card.id, local: async () => card.id, executable: async () => 'test.exe' })
  } finally { await rm(dir, { recursive: true, maxRetries: 5 }) }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Timeout')
}
test('consulta recusada não vira tentativa de deploy nem carrega segredo', () => {
  const observation = observedEditorEvidence(records())[0]
  assert.equal(observation.executionEvidence?.calls[0].operation, 'inspect')
  assert.equal(observation.executionEvidence?.calls[0].outcome, 'denied')
  assert.doesNotMatch(JSON.stringify(observation.executionEvidence), /must-not-survive|example.test/)
  assert.equal(reportEvidenceGaps(observation.text, observation.executionEvidence).length, 1)
  assert.equal(reportEvidenceGaps(observation.text, { ...observation.executionEvidence!, complete: false }).length, 0)
  assert.equal(reportEvidenceGaps(observation.text, observedEditorEvidence(records('npx --no-install vercel --prod --cwd C:/tmp/app'))[0].executionEvidence).length, 0)
  assert.equal(toolOperation('Bash', { command: 'echo "vercel --prod"; git branch -r' }), 'inspect')
})

test('negação da aplicação com wrapper de shell bem-sucedido não provoca correção falsa', () => {
  const trace = records('npx --no-install vercel --prod 2>&1 | tail -30; echo EXIT: ${PIPESTATUS[0]}')
  trace[2].message!.content = [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: '{"status":"error","message":"Not authorized"}\n---- EXIT: 1 ----' }]
  const evidence = observedEditorEvidence(trace)[0].executionEvidence!
  assert.equal(evidence.calls[0].outcome, 'denied')
  assert.equal(evidence.calls[0].failureKind, 'permission')
  assert.equal(reportEvidenceGaps('A publicação foi recusada nesta rodada.', evidence).length, 0)
  const next = observedEditorEvidence(records())[0].executionEvidence!
  assert.equal(reportEvidenceGaps('A recusa do deploy foi na rodada anterior; nesta rodada apenas consultei.', next).length, 0)
  assert.equal(reportEvidenceGaps('A recusa do deploy nesta rodada já foi explicada.', next, [evidence]).length, 0)
  trace[2].message!.content = [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: '---- EXIT: 2 ----' }]
  assert.equal(observedEditorEvidence(trace)[0].executionEvidence!.calls[0].outcome, 'failed')
})

test('somente ponta da cadeia aparece como pedido pendente', () => {
  const base = { text: 'Conferir', at: '', status: 'reported' as const }
  assert.equal(pendingEditorRequests([{ ...base, id: 'a' }, { ...base, id: 'b', followupOf: 'a', status: 'completed' }]).length, 0)
  assert.equal(pendingEditorRequests([{ ...base, id: 'a' }]).length, 1)
})

test('supervisão consulta memória pelo briefing completo e não repete instrução idêntica', () => fixture(async (store, card, ports) => {
  let queryText = ''
  ports.context = async (_, text) => { queryText = text; return '' }
  const instruction = 'Confira o deployment existente sem repetir publicação.'
  const coordinator = new Coordinator(store, () => {}, ports, (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, structured_output: { action: 'retry', message: 'Vou conferir.', instruction, withinScope: true, needsOwner: false } }
  }) as unknown as typeof query)
  const review = await coordinator.reviewReturn(card, { objective: 'autorizado', executionBrief: 'Publicar GA4 no Hub via workflow existente.', correctionHistory: [instruction], retries: 1, state: 'reviewing' }, 'A mesma conferência foi feita.', 'completed')
  assert.match(queryText, /Publicar GA4 no Hub/)
  assert.equal(review.action, 'decision')
}))
test('divergência devolve conferência à mesma sessão sem decisão do dono', () => fixture(async (store, card, ports) => {
  card.kind = 'external'; card.sessionId = requestId
  const session = { sessionId: requestId, cwd: card.workspace, name: 'tracking', address: 'test', pid: 1 }
  let sent = ''; let count = 0
  ports.sessions = async () => [session]
  ports.relay = async (destination, text) => { assert.equal(destination.sessionId, requestId); sent = text; count++ }
  card.editorRequests = [{ id: requestId, text: 'Confira a publicação', at: '2026-09-22T21:02:00Z', status: 'sent', originConversationId: card.id, targetSessionId: requestId, targetName: session.name, supervision: { objective: 'Confira a publicação', retries: 0, state: 'executing' } }]
  const active = new Map<string, AbortController>()
  const coordinator = new Coordinator(store, () => {}, ports, (async function* () { throw new Error('Divergência determinística não precisa de modelo') }) as unknown as typeof query, active)
  await coordinator.observe(card, observedEditorEvidence(records()), true)
  await until(() => count === 1 && card.editorRequests?.length === 2 && card.editorRequests[0].supervision?.state === 'settled')
  assert.match(sent, /Conferência somente leitura/)
  assert.match(sent, /Não repita publicação/)
  assert.equal(card.editorRequests![1].supervision!.retries, 1)
  assert.equal(card.editorRequests![1].followupOf, requestId)
  await until(() => active.size === 0)
  await store.save()
  coordinator.stop()
}))
test('captura mensagem integral uma vez; consultas usam intenção, não templates', () => fixture(async (store, card, ports) => {
  const calls: { text: string; capture?: boolean }[] = []
  ports.context = async (_card, text, opts) => {
    calls.push({ text, capture: opts?.captureOwnerPrompt })
    if (opts?.captureOwnerPrompt) card.events.push({ kind: 'memory-write', turnId: opts.turnId, at: new Date().toISOString(), text: 'Memória gravada e sincronizada.' })
    return 'Contexto'
  }
  const fake = (async function* ({ options }: any) {
    if (!card.coordinationTurns?.every(turn => turn.state === 'done')) assert.match(options.systemPrompt, /Recibo factual de memória desta mensagem: Memória gravada e sincronizada/)
    if (options.outputFormat) card.messages.push({ id: 'newer-queued-owner', role: 'user', text: 'Outra demanda posterior na fila', at: new Date().toISOString(), channel: 'text' })
    yield options.outputFormat
      ? { type: 'result', subtype: 'success', is_error: false, structured_output: { action: 'reply', reply: 'Entendi.', sessionId: null, instruction: null } }
      : { type: 'result', subtype: 'success', is_error: false, result: 'Entendi.' }
  }) as unknown as typeof query
  const coordinator = new Coordinator(store, () => {}, ports, fake)
  const owner = `${'Contexto pertinente. '.repeat(30)}Prefiro textos curtos, mas explique em detalhe quando necessário.`
  await coordinator.enqueue(card, owner, 'text')
  await until(() => card.coordinationTurns?.[0].state === 'done')
  assert.equal(calls.filter(call => call.capture).length, 1)
  assert.ok(calls.every(call => call.text === owner))
  await coordinator.summarize(card, 'Comparar métricas GA4', 'Relato do executor', 'blocked')
  assert.deepEqual(calls.at(-1), { text: 'Comparar métricas GA4', capture: false })
  coordinator.stop()
}))
test('texto longo solicitado é permitido e não é cortado', () => fixture(async (store, card, ports) => {
  const long = 'Detalhe importante com evidência. '.repeat(120)
  const coordinator = new Coordinator(store, () => {}, ports, (async function* ({ prompt }: any) {
    assert.match(prompt, /não existe limite rígido/)
    assert.doesNotMatch(prompt, /até 400 palavras|no máximo três frases/)
    yield { type: 'result', subtype: 'success', is_error: false, result: long }
  }) as unknown as typeof query)
  assert.equal(await coordinator.summarize(card, 'Quero um relatório detalhado', 'Dados verificados', 'completed'), long.trim())
}))
test('bloqueio técnico ganha investigação; permissão negada não é contornada', () => fixture(async (store, card, ports) => {
  const evidence: ExecutionEvidence = { source: 'hooks', complete: true, calls: [{ id: 'read', tool: 'Read', operation: 'inspect', outcome: 'returned', at: '' }] }
  const supervision: Supervision = { objective: 'Corrija o teste', retries: 0, state: 'reviewing', executionEvidence: evidence }
  const coordinator = new Coordinator(store, () => {}, ports, (async function* () { yield { type: 'result', subtype: 'success', is_error: false, structured_output: { action: 'decision', withinScope: true, needsOwner: false, instruction: null, message: 'O teste falhou.', blocker: { kind: 'technical', title: 'Teste falhou', cause: 'Fixture desatualizada', risk: 'Entrega incompleta', remedy: 'Investigar fixture', continuation: null, desktopApproval: false } } } }) as unknown as typeof query)
  assert.equal((await coordinator.reviewReturn(card, supervision, 'Teste falhou', 'failed')).action, 'retry')
  assert.equal(supervision.recoveryAttempts, 1)
  assert.equal((await coordinator.reviewReturn(card, supervision, 'Teste falhou', 'failed')).action, 'decision')
  supervision.recoveryAttempts = 0; evidence.calls[0].outcome = 'denied'
  assert.equal((await coordinator.reviewReturn(card, supervision, 'Teste falhou', 'failed')).action, 'decision')
}))
