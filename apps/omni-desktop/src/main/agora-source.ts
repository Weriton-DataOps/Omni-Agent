import { home, moduleAt } from './runtime'
import { buildAgoraView, missionsFromSessions, type AgoraView, type SessionRow } from '../shared/agora'

// Le as sessoes do ciclo operacional (objetivo + eixo de tempo) e devolve a
// visao "Agora" ja ranqueada. Leitura pura; nao dispara execucao nem escreve.
export async function agoraView(now: Date = new Date()): Promise<AgoraView> {
  try {
    const ciclo = await moduleAt('runtime/ciclo-operacional.mjs')
    const cycle = await ciclo.lerCicloOperacional(home)
    const sessions = Array.isArray(cycle?.sessions) ? (cycle.sessions as SessionRow[]) : []
    return buildAgoraView(missionsFromSessions(sessions), now)
  } catch {
    return { items: [], counts: { overdue: 0, blocked: 0, 'due-soon': 0, scheduled: 0, active: 0, stale: 0, total: 0 } }
  }
}
