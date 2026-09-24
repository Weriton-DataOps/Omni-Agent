import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAgoraView, type MissionRow } from '../src/shared/agora'

const NOW = Date.parse('2026-09-24T12:00:00.000Z')
const dias = (n: number) => new Date(NOW + n * 86_400_000).toISOString()

const mission = (over: Partial<MissionRow> & Pick<MissionRow, 'missionId' | 'objective'>): MissionRow => ({
  state: 'open', priority: 50, dueAt: null, scheduledAt: null,
  lastMovementAt: dias(0), updatedAt: dias(0), payload: null, ...over
})

test('missao com prazo estourado vem primeiro, com o motivo', () => {
  const view = buildAgoraView([
    mission({ missionId: 'mission-a', objective: 'tarefa comum' }),
    mission({ missionId: 'mission-b', objective: 'entrega atrasada', dueAt: dias(-2) })
  ], NOW)
  assert.equal(view.items[0].missionId, 'mission-b')
  assert.equal(view.items[0].category, 'overdue')
  assert.match(view.items[0].reason, /estourado ha 2 dia/)
})

test('bloqueada e prazo-proximo entram nas categorias certas', () => {
  const view = buildAgoraView([
    mission({ missionId: 'mission-block', objective: 'travada', state: 'blocked' }),
    mission({ missionId: 'mission-due', objective: 'vence amanha', dueAt: dias(1) })
  ], NOW)
  const byId = Object.fromEntries(view.items.map((i) => [i.missionId, i]))
  assert.equal(byId['mission-block'].category, 'blocked')
  assert.equal(byId['mission-due'].category, 'due-soon')
  assert.equal(view.counts.blocked, 1)
  assert.equal(view.counts['due-soon'], 1)
})

test('missao parada ha muito tempo vira stale (o medo da ideia morrendo)', () => {
  const view = buildAgoraView([
    mission({ missionId: 'mission-velha', objective: 'ideia esquecida', lastMovementAt: dias(-40), updatedAt: dias(-40) })
  ], NOW, { agingDays: 14 })
  assert.equal(view.items[0].category, 'stale')
  assert.equal(view.items[0].ageDays, 40)
  assert.match(view.items[0].reason, /Parada ha 40 dia/)
})

test('missoes fechadas nao aparecem', () => {
  const view = buildAgoraView([
    mission({ missionId: 'mission-done', objective: 'concluida', state: 'completed' }),
    mission({ missionId: 'mission-cancel', objective: 'cancelada', state: 'cancelled' }),
    mission({ missionId: 'mission-viva', objective: 'ativa' })
  ], NOW)
  assert.equal(view.counts.total, 1)
  assert.equal(view.items[0].missionId, 'mission-viva')
})

test('proxima acao e projeto saem do payload', () => {
  const view = buildAgoraView([
    mission({ missionId: 'mission-x', objective: 'station', payload: { nextAction: 'definir criterios do auditor', project: 'Station' } })
  ], NOW)
  assert.equal(view.items[0].nextAction, 'definir criterios do auditor')
  assert.equal(view.items[0].project, 'Station')
})

test('empatanto categoria, prioridade maior vem antes', () => {
  const view = buildAgoraView([
    mission({ missionId: 'mission-baixa', objective: 'baixa', priority: 10 }),
    mission({ missionId: 'mission-alta', objective: 'alta', priority: 90 })
  ], NOW)
  assert.equal(view.items[0].missionId, 'mission-alta')
})

test('sem missoes, view vazia e coerente', () => {
  const view = buildAgoraView([], NOW)
  assert.deepEqual(view.items, [])
  assert.equal(view.counts.total, 0)
})
