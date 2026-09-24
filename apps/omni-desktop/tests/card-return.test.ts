import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentCardReturn, cardMessageId, cardReturnBatch } from '../src/shared/card-return'
import type { ResultTicket } from '../src/shared/contracts'

const ticket = (id: string, at: string, extra: Partial<ResultTicket> = {}): ResultTicket => ({ id, at, source: 'vscode', title: id, conversationId: 'session-chat', originConversationId: 'central', deliveryConversationId: 'session-chat', state: 'ready', ...extra })
test('card prioriza o retorno atual, mas mantém o último lote não lido acessível', () => {
  const old = ticket('old', '2026-09-14T10:00:00Z', { previous: true })
  const latest = ticket('latest', '2026-09-14T11:00:00Z')
  const other = ticket('other', '2026-09-14T12:00:00Z', { conversationId: 'another-chat' })
  assert.equal(currentCardReturn([old, other, latest], 'session-chat')?.id, 'latest')
  assert.equal(currentCardReturn([old, other], 'session-chat')?.id, 'old')
  assert.equal(currentCardReturn([latest], 'session-chat', 'omni'), undefined)
  assert.deepEqual(cardReturnBatch([old, other, latest], 'session-chat', 'vscode', latest.id).map(item => item.id), ['old', 'latest'])
  const direct = ticket('direct', '2026-09-14T12:00:00Z', { kind: 'editor-response' })
  assert.deepEqual(cardReturnBatch([old, direct], 'session-chat', 'vscode', direct.id).map(item => item.id), ['direct'])
})
test('preparação ou revisão do resumo novo nunca cede lugar ao pronto antigo', () => {
  const old = ticket('old', '2026-09-14T10:00:00Z')
  for (const state of ['preparing', 'reviewing', 'working'] as const) {
    const latest = ticket('latest', '2026-09-14T11:00:00Z', { state })
    assert.equal(currentCardReturn([old, latest], 'session-chat')?.state, state)
  }
})
test('animação se vincula à mensagem exata e versão de evidência entregue', () => {
  assert.equal(cardMessageId(ticket('native', '', { kind: 'editor-response' })), 'native')
  assert.equal(cardMessageId(ticket('request', '', { evidenceId: 'v2' })), 'editor-report:request:v2')
  assert.equal(cardMessageId(ticket('task', '', { source: 'omni' })), 'report:task')
})
