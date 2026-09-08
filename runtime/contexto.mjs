import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBuildTurnContext } from '../dist/application/build-turn-context/build-turn-context.js'
import { lerAtalhos, registrarUsoAtalhos, selecionarAtalhosRelevantes } from './atalhos.mjs'
import { lerCicloOperacional } from './ciclo-operacional.mjs'
import { lerMemoria, registrarUsoMemorias } from './memoria.mjs'
import { lerPersistenciaContexto } from './persistencia-contexto.mjs'
import { lerPersonalidadeAtiva } from './personalidade.mjs'
import { ranquearMemorias } from './recuperacao.mjs'
import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const caminhos = {
  capabilityCatalog: join(raiz, 'contratos', 'capacidades', 'catalogo.json'),
  budgetPolicy: join(raiz, 'contratos', 'contexto', 'orcamento.json'),
  architecture: join(raiz, 'contratos', 'arquitetura', 'invariantes.json'),
  learnedRules: join(raiz, 'contratos', 'operacao', 'regras-aprendidas.json'),
  learnedProcedures: join(raiz, 'contratos', 'operacao', 'procedimentos-aprendidos.json')
}

async function lerJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

const construirContexto = createBuildTurnContext({
  loadMemory: lerMemoria,
  loadCapabilityCatalog: () => lerJson(caminhos.capabilityCatalog),
  loadPersonality: () => lerPersonalidadeAtiva({ pluginRoot: raiz }),
  loadBudgetPolicy: () => lerJson(caminhos.budgetPolicy),
  loadArchitecture: () => lerJson(caminhos.architecture),
  loadStructuredContext: lerPersistenciaContexto,
  loadOperationalCycle: async (home) => {
    const local = await lerCicloOperacional(home)
    try {
      const missions = await new NodeAccessBrokerClient().listActiveMissions()
      if (missions.length === 0) return local
      return { ...local, sessions: missions.map((mission) => ({ id: mission.id, state: mission.state, updatedAt: mission.updatedAt, objective: mission.objective, currentStep: typeof mission.payload.currentStep === 'string' ? mission.payload.currentStep : null })) }
    } catch { return local }
  },
  loadShortcuts: lerAtalhos,
  loadLearnedRules: () => lerJson(caminhos.learnedRules),
  loadLearnedProcedures: () => lerJson(caminhos.learnedProcedures),
  rankMemories: (confirmed, query) => ranquearMemorias(confirmed, query),
  selectShortcuts: (store, intent, query) => selecionarAtalhosRelevantes(store, intent, query),
  recordMemoryUsage: registrarUsoMemorias,
  recordShortcutUsage: registrarUsoAtalhos,
  shortHash: (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16),
  now: () => new Date()
})

export async function montarContexto(casa, options = {}) {
  return construirContexto(casa, options)
}
