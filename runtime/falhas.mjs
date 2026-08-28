import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
import { pareceConterSegredo } from './memoria.mjs'

export const FAILURE_STORE_SCHEMA_VERSION = 6
export const FAILURE_LEARNING_POLICY_VERSION = 3

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

function fingerprintCiclo(id, cycleNumber) {
  return createHash('sha256')
    .update(`${id}:failure-remediation-cycle:${cycleNumber}`, 'utf8')
    .digest('hex')
}

export function geracaoPadraoFalha(pattern) {
  if (hashValid(pattern?.cycleFingerprint)) return pattern.cycleFingerprint
  return fingerprintCiclo(pattern?.id ?? 'sem-padrao', pattern?.cycleNumber ?? 1)
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

function migrateV1(store) {
  const migrated = structuredClone(store)
  migrated.schemaVersion = 2
  migrated.patterns = migrated.patterns.map((pattern) => ({
    ...pattern,
    cycleNumber: 1,
    cycleFingerprint: fingerprintCiclo(pattern.id, 1),
    cycleStartedAt: pattern.createdAt,
    evaluationHistory: []
  }))
  return migrated
}

function migrateV2(store) {
  const migrated = structuredClone(store)
  migrated.schemaVersion = 5
  migrated.patterns = migrated.patterns.map((pattern) => {
    const legacyCandidates = [
      ...(Array.isArray(pattern.legacyUnverifiedFixTests) ? pattern.legacyUnverifiedFixTests : []),
      ...(Array.isArray(pattern.fixTests) ? pattern.fixTests : [])
    ]
    const legacy = legacyCandidates
      .filter(legacyTestValid)
      .map((item) => ({
        id: item.id,
        evidenceFingerprint: item.evidenceFingerprint,
        outcomeFingerprint: item.outcomeFingerprint,
        ...(item.criterionFingerprint === undefined ? {} : { criterionFingerprint: item.criterionFingerprint }),
        success: item.success,
        consistent: item.consistent,
        testedAt: item.testedAt
      }))
    const invalidated = legacyCandidates.length > 0
    return {
      ...pattern,
      analysis: pattern.analysis
        ? { ...pattern.analysis, hypothesisFingerprint: fingerprint(pattern.analysis.hypothesis) }
        : null,
      legacyUnverifiedFixTests: legacy,
      fixTests: [],
      status: invalidated && ['testing', 'ready-for-eval', 'evaluated'].includes(pattern.status)
        ? pattern.analysis ? 'analyzed' : pattern.occurrences >= 3 ? 'candidate' : 'observing'
        : pattern.status,
      evaluation: invalidated ? null : pattern.evaluation
    }
  })
  return migrated
}

function migrateV3(store) {
  const migrated = structuredClone(store)
  migrated.schemaVersion = 5
  migrated.patterns = migrated.patterns.map((pattern) => {
    const legacyCandidates = [
      ...(Array.isArray(pattern.legacyUnverifiedFixTests) ? pattern.legacyUnverifiedFixTests : []),
      ...(Array.isArray(pattern.fixTests) ? pattern.fixTests : [])
    ]
    const legacy = legacyCandidates
      .filter(legacyTestValid)
      .map((item) => ({
        id: item.id,
        evidenceFingerprint: item.evidenceFingerprint,
        outcomeFingerprint: item.outcomeFingerprint,
        ...(item.criterionFingerprint === undefined ? {} : { criterionFingerprint: item.criterionFingerprint }),
        success: item.success,
        consistent: item.consistent,
        testedAt: item.testedAt
      }))
    const invalidated = Array.isArray(pattern.fixTests) && pattern.fixTests.length > 0
    return {
      ...pattern,
      analysis: pattern.analysis
        ? { ...pattern.analysis, hypothesisFingerprint: fingerprint(pattern.analysis.hypothesis) }
        : null,
      legacyUnverifiedFixTests: legacy,
      fixTests: [],
      status: invalidated && ['testing', 'ready-for-eval', 'evaluated'].includes(pattern.status)
        ? pattern.analysis ? 'analyzed' : pattern.occurrences >= 3 ? 'candidate' : 'observing'
        : pattern.status,
      evaluation: invalidated ? null : pattern.evaluation
    }
  })
  return migrated
}

function migrateV4(store) {
  return migrateV3(store)
}

function familiaVerificacao(value) {
  const text = normalize(value ?? '')
  if (/\b(?:git|branch|commit|refs?|index|worktree|diff|repository|repositorio)\b/.test(text)) return 'repository'
  if (/\b(?:build|compile|compilar|bundle|empacotar)\b/.test(text)) return 'build'
  if (/\b(?:agente|subagente|executor|delegacao)\b/.test(text)) return 'delegation'
  // Arquivos, diretÃ³rios e artefatos costumam ser o objeto da correÃ§Ã£o, nÃ£o a
  // prova. Sem um verbo de verificaÃ§Ã£o estrutural mais forte, a prova exigida Ã©
  // um teste real; uma leitura ou `git status` genÃ©rico permanece insuficiente.
  return 'test'
}

function fingerprintFamiliaVerificacao(pattern, hypothesis, family) {
  return fingerprint(`${pattern.id}|${geracaoPadraoFalha(pattern)}|${hypothesis}|${family}`)
}

function migrateV5(store) {
  const migrated = migrateV3(store)
  migrated.schemaVersion = FAILURE_STORE_SCHEMA_VERSION
  migrated.patterns = migrated.patterns.map((pattern) => {
    if (!pattern.analysis) return pattern
    const verificationFamily = familiaVerificacao(`${pattern.action} ${pattern.analysis.hypothesis}`)
    return {
      ...pattern,
      analysis: {
        ...pattern.analysis,
        verificationFamily,
        verificationFamilyFingerprint: fingerprintFamiliaVerificacao(
          pattern,
          pattern.analysis.hypothesis,
          verificationFamily
        )
      }
    }
  })
  return migrated
}

async function backupBeforeMigration(path, raw, version) {
  const backup = `${path}.v${version}.backup`
  try {
    await writeFile(backup, raw, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
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
    policy.policy !== 'failure-learning-v3' ||
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
    policy.verifiedFixTests?.source !== 'audit-self-correction' ||
    policy.verifiedFixTests?.requiredActionEffect !== 'verification' ||
    policy.verifiedFixTests?.requiredActionState !== 'succeeded' ||
    policy.verifiedFixTests?.requireEvidence !== true ||
    policy.verifiedFixTests?.requireAfterAnalysis !== true ||
    policy.verifiedFixTests?.requireDistinctActions !== true ||
    policy.verifiedFixTests?.requireDistinctExecutions !== true ||
    policy.verifiedFixTests?.requireConsistentStrategy !== true ||
    policy.verifiedFixTests?.requireConsistentCriterion !== true ||
    policy.verifiedFixTests?.requireAutomationJob !== true ||
    policy.verifiedFixTests?.requirePatternBinding !== true ||
    policy.verifiedFixTests?.requireHypothesisBinding !== true ||
    policy.verifiedFixTests?.requireDispatchBeforeVerification !== true ||
    policy.verifiedFixTests?.requireExplicitCommandBinding !== true ||
    policy.verifiedFixTests?.requireActionFamilyBinding !== true ||
    policy.verifiedFixTests?.storeRawOutcome !== false ||
    policy.diagnosticSignature?.version !== 'failure-signature-v2' ||
    !Array.isArray(policy.diagnosticSignature.components) ||
    policy.diagnosticSignature.storeRawCommand !== false ||
    policy.diagnosticSignature.storeRawPath !== false ||
    policy.diagnosticSignature.storeRawToolInput !== false ||
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
      typeof item.auditActionId === 'string' && item.auditActionId.startsWith('audit-action-') &&
      typeof item.auditEvidenceId === 'string' && item.auditEvidenceId.startsWith('audit-evidence-') &&
      hashValid(item.executionFingerprint) &&
      hashValid(item.strategyFingerprint) &&
      hashValid(item.evidenceFingerprint) &&
      hashValid(item.outcomeFingerprint) &&
      hashValid(item.criterionFingerprint) &&
      typeof item.automationJobId === 'string' && item.automationJobId.startsWith('failure-job-') &&
      hashValid(item.patternFingerprint) &&
      hashValid(item.hypothesisFingerprint) &&
      hashValid(item.verificationFamilyFingerprint) &&
      hashValid(item.verificationBindingFingerprint) &&
      hashValid(item.bindingFingerprint) &&
      item.source === 'audit-self-correction' &&
      item.verified === true &&
      item.success === true &&
      typeof item.consistent === 'boolean' &&
      dateValid(item.actionRecordedAt) &&
      dateValid(item.testedAt)
  )
}

function legacyTestValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('fix-test-') &&
      hashValid(item.evidenceFingerprint) &&
      hashValid(item.outcomeFingerprint) &&
      (item.criterionFingerprint === undefined || hashValid(item.criterionFingerprint)) &&
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
      Number.isInteger(item.cycleNumber) &&
      item.cycleNumber >= 1 &&
      hashValid(item.cycleFingerprint) &&
      dateValid(item.cycleStartedAt) &&
      Array.isArray(item.evaluationHistory) &&
      Array.isArray(item.observations) &&
      item.observations.every(observationValid) &&
      (item.analysis === null || (
        typeof item.analysis === 'object' &&
        typeof item.analysis.rootCause === 'string' &&
        typeof item.analysis.hypothesis === 'string' &&
        hashValid(item.analysis.hypothesisFingerprint) &&
        typeof item.analysis.verificationFamily === 'string' &&
        hashValid(item.analysis.verificationFamilyFingerprint) &&
        dateValid(item.analysis.analyzedAt)
      )) &&
      Array.isArray(item.legacyUnverifiedFixTests) &&
      item.legacyUnverifiedFixTests.every(legacyTestValid) &&
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
    const raw = await readFile(path, 'utf8')
    let store = JSON.parse(raw)
    if (store.schemaVersion > FAILURE_STORE_SCHEMA_VERSION) {
      throw new Error(`Aprendizado de falhas v${store.schemaVersion} é mais novo que este plugin.`)
    }
    if ([1, 2, 3, 4, 5].includes(store.schemaVersion)) {
      await backupBeforeMigration(path, raw, store.schemaVersion)
      if (store.schemaVersion === 1) store = migrateV1(store)
      if (store.schemaVersion === 2) store = migrateV2(store)
      if (store.schemaVersion === 3) store = migrateV3(store)
      if (store.schemaVersion === 4) store = migrateV4(store)
      if (store.schemaVersion === 5) store = migrateV5(store)
    }
    validateStore(store, path, policy)
    return { store, initialized: false, migrated: store.schemaVersion !== JSON.parse(raw).schemaVersion }
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
    if (loaded.initialized || loaded.migrated) await save(casa, loaded.store, policy)
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
      const id = `failure-pattern-${randomUUID()}`
      pattern = {
        id,
        agent,
        action,
        failureClass,
        signatureFingerprint,
        status: 'observing',
        occurrences: 1,
        cycleNumber: 1,
        cycleFingerprint: fingerprintCiclo(id, 1),
        cycleStartedAt: observedAt,
        evaluationHistory: [],
        observations: [observation],
        analysis: null,
        legacyUnverifiedFixTests: [],
        fixTests: [],
        evaluation: null,
        createdAt: observedAt,
        updatedAt: observedAt
      }
      loaded.store.patterns.push(pattern)
    } else {
      const wasEvaluated = pattern.status === 'evaluated'
      pattern.observations = [...pattern.observations, observation].slice(-policy.maximumObservationsPerPattern)
      pattern.occurrences += 1
      if (wasEvaluated) {
        pattern.evaluationHistory = [...pattern.evaluationHistory, {
          cycleNumber: pattern.cycleNumber,
          cycleFingerprint: pattern.cycleFingerprint,
          evaluation: pattern.evaluation,
          closedAt: observedAt
        }].slice(-20)
        pattern.cycleNumber += 1
        pattern.cycleFingerprint = fingerprintCiclo(pattern.id, pattern.cycleNumber)
        pattern.cycleStartedAt = observedAt
        pattern.analysis = null
        pattern.fixTests = []
        pattern.evaluation = null
        pattern.status = 'candidate'
      } else if (pattern.status === 'observing' && pattern.occurrences >= policy.minimumPatternOccurrences) {
        pattern.status = 'candidate'
      }
      pattern.updatedAt = observedAt
    }
    if (pattern.status === 'observing' && pattern.occurrences >= policy.minimumPatternOccurrences) {
      pattern.status = 'candidate'
    }
    await save(casa, loaded.store, policy)
    return { result: pattern.status, pattern, observation }
  } finally {
    await release()
  }
}

