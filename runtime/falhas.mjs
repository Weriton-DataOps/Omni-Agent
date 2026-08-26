import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'

export const FAILURE_STORE_SCHEMA_VERSION = 1
export const FAILURE_LEARNING_POLICY_VERSION = 1

const POLICY_PATH = new URL('../contratos/aprendizado/falhas.json', import.meta.url)
const STATUS = new Set(['observing', 'candidate', 'analyzed', 'testing', 'ready-for-eval', 'evaluated'])

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function fingerprint(value) {
  return createHash('sha256').update(normalize(value)).digest('hex')
}

function safeText(value, label, minimum, maximum) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} precisa ter entre ${minimum} e ${maximum} caracteres.`)
  }
  if (pareceConterSegredo(text)) throw new Error(`${label} parece conter segredo.`)
  return text
}

function emptyStore(createdAt = now()) {
  return {
    schemaVersion: FAILURE_STORE_SCHEMA_VERSION,
    store: { id: 'omni-local-failure-learning', createdAt, updatedAt: createdAt },
    patterns: []
  }
}

export function caminhoDasFalhas(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do aprendizado de falhas precisa ser absoluta.')
  return join(casa, 'learning', 'failures.json')
}

async function readPolicy() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'))
  if (
    policy?.schemaVersion !== FAILURE_LEARNING_POLICY_VERSION ||
    policy.policy !== 'failure-learning-v1' ||
    !Array.isArray(policy.failureClasses) ||
    !Number.isInteger(policy.minimumPatternOccurrences) ||
    policy.minimumPatternOccurrences < 3 ||
    !Number.isInteger(policy.minimumSuccessfulFixTests) ||
    policy.minimumSuccessfulFixTests < 2 ||
    !Number.isInteger(policy.maximumObservationsPerPattern) ||
    policy.maximumObservationsPerPattern < policy.minimumPatternOccurrences ||
    !Number.isInteger(policy.maximumFixTestsPerPattern) ||
    policy.maximumFixTestsPerPattern < policy.minimumSuccessfulFixTests ||
    policy.requireDistinctEvidence !== true ||
    policy.automaticGlobalRule !== false ||
    policy.automaticPromotion !== false ||
    policy.storeRawError !== false ||
    policy.storeRawTestOutcome !== false
  ) {
    throw new Error('Política de aprendizado de falhas fora do contrato seguro v1.')
  }
  return policy
}

function dateValid(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function hashValid(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function observationValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('failure-observation-') &&
      hashValid(item.evidenceFingerprint) &&
      dateValid(item.observedAt)
  )
}

function testValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('fix-test-') &&
      hashValid(item.evidenceFingerprint) &&
      hashValid(item.outcomeFingerprint) &&
      typeof item.success === 'boolean' &&
      typeof item.consistent === 'boolean' &&
      dateValid(item.testedAt)
  )
}

function patternValid(item, policy) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('failure-pattern-') &&
      typeof item.agent === 'string' &&
      typeof item.action === 'string' &&
      policy.failureClasses.includes(item.failureClass) &&
      hashValid(item.signatureFingerprint) &&
      STATUS.has(item.status) &&
      Number.isInteger(item.occurrences) &&
      item.occurrences >= 1 &&
      Array.isArray(item.observations) &&
      item.observations.every(observationValid) &&
      (item.analysis === null || typeof item.analysis === 'object') &&
      Array.isArray(item.fixTests) &&
      item.fixTests.every(testValid) &&
      (item.evaluation === null || typeof item.evaluation === 'object') &&
      dateValid(item.createdAt) &&
      dateValid(item.updatedAt)
  )
}

function validateStore(store, path, policy) {
  if (
    store?.schemaVersion !== FAILURE_STORE_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-failure-learning' ||
    !dateValid(store.store?.createdAt) ||
    !dateValid(store.store?.updatedAt) ||
    !Array.isArray(store.patterns) ||
    !store.patterns.every((item) => patternValid(item, policy))
  ) {
    throw new Error(`Aprendizado de falhas fora do contrato v1: ${path}`)
  }
}

async function acquireLock(casa) {
  const directory = join(casa, 'learning')
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'failures.lock')
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
  throw new Error('O aprendizado de falhas está ocupado por outra escrita.')
}

async function load(casa, policy) {
  const path = caminhoDasFalhas(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > FAILURE_STORE_SCHEMA_VERSION) {
      throw new Error(`Aprendizado de falhas v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validateStore(store, path, policy)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: emptyStore(), initialized: true }
    throw error
  }
}

