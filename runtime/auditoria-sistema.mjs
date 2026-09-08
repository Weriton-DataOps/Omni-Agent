import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  lerAuditoriaAutocorrecao,
  reconciliarTurnosPendentesAuditoria
} from './auditoria-autocorrecao.mjs'
import { lerAutoaperfeicoamento } from './autoaperfeicoamento.mjs'
import { caminhoDaAutomacaoFalhas, sincronizarAutomacaoFalhas } from './automacao-falhas.mjs'
import {
  lerCicloOperacional,
  reconciliarDelegacoesOperacionais
} from './ciclo-operacional.mjs'
import { lerFalhas } from './falhas.mjs'
import { lerHistoricoComportamental } from './eval-comportamental.mjs'
import { lerHistoricoPersonalidade } from './rodada-personalidade.mjs'
import {
  lerIdentidadeRelease,
  verificarIntegridadeRelease
} from './integridade-release.mjs'
import { lerEstadoVarredura } from './varredura-diaria.mjs'
import { lerTelemetriaAutocorrecao } from './telemetria-autocorrecao.mjs'
import {
  materializarMelhoriaComBaselineConfigurada,
  sincronizarAutomacaoMelhorias
} from './automacao-melhorias.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const CONTRACT_PATH = new URL('../contratos/operacao/auditoria-sistema.json', import.meta.url)
const CONTEXT_DELIVERY_LEASE_MS = 10 * 60 * 1000

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

function consecutiveDegradedRuns(runs, profile) {
  const matching = runs.filter((run) => run.profile === profile)
  let count = 0
  for (let index = matching.length - 1; index >= 0 && matching[index]?.status === 'degraded'; index -= 1) {
    count += 1
  }
  return count
}

export const CLASSIFICACOES_AUDITORIA = Object.freeze({
  actionableDebt: 'actionable-debt',
  awaitingProof: 'awaiting-proof',
  terminalWithoutSuccess: 'terminal-without-success',
  historicalUnverifiable: 'historical-unverifiable',
  superseded: 'superseded',
  verified: 'verified',
  observing: 'observing'
})

const DELEGATION_ACTIONABLE_STATES = new Set(['prepared', 'visible', 'running', 'blocked'])
const DELEGATION_AWAITING_PROOF_STATES = new Set(['reported'])
const DELEGATION_TERMINAL_WITHOUT_SUCCESS_STATES = new Set(['failed', 'cancelled'])
const DELEGATION_VERIFIED_STATES = new Set(['verified', 'closed'])
const TERMINAL_TURN_STATES = new Set(['verified', 'closed', 'failed', 'cancelled', 'archived'])
const TERMINAL_FINDING_WITHOUT_SUCCESS_STATES = new Set(['owner-reconfirmation-required'])
const OPERATIONAL_ACTIONABLE_STATES = new Set([
  'ready',
  'implementation-required',
  'materialized-pending-release'
])

function historicoNaoVerificavel(item) {
  return Boolean(
    item?.legacyUnverified === true ||
    item?.finalOutcome === 'legacy-unverified' ||
    item?.finalOutcome === 'historical-unverifiable' ||
    item?.state === 'historical-unverifiable' ||
    item?.state === 'archived' ||
    item?.status === 'historical-unverifiable' ||
    item?.status === 'archived'
  )
}

export function classificarDelegacaoAuditoria(item = {}) {
  if (DELEGATION_TERMINAL_WITHOUT_SUCCESS_STATES.has(item.state)) {
    return CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess
  }
  if (historicoNaoVerificavel(item)) return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
  if (DELEGATION_ACTIONABLE_STATES.has(item.state)) return CLASSIFICACOES_AUDITORIA.actionableDebt
  if (DELEGATION_AWAITING_PROOF_STATES.has(item.state)) return CLASSIFICACOES_AUDITORIA.awaitingProof
  if (DELEGATION_VERIFIED_STATES.has(item.state)) return CLASSIFICACOES_AUDITORIA.verified
  return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
}

