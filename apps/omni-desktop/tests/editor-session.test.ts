import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editorExecution, latestEditorReturn, mainTranscript, observeEditorRecords, observeNaturalCompletion, type TranscriptRecord } from '../src/main/editor-transcript'
import { editorSessions, readEditor } from '../src/main/vscode-sessions'
import { updateEditorReturn } from '../src/main/editor-return-state'
import type { Conversation } from '../src/shared/contracts'

const requestId = '426a5b93-fa4b-43ca-811f-8397846ef455'
const session = { sessionId: '48c6097c-533c-4bc9-bff9-2fd569ad08fd', cwd: 'y:\\Equipe\\Site Exemplo' }
const at = '2026-09-14T17:43:28.395Z'
const record = (uuid: string, parentUuid: string | null, content: unknown, stop_reason?: string): TranscriptRecord => ({
  uuid, parentUuid, type: 'assistant', timestamp: at, message: { content, stop_reason }
})
const receipt = record('receipt', null, [{ type: 'text', text: `[Omni Desktop received:${requestId}] Recebido.` }], 'tool_use')
const tool = record('tool', 'receipt', [{ type: 'tool_use', id: 'call', name: 'Read', input: {} }], 'tool_use')
const records = (...items: TranscriptRecord[]) => new Map(items.map(item => [item.uuid!, item]))

test('sessões VS Code exigem o pipe de mensagens vivo, não somente PID e registro antigo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-live-pipe-'))
  try {
    const socket = String.raw`\\.\pipe\cc-msg-${'a'.repeat(32)}`
    await writeFile(join(directory, '123.json'), JSON.stringify({ entrypoint: 'claude-vscode', sessionId: '48c6097c-533c-4bc9-bff9-2fd569ad08fd', cwd: directory, name: 'Projeto', pid: 123, messagingSocketPath: socket }))
    const live = await editorSessions({ directory, processAlive: () => {}, pipeLive: async path => path === socket })
    const stale = await editorSessions({ directory, processAlive: () => {}, pipeLive: async () => false })
    assert.equal(live.length, 1)
    assert.equal(stale.length, 0)
  } finally { await rm(directory, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})

test('histórico por UUID recupera recibo e execução mesmo quando o SDK não encontra o drive mapeado', async () => {
  let sdkCalls = 0
  const reading = await readEditor(session, {
    metadata: async id => { assert.equal(id, session.sessionId); return records(receipt, tool) },
    messages: async () => { sdkCalls++; return [] }, subagents: async () => []
  })
  assert.equal(sdkCalls, 0)
  assert.equal(reading.messages.length, 1)
  assert.deepEqual(reading.observations.map(o => [o.requestId, o.kind]), [[requestId, 'received']])
  assert.deepEqual(reading.execution, { state: 'running', at, evidenceId: 'tool', requestId })
})

test('erro do leitor auxiliar não impede histórico nem recibo persistido', async () => {
  const reading = await readEditor(session, {
    metadata: async () => records(receipt, tool), messages: async () => { throw new Error('SDK indisponível') },
    subagents: async () => { throw new Error('Sem diretório de subagentes') }
  })
  assert.equal(reading.execution?.state, 'running')
  assert.equal(reading.observations[0].requestId, requestId)
})

test('dois relatórios no mesmo bloco retornam aos dois cards, sem reenvio', () => {
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  const combined = record('coalesced', null, `[Omni Desktop report:${first} status:completed]\nPrimeiro concluído.\n\n[Omni Desktop report:${second} status:completed]\nSegundo concluído.`, 'end_turn')
  const observations = observeEditorRecords(combined)
  assert.deepEqual(observations.map(event => [event.requestId, event.kind, event.text]), [[first, 'completed', 'Primeiro concluído.'], [second, 'completed', 'Segundo concluído.']])
  assert.notEqual(observations[0].evidenceId, observations[1].evidenceId)
})

test('end_turn seguido de atividade técnica deixa sessão ociosa sem inventar sucesso', () => {
  const end = record('end', 'tool', [{ type: 'text', text: 'Preciso de uma decisão.' }], 'end_turn')
  const hook: TranscriptRecord = { uuid: 'hook', parentUuid: 'end', type: 'attachment', timestamp: at }
  const side = { ...tool, uuid: 'side', parentUuid: 'hook', isSidechain: true }
  const main = mainTranscript(records(receipt, tool, end, hook, side))
  assert.equal(editorExecution(main).state, 'idle')
  assert.equal(observeNaturalCompletion(main).length, 0)
})

