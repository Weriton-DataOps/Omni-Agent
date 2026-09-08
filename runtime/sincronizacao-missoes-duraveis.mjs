import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'
import { lerCicloOperacional } from './ciclo-operacional.mjs'

function state(value) { return value === 'closed' ? 'completed' : value === 'waiting-user' ? 'blocked' : 'in-progress' }

export async function sincronizarMissoesDuraveis(casa) {
  const cycle = await lerCicloOperacional(casa)
  const broker = new NodeAccessBrokerClient()
  let count = 0
  for (const session of cycle.sessions) {
    if (!session.objective) continue
    await broker.upsertMission({ id: `mission-${session.id.replace(/^session-/, '')}`, objective: session.objective, state: state(session.state), priority: 70, payload: { sessionId: session.id, currentStep: session.currentStep, openTasks: session.openTasks }, createdAt: session.startedAt, updatedAt: session.updatedAt, closedAt: session.state === 'closed' ? session.updatedAt : null })
    count += 1
  }
  return { result: 'synced', missions: count }
}