export function classificarAchadoTurnoAuditoria(item = {}, turn = {}) {
  if (item.state === 'historical-unverifiable') return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
  if (item.state === 'superseded') return CLASSIFICACOES_AUDITORIA.superseded
  if (TERMINAL_FINDING_WITHOUT_SUCCESS_STATES.has(item.state)) {
    return CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess
  }
  if (item.state === 'corrected') return CLASSIFICACOES_AUDITORIA.verified
  if (item.state === 'open' || item.state === 'unresolved') {
    return TERMINAL_TURN_STATES.has(turn.state)
      ? CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess
      : CLASSIFICACOES_AUDITORIA.actionableDebt
  }
  return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
}

export function classificarMelhoriaOperacionalAuditoria(item = {}, currentRelease = {}) {
  if (historicoNaoVerificavel(item)) return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
  if (OPERATIONAL_ACTIONABLE_STATES.has(item.status)) return CLASSIFICACOES_AUDITORIA.actionableDebt
  if (item.status === 'installed-verified') {
    const hasCurrentIdentity = typeof currentRelease.version === 'string' &&
      typeof currentRelease.payloadFingerprint === 'string'
    const installed = item.installedReadback
    if (
      hasCurrentIdentity &&
      (
        installed?.version !== currentRelease.version ||
        installed?.payloadFingerprint !== currentRelease.payloadFingerprint
      )
    ) return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
    return CLASSIFICACOES_AUDITORIA.awaitingProof
  }
  if (item.status === 'loaded-verified') return CLASSIFICACOES_AUDITORIA.verified
  if (item.status === 'superseded') return CLASSIFICACOES_AUDITORIA.superseded
  if (item.status === 'observing') return CLASSIFICACOES_AUDITORIA.observing
  return CLASSIFICACOES_AUDITORIA.historicalUnverifiable
}

export function resumirClassificacoesAuditoria(items, classifier) {
  if (!Array.isArray(items) || typeof classifier !== 'function') {
    throw new TypeError('Resumo de classificacoes exige itens e classificador validos.')
  }
  const summary = Object.fromEntries(
    Object.values(CLASSIFICACOES_AUDITORIA).map((classification) => [classification, 0])
  )
  for (const item of items) {
    const classification = classifier(item)
    summary[classification] = (summary[classification] ?? 0) + 1
  }
  return summary
}