test('recibo não expira por silêncio, nova ferramenta reacende e interrupção encerra', () => {
  assert.equal(editorExecution([receipt, tool]).state, 'running')
  const end = record('end', 'tool', [{ type: 'text', text: 'Resposta.' }], 'end_turn')
  assert.equal(editorExecution([receipt, tool, end]).state, 'idle')
  assert.equal(editorExecution([receipt, tool, end, { ...tool, uuid: 'next' }]).state, 'running')
  const interrupted: TranscriptRecord = { type: 'user', uuid: 'cancel', timestamp: at, message: { content: '[Request interrupted by user]' } }
  assert.equal(editorExecution([receipt, tool, interrupted]).state, 'idle')
})

test('rodada automática concluída não se passa por nova fala do proprietário', () => {
  const desktopRequest: TranscriptRecord = { type: 'user', uuid: 'desktop-request', timestamp: '2026-09-15T11:00:00Z', message: { content: `[Omni Desktop authority:v1 request:${requestId}]\nExecutar.` } }
  const report = { ...record('desktop-report', 'desktop-request', `[Omni Desktop report:${requestId} status:completed]\nConcluído.`, 'end_turn'), timestamp: '2026-09-15T11:01:00Z' }
  const execution = editorExecution([desktopRequest, report])
  assert.equal(execution.state, 'idle')
  assert.equal(execution.turnSource, 'desktop')
  assert.equal(execution.turnStartedAt, desktopRequest.timestamp)
})

test('interrupção conserva o início da rodada nova para não reapresentar resposta antiga', () => {
  const owner: TranscriptRecord = { type: 'user', uuid: 'owner', timestamp: '2026-09-15T10:00:00Z', message: { content: 'Pedido anterior' } }
  const answer = { ...record('answer', 'owner', 'Resposta anterior', 'end_turn'), timestamp: '2026-09-15T10:01:00Z' }
  const next = { ...owner, uuid: 'next', timestamp: '2026-09-15T11:00:00Z' }
  const cancelled = { ...owner, uuid: 'cancel', timestamp: '2026-09-15T11:01:00Z', message: { content: '[Request interrupted by user]' } }
  const history = [owner, answer, next, cancelled]
  assert.equal(editorExecution(history).state, 'idle')
  assert.equal(editorExecution(history).turnStartedAt, next.timestamp)
  assert.ok(latestEditorReturn(history, session.sessionId)!.at < editorExecution(history).turnStartedAt!)
})

test('ramo abandonado e texto dentro de ferramentas não são recibos nem execução do pai', async () => {
  const abandoned = record('abandoned', 'receipt', [{ type: 'text', text: `[Omni Desktop report:${requestId} status:completed] Feito.` }], 'end_turn')
  const side = { ...abandoned, uuid: 'side', parentUuid: 'tool', isSidechain: true }
  const reading = await readEditor(session, {
    metadata: async () => records(receipt, abandoned, tool, side), messages: async () => [], subagents: async () => []
  })
  assert.equal(reading.execution?.state, 'running')
  assert.deepEqual(reading.observations.map(o => o.kind), ['received'])
})

test('comentário sobre trabalho já feito durante tool_use não conclui a tarefa atual', () => {
  const command: TranscriptRecord = { type: 'user', uuid: 'command', timestamp: at, message: { content: `[Omni Desktop authority:v1 request:${requestId}]` } }
  const commentary = record('commentary', 'command', [{ type: 'text', text: 'Deploy anterior concluído. Vou conferir agora.' }], 'tool_use')
  assert.equal(observeNaturalCompletion([command, commentary]).length, 0)
})

