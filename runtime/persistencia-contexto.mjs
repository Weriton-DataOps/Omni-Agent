import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'

export const STRUCTURED_CONTEXT_SCHEMA_VERSION = 2
const POLICY_PATH = new URL('../contratos/contexto/persistencia.json', import.meta.url)

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeText(value, label, minimum = 1, maximum = 1000) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} precisa ter entre ${minimum} e ${maximum} caracteres.`)
  }
  if (pareceConterSegredo(text)) throw new Error(`${label} parece conter segredo.`)
  return text
}

function containsForbiddenField(value, forbidden) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((item) => containsForbiddenField(item, forbidden))
  return Object.entries(value).some(
    ([key, nested]) => forbidden.includes(key) || containsForbiddenField(nested, forbidden)
  )
}

async function readPolicy() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'))
  if (
    policy?.schemaVersion !== 1 ||
    policy.policy !== 'structured-context-persistence-v1' ||
    !Number.isInteger(policy.maximumCheckpoints) ||
    !Number.isInteger(policy.maximumBacklogItems) ||
    !Array.isArray(policy.requiredTaskFields) ||
    !Array.isArray(policy.forbiddenFields) ||
    policy.storeRawConversation !== false
  ) {
    throw new Error('Política de persistência estruturada fora do contrato v1.')
  }
  return policy
}

export function caminhoDaPersistenciaContexto(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa da persistência de contexto precisa ser absoluta.')
  return join(casa, 'runs', 'structured-context.json')
}

function emptyStore(createdAt = now()) {
  return {
    schemaVersion: STRUCTURED_CONTEXT_SCHEMA_VERSION,
    store: { id: 'omni-local-structured-context', createdAt, updatedAt: createdAt },
    checkpoints: [],
    backlog: [],
    resolvedDiscoveries: []
  }
}

export function validarDefinicaoTarefa(task) {
  const objective = safeText(task?.objective, 'Objetivo', 3, 500)
  const arrayFields = [
    ['scope', 'Escopo'],
    ['nonGoals', 'Non-goals'],
    ['requirements', 'Requisitos'],
    ['successCriteria', 'Critérios de sucesso'],
    ['definitionOfDone', 'Definition of Done'],
    ['knownConstraints', 'Restrições conhecidas']
  ]
  const normalized = { objective }
  for (const [field, label] of arrayFields) {
    if (!Array.isArray(task?.[field]) || task[field].length === 0 || task[field].length > 30) {
      throw new Error(`${label} precisa ter entre 1 e 30 itens.`)
    }
    normalized[field] = task[field].map((item) => safeText(item, label, 1, 240))
  }
  return normalized
}

function limitedItems(value, label, limit) {
  if (value === undefined) return { items: [], dropped: 0 }
  if (!Array.isArray(value)) throw new Error(`${label} precisa ser uma lista.`)
  const normalized = value.map((item) => safeText(item, label, 1, 240))
  return { items: normalized.slice(0, limit), dropped: Math.max(0, normalized.length - limit) }
}

function checkpointValid(item) {
  const taskArrays = ['scope', 'nonGoals', 'requirements', 'successCriteria', 'definitionOfDone', 'knownConstraints']
  const stateArrays = ['decisions', 'openTasks', 'eventRefs', 'artifactRefs', 'memoryRefs']
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('checkpoint-') &&
      typeof item.runFingerprint === 'string' && /^[a-f0-9]{64}$/.test(item.runFingerprint) &&
      typeof item.task?.objective === 'string' && item.task.objective.length >= 3 &&
      taskArrays.every((field) =>
        Array.isArray(item.task[field]) && item.task[field].length > 0 &&
        item.task[field].every((value) => typeof value === 'string' && value.length <= 240)
      ) &&
      typeof item.state?.summary === 'string' && item.state.summary.length >= 3 && item.state.summary.length <= 800 &&
      stateArrays.every((field) =>
        Array.isArray(item.state[field]) &&
        item.state[field].every((value) => typeof value === 'string' && value.length <= 240)
      ) &&
      item.compression?.policy === 'structured-context-persistence-v1' &&
      Number.isInteger(item.compression.summaryCharactersBefore) && item.compression.summaryCharactersBefore >= 0 &&
      Number.isInteger(item.compression.summaryCharactersAfter) && item.compression.summaryCharactersAfter >= 0 &&
      Number.isInteger(item.compression.droppedItems) && item.compression.droppedItems >= 0 &&
      item.compression.rawConversationStored === false &&
      Number.isFinite(Date.parse(item.createdAt))
  )
}

function backlogValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('discovery-') &&
      ['backlog', 'required-for-dod'].includes(item.decision) &&
      typeof item.title === 'string' &&
      typeof item.reason === 'string' &&
      typeof item.source === 'string' &&
      item.implemented === false &&
      Number.isFinite(Date.parse(item.recordedAt))
  )
}

function resolvedDiscoveryValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('discovery-') &&
      ['backlog', 'required-for-dod'].includes(item.decision) &&
      typeof item.title === 'string' &&
      typeof item.reason === 'string' &&
      typeof item.source === 'string' &&
      item.implemented === true &&
      typeof item.resolution === 'string' && item.resolution.length >= 3 &&
      Number.isFinite(Date.parse(item.recordedAt)) &&
      Number.isFinite(Date.parse(item.resolvedAt))
  )
}

function validateStore(store, path) {
  if (
    store?.schemaVersion !== STRUCTURED_CONTEXT_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-structured-context' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !Array.isArray(store.checkpoints) ||
    store.checkpoints.length > 50 ||
    !store.checkpoints.every(checkpointValid) ||
    !Array.isArray(store.backlog) ||
    store.backlog.length > 100 ||
    !store.backlog.every(backlogValid) ||
    !Array.isArray(store.resolvedDiscoveries) ||
    store.resolvedDiscoveries.length > 100 ||
    !store.resolvedDiscoveries.every(resolvedDiscoveryValid)
  ) {
    throw new Error(`Persistência estruturada fora do contrato v1: ${path}`)
  }
}

async function acquireLock(casa) {
  const directory = join(casa, 'runs')
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'structured-context.lock')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      return async () => {
        await handle.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 10_000) await unlink(lockPath).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('A persistência estruturada está ocupada por outra escrita.')
}

async function load(casa) {
  const path = caminhoDaPersistenciaContexto(casa)
  try {
    const source = await readFile(path, 'utf8')
    const parsed = JSON.parse(source)
    const store = parsed.schemaVersion === 1
      ? { ...parsed, schemaVersion: 2, resolvedDiscoveries: [] }
      : parsed
    if (store.schemaVersion > STRUCTURED_CONTEXT_SCHEMA_VERSION) {
      throw new Error(`Persistência estruturada v${store.schemaVersion} é mais nova que este plugin.`)
    }
    validateStore(store, path)
    return { store, initialized: false, migratedFrom: parsed.schemaVersion === 1 ? 1 : null, source }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { store: emptyStore(), initialized: true, migratedFrom: null, source: null }
    }
    throw error
  }
}

async function preserveBeforeMigration(casa, loaded) {
  if (loaded.migratedFrom === null) return
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '')
  const backup = `${caminhoDaPersistenciaContexto(casa)}.before-v1-to-v2.${stamp}.backup`
  await writeFile(backup, loaded.source, { encoding: 'utf8', flag: 'wx' })
}

async function save(casa, store) {
  const path = caminhoDaPersistenciaContexto(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  validateStore(store, path)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function lerPersistenciaContexto(casa) {
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa)
    await preserveBeforeMigration(casa, loaded)
    if (loaded.initialized || loaded.migratedFrom !== null) await save(casa, loaded.store)
    return loaded.store
  } finally {
    await release()
  }
}

export async function registrarCheckpoint(casa, input, { at } = {}) {
  const policy = await readPolicy()
  if (containsForbiddenField(input, policy.forbiddenFields)) {
    throw new Error('Checkpoint recusado: conversa bruta, transcript ou mensagens não são persistência estruturada.')
  }
  const runId = safeText(input?.runId, 'Identificador da execução', 3, 240)
  const task = validarDefinicaoTarefa(input?.task)
  const summaryRaw = safeText(input?.state?.summary, 'Resumo de estado', 3, 4000)
  const decisions = limitedItems(input?.state?.decisions, 'Decisões', policy.budgets.decisionItems)
  const openTasks = limitedItems(input?.state?.openTasks, 'Pendências', policy.budgets.openTaskItems)
  const eventRefs = limitedItems(input?.state?.eventRefs, 'Referências de eventos', policy.budgets.referenceItemsPerType)
  const artifactRefs = limitedItems(input?.state?.artifactRefs, 'Referências de artefatos', policy.budgets.referenceItemsPerType)
  const memoryRefs = limitedItems(input?.state?.memoryRefs, 'Referências de memória', policy.budgets.referenceItemsPerType)
  const summary = summaryRaw.slice(0, policy.budgets.summaryCharacters)
  const createdAt = now(at)
  const checkpoint = {
    id: `checkpoint-${randomUUID()}`,
    runFingerprint: hash(runId),
    task,
    state: {
      summary,
      decisions: decisions.items,
      openTasks: openTasks.items,
      eventRefs: eventRefs.items,
      artifactRefs: artifactRefs.items,
      memoryRefs: memoryRefs.items
    },
    compression: {
      policy: policy.policy,
      summaryCharactersBefore: summaryRaw.length,
      summaryCharactersAfter: summary.length,
      droppedItems: decisions.dropped + openTasks.dropped + eventRefs.dropped + artifactRefs.dropped + memoryRefs.dropped,
      rawConversationStored: false
    },
    createdAt
  }
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa)
    await preserveBeforeMigration(casa, loaded)
    loaded.store.checkpoints = [...loaded.store.checkpoints, checkpoint].slice(-policy.maximumCheckpoints)
    await save(casa, loaded.store)
    return { result: 'recorded', checkpoint }
  } finally {
    await release()
  }
}

export function classificarDescoberta({ requiredForDefinitionOfDone }) {
  return requiredForDefinitionOfDone === true ? 'required-for-dod' : 'backlog'
}

export async function registrarDescoberta(casa, input, { at } = {}) {
  const policy = await readPolicy()
  const item = {
    id: `discovery-${randomUUID()}`,
    title: safeText(input?.title, 'Título da descoberta', 3, 240),
    reason: safeText(input?.reason, 'Motivo da descoberta', 3, 500),
    source: safeText(input?.source, 'Origem da descoberta', 2, 240),
    decision: classificarDescoberta({ requiredForDefinitionOfDone: input?.requiredForDefinitionOfDone }),
    implemented: false,
    recordedAt: now(at)
  }
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa)
    await preserveBeforeMigration(casa, loaded)
    loaded.store.backlog = [...loaded.store.backlog, item].slice(-policy.maximumBacklogItems)
    await save(casa, loaded.store)
    return { result: item.decision, discovery: item }
  } finally {
    await release()
  }
}

export async function resolverDescoberta(casa, id, input, { at } = {}) {
  const discoveryId = safeText(id, 'Identificador da descoberta', 12, 240)
  const resolution = safeText(input?.resolution, 'Resolução da descoberta', 3, 500)
  const resolvedAt = now(at)
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa)
    await preserveBeforeMigration(casa, loaded)
    const discovery = loaded.store.backlog.find((item) => item.id === discoveryId)
    if (!discovery) return { result: 'not-found', discovery: null }
    const resolved = { ...discovery, implemented: true, resolution, resolvedAt }
    loaded.store.backlog = loaded.store.backlog.filter((item) => item.id !== discoveryId)
    loaded.store.resolvedDiscoveries = [...loaded.store.resolvedDiscoveries, resolved].slice(-100)
    await save(casa, loaded.store)
    return { result: 'resolved', discovery: resolved }
  } finally {
    await release()
  }
}