async function contract() {
  const value = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  const sameList = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  const operationalFindings = [
    'operational-improvement-ready-without-materialization',
    'operational-implementation-required',
    'operational-materialized-without-installed-readback',
    'operational-installed-without-loaded-readback'
  ]
  const operationalMetrics = [
    'selfImprovementRetracted',
    'operationalImprovementReady',
    'operationalImplementationRequired',
    'operationalMaterializedPendingRelease',
    'operationalInstalledVerified',
    'operationalLoadedVerified',
    'operationalSuperseded',
    'operationalImprovementHistoricalTotal',
    'operationalImprovementActionableDebt',
    'operationalImprovementAwaitingProof',
    'operationalImprovementHistoricalUnverifiable',
    'operationalImprovementObserving',
    'operationalLearningEffectRate'
  ]
  const classificationMetrics = [
    'delegationHistoricalTotal',
    'delegationActionableDebt',
    'delegationAwaitingProof',
    'delegationTerminalWithoutSuccess',
    'delegationHistoricalUnverifiable',
    'delegationVerified',
    'turnFindingHistoricalTotal',
    'turnFindingActionableDebt',
    'turnFindingTerminalWithoutSuccess',
    'turnFindingHistoricalUnverifiable',
    'turnFindingSuperseded',
    'turnFindingVerified'
  ]
  const selfRepairMetrics = [
    'selfRepairRunsObserved',
    'selfRepairConsecutiveDegradedRuns',
    'selfRepairFailedStagesLatest'
  ]
  const classification = value.classification
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-system-self-audit-v1' ||
    !Number.isInteger(value.history?.maximumRuns) ||
    value.history.maximumRuns < 1 ||
    value.history.idempotentByStateFingerprint !== true ||
    value.history.reuseLatestUnchangedRun !== true ||
    !value.repairPolicy?.automatic?.includes('materialize-ready-operational-improvements') ||
    !value.repairPolicy?.automatic?.includes('reconcile-inactive-turn-findings') ||
    !value.repairPolicy?.automatic?.includes('reconcile-orphan-delegations') ||
    !value.repairPolicy?.automatic?.includes('serialize-operational-improvements-per-repository') ||
    !value.repairPolicy?.automatic?.includes('route-source-improvements-to-neutral-delegation') ||
    value.repairPolicy?.requiresIndependentReadback !== true ||
    value.repairPolicy?.doesNotExpandCurrentAuthority !== true ||
    !sameList(value.turnFindingLifecycle?.recoverable?.findingStates, ['open', 'unresolved']) ||
    value.turnFindingLifecycle?.recoverable?.severity !== 'error' ||
    value.turnFindingLifecycle?.recoverable?.releaseBlocking !== false ||
    value.turnFindingLifecycle?.recoverable?.survivesSessionAndReleaseBoundary !== true ||
    value.turnFindingLifecycle?.recoverable?.retestAutomatically !== true ||
    value.turnFindingLifecycle?.recoverable?.terminalArchiveWithoutCounterproof !== false ||
    !value.findings?.includes('delegations-awaiting-proof') ||
    !value.findings?.includes('self-repair-stages-degraded') ||
    !operationalFindings.every((code) => value.findings?.includes(code)) ||
    !operationalMetrics.every((metric) => value.metrics?.includes(metric)) ||
    !classificationMetrics.every((metric) => value.metrics?.includes(metric)) ||
    !selfRepairMetrics.every((metric) => value.metrics?.includes(metric)) ||
    !sameList(classification?.categories, Object.values(CLASSIFICACOES_AUDITORIA)) ||
    classification?.historicalTotalsRemainObservable !== true ||
    classification?.actionableFindingsExcludeTerminal !== true ||
    !sameList(classification?.delegations?.actionableStates, ['prepared', 'visible', 'running', 'blocked']) ||
    !sameList(classification?.delegations?.awaitingProofStates, ['reported']) ||
    !sameList(classification?.delegations?.terminalWithoutSuccessStates, ['failed', 'cancelled']) ||
    classification?.delegations?.terminalStatesOverrideLegacyFlag !== true ||
    !sameList(classification?.delegations?.verifiedStates, ['verified', 'closed']) ||
    !sameList(classification?.delegations?.historicalUnverifiableStates, ['archived']) ||
    !sameList(classification?.delegations?.historicalUnverifiableOutcomes, ['legacy-unverified', 'historical-unverifiable']) ||
    !sameList(classification?.turnFindings?.actionableStates, ['open', 'unresolved']) ||
    !sameList(classification?.turnFindings?.terminalWithoutSuccessStates, ['owner-reconfirmation-required']) ||
    !sameList(classification?.turnFindings?.historicalUnverifiableStates, ['historical-unverifiable']) ||
    !sameList(classification?.turnFindings?.supersededStates, ['superseded']) ||
    !sameList(classification?.turnFindings?.verifiedStates, ['corrected']) ||
    !sameList(classification?.turnFindings?.terminalContainerStates, ['verified', 'closed', 'failed', 'cancelled', 'archived']) ||
    !sameList(classification?.operationalImprovements?.actionableStates, ['ready', 'implementation-required', 'materialized-pending-release']) ||
    !sameList(classification?.operationalImprovements?.awaitingProofStates, ['installed-verified']) ||
    !sameList(classification?.operationalImprovements?.verifiedStates, ['loaded-verified']) ||
    !sameList(classification?.operationalImprovements?.supersededStates, ['superseded']) ||
    !sameList(classification?.operationalImprovements?.observingStates, ['observing']) ||
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
  'release-integrity-drift': 'o executor interno de release é responsável por atualizar e confirmar a integridade da instalação antes de registrar reparo',
  'real-behavior-eval-missing': 'o avaliador interno mantém o item aguardando corpus revisado e processa `eval-comportamental` quando houver revisão independente',
  'trusted-personality-eval-missing': 'o avaliador interno processa `eval-personalidade-plano` e registra somente uma rodada observada',
  'learned-personality-cases-pending': 'o orquestrador interno completa o cenário executável dos casos aprendidos antes da promoção',
  'duplicate-active-failure-jobs': 'o sincronizador interno reconcilia a fila e conserva o resultado como evidência da auditoria',
  'unverified-delegations': 'o reconciliador interno cria rota apenas para delegações ativas e aguarda evidência correlacionada; estados terminais permanecem somente no histórico',
  'delegations-awaiting-proof': 'o worker responsável obtém readback independente do relato correlacionado antes de verificar ou fechar a delegação',
  'materialized-learning-without-installed-readback': 'o atualizador interno processa a instalação e exige readback do payload instalado',
  'operational-improvement-ready-without-materialization': 'o materializador interno aplica a candidata à fonte canônica configurada; sem configuração, ela permanece pronta e ainda não constitui release',
  'operational-implementation-required': 'o despachante interno reivindica um executor pela porta neutra, implementa o alvo, roda a regressão e lê novamente o mesmo artefato',
  'operational-materialized-without-installed-readback': 'o worker de release valida os gates, gera uma release identificada, instala e confirma o readback; antes disso não há efeito comprovado',
  'self-repair-stages-degraded': 'o hook síncrono tenta novamente a etapa rejeitada e mantém a falha observável pela telemetria hash-only'
})