const REANALYSABLE_STATUSES = ['candidate', 'analyzed', 'testing', 'ready-for-eval']

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
    if (input?.generation && input.generation !== geracaoPadraoFalha(pattern)) {
      return { result: 'stale-generation', pattern }
    }
    // Reanálise é permitida enquanto o padrão não foi avaliado: um diagnóstico errado
    // precisa poder ser substituído por outro medido. Reanalisar zera testes e avaliação,
    // porque eles provaram a hipótese antiga, não a nova.
    if (!REANALYSABLE_STATUSES.includes(pattern.status)) {
      return { result: 'not-ready', requiredStatus: REANALYSABLE_STATUSES.join('|'), pattern }
    }
    pattern.analysis = {
      rootCause,
      hypothesis,
      hypothesisFingerprint: fingerprint(hypothesis),
      verificationFamily: familiaVerificacao(`${pattern.action} ${hypothesis}`),
      verificationFamilyFingerprint: fingerprintFamiliaVerificacao(
        pattern,
        hypothesis,
        familiaVerificacao(`${pattern.action} ${hypothesis}`)
      ),
      analyzedAt
    }
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

function verificacoesDaAuditoria(store, {
  after,
  usedActionIds = new Set(),
  usedExecutionFingerprints = new Set(),
  semanticBindingFingerprint = null,
  expectedActionFamily = null
} = {}) {
  const threshold = Date.parse(after ?? '')
  const verified = []
  for (const turn of store.turns ?? []) {
    for (const action of turn.actions ?? []) {
      if (
        action.effect !== 'verification' ||
        action.state !== 'succeeded' ||
        usedActionIds.has(action.id) ||
        usedExecutionFingerprints.has(action.toolUseFingerprint) ||
        (semanticBindingFingerprint !== null && action.semanticBindingFingerprint !== semanticBindingFingerprint) ||
        (expectedActionFamily !== null && action.actionFamily !== expectedActionFamily) ||
        !Number.isFinite(threshold) ||
        Date.parse(action.recordedAt) <= threshold
      ) continue
      const evidence = (turn.evidence ?? []).find((item) =>
        item.sourceActionId === action.id &&
        item.kind === 'state-readback' &&
        Date.parse(item.recordedAt) >= Date.parse(action.recordedAt)
      )
      if (evidence) verified.push({ action, evidence })
    }
  }
  return verified.sort((left, right) => Date.parse(left.action.recordedAt) - Date.parse(right.action.recordedAt))
}

