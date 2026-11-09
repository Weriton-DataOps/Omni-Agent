import { comBancoDaCasa } from './casa/banco.mjs'
import { encerrarMissoesPodadas, gravarMissoes } from './casa/loja-operacao.mjs'
import { lerCicloOperacional } from './ciclo-operacional.mjs'

function state(value) { return value === 'closed' ? 'completed' : value === 'waiting-user' ? 'blocked' : 'in-progress' }

export function idDaMissao(session) { return `mission-${session.id.replace(/^session-/, '')}` }

export function missaoDaSessao(session) {
  return {
    id: idDaMissao(session),
    objective: session.objective,
    state: state(session.state),
    priority: 70,
    payload: { sessionId: session.id, currentStep: session.currentStep, openTasks: session.openTasks, nextAction: session.nextAction ?? null, dueAt: session.dueAt ?? null, scheduledAt: session.scheduledAt ?? null, lastMovementAt: session.lastMovementAt ?? session.updatedAt },
    createdAt: session.startedAt,
    updatedAt: session.updatedAt,
    closedAt: session.state === 'closed' ? session.updatedAt : null
  }
}

/**
 * O ciclo local (runs/operational-cycle.json) é o cache de trabalho; o omni.db guarda o histórico
 * das missões. A retenção local poda sessões por ordem de chegada; a missão de uma sessão podada
 * que ficou ativa no banco é encerrada aqui, para não virar fantasma no contexto.
 */
export async function sincronizarMissoesDuraveis(casa) {
  const cycle = await lerCicloOperacional(casa)
  const sessions = cycle.sessions ?? []
  const missoes = sessions.filter((session) => session.objective).map(missaoDaSessao)
  const inicios = sessions.map((session) => session.startedAt).filter((valor) => typeof valor === 'string').sort()
  return comBancoDaCasa(casa, 'omni', (db) => {
    const gravadas = gravarMissoes(db, missoes)
    const { encerradas } = encerrarMissoesPodadas(db, { idsVivos: sessions.map(idDaMissao), maisAntiga: inicios[0] ?? null })
    return { result: 'synced', missions: missoes.length, ...gravadas, encerradas }
  })
}
