// Cerebro da superficie "Agora": recebe missoes (operations.missions com o eixo
// de tempo da migration 005) e decide o que merece atencao do proprietario agora,
// com o motivo ao lado. Logica pura e testavel; a tela apenas renderiza isto.

export interface MissionRow {
  missionId: string
  objective: string
  state: 'open' | 'in-progress' | 'blocked' | 'completed' | 'cancelled'
  priority: number
  dueAt?: string | null
  scheduledAt?: string | null
  lastMovementAt?: string | null
  updatedAt: string
  payload?: { nextAction?: string | null; currentStep?: string | null; project?: string | null } | null
}

export type AgoraCategory = 'overdue' | 'blocked' | 'due-soon' | 'scheduled' | 'stale' | 'active'

export interface AgoraItem {
  missionId: string
  objective: string
  state: MissionRow['state']
  category: AgoraCategory
  reason: string
  nextAction: string | null
  project: string | null
  dueAt: string | null
  ageDays: number
}

export interface AgoraView {
  items: AgoraItem[]
  counts: Record<AgoraCategory, number> & { total: number }
}

export interface AgoraOptions {
  agingDays?: number
  dueSoonHours?: number
}

const CLOSED = new Set(['completed', 'cancelled'])
const ORDER: AgoraCategory[] = ['overdue', 'blocked', 'due-soon', 'scheduled', 'active', 'stale']
const ms = (value: string | number | Date): number =>
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
const dayFloor = (from: number, to: number) => Math.max(0, Math.floor((to - from) / 86_400_000))

function classify(mission: MissionRow, nowMs: number, agingMs: number, dueSoonMs: number, ageDays: number): { category: AgoraCategory; reason: string } {
  const dueMs = mission.dueAt ? ms(mission.dueAt) : null
  if (dueMs !== null && dueMs < nowMs) return { category: 'overdue', reason: `Prazo estourado ha ${dayFloor(dueMs, nowMs)} dia(s).` }
  if (mission.state === 'blocked') return { category: 'blocked', reason: 'Bloqueada; aguardando decisao ou dependencia.' }
  if (dueMs !== null && dueMs - nowMs <= dueSoonMs) return { category: 'due-soon', reason: `Vence em ${Math.max(1, Math.ceil((dueMs - nowMs) / 86_400_000))} dia(s).` }
  const schedMs = mission.scheduledAt ? ms(mission.scheduledAt) : null
  if (schedMs !== null && schedMs <= nowMs) return { category: 'scheduled', reason: 'Agendada para agora ou antes.' }
  if (ageDays * 86_400_000 >= agingMs) return { category: 'stale', reason: `Parada ha ${ageDays} dia(s) sem movimento.` }
  return { category: 'active', reason: mission.state === 'in-progress' ? 'Em andamento.' : 'Aberta, aguardando proxima acao.' }
}

/** Ordena missoes abertas pelo que exige atencao agora e explica cada escolha. */
export function buildAgoraView(missions: MissionRow[], now: string | number | Date = new Date(), options: AgoraOptions = {}): AgoraView {
  const nowMs = ms(now)
  const agingMs = (options.agingDays ?? 14) * 86_400_000
  const dueSoonMs = (options.dueSoonHours ?? 48) * 3_600_000
  const counts: AgoraView['counts'] = { overdue: 0, blocked: 0, 'due-soon': 0, scheduled: 0, active: 0, stale: 0, total: 0 }

  const items = missions
    .filter((mission) => mission && !CLOSED.has(mission.state) && typeof mission.objective === 'string')
    .map((mission): AgoraItem => {
      const lastMovement = ms(mission.lastMovementAt || mission.updatedAt)
      const ageDays = Number.isFinite(lastMovement) ? dayFloor(lastMovement, nowMs) : 0
      const { category, reason } = classify(mission, nowMs, agingMs, dueSoonMs, ageDays)
      counts[category] += 1
      counts.total += 1
      return {
        missionId: mission.missionId,
        objective: mission.objective,
        state: mission.state,
        category,
        reason,
        nextAction: mission.payload?.nextAction ?? mission.payload?.currentStep ?? null,
        project: mission.payload?.project ?? null,
        dueAt: mission.dueAt ?? null,
        ageDays
      }
    })
    .sort((a, b) => {
      const rank = ORDER.indexOf(a.category) - ORDER.indexOf(b.category)
      if (rank !== 0) return rank
      const missionA = missions.find((m) => m.missionId === a.missionId)!
      const missionB = missions.find((m) => m.missionId === b.missionId)!
      if (missionB.priority !== missionA.priority) return missionB.priority - missionA.priority
      if (a.dueAt && b.dueAt) return ms(a.dueAt) - ms(b.dueAt)
      return b.ageDays - a.ageDays
    })

  return { items, counts }
}