async function save(casa, store, policy) {
  const path = caminhoDasFalhas(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  validateStore(store, path, policy)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function lerFalhas(casa) {
  const policy = await readPolicy()
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    if (loaded.initialized) await save(casa, loaded.store, policy)
    return loaded.store
  } finally {
    await release()
  }
}

function patternKey({ agent, action, failureClass, signatureFingerprint }) {
  return [normalize(agent), normalize(action), failureClass, signatureFingerprint].join('::')
}

export async function registrarFalha(casa, input, { at } = {}) {
  const policy = await readPolicy()
  const agent = safeText(input?.agent, 'Agente', 2, 80)
  const action = safeText(input?.action, 'Ação resumida', 3, 240)
  const failureClass = typeof input?.failureClass === 'string' ? input.failureClass : ''
  if (!policy.failureClasses.includes(failureClass)) throw new Error('Classe de falha inválida.')
  const signature = safeText(input?.signature, 'Assinatura da falha', 3, 500)
  const evidence = safeText(input?.evidenceId, 'Identificador da execução', 3, 240)
  const signatureFingerprint = fingerprint(signature)
  const evidenceFingerprint = fingerprint(evidence)
  const observedAt = now(at)
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    const key = patternKey({ agent, action, failureClass, signatureFingerprint })
    let pattern = loaded.store.patterns.find((item) => patternKey(item) === key)
    if (pattern?.observations.some((item) => item.evidenceFingerprint === evidenceFingerprint)) {
      return { result: 'duplicate-evidence', pattern }
    }
    const observation = {
      id: `failure-observation-${randomUUID()}`,
      evidenceFingerprint,
      observedAt
    }
    if (!pattern) {
      pattern = {
        id: `failure-pattern-${randomUUID()}`,
        agent,
        action,
        failureClass,
        signatureFingerprint,
        status: 'observing',
        occurrences: 1,
        observations: [observation],
        analysis: null,
        fixTests: [],
        evaluation: null,
        createdAt: observedAt,
        updatedAt: observedAt
      }
      loaded.store.patterns.push(pattern)
    } else {
      pattern.observations = [...pattern.observations, observation].slice(-policy.maximumObservationsPerPattern)
      pattern.occurrences += 1
      pattern.fixTests = []
      pattern.evaluation = null
      pattern.status = pattern.occurrences >= policy.minimumPatternOccurrences ? 'candidate' : 'observing'
      pattern.updatedAt = observedAt
    }
    if (pattern.occurrences >= policy.minimumPatternOccurrences) pattern.status = 'candidate'
    await save(casa, loaded.store, policy)
    return { result: pattern.status, pattern, observation }
  } finally {
    await release()
  }
}

export async function analisarPadraoFalha(casa, id, input, { at } = {}) {
  const policy = await readPolicy()
  const rootCause = safeText(input?.rootCause, 'Causa raiz', 8, 500)
  const hypothesis = safeText(input?.hypothesis, 'Hipótese de correção', 8, 500)
  const analyzedAt = now(at)
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    const pattern = loaded.store.patterns.find((item) => item.id === id)
    if (!pattern) return { result: 'not-found', pattern: null }
    if (pattern.status !== 'candidate') return { result: 'not-ready', requiredStatus: 'candidate', pattern }
    pattern.analysis = { rootCause, hypothesis, analyzedAt }
    pattern.fixTests = []
    pattern.evaluation = null
    pattern.status = 'analyzed'
    pattern.updatedAt = analyzedAt
    await save(casa, loaded.store, policy)
    return { result: 'analyzed', pattern }
  } finally {
    await release()
  }
}

