import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'

export const SHORTCUT_STORE_SCHEMA_VERSION = 1
export const SHORTCUT_POLICY_VERSION = 1

const POLICY_PATH = new URL('../contratos/aprendizado/atalhos.json', import.meta.url)
const STATUS = new Set(['observing', 'candidate', 'validated'])
const SCOPE_TYPES = new Set(['user', 'project', 'task', 'environment'])

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
    shortcuts: []
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
      Array.isArray(item.observations) &&
      item.observations.every(observacaoValida) &&
      validationValid &&
      dataValida(item.createdAt) &&
      dataValida(item.updatedAt)
  )
}

function validarStore(store, path) {
  if (
    store?.schemaVersion !== SHORTCUT_STORE_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-shortcut-learning' ||
    !dataValida(store.store.createdAt) ||
    !dataValida(store.store.updatedAt) ||
    !Array.isArray(store.shortcuts) ||
    !store.shortcuts.every(atalhoValido)
  ) {
    throw new Error(`Aprendizado de atalhos fora do contrato v${SHORTCUT_STORE_SCHEMA_VERSION}: ${path}`)
  }
}

async function lerPolitica() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'))
  if (
    policy?.schemaVersion !== SHORTCUT_POLICY_VERSION ||
    policy.policy !== 'shortcut-learning-v1' ||
    !Number.isInteger(policy.minimumConsecutiveSuccesses) ||
    policy.minimumConsecutiveSuccesses < 2 ||
    !Number.isInteger(policy.validationRunsRequired) ||
    policy.validationRunsRequired < 1 ||
    !Number.isInteger(policy.maximumObservationsPerShortcut) ||
    policy.maximumObservationsPerShortcut < policy.minimumConsecutiveSuccesses ||
    policy.validationRunsRequired !== 1 ||
    !Number.isInteger(policy.minimumRemovedSteps) ||
    policy.minimumRemovedSteps < 1 ||
    policy.automaticPromotion !== false ||
    policy.storeRawOutcome !== false
  ) {
    throw new Error('Política de aprendizado de atalhos fora do contrato seguro v1.')
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

async function carregar(casa) {
  const path = caminhoDosAtalhos(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > SHORTCUT_STORE_SCHEMA_VERSION) {
      throw new Error(`Aprendizado v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validarStore(store, path)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: storeVazio(), initialized: true }
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

export async function prepararAtalhos(casa) {
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa)
    if (loaded.initialized) await gravar(casa, loaded.store)
    return {
      result: loaded.initialized ? 'initialized' : 'ready',
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

function chave({ goal, scope, baselineSteps, shortcutSteps }) {
  return [
    scope.type,
    scope.id ?? '',
    normalizar(goal),
    baselineSteps.map(normalizar).join('>'),
    shortcutSteps.map(normalizar).join('>')
  ].join('::')
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
    if (item.status !== 'validated' && item.consecutiveSuccesses >= policy.minimumConsecutiveSuccesses) {
      item.status = 'candidate'
    }
    return
  }
  if (!observation.success) item.failureCount += 1
  else item.inconsistentCount += 1
  item.consecutiveSuccesses = 0
  item.status = 'observing'
  item.validation = null
}

export async function registrarObservacaoAtalho(casa, input, { now } = {}) {
  const policy = await lerPolitica()
  const goal = validarTexto(input?.goal, 'Objetivo', 3, 240)
  const baselineSteps = validarPassos(input?.baselineSteps, 'referência')
  const shortcutSteps = validarPassos(input?.shortcutSteps, 'atalho')
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
    const loaded = await carregar(casa)
    const store = loaded.store
    const inputKey = chave({ goal, scope, baselineSteps, shortcutSteps })
    let item = store.shortcuts.find((candidate) => chave(candidate) === inputKey)
    if (!item) {
      item = {
        id: `shortcut-${randomUUID()}`,
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
        observations: [],
        validation: null,
        createdAt: recordedAt,
        updatedAt: recordedAt
      }
      store.shortcuts.push(item)
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
    await gravar(casa, store)
    return {
      result: item.status,
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
  const outcome = validarTexto(input?.outcome, 'Resultado', 2, 240)
  if (typeof input?.success !== 'boolean') throw new Error('A validação precisa declarar sucesso ou falha.')
  const durationMs = validarDuracao(input?.durationMs)
  const recordedAt = now ? new Date(now).toISOString() : new Date().toISOString()
  const outcomeFingerprint = fingerprint(outcome)

  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa)
    const item = loaded.store.shortcuts.find((shortcut) => shortcut.id === id)
    if (!item) return { result: 'not-found', shortcut: null }
    if (item.status !== 'candidate') {
      return { result: 'not-ready', shortcut: item, requiredStatus: 'candidate' }
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
    if (input.success && consistent) {
      item.status = 'validated'
      item.validation = { status: 'passed', validatedAt: recordedAt, observationId: observation.id }
    } else {
      item.status = 'observing'
      item.validation = { status: 'failed', validatedAt: recordedAt, observationId: observation.id }
    }
    await gravar(casa, loaded.store)
    return {
      result: item.status === 'validated' ? 'validated' : 'validation-failed',
      shortcut: item,
      observation,
      promotion: 'not-performed'
    }
  } finally {
    await release()
  }
}