function fingerprintDoPadrao(pattern) {
  return fingerprint([
    pattern.id,
    geracaoPadraoFalha(pattern),
    pattern.agent,
    pattern.action,
    pattern.failureClass,
    pattern.signatureFingerprint
  ].join('|'))
}

export function vinculoVerificacaoFalha(pattern, automationJobId) {
  if (
    !pattern?.analysis ||
    !hashValid(pattern.analysis.hypothesisFingerprint) ||
    !hashValid(pattern.analysis.verificationFamilyFingerprint)
  ) {
    throw new Error('O padrão precisa estar analisado antes de gerar o vínculo de verificação.')
  }
  const jobId = safeText(automationJobId, 'Trabalho de automação', 3, 240)
  return fingerprint([
    fingerprintDoPadrao(pattern),
    jobId,
    pattern.analysis.hypothesisFingerprint,
    pattern.analysis.verificationFamilyFingerprint
  ].join('|'))
}

async function verificarJobNoHistorico(casa, {
  jobId,
  patternId,
  generationFingerprint,
  actionRecordedAt
}) {
  const path = join(casa, 'learning', 'failure-automation.json')
  let store
  try {
    store = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { result: 'unverified-job', job: null }
    throw error
  }
  const job = (store.jobs ?? []).find((item) => item.id === jobId)
  const dispatchAt = Date.parse(job?.dispatchRequestedAt ?? '')
  const actionProvided = actionRecordedAt !== undefined
  const actionAt = actionProvided ? Date.parse(actionRecordedAt) : null
  if (
    !job ||
    job.patternId !== patternId ||
    job.generationFingerprint !== generationFingerprint ||
    job.state !== 'running' ||
    job.dispatchState !== 'requested' ||
    !Number.isFinite(dispatchAt) ||
    (actionProvided && (!Number.isFinite(actionAt) || dispatchAt > actionAt))
  ) return { result: 'unverified-job', job: null }
  return { result: 'verified', job }
}

