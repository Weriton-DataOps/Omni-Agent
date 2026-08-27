import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'

export const SHORTCUT_STORE_SCHEMA_VERSION = 2
export const SHORTCUT_POLICY_VERSION = 2

const POLICY_PATH = new URL('../contratos/aprendizado/atalhos.json', import.meta.url)
const STATUS = new Set(['observing', 'active', 'validated'])
const ARCHIVE_REASONS = new Set(['identity-merged', 'inactive', 'repeated-failure'])
const SCOPE_TYPES = new Set(['user', 'project', 'task', 'environment'])
const FAMILIAS_OPERACIONAIS_GERAIS = new Set([
  'delegar e acompanhar uma execucao',
  'alterar e verificar artefatos',
  'investigar e verificar artefatos'
])

function normalizar(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function fingerprint(outcome) {
  return createHash('sha256').update(normalizar(outcome)).digest('hex')
}

function storeVazio(now = new Date().toISOString()) {
  return {
    schemaVersion: SHORTCUT_STORE_SCHEMA_VERSION,
    store: { id: 'omni-local-shortcut-learning', createdAt: now, updatedAt: now },
    shortcuts: [],
    archive: []
  }
}

export function caminhoDosAtalhos(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do aprendizado precisa ser um caminho absoluto.')
  return join(casa, 'learning', 'shortcuts.json')
}

function dataValida(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function escopoValido(scope) {
  return Boolean(
    scope &&
      SCOPE_TYPES.has(scope.type) &&
      (scope.type === 'user' || (typeof scope.id === 'string' && scope.id.trim()))
  )
}

function observacaoValida(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('obs-') &&
      dataValida(item.recordedAt) &&
      typeof item.success === 'boolean' &&
      typeof item.consistent === 'boolean' &&
      typeof item.outcomeFingerprint === 'string' &&
      /^[a-f0-9]{64}$/.test(item.outcomeFingerprint) &&
      (item.durationMs === null || (Number.isInteger(item.durationMs) && item.durationMs >= 0))
  )
}

function atalhoValido(item) {
  const validationValid =
    item?.validation === null ||
    (item.validation &&
      ['passed', 'failed'].includes(item.validation.status) &&
      dataValida(item.validation.validatedAt) &&
      typeof item.validation.observationId === 'string' &&
      item.validation.observationId.startsWith('obs-'))
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('shortcut-') &&
      typeof item.family === 'string' &&
      item.family.length > 0 &&
      typeof item.goal === 'string' &&
      item.goal.length > 0 &&
      escopoValido(item.scope) &&
      Array.isArray(item.baselineSteps) &&
      item.baselineSteps.length >= 2 &&
      item.baselineSteps.every((step) => typeof step === 'string' && step.length > 0) &&
      Array.isArray(item.shortcutSteps) &&
      item.shortcutSteps.length >= 1 &&
      item.shortcutSteps.length < item.baselineSteps.length &&
      item.shortcutSteps.every((step) => typeof step === 'string' && step.length > 0) &&
      STATUS.has(item.status) &&
      (item.outcomeFingerprint === null || /^[a-f0-9]{64}$/.test(item.outcomeFingerprint)) &&
      Number.isInteger(item.consecutiveSuccesses) &&
      item.consecutiveSuccesses >= 0 &&
      Number.isInteger(item.successCount) &&
      item.successCount >= 0 &&
      Number.isInteger(item.failureCount) &&
      item.failureCount >= 0 &&
      Number.isInteger(item.inconsistentCount) &&
      item.inconsistentCount >= 0 &&
      Number.isInteger(item.usageCount) &&
      item.usageCount >= 0 &&
      (item.lastSucceededAt === null || dataValida(item.lastSucceededAt)) &&
      (item.lastUsedAt === null || dataValida(item.lastUsedAt)) &&
      Array.isArray(item.mergedFrom) &&
      item.mergedFrom.every((id) => typeof id === 'string' && id.startsWith('shortcut-')) &&
      Array.isArray(item.observations) &&
      item.observations.every(observacaoValida) &&
      validationValid &&
      dataValida(item.createdAt) &&
      dataValida(item.updatedAt)
  )
}

