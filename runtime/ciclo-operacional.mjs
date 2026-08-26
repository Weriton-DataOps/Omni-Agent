import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'

export const OPERATIONAL_CYCLE_SCHEMA_VERSION = 1
const CONTRACT_PATH = new URL('../contratos/operacao/ciclo.json', import.meta.url)

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function textoSeguro(value, maximum = 240) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text || pareceConterSegredo(text)) return null
  return text.slice(0, maximum)
}

async function contrato() {
  const value = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-operational-cycle-v1' ||
    !Number.isInteger(value.eventRetention) ||
    value.privacy?.storeRawConversation !== false ||
    value.privacy?.storeRawToolOutput !== false
  ) throw new Error('Contrato do ciclo operacional fora da versao 1.')
  return value
}

export function caminhoDoCiclo(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do ciclo operacional precisa ser absoluta.')
  return join(casa, 'runs', 'operational-cycle.json')
}

function vazio(at = agora()) {
  return {
    schemaVersion: OPERATIONAL_CYCLE_SCHEMA_VERSION,
    store: { id: 'omni-local-operational-cycle', createdAt: at, updatedAt: at },
    sessions: [],
    delegations: [],
    events: [],
    improvementCandidates: []
  }
}

function valido(store, path) {
  const dataValida = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  if (
    store?.schemaVersion !== 1 ||
    store.store?.id !== 'omni-local-operational-cycle' ||
    !dataValida(store.store.createdAt) ||
    !dataValida(store.store.updatedAt) ||
    !Array.isArray(store.sessions) ||
    !Array.isArray(store.delegations) ||
    !Array.isArray(store.events) ||
    !Array.isArray(store.improvementCandidates)
  ) throw new Error(`Ciclo operacional fora do contrato v1: ${path}`)
}

async function travar(casa) {
  const directory = join(casa, 'runs')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'operational-cycle.lock')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 10_000) await unlink(path).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('O ciclo operacional esta ocupado por outra escrita.')
}

async function carregar(casa) {
  const path = caminhoDoCiclo(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > OPERATIONAL_CYCLE_SCHEMA_VERSION) {
      throw new Error(`Ciclo operacional v${store.schemaVersion} e mais novo que este plugin.`)
    }
    valido(store, path)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: vazio(), initialized: true }
    throw error
  }
}