function jobValido(value, {
  jobId,
  patternId,
  generationFingerprint,
  actionRecordedAt
}) {
  const job = value?.job
  return Boolean(
    value?.result === 'verified' &&
    job?.id === jobId &&
    job.patternId === patternId &&
    job.generationFingerprint === generationFingerprint &&
    job.state === 'running' &&
    job.dispatchState === 'requested' &&
    dateValid(job.dispatchRequestedAt) &&
    Date.parse(job.dispatchRequestedAt) <= Date.parse(actionRecordedAt)
  )
}

async function verificarAcaoNoHistorico(casa, {
  actionId,
  evidenceId,
  analyzedAt,
  semanticBindingFingerprint,
  expectedActionFamily
}) {
  const audit = await lerAuditoriaAutocorrecao(casa)
  const candidate = verificacoesDaAuditoria(audit, {
    after: analyzedAt,
    semanticBindingFingerprint,
    expectedActionFamily
  })
    .find((item) => item.action.id === actionId && (evidenceId === null || item.evidence.id === evidenceId))
  return candidate
    ? { result: 'verified', ...candidate }
    : { result: 'unverified-action', action: null, evidence: null }
}

function verificacaoValida(value, {
  actionId,
  evidenceId,
  analyzedAt,
  semanticBindingFingerprint,
  expectedActionFamily
}) {
  const action = value?.action
  const evidence = value?.evidence
  return Boolean(
    value?.result === 'verified' &&
    action?.id === actionId &&
    (evidenceId === null || evidence?.id === evidenceId) &&
    typeof action.id === 'string' && action.id.startsWith('audit-action-') &&
    action.effect === 'verification' &&
    action.state === 'succeeded' &&
    action.semanticBindingFingerprint === semanticBindingFingerprint &&
    action.actionFamily === expectedActionFamily &&
    hashValid(action.toolUseFingerprint) &&
    hashValid(action.strategyFingerprint) &&
    dateValid(action.recordedAt) &&
    Date.parse(action.recordedAt) > Date.parse(analyzedAt) &&
    typeof evidence?.id === 'string' && evidence.id.startsWith('audit-evidence-') &&
    evidence.sourceActionId === action.id &&
    evidence.kind === 'state-readback' &&
    hashValid(evidence.fingerprint) &&
    dateValid(evidence.recordedAt) &&
    Date.parse(evidence.recordedAt) >= Date.parse(action.recordedAt)
  )
}