function arquivoValido(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('shortcut-archive-') &&
      typeof item.shortcutId === 'string' &&
      item.shortcutId.startsWith('shortcut-') &&
      typeof item.family === 'string' &&
      item.family.length > 0 &&
      escopoValido(item.scope) &&
      ARCHIVE_REASONS.has(item.reason) &&
      (item.mergedInto === null || (typeof item.mergedInto === 'string' && item.mergedInto.startsWith('shortcut-'))) &&
      Number.isInteger(item.successCount) &&
      item.successCount >= 0 &&
      Number.isInteger(item.failureCount) &&
      item.failureCount >= 0 &&
      dataValida(item.archivedAt)
  )
}

function validarStore(store, path) {
  if (
    store?.schemaVersion !== SHORTCUT_STORE_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-shortcut-learning' ||
    !dataValida(store.store.createdAt) ||
    !dataValida(store.store.updatedAt) ||
    !Array.isArray(store.shortcuts) ||
    !store.shortcuts.every(atalhoValido) ||
    !Array.isArray(store.archive) ||
    !store.archive.every(arquivoValido)
  ) {
    throw new Error(`Aprendizado de atalhos fora do contrato v${SHORTCUT_STORE_SCHEMA_VERSION}: ${path}`)
  }
}

function familiaCanonica(goal) {
  return normalizar(String(goal ?? ''))
    .replace(/^(?:corrigir|validar|implementar|analisar|organizar|consultar|executar)\s*:\s*/, '')
    .trim()
}

function passosComVerificacao(steps) {
  const verificationPattern = /\b(?:verific|valid|confer|evidenci)/i
  const verification = steps.find((step) => verificationPattern.test(normalizar(step))) ?? 'verificar o resultado'
  const withoutVerification = steps.filter((step) => !verificationPattern.test(normalizar(step)))
  const reportIndex = withoutVerification.findIndex((step) => /\b(?:report|retorn|resum)/i.test(normalizar(step)))
  if (reportIndex < 0) return [...withoutVerification, verification]
  return [
    ...withoutVerification.slice(0, reportIndex),
    verification,
    ...withoutVerification.slice(reportIndex)
  ]
}

function normalizarPassosDoStore(store) {
  const actions = []
  for (const item of store.shortcuts) {
    const normalized = passosComVerificacao(item.shortcutSteps)
    if (JSON.stringify(normalized) === JSON.stringify(item.shortcutSteps)) continue
    item.shortcutSteps = normalized
    actions.push({ shortcutId: item.id, action: 'verification-order-normalized' })
  }
  return actions
}

function arquivarResumo(store, item, reason, archivedAt, mergedInto = null) {
  store.archive.push({
    id: `shortcut-archive-${randomUUID()}`,
    shortcutId: item.id,
    family: item.family,
    scope: item.scope,
    reason,
    mergedInto,
    successCount: item.successCount,
    failureCount: item.failureCount,
    archivedAt
  })
}

function enriquecerV1(item) {
  const successful = item.observations.filter((observation) => observation.success && observation.consistent)
  const family = familiaCanonica(item.goal)
  return {
    ...item,
    family,
    goal: family,
    scope: FAMILIAS_OPERACIONAIS_GERAIS.has(family) ? { type: 'user' } : item.scope,
    shortcutSteps: passosComVerificacao(item.shortcutSteps),
    status: item.status === 'validated' ? 'validated' : item.successCount > 0 ? 'active' : 'observing',
    usageCount: 0,
    lastSucceededAt: successful.at(-1)?.recordedAt ?? null,
    lastUsedAt: null,
    mergedFrom: []
  }
}

function chaveDeIdentidade(item) {
  return `${item.scope.type}:${item.scope.id ?? ''}:${item.family}`
}

