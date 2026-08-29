import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
import { lerAutoaperfeicoamento } from './autoaperfeicoamento.mjs'
import { caminhoDaAutomacaoFalhas, sincronizarAutomacaoFalhas } from './automacao-falhas.mjs'
import { lerCicloOperacional } from './ciclo-operacional.mjs'
import { lerFalhas } from './falhas.mjs'
import { lerHistoricoComportamental } from './eval-comportamental.mjs'
import { lerHistoricoPersonalidade } from './rodada-personalidade.mjs'
import {
  lerIdentidadeRelease,
  verificarIntegridadeRelease
} from './integridade-release.mjs'
import { lerEstadoVarredura } from './varredura-diaria.mjs'
import {
  materializarMelhoriaComBaselineConfigurada,
  sincronizarAutomacaoMelhorias
} from './automacao-melhorias.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const CONTRACT_PATH = new URL('../contratos/operacao/auditoria-sistema.json', import.meta.url)

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number(Math.min(1, Math.max(0, numerator / denominator)).toFixed(4)) : 0
}

function safePluginVersion(value) {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : null
}

async function contract() {
  const value = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  const operationalFindings = [
    'operational-improvement-ready-without-materialization',
    'operational-implementation-required',
    'operational-materialized-without-installed-readback'
  ]
  const operationalMetrics = [
    'selfImprovementRetracted',
    'operationalImprovementReady',
    'operationalImplementationRequired',
    'operationalMaterializedPendingRelease',
    'operationalInstalledVerified',
    'operationalSuperseded',
    'operationalLearningEffectRate'
  ]
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-system-self-audit-v1' ||
    !Number.isInteger(value.history?.maximumRuns) ||
    value.history.maximumRuns < 1 ||
    value.history.idempotentByStateFingerprint !== true ||
    value.history.reuseLatestUnchangedRun !== true ||
    !value.repairPolicy?.automatic?.includes('materialize-ready-operational-improvements') ||
    !value.repairPolicy?.automatic?.includes('serialize-operational-improvements-per-repository') ||
    !value.repairPolicy?.automatic?.includes('route-source-improvements-to-neutral-delegation') ||
    value.repairPolicy?.requiresIndependentReadback !== true ||
    value.repairPolicy?.doesNotExpandCurrentAuthority !== true ||
    JSON.stringify(value.turnFindingLifecycle?.recoverable?.findingStates) !== JSON.stringify(['open', 'unresolved']) ||
    value.turnFindingLifecycle?.recoverable?.severity !== 'error' ||
    value.turnFindingLifecycle?.recoverable?.releaseBlocking !== false ||
    value.turnFindingLifecycle?.recoverable?.survivesSessionAndReleaseBoundary !== true ||
    value.turnFindingLifecycle?.recoverable?.retestAutomatically !== true ||
    value.turnFindingLifecycle?.recoverable?.terminalArchiveWithoutCounterproof !== false ||
    !operationalFindings.every((code) => value.findings?.includes(code)) ||
    !operationalMetrics.every((metric) => value.metrics?.includes(metric)) ||
    value.privacy?.storeRawConversation !== false ||
    value.privacy?.storeRawToolData !== false ||
    value.privacy?.storeRawPaths !== false ||
    value.privacy?.storeSecrets !== false ||
    value.privacy?.pluginVersionAllowlist !== 'semver'
  ) throw new Error('Contrato da auditoria sistêmica fora da versão 1.')
  return value
}

async function optionalJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