export async function listarEvidenciasVerificadasFalha(casa, id, { automationJobId } = {}) {
  const [failures, audit] = await Promise.all([
    lerFalhas(casa),
    lerAuditoriaAutocorrecao(casa)
  ])
  const pattern = failures.patterns.find((item) => item.id === id)
  if (!pattern) return { result: 'not-found', pattern: null, evidence: [] }
  if (!pattern.analysis) return { result: 'not-ready', pattern, evidence: [] }
  const jobId = safeText(automationJobId, 'Trabalho de automação', 3, 240)
  const job = await verificarJobNoHistorico(casa, {
    jobId,
    patternId: pattern.id,
    generationFingerprint: geracaoPadraoFalha(pattern)
  })
  if (job.result !== 'verified') return { result: 'unverified-job', pattern, evidence: [] }
  const semanticBindingFingerprint = vinculoVerificacaoFalha(pattern, jobId)
  const usedActionIds = new Set(pattern.fixTests.map((item) => item.auditActionId))
  const usedExecutionFingerprints = new Set(pattern.fixTests.map((item) => item.executionFingerprint))
  const evidence = verificacoesDaAuditoria(audit, {
    after: Date.parse(pattern.analysis.analyzedAt) >= Date.parse(job.job.dispatchRequestedAt)
      ? pattern.analysis.analyzedAt
      : job.job.dispatchRequestedAt,
    usedActionIds,
    usedExecutionFingerprints,
    semanticBindingFingerprint,
    expectedActionFamily: pattern.analysis.verificationFamily
  }).map((item) => ({
    actionId: item.action.id,
    evidenceId: item.evidence.id,
    strategyFingerprint: item.action.strategyFingerprint,
    executionFingerprint: item.action.toolUseFingerprint,
    toolName: item.action.toolName,
    actionRecordedAt: item.action.recordedAt,
    evidenceRecordedAt: item.evidence.recordedAt
  }))
  return {
    result: 'listed',
    pattern,
    job: { id: job.job.id, dispatchState: job.job.dispatchState },
    bindingMarker: `omni-failure-binding:${semanticBindingFingerprint}`,
    evidence
  }
}