function consolidarIdentidades(store, policy, at) {
  const groups = new Map()
  for (const item of store.shortcuts) {
    const key = chaveDeIdentidade(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const consolidated = []
  for (const items of groups.values()) {
    const ordered = [...items].sort((left, right) =>
      right.successCount - left.successCount ||
      left.shortcutSteps.length - right.shortcutSteps.length ||
      Date.parse(left.createdAt) - Date.parse(right.createdAt)
    )
    const keeper = ordered[0]
    for (const duplicate of ordered.slice(1)) {
      keeper.successCount += duplicate.successCount
      keeper.failureCount += duplicate.failureCount
      keeper.inconsistentCount += duplicate.inconsistentCount
      keeper.consecutiveSuccesses = Math.max(keeper.consecutiveSuccesses, duplicate.consecutiveSuccesses)
      keeper.observations = [...keeper.observations, ...duplicate.observations]
        .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt))
        .slice(-policy.maximumObservationsPerShortcut)
      keeper.mergedFrom.push(duplicate.id, ...duplicate.mergedFrom)
      keeper.lastSucceededAt = [keeper.lastSucceededAt, duplicate.lastSucceededAt]
        .filter(Boolean)
        .sort()
        .at(-1) ?? null
      if (duplicate.status === 'validated') {
        keeper.status = 'validated'
        keeper.validation = duplicate.validation
      } else if (keeper.status === 'observing' && duplicate.status === 'active') {
        keeper.status = 'active'
      }
      arquivarResumo(store, duplicate, 'identity-merged', at, keeper.id)
    }
    if (keeper.successCount >= policy.validationSuccessfulRuns && keeper.status !== 'validated') {
      keeper.status = 'validated'
      const observationId = keeper.observations.filter((item) => item.success && item.consistent).at(-1)?.id
      keeper.validation = observationId
        ? { status: 'passed', validatedAt: keeper.lastSucceededAt ?? at, observationId }
        : null
    }
    consolidated.push(keeper)
  }
  store.shortcuts = consolidated
  return store
}

function migrarV1(source, policy) {
  const original = JSON.parse(source)
  const at = new Date().toISOString()
  const migrated = {
    ...original,
    schemaVersion: 2,
    shortcuts: original.shortcuts.map(enriquecerV1),
    archive: []
  }
  consolidarIdentidades(migrated, policy, at)
  migrated.store.updatedAt = at
  return migrated
}

async function lerPolitica() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'))
  if (
    policy?.schemaVersion !== SHORTCUT_POLICY_VERSION ||
    policy.policy !== 'shortcut-learning-v2' ||
    policy.activationSuccessfulRuns !== 1 ||
    !Number.isInteger(policy.validationSuccessfulRuns) ||
    policy.validationSuccessfulRuns < 2 ||
    !Number.isInteger(policy.maximumObservationsPerShortcut) ||
    policy.maximumObservationsPerShortcut < policy.validationSuccessfulRuns ||
    !Number.isInteger(policy.minimumRemovedSteps) ||
    policy.minimumRemovedSteps < 1 ||
    !Number.isInteger(policy.observingInactivityDays) ||
    policy.observingInactivityDays < 1 ||
    !Number.isInteger(policy.activeInactivityDays) ||
    policy.activeInactivityDays < policy.observingInactivityDays ||
    !Number.isInteger(policy.validatedInactivityDays) ||
    policy.validatedInactivityDays < policy.activeInactivityDays ||
    !Number.isInteger(policy.maximumFailuresBeforeArchive) ||
    policy.maximumFailuresBeforeArchive < 2 ||
    policy.automaticPortablePromotion !== false ||
    policy.storeRawOutcome !== false
  ) {
    throw new Error('Política de aprendizado de atalhos fora do contrato seguro v2.')
  }
  return policy
}

async function adquirirTrava(casa) {
  const directory = join(casa, 'learning')
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'shortcuts.lock')
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
  throw new Error('O aprendizado de atalhos está ocupado por outra escrita.')
}