function duplicateActiveJobs(store) {
  const counts = new Map()
  for (const job of store?.jobs ?? []) {
    if (!['queued', 'running'].includes(job.state)) continue
    const key = `${job.patternId}:${job.generationFingerprint}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
}

function duplicatePortableRules(document) {
  const counts = new Map()
  for (const rule of document?.rules ?? []) {
    const key = rule?.evidence?.fingerprint ?? hash(
      `${rule?.destination}:${String(rule?.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}`
    )
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
}

function finding(code, severity, amount, at, { releaseBlocking = severity === 'error' } = {}) {
  return {
    code,
    severity,
    releaseBlocking,
    amount,
    evidenceFingerprint: hash(`${code}:${amount}`),
    detectedAt: at
  }
}

const FINDING_ROUTES = Object.freeze({
  'release-integrity-drift': 'rode `atualizar` e confirme a integridade da instalação antes de declarar reparo',
  'real-behavior-eval-missing': 'execute `eval-comportamental --arquivo <corpus-revisado>` quando houver corpus e revisão independentes',
  'trusted-personality-eval-missing': 'execute `eval-personalidade-plano` e registre somente uma rodada observada',
  'learned-personality-cases-pending': 'complete o cenário executável dos casos aprendidos antes de promovê-los',
  'duplicate-active-failure-jobs': 'a sincronização da fila é o reparo local determinístico; confira o resultado desta auditoria',
  'materialized-learning-without-installed-readback': 'rode `atualizar` e exija readback do payload instalado',
  'operational-improvement-ready-without-materialization': 'materialize a candidata na fonte canônica configurada; sem configuração ela continua pronta e isto ainda não é release',
  'operational-implementation-required': 'reivindique automaticamente um executor pela porta neutra para implementar o alvo, rodar regressão e fazer readback do mesmo artefato',
  'operational-materialized-without-installed-readback': 'rode gates, gere uma release identificada, instale-a e execute `atualizar`; antes do readback íntegro não há efeito comprovado'
})

function contextoDoFinding(item) {
  const route = FINDING_ROUTES[item.code]
  return `- ${item.code} (${item.severity}; ${item.amount}) — ${route ?? 'classifique a causa, registre uma rota executável e inicie a correção sem declarar sucesso antes do readback'}`
}

async function materializarMelhoriasProntas(casa, at) {
  const cycle = await lerCicloOperacional(casa)
  const results = []
  const sourceChanges = new Set(['routing', 'hook', 'runtime-fix', 'capability'])
  const ready = (cycle.improvementCandidates ?? [])
    .filter((candidate) => candidate.status === 'ready')
    .sort((left, right) =>
      Number(sourceChanges.has(right.destination)) - Number(sourceChanges.has(left.destination))
    )
  for (const candidate of ready) {
    try {
      const result = await materializarMelhoriaComBaselineConfigurada(casa, candidate.id, { at })
      results.push({ candidateId: candidate.id, result: result.result })
    } catch (error) {
      results.push({
        candidateId: candidate.id,
        result: 'repair-failed',
        errorFingerprint: hash(`${error?.name ?? 'Error'}:${error?.code ?? 'unknown'}:${at}`)
      })
    }
  }
  return results
}

function stateFingerprint(run) {
  const stableMetrics = { ...run.metrics }
  delete stableMetrics.findingsAutoCorrected
  delete stableMetrics.findingCorrectionRate
  return hash(JSON.stringify({
    plugin: run.plugin,
    findings: run.findings.map(({ code, severity, releaseBlocking, amount, evidenceFingerprint }) => ({
      code,
      severity,
      releaseBlocking,
      amount,
      evidenceFingerprint
    })),
    metrics: stableMetrics
  }))
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validateStore(store, path) {
  if (
    store?.schemaVersion !== 1 ||
    store.store?.id !== 'omni-local-system-self-audit' ||
    !validDate(store.store?.createdAt) ||
    !validDate(store.store?.updatedAt) ||
    (store.store.lastSurfacedFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(store.store.lastSurfacedFingerprint)) ||
    (store.store.lastSurfacedAt !== undefined && !validDate(store.store.lastSurfacedAt)) ||
    !Array.isArray(store.runs) ||
    !store.runs.every((run) =>
      typeof run?.id === 'string' &&
      validDate(run.executedAt) &&
      typeof run.status === 'string' &&
      (run.stateFingerprint === undefined || /^[a-f0-9]{64}$/.test(run.stateFingerprint)) &&
      Array.isArray(run.findings) &&
      Array.isArray(run.repairs) &&
      run.privacy?.rawConversationStored === false &&
      run.privacy?.rawToolDataStored === false &&
      run.privacy?.rawPathsStored === false
    )
  ) throw new Error(`Histórico da auditoria sistêmica fora da versão 1: ${path}`)
}

async function lockHistory(casa) {
  const directory = join(casa, 'audits')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'system-health.lock')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(path).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 120_000) {
        await unlink(path).catch(() => undefined)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    }
  }
  throw new Error('O histórico da auditoria sistêmica está ocupado por outra escrita.')
}

export function caminhoDaAuditoriaSistema(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'audits', 'system-health.json')
}

function emptyHistory(at = now()) {
  return {
    schemaVersion: 1,
    store: { id: 'omni-local-system-self-audit', createdAt: at, updatedAt: at },
    runs: []
  }
}

export async function lerAuditoriaSistema(casa) {
  const path = caminhoDaAuditoriaSistema(casa)
  const store = await optionalJson(path, emptyHistory())
  validateStore(store, path)
  return store
}

export async function consumirContextoAuditoriaSistema(casa, { at } = {}) {
  const path = caminhoDaAuditoriaSistema(casa)
  const release = await lockHistory(casa)
  try {
    const store = await optionalJson(path, emptyHistory())
    validateStore(store, path)
    const latest = store.runs.at(-1)
    if (!latest || latest.findings.length === 0) return null
    if (store.store.lastSurfacedFingerprint === latest.stateFingerprint) return null
    const timestamp = now(at)
    store.store.lastSurfacedFingerprint = latest.stateFingerprint
    store.store.lastSurfacedAt = timestamp
    store.store.updatedAt = timestamp
    validateStore(store, path)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
    return [
      `AUDITORIA SISTÊMICA ${latest.id}: ${latest.status}.`,
      'Estes achados são estado observado, não prova de reparo. Crie trabalho somente para uma rota executável abaixo:',
      ...latest.findings.map(contextoDoFinding)
    ].join('\n')
  } finally {
    await release()
  }
}

export async function auditarSaudeSistema(casa, {
  pluginRoot = raiz,
  repair = true,
  at
} = {}) {
  const policy = await contract()
  const timestamp = now(at)
  const automationPath = caminhoDaAutomacaoFalhas(casa)
  const beforeAutomation = await optionalJson(automationPath, { jobs: [] })
  const duplicatesBefore = duplicateActiveJobs(beforeAutomation)
  const automation = repair
    ? await sincronizarAutomacaoFalhas(casa, { at: timestamp })
    : beforeAutomation
  const duplicatesAfter = duplicateActiveJobs(automation)
  const operationalRepairs = repair
    ? await materializarMelhoriasProntas(casa, timestamp)
    : []
  const improvementAutomation = repair
    ? await sincronizarAutomacaoMelhorias(casa, { at: timestamp })
    : { jobs: [] }

  const [failures, improvements, cycle, turnAudit, scan, behavior, personality, releaseIdentity, rules, learnedCases, integrity] = await Promise.all([
    lerFalhas(casa),
    lerAutoaperfeicoamento(casa),
    lerCicloOperacional(casa),
    lerAuditoriaAutocorrecao(casa),
    lerEstadoVarredura(casa),
    lerHistoricoComportamental(casa),
    lerHistoricoPersonalidade(casa),
    lerIdentidadeRelease(pluginRoot),
    optionalJson(join(pluginRoot, 'contratos', 'operacao', 'regras-aprendidas.json'), { rules: [] }),
    optionalJson(join(pluginRoot, 'contratos', 'eval', 'casos-aprendidos.json'), { cases: [] }),
    verificarIntegridadeRelease(pluginRoot)
  ])

  const delegations = cycle.delegations ?? []
  const verifiedDelegations = delegations.filter((item) => ['verified', 'closed'].includes(item.state)).length
  const unverifiedDelegations = delegations.filter((item) => !['verified', 'closed'].includes(item.state)).length
  const turns = turnAudit.turns ?? []
  const allFindings = turns.flatMap((turn) => turn.findings ?? [])
  const allCorrections = turns.flatMap((turn) => turn.corrections ?? [])
  const verifiedCorrections = allCorrections.filter((item) => item.state === 'verified').length
  const unresolvedTurnFindings = turns.reduce((sum, turn) => sum + (turn.findings ?? []).filter((item) =>
    item.state === 'open' || item.state === 'unresolved'
  ).length, 0)
  const actionCount = turns.reduce((sum, turn) => sum + (turn.actions?.length ?? 0), 0)
  const evidenceCount = turns.reduce((sum, turn) => sum + (turn.evidence?.length ?? 0), 0)
  const behaviorRuns = behavior.runs ?? []
  const behaviorPassed = behaviorRuns.filter((run) => run.status === 'passed').length
  const personalityRuns = personality.runs ?? []
  const personalityPassed = personalityRuns.filter((run) => run.status === 'passed').length
  const personalityUnverified = personalityRuns.filter((run) => run.status.startsWith('unverified')).length
  const pendingLearnedCases = (learnedCases.cases ?? []).filter((item) =>
    !['covered-by-canonical-case', 'executable'].includes(item.readiness)
  ).length
  const evaluatedProposals = improvements.proposals.filter((item) =>
    ['evaluated', 'approved', 'materialized-pending-version', 'retracted'].includes(item.status)
  )
  const effectiveProposals = improvements.proposals.filter((item) =>
    item.status === 'materialized-pending-version' && item.promotion?.installedReadback?.verified === true
  ).length
  const materializedWithoutReadback = improvements.proposals.filter((item) =>
    item.status === 'materialized-pending-version' && item.promotion?.installedReadback?.verified !== true
  ).length
  const retractedProposals = improvements.proposals.filter((item) => item.status === 'retracted').length
  const operationalCandidates = (cycle.improvementCandidates ?? []).filter((item) => [
    'ready',
    'implementation-required',
    'materialized-pending-release',
    'installed-verified',
    'superseded'
  ].includes(item.status))
  const operationalReady = operationalCandidates.filter((item) => item.status === 'ready').length
  const operationalImplementationRequired = operationalCandidates.filter((item) => item.status === 'implementation-required').length
  const operationalPendingRelease = operationalCandidates.filter((item) => item.status === 'materialized-pending-release').length
  const operationalInstalledVerified = operationalCandidates.filter((item) => item.status === 'installed-verified').length
  const operationalSuperseded = operationalCandidates.filter((item) => item.status === 'superseded').length
  const evaluatedFailures = failures.patterns.filter((item) => item.status === 'evaluated').length
  const routedFailureIds = new Set(improvements.proposals
    .filter((item) => item.source?.kind === 'failure-pattern')
    .map((item) => item.source.id))
  const unroutedEvaluatedFailures = failures.patterns.filter((item) =>
    item.status === 'evaluated' && !routedFailureIds.has(item.id)
  ).length
  const portableDuplicates = duplicatePortableRules(rules)
  const findings = []
  if (integrity.status !== 'verified') findings.push(finding('release-integrity-drift', 'error', 1, timestamp))
  if (behaviorPassed === 0) findings.push(finding('real-behavior-eval-missing', 'warning', 1, timestamp))
  if (personalityPassed === 0) findings.push(finding('trusted-personality-eval-missing', 'warning', 1, timestamp))
  if (personalityUnverified > 0) findings.push(finding('personality-self-claims-unverified', 'warning', personalityUnverified, timestamp))
  if (pendingLearnedCases > 0) findings.push(finding('learned-personality-cases-pending', 'warning', pendingLearnedCases, timestamp))
  if (duplicatesAfter > 0) findings.push(finding('duplicate-active-failure-jobs', 'error', duplicatesAfter, timestamp))
  if (unverifiedDelegations > 0) findings.push(finding('unverified-delegations', 'warning', unverifiedDelegations, timestamp))
  if (unresolvedTurnFindings > 0) {
    findings.push(finding(
      'unresolved-turn-findings',
      'error',
      unresolvedTurnFindings,
      timestamp,
      { releaseBlocking: false }
    ))
  }
  if (portableDuplicates > 0) findings.push(finding('duplicate-portable-rules', 'error', portableDuplicates, timestamp))
  if (unroutedEvaluatedFailures > 0) findings.push(finding('evaluated-learning-without-route', 'warning', unroutedEvaluatedFailures, timestamp))
  if (materializedWithoutReadback > 0) findings.push(finding('materialized-learning-without-installed-readback', 'warning', materializedWithoutReadback, timestamp))
  if (operationalReady > 0) findings.push(finding('operational-improvement-ready-without-materialization', 'warning', operationalReady, timestamp))
  if (operationalImplementationRequired > 0) findings.push(finding('operational-implementation-required', 'warning', operationalImplementationRequired, timestamp))
  if (operationalPendingRelease > 0) findings.push(finding('operational-materialized-without-installed-readback', 'warning', operationalPendingRelease, timestamp))

  const queueRepairs = Math.max(0, duplicatesBefore - duplicatesAfter)
  const operationalAdvanced = operationalRepairs.filter((item) =>
    ['implementation-required', 'materialized-pending-release'].includes(item.result)
  ).length
  const operationalRouted = improvementAutomation.jobs.filter((item) =>
    !['completed'].includes(item.state)
  ).length
  const repaired = queueRepairs + operationalAdvanced
  const latestScan = scan.scans?.at(-1) ?? null
  const findingCounts = new Map()
  for (const item of allFindings) findingCounts.set(item.code, (findingCounts.get(item.code) ?? 0) + 1)
  const recurringFindings = [...findingCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const metrics = {
    findingsDetected: findings.reduce((sum, item) => sum + item.amount, 0),
    findingsAutoCorrected: repaired,
    findingCorrectionRate: ratio(repaired + verifiedCorrections, repaired + allFindings.length),
    findingRecurrenceRate: ratio(recurringFindings, allFindings.length),
    evidenceCoverage: ratio(evidenceCount, actionCount),
    sameTurnCorrectionRate: ratio(verifiedCorrections, allCorrections.length),
    verifiedDelegationRate: ratio(verifiedDelegations, delegations.length),
    personalityRealPassRate: ratio(behaviorPassed, behaviorRuns.length),
    personalityTrustedPassRate: ratio(personalityPassed, personalityRuns.length),
    personalityUnverifiedClaims: personalityUnverified,
    learningEffectRate: ratio(
      effectiveProposals + operationalInstalledVerified,
      evaluatedProposals.length + operationalCandidates.length
    ),
    selfImprovementRetracted: retractedProposals,
    operationalImprovementReady: operationalReady,
    operationalImplementationRequired,
    operationalMaterializedPendingRelease: operationalPendingRelease,
    operationalInstalledVerified,
    operationalSuperseded,
    operationalLearningEffectRate: ratio(operationalInstalledVerified, operationalCandidates.length),
    activeQueueDuplicateRate: ratio(duplicatesAfter, automation.jobs.filter((item) => ['queued', 'running'].includes(item.state)).length),
    lastScanBytes: latestScan?.bytes ?? 0,
    lastScanParsedLines: latestScan?.parsedLines ?? 0,
    evaluatedFailures,
    routedEvaluatedFailures: evaluatedFailures - unroutedEvaluatedFailures
  }
  const run = {
    id: `system-audit-${randomUUID()}`,
    executedAt: timestamp,
    status: findings.some((item) => item.severity === 'error') ? 'repair-required' : findings.length ? 'observing' : 'healthy',
    plugin: {
      version: safePluginVersion(releaseIdentity.version),
      payloadFingerprint: integrity.fingerprint,
      integrity: integrity.status
    },
    findings,
    repairs: [
      ...(queueRepairs > 0 ? [{
        code: 'coalesced-duplicate-failure-jobs',
        amount: queueRepairs,
        verified: duplicatesAfter === 0
      }] : []),
      ...(operationalAdvanced > 0 ? [{
        code: 'advanced-ready-operational-improvements',
        amount: operationalAdvanced,
        verified: true
      }] : []),
      ...(operationalRouted > 0 ? [{
        code: 'routed-source-improvements-through-neutral-port',
        amount: operationalRouted,
        verified: true
      }] : [])
    ],
    metrics,
    privacy: { rawConversationStored: false, rawToolDataStored: false, rawPathsStored: false }
  }
  run.stateFingerprint = stateFingerprint(run)

  const path = caminhoDaAuditoriaSistema(casa)
  const releaseLock = await lockHistory(casa)
  try {
    const store = await optionalJson(path, emptyHistory(timestamp))
    validateStore(store, path)
    const latest = store.runs.at(-1)
    if (latest?.stateFingerprint === run.stateFingerprint) {
      return { result: latest.status, run: latest, unchanged: true }
    }
    store.runs.push(run)
    store.runs = store.runs.slice(-policy.history.maximumRuns)
    store.store.updatedAt = timestamp
    validateStore(store, path)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
    return { result: run.status, run, unchanged: false }
  } finally {
    await releaseLock()
  }
}