function contextoDoFinding(item) {
  const route = FINDING_ROUTES[item.code]
  return `- obrigação interna: ${item.code} (${item.severity}; ${item.amount}) — ${route ?? 'o orquestrador interno classifica a causa, cria uma rota executável e só registra sucesso depois do readback'}`
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
    const timestamp = now(at)
    const sameStateWasRecentlyDelivered =
      store.store.lastSurfacedFingerprint === latest.stateFingerprint &&
      validDate(store.store.lastSurfacedAt) &&
      Date.parse(timestamp) >= Date.parse(store.store.lastSurfacedAt) &&
      Date.parse(timestamp) - Date.parse(store.store.lastSurfacedAt) < CONTEXT_DELIVERY_LEASE_MS
    if (sameStateWasRecentlyDelivered) return null
    store.store.lastSurfacedFingerprint = latest.stateFingerprint
    store.store.lastSurfacedAt = timestamp
    store.store.updatedAt = timestamp
    validateStore(store, path)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
    return [
      `ESTADO INTERNO DE AUTOCORREÇÃO ${latest.id}: ${latest.status}.`,
      'Este bloco é memória operacional interna: não o repita nem o transforme em checklist para o proprietário.',
      'Mantenha a personalidade ativa. O Omni é responsável por executar silenciosamente as rotas cobertas pela autoridade já existente.',
      'O pedido atual mantém prioridade. Dívida que não faz parte do seu Definition of Done permanece no worker ou na fila e nunca substitui a resposta ao proprietário.',
      'Só peça ao proprietário nova autoridade, um dado indispensável ou uma decisão material. Nesse caso, faça uma única pergunta contextual e nunca mande o proprietário executar comandos ou etapas operacionais.',
      'Rotas internas pendentes:',
      ...latest.findings.map(contextoDoFinding)
    ].join('\n')
  } finally {
    await release()
  }
}