function trailingConsistentSuccesses(tests) {
  let count = 0
  for (let index = tests.length - 1; index >= 0; index -= 1) {
    if (!tests[index].success || !tests[index].consistent) break
    count += 1
  }
  return count
}

export async function testarCorrecaoFalha(casa, id, input, { at } = {}) {
  const policy = await readPolicy()
  const evidence = safeText(input?.evidenceId, 'Identificador do teste', 3, 240)
  const outcome = safeText(input?.outcome, 'Resultado do teste', 2, 500)
  if (typeof input?.success !== 'boolean') throw new Error('O teste precisa declarar sucesso ou falha.')
  const evidenceFingerprint = fingerprint(evidence)
  const outcomeFingerprint = fingerprint(outcome)
  const testedAt = now(at)
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    const pattern = loaded.store.patterns.find((item) => item.id === id)
    if (!pattern) return { result: 'not-found', pattern: null }
    if (!['analyzed', 'testing', 'ready-for-eval'].includes(pattern.status)) {
      return { result: 'not-ready', requiredStatus: 'analyzed', pattern }
    }
    const evidenceUsed = [
      ...pattern.observations.map((item) => item.evidenceFingerprint),
      ...pattern.fixTests.map((item) => item.evidenceFingerprint)
    ].includes(evidenceFingerprint)
    if (evidenceUsed) return { result: 'duplicate-evidence', pattern }
    const expected = [...pattern.fixTests]
      .reverse()
      .find((item) => item.success && item.consistent)?.outcomeFingerprint ?? outcomeFingerprint
    const consistent = input.success && expected === outcomeFingerprint
    const fixTest = {
      id: `fix-test-${randomUUID()}`,
      evidenceFingerprint,
      outcomeFingerprint,
      success: input.success,
      consistent,
      testedAt
    }
    pattern.fixTests = [...pattern.fixTests, fixTest].slice(-policy.maximumFixTestsPerPattern)
    pattern.evaluation = null
    const successful = trailingConsistentSuccesses(pattern.fixTests)
    pattern.status = successful >= policy.minimumSuccessfulFixTests
      ? 'ready-for-eval'
      : input.success && consistent ? 'testing' : 'analyzed'
    pattern.updatedAt = testedAt
    await save(casa, loaded.store, policy)
    return { result: pattern.status, pattern, fixTest, consecutiveSuccessfulTests: successful }
  } finally {
    await release()
  }
}

export async function avaliarPadraoFalha(casa, id, { at } = {}) {
  const policy = await readPolicy()
  const evaluatedAt = now(at)
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    const pattern = loaded.store.patterns.find((item) => item.id === id)
    if (!pattern) return { result: 'not-found', pattern: null }
    if (pattern.status !== 'ready-for-eval') {
      return { result: 'not-ready', requiredStatus: 'ready-for-eval', pattern }
    }
    const distinctObservations = new Set(pattern.observations.map((item) => item.evidenceFingerprint)).size
    const successfulTests = trailingConsistentSuccesses(pattern.fixTests)
    const gates = [
      { id: 'repeated-pattern', passed: pattern.occurrences >= policy.minimumPatternOccurrences },
      { id: 'distinct-failure-evidence', passed: distinctObservations >= policy.minimumPatternOccurrences },
      { id: 'root-cause-recorded', passed: Boolean(pattern.analysis?.rootCause) },
      { id: 'fix-hypothesis-recorded', passed: Boolean(pattern.analysis?.hypothesis) },
      { id: 'repeated-fix-success', passed: successfulTests >= policy.minimumSuccessfulFixTests },
      { id: 'no-automatic-global-rule', passed: policy.automaticGlobalRule === false },
      { id: 'no-automatic-promotion', passed: policy.automaticPromotion === false }
    ]
    pattern.evaluation = {
      protocol: 'failure-pattern-eval-v1',
      passed: gates.every((gate) => gate.passed),
      gates,
      evaluatedAt
    }
    pattern.status = pattern.evaluation.passed ? 'evaluated' : 'analyzed'
    pattern.updatedAt = evaluatedAt
    await save(casa, loaded.store, policy)
    return { result: pattern.evaluation.passed ? 'passed' : 'failed', pattern }
  } finally {
    await release()
  }
}