test('resposta direta nova vira retorno próprio, sem reciclar relatório antigo do Desktop', async () => {
  const old = record('old', null, [{ type: 'text', text: `[Omni Desktop report:${requestId} status:completed] Proposta antiga.` }], 'end_turn')
  const owner: TranscriptRecord = { uuid: 'owner', parentUuid: 'old', type: 'user', timestamp: at, message: { content: 'Preciso das respostas da landing page nova.' } }
  const answer = record('answer', 'owner', [{ type: 'text', text: 'Diagnóstico atual: formulário estava em modo mock.' }], 'end_turn')
  const tail = record('tail', 'answer', [{ type: 'text', text: 'Patch preparado; publicação ainda não confirmada.' }], 'end_turn')
  const next = { ...tool, uuid: 'next', parentUuid: 'tail' }
  const reading = await readEditor(session, { metadata: async () => records(old, owner, answer, tail, next), messages: async () => [], subagents: async () => [] })
  assert.equal(reading.latestReturn?.evidenceId, 'tail')
  assert.equal(reading.latestReturn?.turnId, 'owner')
  assert.equal(reading.latestReturn?.sessionId, session.sessionId)
  assert.match(reading.latestReturn!.report, /modo mock/)
  assert.match(reading.latestReturn!.report, /publicação ainda não confirmada/)
  assert.doesNotMatch(reading.latestReturn!.report, /Proposta antiga/)
  assert.equal(reading.observations.length, 1, 'resposta direta não conclui pedido do Desktop')
  assert.equal(reading.execution?.state, 'running', 'retorno disponível não apaga nova execução')
})

test('ferramentas, resumo de compactação, sidechains e mensagens encaminhadas não viram resposta direta', () => {
  const user: TranscriptRecord = { type: 'user', uuid: 'owner', timestamp: at, message: { content: 'Verifique a LP.' } }
  const answer = record('answer', 'owner', [{ type: 'text', text: 'Resposta' }], 'end_turn')
  const relay: TranscriptRecord = { ...user, uuid: 'relay', isMeta: true, message: { content: `<cross-session-message from-name="courier">[Omni Desktop authority:v1 request:${requestId}] Execute.</cross-session-message>` } }
  assert.equal(latestEditorReturn([user, tool], session.sessionId), undefined)
  assert.equal(latestEditorReturn([user, { ...answer, isSidechain: true }], session.sessionId), undefined)
  assert.equal(latestEditorReturn([user, relay, answer], session.sessionId), undefined)
  assert.equal(latestEditorReturn([{ ...user, isCompactSummary: true }, answer], session.sessionId), undefined)
  assert.equal(latestEditorReturn([user, answer, relay, { ...answer, uuid: 'other' }], session.sessionId)?.evidenceId, 'answer')
})

test('automode off não vira objetivo nem mistura o diagnóstico anterior com o resultado posterior', () => {
  const user: TranscriptRecord = { type: 'user', uuid: 'owner', timestamp: at, message: { content: 'Publicar a página.' } }
  const before = record('before', 'owner', [{ type: 'text', text: 'Ainda não publicou.' }], 'end_turn')
  const control = { ...user, uuid: 'control', message: { content: 'automode off' } }
  const after = record('after', 'control', [{ type: 'text', text: 'Publicação realizada.' }], 'end_turn')
  const result = latestEditorReturn([user, before, control, after], session.sessionId)!
  assert.equal(result.objective, 'Publicar a página.'); assert.equal(result.evidenceId, 'after')
  assert.doesNotMatch(result.report, /Ainda não publicou/)
  assert.equal(latestEditorReturn([control, after], session.sessionId)?.objective, 'Continuação do trabalho nesta sessão')
})

test('ajuste de rótulo atualiza retorno pendente sem ressuscitar retorno lido nem regredir a evidência', () => {
  const original = { id: 'return', sessionId: session.sessionId, evidenceId: 'evidence', turnId: 'control', at, objective: 'automode off', report: 'Relato', deliveryState: 'ready' as const }
  const c = { sessionId: session.sessionId, editorReturn: original } as Conversation
  const corrected = { ...original, objective: 'Continuação do trabalho nesta sessão' }
  assert.equal(updateEditorReturn(c, corrected), true); assert.equal(c.editorReturn?.objective, corrected.objective)
  assert.equal(updateEditorReturn(c, { ...original, sessionId: 'different' }), false)
  c.editorReturn!.acknowledgedAt = at; c.editorReturn!.deliveryState = 'delivered'
  assert.equal(updateEditorReturn(c, { ...corrected, objective: 'Título esclarecido' }), true)
  assert.equal(c.editorReturn!.acknowledgedAt, at); assert.equal(c.editorReturn!.deliveryState, 'delivered')
  assert.equal(updateEditorReturn(c, { ...original, id: 'old', at: '2026-09-10T00:00:00.000Z' }), false)
})