export async function auditarSaudeSistema(casa, {
  pluginRoot = raiz,
  repair = true,
  reconcile = true,
  at
} = {}) {
  const policy = await contract()
  const timestamp = now(at)
  if (repair && reconcile) await reconciliarTurnosPendentesAuditoria(casa, {}, { at: timestamp })
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
  if (repair && reconcile) {
    const activeDelegationIds = [...new Set([
      ...(automation.jobs ?? [])
        .filter((job) => !['completed', 'superseded'].includes(job.state) && job.delegationId)
        .map((job) => job.delegationId),
      ...(improvementAutomation.jobs ?? [])
        .filter((job) => job.state !== 'completed' && job.delegationId)
        .map((job) => job.delegationId)
    ])]
    await reconciliarDelegacoesOperacionais(casa, { activeDelegationIds, at: timestamp })
  }

  const [failures, improvements, cycle, turnAudit, scan, behavior, personality, releaseIdentity, rules, learnedCases, integrity, selfRepairTelemetry] = await Promise.all([
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
    verificarIntegridadeRelease(pluginRoot),
    lerTelemetriaAutocorrecao(casa)
  ])

  const delegations = cycle.delegations ?? []
  const delegationClassifications = resumirClassificacoesAuditoria(
    delegations,
    classificarDelegacaoAuditoria
  )
  const verifiedDelegations = delegationClassifications[CLASSIFICACOES_AUDITORIA.verified]
  const unverifiedDelegations = delegationClassifications[CLASSIFICACOES_AUDITORIA.actionableDebt]
  const delegationsAwaitingProof = delegationClassifications[CLASSIFICACOES_AUDITORIA.awaitingProof]
  const turns = turnAudit.turns ?? []
  const turnFindingEntries = turns.flatMap((turn) =>
    (turn.findings ?? []).map((item) => ({ item, turn }))
  )
  const allFindings = turnFindingEntries.map(({ item }) => item)
  const turnFindingClassifications = resumirClassificacoesAuditoria(
    turnFindingEntries,
    ({ item, turn }) => classificarAchadoTurnoAuditoria(item, turn)
  )
  const allCorrections = turns.flatMap((turn) => turn.corrections ?? [])
  const verifiedCorrections = allCorrections.filter((item) => item.state === 'verified').length
  const unresolvedTurnFindings = turnFindingClassifications[CLASSIFICACOES_AUDITORIA.actionableDebt]
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
  const allOperationalCandidates = cycle.improvementCandidates ?? []
  const currentRelease = {
    version: releaseIdentity.version,
    payloadFingerprint: integrity.fingerprint
  }
  const operationalClassifications = resumirClassificacoesAuditoria(
    allOperationalCandidates,
    (item) => classificarMelhoriaOperacionalAuditoria(item, currentRelease)
  )
  const operationalCandidates = allOperationalCandidates.filter((item) => [
    'ready',
    'implementation-required',
    'materialized-pending-release',
    'installed-verified',
    'loaded-verified',
    'superseded'
  ].includes(item.status))
  const operationalReady = operationalCandidates.filter((item) => item.status === 'ready').length
  const operationalImplementationRequired = operationalCandidates.filter((item) => item.status === 'implementation-required').length
  const operationalPendingRelease = operationalCandidates.filter((item) => item.status === 'materialized-pending-release').length
  const operationalInstalledVerified = operationalCandidates.filter((item) => item.status === 'installed-verified').length
  const operationalLoadedVerified = operationalCandidates.filter((item) => item.status === 'loaded-verified').length
  const operationalSuperseded = operationalCandidates.filter((item) => item.status === 'superseded').length
  const operationalInstalledAwaitingProof = operationalClassifications[CLASSIFICACOES_AUDITORIA.awaitingProof]
  const evaluatedFailures = failures.patterns.filter((item) => item.status === 'evaluated').length
  const routedFailureIds = new Set(improvements.proposals
    .filter((item) => item.source?.kind === 'failure-pattern')
    .map((item) => item.source.id))
  const unroutedEvaluatedFailures = failures.patterns.filter((item) =>
    item.status === 'evaluated' && !routedFailureIds.has(item.id)
  ).length
  const portableDuplicates = duplicatePortableRules(rules)
  const selfRepairRuns = selfRepairTelemetry.runs ?? []
  const selfRepairProfiles = ['reconciliation', 'maintenance']
  const latestSelfRepairByProfile = selfRepairProfiles.map((profile) =>
    selfRepairRuns.filter((run) => run.profile === profile).at(-1) ?? null
  )
  const selfRepairConsecutiveDegradedRuns = Math.max(0, ...selfRepairProfiles.map((profile) =>
    consecutiveDegradedRuns(selfRepairRuns, profile)
  ))
  const selfRepairFailedStagesLatest = latestSelfRepairByProfile.reduce((sum, run) =>
    sum + (run?.status === 'degraded' ? run.failedStages : 0), 0
  )
  const findings = []
  if (integrity.status !== 'verified') findings.push(finding('release-integrity-drift', 'error', 1, timestamp))
  if (behaviorPassed === 0) findings.push(finding('real-behavior-eval-missing', 'warning', 1, timestamp))
  if (personalityPassed === 0) findings.push(finding('trusted-personality-eval-missing', 'warning', 1, timestamp))
  if (personalityUnverified > 0) findings.push(finding('personality-self-claims-unverified', 'warning', personalityUnverified, timestamp))
  if (pendingLearnedCases > 0) findings.push(finding('learned-personality-cases-pending', 'warning', pendingLearnedCases, timestamp))
  if (duplicatesAfter > 0) findings.push(finding('duplicate-active-failure-jobs', 'error', duplicatesAfter, timestamp))
  if (selfRepairFailedStagesLatest > 0) {
    findings.push(finding(
      'self-repair-stages-degraded',
      selfRepairConsecutiveDegradedRuns >= 3 ? 'error' : 'warning',
      selfRepairFailedStagesLatest,
      timestamp,
      { releaseBlocking: false }
    ))
  }
  if (unverifiedDelegations > 0) findings.push(finding('unverified-delegations', 'warning', unverifiedDelegations, timestamp))
  if (delegationsAwaitingProof > 0) {
    findings.push(finding('delegations-awaiting-proof', 'warning', delegationsAwaitingProof, timestamp))
  }
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
  if (operationalInstalledAwaitingProof > 0) {
    findings.push(finding(
      'operational-installed-without-loaded-readback',
      'warning',
      operationalInstalledAwaitingProof,
      timestamp
    ))
  }

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
    delegationHistoricalTotal: delegations.length,
    delegationActionableDebt: unverifiedDelegations,
    delegationAwaitingProof: delegationsAwaitingProof,
    delegationTerminalWithoutSuccess: delegationClassifications[CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess],
    delegationHistoricalUnverifiable: delegationClassifications[CLASSIFICACOES_AUDITORIA.historicalUnverifiable],
    delegationVerified: verifiedDelegations,
    turnFindingHistoricalTotal: allFindings.length,
    turnFindingActionableDebt: unresolvedTurnFindings,
    turnFindingTerminalWithoutSuccess: turnFindingClassifications[CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess],
    turnFindingHistoricalUnverifiable: turnFindingClassifications[CLASSIFICACOES_AUDITORIA.historicalUnverifiable],
    turnFindingSuperseded: turnFindingClassifications[CLASSIFICACOES_AUDITORIA.superseded],
    turnFindingVerified: turnFindingClassifications[CLASSIFICACOES_AUDITORIA.verified],
    selfRepairRunsObserved: selfRepairRuns.length,
    selfRepairConsecutiveDegradedRuns,
    selfRepairFailedStagesLatest,
    personalityRealPassRate: ratio(behaviorPassed, behaviorRuns.length),
    personalityTrustedPassRate: ratio(personalityPassed, personalityRuns.length),
    personalityUnverifiedClaims: personalityUnverified,
    learningEffectRate: ratio(
      effectiveProposals + operationalLoadedVerified,
      evaluatedProposals.length + operationalCandidates.length
    ),
    selfImprovementRetracted: retractedProposals,
    operationalImprovementReady: operationalReady,
    operationalImplementationRequired,
    operationalMaterializedPendingRelease: operationalPendingRelease,
    operationalInstalledVerified,
    operationalLoadedVerified,
    operationalSuperseded,
    operationalImprovementHistoricalTotal: allOperationalCandidates.length,
    operationalImprovementActionableDebt: operationalClassifications[CLASSIFICACOES_AUDITORIA.actionableDebt],
    operationalImprovementAwaitingProof: operationalInstalledAwaitingProof,
    operationalImprovementHistoricalUnverifiable: operationalClassifications[CLASSIFICACOES_AUDITORIA.historicalUnverifiable],
    operationalImprovementObserving: operationalClassifications[CLASSIFICACOES_AUDITORIA.observing],
    operationalLearningEffectRate: ratio(operationalLoadedVerified, operationalCandidates.length),
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