async function salvar(casa, store) {
  const path = caminhoDoCiclo(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = agora()
  valido(store, path)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function alterar(casa, mutate) {
  const release = await travar(casa)
  try {
    const loaded = await carregar(casa)
    const result = await mutate(loaded.store, await contrato())
    await salvar(casa, loaded.store)
    return result
  } finally {
    await release()
  }
}

export async function lerCicloOperacional(casa) {
  return alterar(casa, (store) => store)
}

export async function observarEvento(casa, input, { at } = {}) {
  const eventType = textoSeguro(input?.eventType, 60)
  if (!eventType) return { result: 'ignored', reason: 'event-type' }
  const recordedAt = agora(at)
  const sessionFingerprint = hash(input?.sessionId || 'session-unknown')
  const evidenceFingerprint = hash(input?.evidenceId || `${eventType}:${sessionFingerprint}:${recordedAt}`)
  const summary = textoSeguro(input?.summary)
  return alterar(casa, (store, policy) => {
    if (store.events.some((item) => item.evidenceFingerprint === evidenceFingerprint)) {
      return { result: 'duplicate', event: null }
    }
    const event = {
      id: `event-${randomUUID()}`,
      eventType,
      sessionFingerprint,
      evidenceFingerprint,
      status: textoSeguro(input?.status, 40) ?? 'observed',
      toolName: textoSeguro(input?.toolName, 100),
      summary,
      durationMs: Number.isFinite(input?.durationMs) && input.durationMs >= 0 ? Math.round(input.durationMs) : null,
      recordedAt
    }
    store.events = [...store.events, event].slice(-policy.eventRetention)
    const existing = store.sessions.find((item) => item.sessionFingerprint === sessionFingerprint)
    const session = existing ?? {
      id: `session-${randomUUID()}`,
      sessionFingerprint,
      cwdFingerprint: hash(input?.cwd || ''),
      objective: null,
      currentStep: null,
      openTasks: [],
      state: 'active',
      startedAt: recordedAt,
      updatedAt: recordedAt
    }
    session.updatedAt = recordedAt
    if (eventType === 'user-prompt' && summary) {
      session.currentStep = summary
      const objective = textoSeguro(input?.objective, 240)
      if (objective) session.objective = objective
    }
    if (eventType === 'stop') session.state = 'waiting-user'
    if (eventType === 'session-end') session.state = 'closed'
    if (!existing) store.sessions = [...store.sessions, session].slice(-policy.sessionRetention)
    return { result: 'recorded', event, session }
  })
}

export async function prepararDelegacao(casa, input, { at } = {}) {
  const prompt = textoSeguro(input?.prompt, 2000)
  const target = textoSeguro(input?.target, 240)
  if (!prompt || !target) throw new Error('Delegacao exige destino e prompt seguros.')
  const timestamp = agora(at)
  return alterar(casa, (store, policy) => {
    const item = {
      id: `delegation-${randomUUID()}`,
      sessionFingerprint: hash(input?.sessionId || 'session-unknown'),
      target,
      promptSummary: `Prompt de delegacao preparado (${prompt.length} caracteres)`,
      promptFingerprint: hash(prompt),
      state: 'prepared',
      visiblePromptConfirmed: false,
      evidenceFingerprint: null,
      resultSummary: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    store.delegations = [...store.delegations, item].slice(-policy.delegationRetention)
    return { result: 'prepared', delegation: item }
  })
}

export async function atualizarDelegacao(casa, id, state, input = {}, { at } = {}) {
  const timestamp = agora(at)
  return alterar(casa, (store, policy) => {
    if (!policy.delegation.states.includes(state)) throw new Error(`Estado de delegacao invalido: ${state}`)
    const item = store.delegations.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Delegacao inexistente: ${id}`)
    item.state = state
    item.updatedAt = timestamp
    if (state === 'visible') item.visiblePromptConfirmed = true
    if (state === 'completed') {
      item.evidenceFingerprint = hash(input?.evidence || `${id}:${timestamp}`)
      item.resultSummary = textoSeguro(input?.summary)
    }
    return { result: state, delegation: item }
  })
}

export async function observarDelegacao(casa, input, { at } = {}) {
  const state = input?.state
  const timestamp = agora(at)
  return alterar(casa, (store, policy) => {
    const agentId = textoSeguro(input?.agentId, 240)
    if (!agentId) return { result: 'ignored', delegation: null }
    const fingerprint = hash(agentId)
    let item = store.delegations.find((candidate) => candidate.agentFingerprint === fingerprint)
    if (!item) {
      item = {
        id: `delegation-${randomUUID()}`,
        sessionFingerprint: hash(input?.sessionId || 'session-unknown'),
        agentFingerprint: fingerprint,
        target: textoSeguro(input?.agentType, 240) ?? 'agent',
        promptSummary: null,
        promptFingerprint: null,
        state: 'running',
        visiblePromptConfirmed: true,
        evidenceFingerprint: null,
        resultSummary: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      store.delegations = [...store.delegations, item].slice(-policy.delegationRetention)
    }
    item.state = state
    item.updatedAt = timestamp
    if (state === 'completed') {
      item.evidenceFingerprint = hash(input?.evidence || `${agentId}:${timestamp}`)
      item.resultSummary = textoSeguro(input?.summary)
    }
    return { result: state, delegation: item }
  })
}

export async function proporMelhoriaOperacional(casa, input, { at } = {}) {
  const category = textoSeguro(input?.category, 80)
  const destination = textoSeguro(input?.destination, 80)
  const statement = textoSeguro(input?.statement, 500)
  if (!category || !destination || !statement) return { result: 'ignored', candidate: null }
  const timestamp = agora(at)
  const fingerprint = hash(`${category}:${destination}:${statement.toLowerCase()}`)
  return alterar(casa, (store, policy) => {
    const existing = store.improvementCandidates.find((item) => item.fingerprint === fingerprint)
    if (existing) {
      existing.occurrences += 1
      if (existing.occurrences >= 2) existing.status = 'ready'
      existing.updatedAt = timestamp
      return { result: 'reinforced', candidate: existing }
    }
    const candidate = {
      id: `improvement-${randomUUID()}`,
      fingerprint,
      category,
      destination,
      statement,
      status: 'observing',
      occurrences: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    store.improvementCandidates = [...store.improvementCandidates, candidate].slice(-policy.improvementRetention)
    return { result: 'observing', candidate }
  })
}

export async function marcarMelhoriaOperacional(casa, id, input = {}, { at } = {}) {
  const timestamp = agora(at)
  return alterar(casa, (store) => {
    const candidate = store.improvementCandidates.find((item) => item.id === id)
    if (!candidate) throw new Error(`Melhoria operacional inexistente: ${id}`)
    candidate.status = input.status ?? candidate.status
    candidate.artifact = textoSeguro(input.artifact, 500)
    candidate.materializedAt = candidate.status === 'materialized' ? timestamp : null
    candidate.updatedAt = timestamp
    return { result: candidate.status, candidate }
  })
}