async function carregar(casa, policy) {
  const path = caminhoDosAtalhos(casa)
  try {
    const source = await readFile(path, 'utf8')
    const parsed = JSON.parse(source)
    const store = parsed.schemaVersion === 1 ? migrarV1(source, policy) : parsed
    if (store.schemaVersion > SHORTCUT_STORE_SCHEMA_VERSION) {
      throw new Error(`Aprendizado v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validarStore(store, path)
    return { store, initialized: false, migratedFrom: parsed.schemaVersion === 1 ? 1 : null, source }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { store: storeVazio(), initialized: true, migratedFrom: null, source: null }
    }
    throw error
  }
}

async function gravar(casa, store) {
  const path = caminhoDosAtalhos(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = new Date().toISOString()
  validarStore(store, path)
  await mkdir(join(casa, 'learning'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function aplicarDecaimento(store, policy, at) {
  const nowMs = Date.parse(at)
  const actions = []
  const active = []
  for (const item of store.shortcuts) {
    const days = item.status === 'validated'
      ? policy.validatedInactivityDays
      : item.status === 'active' ? policy.activeInactivityDays : policy.observingInactivityDays
    const reference = item.lastUsedAt ?? item.lastSucceededAt ?? item.updatedAt
    if (nowMs - Date.parse(reference) < days * 24 * 60 * 60 * 1000) {
      active.push(item)
      continue
    }
    arquivarResumo(store, item, 'inactive', at)
    actions.push({ shortcutId: item.id, action: 'inactive' })
  }
  store.shortcuts = active
  return actions
}

export async function prepararAtalhos(casa) {
  const policy = await lerPolitica()
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const maintenanceAt = new Date().toISOString()
    const maintenance = [
      ...normalizarPassosDoStore(loaded.store),
      ...aplicarDecaimento(loaded.store, policy, maintenanceAt)
    ]
    if (loaded.migratedFrom !== null) {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '')
      await writeFile(`${caminhoDosAtalhos(casa)}.before-v1-to-v2.${stamp}.backup`, loaded.source, {
        encoding: 'utf8',
        flag: 'wx'
      })
    }
    if (loaded.initialized || loaded.migratedFrom !== null || maintenance.length) {
      await gravar(casa, loaded.store)
    }
    return {
      result: loaded.initialized ? 'initialized' : loaded.migratedFrom !== null ? 'migrated' : 'ready',
      migratedFrom: loaded.migratedFrom,
      maintenance,
      schemaVersion: loaded.store.schemaVersion,
      store: loaded.store
    }
  } finally {
    await release()
  }
}

export async function lerAtalhos(casa) {
  return (await prepararAtalhos(casa)).store
}

function tokens(value) {
  return new Set(normalizar(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 2))
}

function tokensDaFamilia(family) {
  const result = tokens(family)
  const normalized = normalizar(family)
  const aliases = [
    [/deleg|execucao/, ['agente', 'sessao', 'prompt', 'executor', 'mandar', 'acompanhar']],
    [/alterar|artefato/, ['corrigir', 'ajustar', 'editar', 'arquivo', 'codigo', 'implementar']],
    [/investigar|verificar/, ['analisar', 'diagnosticar', 'causa', 'conferir', 'testar']]
  ]
  for (const [pattern, words] of aliases) {
    if (pattern.test(normalized)) for (const word of words) result.add(word)
  }
  return result
}

export function selecionarAtalhosRelevantes(store, intent, { projectId, taskId, environmentId, limit = 3 } = {}) {
  const intentTokens = tokens(intent)
  const scopeMatches = (scope) => scope.type === 'user' ||
    (scope.type === 'project' && scope.id === projectId) ||
    (scope.type === 'task' && scope.id === taskId) ||
    (scope.type === 'environment' && scope.id === environmentId)
  return store.shortcuts
    .filter((item) => ['active', 'validated'].includes(item.status) && scopeMatches(item.scope))
    .map((item) => {
      const familyTokens = tokensDaFamilia(item.family)
      const overlap = [...familyTokens].filter((token) => intentTokens.has(token)).length
      const score = overlap / Math.max(1, familyTokens.size) + (item.status === 'validated' ? 0.1 : 0)
      return { item, score }
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.item.successCount - left.item.successCount)
    .slice(0, limit)
    .map(({ item }) => item)
}

export async function registrarUsoAtalhos(casa, ids, { now } = {}) {
  const wanted = new Set(ids)
  if (!wanted.size) return { result: 'unchanged', updated: 0 }
  const policy = await lerPolitica()
  await prepararAtalhos(casa)
  const usedAt = now ? new Date(now).toISOString() : new Date().toISOString()
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    let updated = 0
    for (const item of loaded.store.shortcuts) {
      if (!wanted.has(item.id)) continue
      item.usageCount += 1
      item.lastUsedAt = usedAt
      item.updatedAt = usedAt
      updated += 1
    }
    if (updated) await gravar(casa, loaded.store)
    return { result: updated ? 'updated' : 'unchanged', updated }
  } finally {
    await release()
  }
}

export async function executarManutencaoAtalhos(casa, { now } = {}) {
  const policy = await lerPolitica()
  await prepararAtalhos(casa)
  const at = now ? new Date(now).toISOString() : new Date().toISOString()
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const actions = aplicarDecaimento(loaded.store, policy, at)
    if (actions.length) await gravar(casa, loaded.store)
    return { result: 'maintained', actions, active: loaded.store.shortcuts.length, archived: loaded.store.archive.length }
  } finally {
    await release()
  }
}

function validarTexto(text, label, minimum, maximum) {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (value.length < minimum || value.length > maximum) {
    throw new Error(`${label} precisa ter entre ${minimum} e ${maximum} caracteres.`)
  }
  if (pareceConterSegredo(value)) throw new Error(`${label} parece conter segredo.`)
  return value
}

function validarPassos(steps, label) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 20) {
    throw new Error(`${label} precisa ter entre 1 e 20 etapas.`)
  }
  return steps.map((step) => validarTexto(step, `Etapa de ${label}`, 1, 160))
}

function chave({ family, goal, scope }) {
  return [scope.type, scope.id ?? '', family ?? familiaCanonica(goal)].join('::')
}

function validarDuracao(durationMs) {
  if (durationMs === undefined || durationMs === null) return null
  if (!Number.isInteger(durationMs) || durationMs < 0) {
    throw new Error('A duração precisa ser um inteiro não negativo em milissegundos.')
  }
  return durationMs
}

function novaObservacao({ success, outcomeFingerprint, durationMs, now, consistent }) {
  return {
    id: `obs-${randomUUID()}`,
    recordedAt: now,
    success,
    consistent,
    outcomeFingerprint,
    durationMs
  }
}

function aplicarObservacao(item, observation, policy) {
  item.observations = [...item.observations, observation].slice(-policy.maximumObservationsPerShortcut)
  item.updatedAt = observation.recordedAt
  if (observation.success && observation.consistent) {
    item.successCount += 1
    item.consecutiveSuccesses += 1
    item.lastSucceededAt = observation.recordedAt
    if (item.status !== 'validated') item.status = 'active'
    if (item.consecutiveSuccesses >= policy.validationSuccessfulRuns) {
      item.status = 'validated'
      item.validation = {
        status: 'passed',
        validatedAt: observation.recordedAt,
        observationId: observation.id
      }
    }
    return
  }
  if (!observation.success) item.failureCount += 1
  else item.inconsistentCount += 1
  item.consecutiveSuccesses = 0
  item.status = 'observing'
  item.validation = observation.success
    ? { status: 'failed', validatedAt: observation.recordedAt, observationId: observation.id }
    : null
}

export async function registrarObservacaoAtalho(casa, input, { now } = {}) {
  const policy = await lerPolitica()
  await prepararAtalhos(casa)
  const declaredGoal = validarTexto(input?.goal, 'Objetivo', 3, 240)
  const family = familiaCanonica(declaredGoal)
  const goal = family
  const baselineSteps = validarPassos(input?.baselineSteps, 'referência')
  const shortcutSteps = passosComVerificacao(validarPassos(input?.shortcutSteps, 'atalho'))
  if (baselineSteps.length - shortcutSteps.length < policy.minimumRemovedSteps) {
    throw new Error('O atalho precisa remover ao menos uma etapa da referência.')
  }
  const scope = input?.scope ?? { type: 'user' }
  if (!escopoValido(scope)) throw new Error('Escopo do atalho é inválido.')
  const outcome = validarTexto(input?.outcome, 'Resultado', 2, 240)
  if (typeof input?.success !== 'boolean') throw new Error('O resultado precisa declarar sucesso ou falha.')
  const durationMs = validarDuracao(input?.durationMs)
  const recordedAt = now ? new Date(now).toISOString() : new Date().toISOString()
  const outcomeFingerprint = fingerprint(outcome)

  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const store = loaded.store
    const inputKey = chave({ family, scope })
    let item = store.shortcuts.find((candidate) => chave(candidate) === inputKey)
    if (!item) {
      item = {
        id: `shortcut-${randomUUID()}`,
        family,
        goal,
        scope,
        baselineSteps,
        shortcutSteps,
        status: 'observing',
        outcomeFingerprint: input.success ? outcomeFingerprint : null,
        consecutiveSuccesses: 0,
        successCount: 0,
        failureCount: 0,
        inconsistentCount: 0,
        usageCount: 0,
        lastSucceededAt: null,
        lastUsedAt: null,
        mergedFrom: [],
        observations: [],
        validation: null,
        createdAt: recordedAt,
        updatedAt: recordedAt
      }
      store.shortcuts.push(item)
    } else if (shortcutSteps.length < item.shortcutSteps.length) {
      item.baselineSteps = baselineSteps
      item.shortcutSteps = shortcutSteps
    }
    if (item.outcomeFingerprint === null && input.success) item.outcomeFingerprint = outcomeFingerprint
    const consistent = input.success && item.outcomeFingerprint === outcomeFingerprint
    const observation = novaObservacao({
      success: input.success,
      outcomeFingerprint,
      durationMs,
      now: recordedAt,
      consistent
    })
    aplicarObservacao(item, observation, policy)
    let result = item.status
    if (item.failureCount + item.inconsistentCount >= policy.maximumFailuresBeforeArchive) {
      arquivarResumo(store, item, 'repeated-failure', recordedAt)
      store.shortcuts = store.shortcuts.filter((shortcut) => shortcut.id !== item.id)
      result = 'archived'
    }
    await gravar(casa, store)
    return {
      result,
      shortcut: item,
      observation,
      promotion: 'not-performed'
    }
  } finally {
    await release()
  }
}

export async function validarAtalho(casa, id, input, { now } = {}) {
  const policy = await lerPolitica()
  await prepararAtalhos(casa)
  const outcome = validarTexto(input?.outcome, 'Resultado', 2, 240)
  if (typeof input?.success !== 'boolean') throw new Error('A validação precisa declarar sucesso ou falha.')
  const durationMs = validarDuracao(input?.durationMs)
  const recordedAt = now ? new Date(now).toISOString() : new Date().toISOString()
  const outcomeFingerprint = fingerprint(outcome)

  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const item = loaded.store.shortcuts.find((shortcut) => shortcut.id === id)
    if (!item) return { result: 'not-found', shortcut: null }
    if (!['active', 'validated'].includes(item.status)) {
      return { result: 'not-ready', shortcut: item, requiredStatus: 'active' }
    }
    const consistent = input.success && item.outcomeFingerprint === outcomeFingerprint
    const observation = novaObservacao({
      success: input.success,
      outcomeFingerprint,
      durationMs,
      now: recordedAt,
      consistent
    })
    aplicarObservacao(item, observation, policy)
    let result
    if (input.success && consistent) {
      item.status = 'validated'
      item.validation = { status: 'passed', validatedAt: recordedAt, observationId: observation.id }
      result = 'validated'
    } else {
      item.status = 'observing'
      item.validation = { status: 'failed', validatedAt: recordedAt, observationId: observation.id }
      result = 'validation-failed'
      if (item.failureCount + item.inconsistentCount >= policy.maximumFailuresBeforeArchive) {
        arquivarResumo(loaded.store, item, 'repeated-failure', recordedAt)
        loaded.store.shortcuts = loaded.store.shortcuts.filter((shortcut) => shortcut.id !== item.id)
        result = 'archived'
      }
    }
    await gravar(casa, loaded.store)
    return {
      result,
      shortcut: item,
      observation,
      promotion: 'not-performed'
    }
  } finally {
    await release()
  }
}