export async function testarCorrecaoFalha(casa, id, input) {
  const policy = await readPolicy()
  if (['evidenceId', 'outcome', 'success'].some((field) => Object.hasOwn(input ?? {}, field))) {
    throw new Error('O teste de correção não aceita evidência, resultado ou sucesso autodeclarado.')
  }
  const auditActionId = safeText(input?.auditActionId, 'Ação verificada da auditoria', 3, 240)
  const auditEvidenceId = input?.auditEvidenceId === undefined
    ? null
    : safeText(input.auditEvidenceId, 'Evidência verificada da auditoria', 3, 240)
  const criterion = safeText(input?.criterion, 'Critério de aceitação', 3, 500)
  const automationJobId = safeText(input?.automationJobId, 'Trabalho de automação', 3, 240)
  const criterionFingerprint = fingerprint(criterion)
  const testedAt = now()
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    const pattern = loaded.store.patterns.find((item) => item.id === id)
    if (!pattern) return { result: 'not-found', pattern: null }
    if (input?.generation && input.generation !== geracaoPadraoFalha(pattern)) {
      return { result: 'stale-generation', pattern }
    }
    if (!['analyzed', 'testing', 'ready-for-eval'].includes(pattern.status)) {
      return { result: 'not-ready', requiredStatus: 'analyzed', pattern }
    }
    if (pattern.fixTests.some((item) => item.auditActionId === auditActionId)) {
      return { result: 'duplicate-evidence', pattern }
    }
    const jobIdentity = await verificarJobNoHistorico(casa, {
      jobId: automationJobId,
      patternId: pattern.id,
      generationFingerprint: geracaoPadraoFalha(pattern)
    })
    if (jobIdentity.result !== 'verified') return { result: 'unverified-job', pattern }
    const semanticBindingFingerprint = vinculoVerificacaoFalha(pattern, automationJobId)
    const verified = await verificarAcaoNoHistorico(casa, {
      actionId: auditActionId,
      evidenceId: auditEvidenceId,
      analyzedAt: pattern.analysis.analyzedAt,
      semanticBindingFingerprint,
      expectedActionFamily: pattern.analysis.verificationFamily
    })
    if (!verificacaoValida(verified, {
      actionId: auditActionId,
      evidenceId: auditEvidenceId,
      analyzedAt: pattern.analysis.analyzedAt,
      semanticBindingFingerprint,
      expectedActionFamily: pattern.analysis.verificationFamily
    })) return { result: 'unverified-action', pattern }
    const { action, evidence } = verified
    const verifiedJob = await verificarJobNoHistorico(casa, {
      jobId: automationJobId,
      patternId: pattern.id,
      generationFingerprint: geracaoPadraoFalha(pattern),
      actionRecordedAt: action.recordedAt
    })
    if (!jobValido(verifiedJob, {
      jobId: automationJobId,
      patternId: pattern.id,
      generationFingerprint: geracaoPadraoFalha(pattern),
      actionRecordedAt: action.recordedAt
    })) return { result: 'unverified-job', pattern }
    if (pattern.fixTests.some((item) => item.executionFingerprint === action.toolUseFingerprint)) {
      return { result: 'duplicate-evidence', pattern }
    }
    const previousSuccess = [...pattern.fixTests]
      .reverse()
      .find((item) => item.success && item.consistent)
    const consistent = previousSuccess === undefined || (
      previousSuccess.strategyFingerprint === action.strategyFingerprint &&
      previousSuccess.criterionFingerprint === criterionFingerprint &&
      previousSuccess.automationJobId === automationJobId &&
      previousSuccess.hypothesisFingerprint === pattern.analysis.hypothesisFingerprint &&
      previousSuccess.verificationFamilyFingerprint === pattern.analysis.verificationFamilyFingerprint
    )
    const patternFingerprint = fingerprintDoPadrao(pattern)
    const bindingFingerprint = fingerprint([
      patternFingerprint,
      automationJobId,
      pattern.analysis.hypothesisFingerprint,
      pattern.analysis.verificationFamilyFingerprint,
      semanticBindingFingerprint,
      action.strategyFingerprint,
      criterionFingerprint
    ].join('|'))
    const fixTest = {
      id: `fix-test-${randomUUID()}`,
      auditActionId: action.id,
      auditEvidenceId: evidence.id,
      executionFingerprint: action.toolUseFingerprint,
      strategyFingerprint: action.strategyFingerprint,
      evidenceFingerprint: evidence.fingerprint,
      outcomeFingerprint: evidence.fingerprint,
      criterionFingerprint,
      automationJobId,
      patternFingerprint,
      hypothesisFingerprint: pattern.analysis.hypothesisFingerprint,
      verificationFamilyFingerprint: pattern.analysis.verificationFamilyFingerprint,
      verificationBindingFingerprint: semanticBindingFingerprint,
      bindingFingerprint,
      source: 'audit-self-correction',
      verified: true,
      success: true,
      consistent,
      actionRecordedAt: action.recordedAt,
      testedAt
    }
    pattern.fixTests = [...pattern.fixTests, fixTest].slice(-policy.maximumFixTestsPerPattern)
    pattern.evaluation = null
    const successful = trailingConsistentSuccesses(pattern.fixTests)
    pattern.status = successful >= policy.minimumSuccessfulFixTests
      ? 'ready-for-eval'
      : consistent ? 'testing' : 'analyzed'
    pattern.updatedAt = testedAt
    await save(casa, loaded.store, policy)
    return { result: pattern.status, pattern, fixTest, consecutiveSuccessfulTests: successful }
  } finally {
    await release()
  }
}

export async function avaliarPadraoFalha(casa, id, { at, generation } = {}) {
  const policy = await readPolicy()
  const evaluatedAt = now(at)
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, policy)
    const pattern = loaded.store.patterns.find((item) => item.id === id)
    if (!pattern) return { result: 'not-found', pattern: null }
    if (generation && generation !== geracaoPadraoFalha(pattern)) {
      return { result: 'stale-generation', pattern }
    }
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
