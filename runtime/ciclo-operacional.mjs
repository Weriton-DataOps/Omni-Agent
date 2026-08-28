import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'
import { resolverVerificacaoDelegacaoAuditoria } from './auditoria-autocorrecao.mjs'

export const OPERATIONAL_CYCLE_SCHEMA_VERSION = 1
const CONTRACT_PATH = new URL('../contratos/operacao/ciclo.json', import.meta.url)
const AUTHORITY_PATH = new URL('../contratos/operacao/autoridade.json', import.meta.url)
const HASH_SHA256 = /^[a-f0-9]{64}$/
const DELEGATION_STATES = new Set([
  'prepared',
  'visible',
  'running',
  'reported',
  'verified',
  'closed',
  'blocked',
  'failed',
  'cancelled'
])
const DELEGATION_TRANSITIONS = {
  prepared: ['visible', 'failed', 'cancelled'],
  visible: ['running', 'failed', 'cancelled'],
  running: ['reported', 'blocked', 'failed', 'cancelled'],
  reported: ['verified', 'running', 'blocked', 'failed', 'cancelled'],
  verified: ['closed'],
  blocked: ['running', 'failed', 'cancelled'],
  closed: [],
  failed: [],
  cancelled: []
}
const IMPROVEMENT_STATES = new Set([
  'observing',
  'ready',
  'implementation-required',
  'materialized-pending-release',
  'installed-verified'
])
const IMPROVEMENT_TRANSITIONS = {
  observing: ['ready'],
  ready: ['implementation-required', 'materialized-pending-release'],
  'implementation-required': ['materialized-pending-release'],
  'materialized-pending-release': ['installed-verified'],
  'installed-verified': []
}
const PORTABLE_ARTIFACTS = {
  'operational-rule': { path: 'contratos/operacao/regras-aprendidas.json', collection: 'rules' },
  personality: { path: 'contratos/eval/casos-aprendidos.json', collection: 'cases' },
  procedure: { path: 'contratos/operacao/procedimentos-aprendidos.json', collection: 'procedures' },
  eval: { path: 'contratos/eval/casos-aprendidos.json', collection: 'cases' }
}

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

function textoIntegralSeguro(value, label, maximum, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} e obrigatorio.`)
    return null
  }
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text) throw new Error(`${label} precisa ser texto nao vazio.`)
  if (text.length > maximum) throw new Error(`${label} excede ${maximum} caracteres.`)
  if (pareceConterSegredo(text)) throw new Error(`${label} parece conter segredo.`)
  return text
}

async function contrato() {
  const [value, authority] = await Promise.all([
    readFile(CONTRACT_PATH, 'utf8').then(JSON.parse),
    readFile(AUTHORITY_PATH, 'utf8').then(JSON.parse)
  ])
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-operational-cycle-v1' ||
    value.authorityContract !== 'omni-responsible-freedom-v1' ||
    !Number.isInteger(value.eventRetention) ||
    !Array.isArray(value.delegation?.states) ||
    !value.delegation.states.every((state) => DELEGATION_STATES.has(state)) ||
    JSON.stringify(value.delegation.transitions) !== JSON.stringify(DELEGATION_TRANSITIONS) ||
    value.delegation.subagentStopProduces !== 'reported' ||
    value.delegation.untrackedExecutorProduces !== 'failed' ||
    value.delegation.reportedIsNotSuccess !== true ||
    value.delegation.verificationPrecedesClosure !== true ||
    value.delegation.verifiedRequiresAuditActionAndEvidence !== true ||
    value.delegation.verificationMustFollowReport !== true ||
    value.delegation.verificationMustMatchAuditedObject !== true ||
    value.delegation.closedSuccessRequiresOutcome !== 'verified' ||
    !Array.isArray(value.improvement?.states) ||
    !value.improvement.states.every((state) => IMPROVEMENT_STATES.has(state)) ||
    JSON.stringify(value.improvement.transitions) !== JSON.stringify(IMPROVEMENT_TRANSITIONS) ||
    value.improvement.minimumOccurrencesReady !== 2 ||
    value.improvement.effectiveState !== 'installed-verified' ||
    value.improvement.materializedState !== 'materialized-pending-release' ||
    value.improvement.reinforcementNeverRegressesState !== true ||
    value.improvement.installedVerificationRequiresReleaseIntegrity !== true ||
    value.improvement.sourceImplementationRequiresAuditedMutationAndReadback !== true ||
    value.privacy?.storeRawConversation !== false ||
    value.privacy?.storeRawToolOutput !== false ||
    authority?.schemaVersion !== 1 ||
    authority.contract !== value.authorityContract ||
    !Array.isArray(authority.authority?.sources) ||
    authority.authority.sources.length < 4 ||
    authority.authority?.delegationCarriesAuthority !== true ||
    authority.authority?.publicDelegationRequiresActiveAuditedTurn !== true ||
    authority.authority?.parentFingerprintMustResolveExistingAuthority !== true ||
    !Array.isArray(authority.risk?.dimensions?.reversibility) ||
    !Array.isArray(authority.risk?.dimensions?.reach) ||
    !Array.isArray(authority.risk?.dimensions?.data) ||
    !Array.isArray(authority.risk?.executionModes) ||
    authority.risk.unclassifiedRiskAction !== 'classify-before-first-material-effect' ||
    !Array.isArray(authority.ownerDecisionWhen) ||
    authority.ownerDecisionWhen.length !== 3 ||
    authority.verification?.evidenceBeforeCompletion !== true ||
    authority.verification?.delegationVerifiedByAuditActionAndEvidence !== true ||
    authority.verification?.verificationAfterReport !== true ||
    authority.verification?.verificationMatchesAuditedObject !== true ||
    authority.privacy?.storeRawIntent !== false ||
    authority.privacy?.storeRawEvidence !== false
  ) throw new Error('Contrato do ciclo operacional fora da versao 1.')
  return { ...value, authority }
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

function hashOuNull(value) {
  return value === null || (typeof value === 'string' && HASH_SHA256.test(value))
}

function dataValida(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function textoNormalizado(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprintSemanticoMelhoria({ destination, statement } = {}) {
  return hash(JSON.stringify({
    destination: textoNormalizado(destination),
    statement: textoNormalizado(statement)
  }))
}

function valorDoContrato(value, allowed, fallback, label) {
  if (value === undefined || value === null) return fallback
  if (!allowed.includes(value)) throw new Error(`${label} fora do contrato.`)
  return value
}

function fingerprintEnvelope(envelope) {
  const { fingerprint: _ignored, ...canonical } = envelope
  return hash(JSON.stringify(canonical))
}

function fingerprintAutoridadeMaterial(envelope) {
  const {
    fingerprint: _ignoredFingerprint,
    turnFingerprint: _ignoredTurn,
    ...material
  } = envelope
  return hash(JSON.stringify(material))
}

function criarEnvelopeAutoridade(input, prompt, target, authority) {
  const hasExplicitAuthority = Boolean(
    input?.authority &&
    typeof input.authority === 'object' &&
    !Array.isArray(input.authority) &&
    Object.keys(input.authority).length > 0
  )
  const requested = hasExplicitAuthority ? input.authority : {}
  const intent = requested.intent === undefined
    ? prompt
    : textoIntegralSeguro(requested.intent, 'Intencao da autoridade', 4000, { required: true })
  const scope = requested.scope === undefined
    ? target
    : textoIntegralSeguro(requested.scope, 'Escopo da autoridade', 2000, { required: true })
  if (requested.effects !== undefined && !Array.isArray(requested.effects)) {
    throw new Error('Efeitos autorizados precisam ser uma lista.')
  }
  if (requested.risk !== undefined && (!requested.risk || typeof requested.risk !== 'object' || Array.isArray(requested.risk))) {
    throw new Error('Risco da autoridade precisa ser um objeto.')
  }
  if (requested.inherited !== undefined && typeof requested.inherited !== 'boolean') {
    throw new Error('Heranca da autoridade precisa ser booleana.')
  }
  const effects = Array.isArray(requested.effects)
    ? requested.effects
        .map((effect) => textoIntegralSeguro(effect, 'Efeito autorizado', 240, { required: true }))
        .map(hash)
    : []
  if (requested.parentFingerprint !== undefined && !HASH_SHA256.test(requested.parentFingerprint)) {
    throw new Error('Fingerprint da autoridade superior e invalido.')
  }
  const parentFingerprint = requested.parentFingerprint ?? null
  if (requested.turnFingerprint !== undefined && !HASH_SHA256.test(requested.turnFingerprint)) {
    throw new Error('Fingerprint do turno de origem e invalido.')
  }
  const turnFingerprint = requested.turnFingerprint ?? null
  const risk = authority.risk.dimensions
  const source = requested.source === undefined
    ? hasExplicitAuthority ? 'owner-intent' : 'delegation-briefing'
    : textoIntegralSeguro(requested.source, 'Fonte da autoridade', 80, { required: true })
  if (!authority.authority.sources.includes(source)) throw new Error('Fonte da autoridade fora do contrato.')
  if (['standing-authority', 'inherited-authority', 'owner-expansion'].includes(source) && parentFingerprint === null) {
    throw new Error(`Fonte ${source} exige fingerprint da autoridade anterior.`)
  }
  const sourceCarriesAuthority = [
    'owner-intent',
    'owner-expansion',
    'standing-authority',
    'inherited-authority'
  ].includes(source)
  const inherited = requested.inherited === undefined
    ? sourceCarriesAuthority
    : requested.inherited === true
  if (inherited && !sourceCarriesAuthority) {
    throw new Error(`Fonte ${source} nao comprova autoridade herdada.`)
  }
  const envelope = {
    contract: authority.contract,
    source,
    intentFingerprint: hash(intent),
    scopeFingerprint: hash(scope),
    effectFingerprints: [...new Set(effects)],
    parentFingerprint,
    turnFingerprint,
    inherited,
    risk: {
      reversibility: valorDoContrato(
        requested.risk?.reversibility,
        risk.reversibility,
        'unclassified',
        'Reversibilidade'
      ),
      reach: valorDoContrato(requested.risk?.reach, risk.reach, 'unclassified', 'Alcance'),
      data: valorDoContrato(requested.risk?.data, risk.data, 'unclassified', 'Classe de dados'),
      mode: valorDoContrato(
        requested.risk?.mode,
        authority.risk.executionModes,
        'prepare-and-proceed',
        'Modo de execucao'
      )
    }
  }
  return { ...envelope, fingerprint: fingerprintEnvelope(envelope) }
}

function envelopeLegado(item) {
  const envelope = {
    contract: 'omni-responsible-freedom-v1',
    source: 'legacy-unscoped',
    intentFingerprint: HASH_SHA256.test(item.promptFingerprint ?? '')
      ? item.promptFingerprint
      : hash(item.id),
    scopeFingerprint: hash(item.target ?? 'legacy-target'),
    effectFingerprints: [],
    parentFingerprint: null,
    inherited: false,
    risk: {
      reversibility: 'unclassified',
      reach: 'unclassified',
      data: 'unclassified',
      mode: 'owner-decision'
    }
  }
  return { ...envelope, fingerprint: fingerprintEnvelope(envelope) }
}

function migrarDelegacaoLegada(item) {
  if (item?.lifecycleVersion === 2) {
    const current = {
      ...item,
      correlationFingerprint: item.correlationFingerprint ?? null,
      reportAuditActionId: item.reportAuditActionId ?? null,
      reportAuditEvidenceId: item.reportAuditEvidenceId ?? null,
      verificationAuditActionId: item.verificationAuditActionId ?? null,
      verificationAuditEvidenceId: item.verificationAuditEvidenceId ?? null
    }
    if (
      ['verified', 'closed'].includes(current.state) &&
      (
        current.reportAuditActionId === null ||
        current.reportAuditEvidenceId === null ||
        current.verificationAuditActionId === null ||
        current.verificationAuditEvidenceId === null
      )
    ) {
      const timestamp = dataValida(current.updatedAt) ? current.updatedAt : agora()
      current.state = 'reported'
      current.verificationEvidenceFingerprint = null
      current.verificationSummary = null
      current.finalOutcome = 'legacy-unverified'
      current.legacyUnverified = true
      current.transitionHistory = [...current.transitionHistory, {
        from: item.state,
        to: 'reported',
        evidenceFingerprint: null,
        kind: 'legacy-migration',
        recordedAt: timestamp
      }].slice(-50)
    }
    return current
  }
  const timestamp = dataValida(item?.updatedAt)
    ? item.updatedAt
    : dataValida(item?.createdAt) ? item.createdAt : agora()
  const legacyState = item?.state
  const state = legacyState === 'completed'
    ? 'reported'
    : legacyState === 'closed'
      ? 'closed'
      : legacyState === 'visible'
        ? 'prepared'
        : legacyState === 'running'
          ? 'blocked'
          : DELEGATION_STATES.has(legacyState)
            ? legacyState
            : 'failed'
  const authorityEnvelope = envelopeLegado(item)
  return {
    ...item,
    lifecycleVersion: 2,
    state,
    visiblePromptConfirmed: false,
    visibilityEvidenceFingerprint: null,
    executionEvidenceFingerprint: null,
    reportEvidenceFingerprint: null,
    verificationEvidenceFingerprint: null,
    evidenceFingerprint: null,
    verificationSummary: null,
    reasonFingerprint: state === 'blocked' || state === 'failed'
      ? hash('legacy-lifecycle-without-verifiable-evidence')
      : null,
    checkpointFingerprint: null,
    rollbackFingerprint: null,
    correlationFingerprint: null,
    reportAuditActionId: null,
    reportAuditEvidenceId: null,
    verificationAuditActionId: null,
    verificationAuditEvidenceId: null,
    authorityEnvelope,
    authorityFingerprint: authorityEnvelope.fingerprint,
    finalOutcome: state === 'closed' ? 'legacy-unverified' : item.finalOutcome ?? null,
    legacyUnverified: true,
    transitionHistory: [{
      from: legacyState ?? null,
      to: state,
      evidenceFingerprint: null,
      kind: 'legacy-migration',
      recordedAt: timestamp
    }]
  }
}

function migrarDelegacoesLegadas(store) {
  store.delegations = store.delegations.map(migrarDelegacaoLegada)
  return store
}

function referenciaPortatil(item) {
  const destination = PORTABLE_ARTIFACTS[item?.destination]
  if (!destination) return null
  return {
    kind: 'portable-entry',
    ...destination,
    entryId: item.id,
    semanticFingerprint: fingerprintSemanticoMelhoria(item),
    contentFingerprint: null
  }
}

function migrarMelhoriaLegada(item) {
  const timestamp = dataValida(item?.updatedAt)
    ? item.updatedAt
    : dataValida(item?.createdAt) ? item.createdAt : agora()
  const legacyStatus = item?.status
  let status = legacyStatus === 'materialized'
    ? 'materialized-pending-release'
    : IMPROVEMENT_STATES.has(legacyStatus) ? legacyStatus : 'observing'
  if (status === 'observing' && Number.isInteger(item?.occurrences) && item.occurrences >= 2) {
    status = 'ready'
  }
  if (status === 'installed-verified' && item?.installedReadback?.verified !== true) {
    status = 'materialized-pending-release'
  }
  let materialized = ['materialized-pending-release', 'installed-verified'].includes(status)
  let artifactRef = materialized
    ? item.artifactRef ?? referenciaPortatil(item)
    : null
  let artifact = materialized
    ? artifactRef?.path ?? null
    : status === 'implementation-required' ? textoSeguro(item?.artifact, 500) : null
  let transitionHistory = Array.isArray(item?.transitionHistory) &&
      item.transitionHistory.length > 0 &&
      item.transitionHistory.at(-1)?.to === status &&
      item.transitionHistory.every((transition) => IMPROVEMENT_STATES.has(transition?.to))
    ? item.transitionHistory
    : [{
        from: legacyStatus ?? null,
        to: status,
        kind: 'legacy-migration',
        recordedAt: timestamp
      }]
  if (materialized && artifactRef?.kind === 'source-file' && !reciboImplementacaoValido(artifactRef.implementationReceipt)) {
    const previous = status
    status = 'implementation-required'
    materialized = false
    artifact = textoSeguro(artifactRef.path ?? item?.artifact, 500) ?? 'runtime'
    artifactRef = null
    transitionHistory = [...transitionHistory, {
      from: previous,
      to: status,
      kind: 'legacy-migration',
      recordedAt: timestamp
    }].slice(-50)
  }
  return {
    ...item,
    lifecycleVersion: 2,
    status,
    artifact: artifact ?? null,
    artifactRef,
    materializedAt: materialized
      ? dataValida(item?.materializedAt) ? item.materializedAt : timestamp
      : null,
    installedReadback: status === 'installed-verified' ? item.installedReadback : null,
    transitionHistory
  }
}

function migrarMelhoriasLegadas(store) {
  store.improvementCandidates = store.improvementCandidates.map(migrarMelhoriaLegada)
  return store
}

function delegacaoValida(item) {
  const base = Boolean(
    item &&
      item.lifecycleVersion === 2 &&
      typeof item.id === 'string' && item.id.startsWith('delegation-') &&
      HASH_SHA256.test(item.sessionFingerprint ?? '') &&
      typeof item.target === 'string' && item.target.length > 0 &&
      DELEGATION_STATES.has(item.state) &&
      typeof item.visiblePromptConfirmed === 'boolean' &&
      hashOuNull(item.promptFingerprint) &&
      hashOuNull(item.visibilityEvidenceFingerprint) &&
      hashOuNull(item.executionEvidenceFingerprint) &&
      hashOuNull(item.reportEvidenceFingerprint) &&
      hashOuNull(item.verificationEvidenceFingerprint) &&
      hashOuNull(item.evidenceFingerprint) &&
      hashOuNull(item.reasonFingerprint) &&
      hashOuNull(item.checkpointFingerprint) &&
      hashOuNull(item.rollbackFingerprint) &&
      hashOuNull(item.correlationFingerprint) &&
      (item.reportAuditActionId === null || /^audit-action-/.test(item.reportAuditActionId)) &&
      (item.reportAuditEvidenceId === null || /^audit-evidence-/.test(item.reportAuditEvidenceId)) &&
      (item.verificationAuditActionId === null || /^audit-action-/.test(item.verificationAuditActionId)) &&
      (item.verificationAuditEvidenceId === null || /^audit-evidence-/.test(item.verificationAuditEvidenceId)) &&
      HASH_SHA256.test(item.authorityFingerprint ?? '') &&
      item.authorityEnvelope?.contract === 'omni-responsible-freedom-v1' &&
      item.authorityEnvelope.fingerprint === item.authorityFingerprint &&
      Array.isArray(item.transitionHistory) &&
      item.transitionHistory.every((transition) =>
        DELEGATION_STATES.has(transition.to) &&
        hashOuNull(transition.evidenceFingerprint) &&
        dataValida(transition.recordedAt)
      ) &&
      dataValida(item.createdAt) &&
      dataValida(item.updatedAt)
  )
  if (!base) return false
  if (fingerprintEnvelope(item.authorityEnvelope) !== item.authorityFingerprint) return false
  if (item.transitionHistory.at(-1)?.to !== item.state) return false

  for (let index = 1; index < item.transitionHistory.length; index += 1) {
    const previous = item.transitionHistory[index - 1]
    const current = item.transitionHistory[index]
    if (current.kind === 'legacy-migration') continue
    if (current.from !== previous.to) return false
    if (!(DELEGATION_TRANSITIONS[current.from] ?? []).includes(current.to)) return false
  }

  if (item.legacyUnverified === true) {
    return item.verificationEvidenceFingerprint === null && item.finalOutcome !== 'verified'
  }

  // O historico e uma janela limitada. Marcos antigos podem sair dela sem apagar
  // os fingerprints canonicos que provam cada etapa do ciclo.
  if (item.visiblePromptConfirmed !== (item.visibilityEvidenceFingerprint !== null)) return false
  if (['running', 'reported', 'verified', 'closed'].includes(item.state) && item.executionEvidenceFingerprint === null) return false
  if (['reported', 'verified', 'closed'].includes(item.state) && item.reportEvidenceFingerprint === null) return false
  if (['verified', 'closed'].includes(item.state) && item.verificationEvidenceFingerprint === null) return false
  if (
    ['verified', 'closed'].includes(item.state) &&
    (
      item.reportAuditActionId === null ||
      item.reportAuditEvidenceId === null ||
      item.verificationAuditActionId === null ||
      item.verificationAuditEvidenceId === null
    )
  ) return false
  if (item.reportEvidenceFingerprint !== null && item.reportEvidenceFingerprint === item.verificationEvidenceFingerprint) {
    return false
  }
  if (item.state === 'closed' && item.finalOutcome !== 'verified') return false
  if (['blocked', 'failed', 'cancelled'].includes(item.state) && item.reasonFingerprint === null) return false
  return true
}

function caminhoPortatilValido(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    !isAbsolute(value) &&
    !value.split(/[\\/]/).includes('..') &&
    !value.includes('\\')
}

function referenciaMelhoriaValida(value) {
  const base = Boolean(
    value &&
    ['portable-entry', 'source-file'].includes(value.kind) &&
    caminhoPortatilValido(value.path) &&
    HASH_SHA256.test(value.semanticFingerprint ?? '')
  )
  if (!base) return false
  if (value.kind === 'portable-entry') {
    return typeof value.collection === 'string' && value.collection.length > 0 && value.collection.length <= 80 &&
      typeof value.entryId === 'string' && value.entryId.startsWith('improvement-') &&
      value.contentFingerprint === null
  }
  return value.collection === null && value.entryId === null &&
    HASH_SHA256.test(value.contentFingerprint ?? '') &&
    reciboImplementacaoValido(value.implementationReceipt)
}

function reciboImplementacaoValido(value) {
  return Boolean(
    value &&
    HASH_SHA256.test(value.sessionFingerprint ?? '') &&
    typeof value.mutationActionId === 'string' && value.mutationActionId.startsWith('audit-action-') &&
    typeof value.mutationEvidenceId === 'string' && value.mutationEvidenceId.startsWith('audit-evidence-') &&
    HASH_SHA256.test(value.mutationActionFingerprint ?? '') &&
    HASH_SHA256.test(value.mutationEvidenceFingerprint ?? '') &&
    typeof value.verificationActionId === 'string' && value.verificationActionId.startsWith('audit-action-') &&
    typeof value.verificationEvidenceId === 'string' && value.verificationEvidenceId.startsWith('audit-evidence-') &&
    HASH_SHA256.test(value.verificationActionFingerprint ?? '') &&
    HASH_SHA256.test(value.verificationEvidenceFingerprint ?? '') &&
    HASH_SHA256.test(value.targetFingerprint ?? '') &&
    dataValida(value.verifiedAt)
  )
}

function readbackMelhoriaValido(value) {
  return Boolean(
    value &&
    value.verified === true &&
    typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 80 &&
    HASH_SHA256.test(value.payloadFingerprint ?? '') &&
    HASH_SHA256.test(value.artifactFingerprint ?? '') &&
    dataValida(value.verifiedAt)
  )
}

function melhoriaValida(item) {
  const base = Boolean(
    item &&
    item.lifecycleVersion === 2 &&
    typeof item.id === 'string' && item.id.startsWith('improvement-') &&
    HASH_SHA256.test(item.fingerprint ?? '') &&
    typeof item.category === 'string' && item.category.length > 0 && item.category.length <= 80 &&
    typeof item.destination === 'string' && item.destination.length > 0 && item.destination.length <= 80 &&
    typeof item.statement === 'string' && item.statement.length > 0 && item.statement.length <= 500 &&
    IMPROVEMENT_STATES.has(item.status) &&
    Number.isInteger(item.occurrences) && item.occurrences >= 1 &&
    (item.artifact === null || (typeof item.artifact === 'string' && item.artifact.length <= 500)) &&
    (item.artifactRef === null || referenciaMelhoriaValida(item.artifactRef)) &&
    (item.materializedAt === null || dataValida(item.materializedAt)) &&
    (item.installedReadback === null || readbackMelhoriaValido(item.installedReadback)) &&
    Array.isArray(item.transitionHistory) && item.transitionHistory.length > 0 &&
    item.transitionHistory.every((transition) =>
      IMPROVEMENT_STATES.has(transition.to) &&
      dataValida(transition.recordedAt)
    ) &&
    dataValida(item.createdAt) &&
    dataValida(item.updatedAt)
  )
  if (!base || item.transitionHistory.at(-1)?.to !== item.status) return false
  if (item.status === 'observing' && item.occurrences >= 2) return false
  if (item.status === 'ready' && item.occurrences < 2) return false
  if (['observing', 'ready'].includes(item.status)) {
    return item.artifact === null && item.artifactRef === null && item.materializedAt === null && item.installedReadback === null
  }
  if (item.status === 'implementation-required') {
    return typeof item.artifact === 'string' && item.artifact.length > 0 &&
      item.artifactRef === null && item.materializedAt === null && item.installedReadback === null
  }
  if (!referenciaMelhoriaValida(item.artifactRef) || item.artifact !== item.artifactRef.path || !dataValida(item.materializedAt)) {
    return false
  }
  if (item.status === 'materialized-pending-release') return item.installedReadback === null
  return readbackMelhoriaValido(item.installedReadback)
}

function valido(store, path) {
  if (
    store?.schemaVersion !== 1 ||
    store.store?.id !== 'omni-local-operational-cycle' ||
    !dataValida(store.store.createdAt) ||
    !dataValida(store.store.updatedAt) ||
    !Array.isArray(store.sessions) ||
    !Array.isArray(store.delegations) ||
    !store.delegations.every(delegacaoValida) ||
    !Array.isArray(store.events) ||
    !Array.isArray(store.improvementCandidates) ||
    !store.improvementCandidates.every(melhoriaValida)
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
    const store = migrarMelhoriasLegadas(
      migrarDelegacoesLegadas(JSON.parse(await readFile(path, 'utf8')))
    )
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

function evidenciaObrigatoria(input, state) {
  const reasonState = ['blocked', 'failed', 'cancelled'].includes(state)
  const reason = reasonState
    ? textoIntegralSeguro(input?.reason ?? input?.summary, `Motivo do estado ${state}`, 2000, { required: true })
    : null
  if (reasonState && !reason) throw new Error(`Estado ${state} exige motivo seguro.`)
  const evidence = input?.evidence === undefined
    ? reason
    : textoIntegralSeguro(input.evidence, `Evidencia do estado ${state}`, 2000, { required: true })
  if (!evidence) throw new Error(`Estado ${state} exige evidencia explicita.`)
  return { evidenceFingerprint: hash(evidence), reason }
}

function registrarPreparacaoMaterial(item, input) {
  const checkpoint = textoIntegralSeguro(input?.checkpoint, 'Checkpoint', 2000)
  const rollback = textoIntegralSeguro(input?.rollback, 'Rollback ou compensacao', 2000)
  if (checkpoint) item.checkpointFingerprint = hash(checkpoint)
  if (rollback) item.rollbackFingerprint = hash(rollback)
}

function aplicarTransicao(item, state, input, policy, timestamp) {
  if (!policy.delegation.states.includes(state)) {
    throw new Error(`Estado de delegacao invalido: ${state}`)
  }
  if (item.state === state) return { result: 'duplicate', delegation: item }
  const allowed = policy.delegation.transitions[item.state] ?? []
  if (!allowed.includes(state)) {
    throw new Error(`Transicao de delegacao invalida: ${item.state} -> ${state}`)
  }

  let evidenceFingerprint = null
  let reason = null
  if (state === 'verified') {
    if (input?.evidence !== undefined) {
      throw new Error('Estado verified nao aceita evidencia textual; use acao e evidencia verificadas da auditoria.')
    }
    if (input?.auditProof?.result !== 'verified') {
      throw new Error('Estado verified exige acao e evidencia reais da auditoria.')
    }
    evidenceFingerprint = input.auditProof.verificationEvidence.fingerprint
  } else if (policy.delegation.evidenceRequiredFor.includes(state)) {
    ({ evidenceFingerprint, reason } = evidenciaObrigatoria(input, state))
  }
  const summary = ['reported', 'verified'].includes(state)
    ? textoSeguro(input?.summary, 500)
    : null
  if (['reported', 'verified'].includes(state) && !summary) {
    throw new Error(`Estado ${state} exige resumo seguro.`)
  }

  const previous = item.state
  registrarPreparacaoMaterial(item, input)
  if (state === 'visible') {
    item.visiblePromptConfirmed = true
    item.visibilityEvidenceFingerprint = evidenceFingerprint
  }
  if (state === 'running') {
    item.executionEvidenceFingerprint = evidenceFingerprint
    item.reasonFingerprint = null
  }
  if (state === 'reported') {
    item.reportEvidenceFingerprint = evidenceFingerprint
    item.evidenceFingerprint = evidenceFingerprint
    item.resultSummary = summary
    item.reportAuditActionId = input?.auditActionId ?? null
    item.reportAuditEvidenceId = input?.auditEvidenceId ?? null
  }
  if (state === 'verified') {
    if (evidenceFingerprint === item.reportEvidenceFingerprint) {
      throw new Error('Verificacao exige evidencia independente do relato do executor.')
    }
    item.verificationEvidenceFingerprint = evidenceFingerprint
    item.verificationSummary = summary
    item.verificationAuditActionId = input.auditProof.verificationAction.id
    item.verificationAuditEvidenceId = input.auditProof.verificationEvidence.id
    item.legacyUnverified = false
  }
  if (['blocked', 'failed', 'cancelled'].includes(state)) {
    item.reasonFingerprint = hash(reason)
  }
  if (state === 'closed') item.finalOutcome = 'verified'
  if (state === 'failed' || state === 'cancelled') item.finalOutcome = state

  item.state = state
  item.updatedAt = timestamp
  item.transitionHistory = [...item.transitionHistory, {
    from: previous,
    to: state,
    evidenceFingerprint,
    kind: state === 'verified' ? 'audit-verified-transition' : 'explicit-transition',
    recordedAt: timestamp
  }].slice(-50)
  return { result: state, delegation: item }
}

function delegacaoPreparada(input, prompt, target, timestamp, policy) {
  const authorityEnvelope = criarEnvelopeAutoridade(input, prompt, target, policy.authority)
  const promptFingerprint = hash(prompt)
  return {
    lifecycleVersion: 2,
    id: `delegation-${randomUUID()}`,
    sessionFingerprint: hash(input?.sessionId || 'session-unknown'),
    agentFingerprint: null,
    target,
    promptSummary: `Prompt de delegacao preparado (${prompt.length} caracteres)`,
    promptFingerprint,
    state: 'prepared',
    visiblePromptConfirmed: false,
    visibilityEvidenceFingerprint: null,
    executionEvidenceFingerprint: null,
    reportEvidenceFingerprint: null,
    verificationEvidenceFingerprint: null,
    evidenceFingerprint: null,
    reasonFingerprint: null,
    checkpointFingerprint: null,
    rollbackFingerprint: null,
    correlationFingerprint: input?.idempotencyKey
      ? hash(textoIntegralSeguro(input.idempotencyKey, 'Chave de idempotencia', 500, { required: true }))
      : null,
    reportAuditActionId: null,
    reportAuditEvidenceId: null,
    verificationAuditActionId: null,
    verificationAuditEvidenceId: null,
    authorityEnvelope,
    authorityFingerprint: authorityEnvelope.fingerprint,
    resultSummary: null,
    verificationSummary: null,
    finalOutcome: null,
    legacyUnverified: false,
    transitionHistory: [{
      from: null,
      to: 'prepared',
      evidenceFingerprint: promptFingerprint,
      kind: 'briefing-prepared',
      recordedAt: timestamp
    }],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function delegacaoNaoRastreada(input, agentFingerprint, evidence, timestamp) {
  const target = textoSeguro(input?.agentType, 240) ?? 'agent'
  const id = `delegation-${randomUUID()}`
  const authorityEnvelope = envelopeLegado({ id, target })
  authorityEnvelope.source = 'untracked-delegation'
  authorityEnvelope.fingerprint = fingerprintEnvelope(authorityEnvelope)
  const evidenceFingerprint = hash(evidence)
  return {
    lifecycleVersion: 2,
    id,
    sessionFingerprint: hash(input?.sessionId || 'session-unknown'),
    agentFingerprint,
    target,
    promptSummary: null,
    promptFingerprint: null,
    state: 'failed',
    visiblePromptConfirmed: false,
    visibilityEvidenceFingerprint: null,
    executionEvidenceFingerprint: evidenceFingerprint,
    reportEvidenceFingerprint: null,
    verificationEvidenceFingerprint: null,
    evidenceFingerprint: null,
    reasonFingerprint: hash('executor-observed-without-prepared-visible-delegation'),
    checkpointFingerprint: null,
    rollbackFingerprint: null,
    correlationFingerprint: null,
    reportAuditActionId: null,
    reportAuditEvidenceId: null,
    verificationAuditActionId: null,
    verificationAuditEvidenceId: null,
    authorityEnvelope,
    authorityFingerprint: authorityEnvelope.fingerprint,
    resultSummary: null,
    verificationSummary: null,
    finalOutcome: 'failed',
    legacyUnverified: false,
    transitionHistory: [{
      from: null,
      to: 'failed',
      evidenceFingerprint,
      kind: 'untracked-executor-observed',
      recordedAt: timestamp
    }],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export async function prepararDelegacao(casa, input, { at } = {}) {
  const prompt = textoIntegralSeguro(input?.prompt, 'Prompt da delegacao', 12_000, { required: true })
  const target = textoIntegralSeguro(input?.target, 'Destino da delegacao', 500, { required: true })
  const timestamp = agora(at)
  return alterar(casa, (store, policy) => {
    const parentFingerprint = input?.authority?.parentFingerprint ?? null
    if (parentFingerprint !== null) {
      const parent = store.delegations.find((candidate) =>
        candidate.authorityFingerprint === parentFingerprint &&
        candidate.legacyUnverified !== true &&
        candidate.authorityEnvelope?.inherited === true
      )
      if (!parent) {
        throw new Error('Fingerprint pai nao resolve uma autoridade herdavel existente neste ciclo.')
      }
    }
    const item = delegacaoPreparada(input, prompt, target, timestamp, policy)
    store.delegations = [...store.delegations, item].slice(-policy.delegationRetention)
    return { result: 'prepared', delegation: item }
  })
}

export async function prepararDelegacaoVisivelIdempotente(casa, input, { at } = {}) {
  const prompt = textoIntegralSeguro(input?.prompt, 'Prompt da delegacao', 12_000, { required: true })
  const target = textoIntegralSeguro(input?.target, 'Destino da delegacao', 500, { required: true })
  const idempotencyKey = textoIntegralSeguro(
    input?.idempotencyKey,
    'Chave de idempotencia',
    500,
    { required: true }
  )
  const visibilityEvidence = textoIntegralSeguro(
    input?.visibilityEvidence,
    'Evidencia de visibilidade',
    2000,
    { required: true }
  )
  const timestamp = agora(at)
  return alterar(casa, (store, policy) => {
    const parentFingerprint = input?.authority?.parentFingerprint ?? null
    if (parentFingerprint !== null) {
      const parent = store.delegations.find((candidate) =>
        candidate.authorityFingerprint === parentFingerprint &&
        candidate.legacyUnverified !== true &&
        candidate.authorityEnvelope?.inherited === true
      )
      if (!parent) {
        throw new Error('Fingerprint pai nao resolve uma autoridade herdavel existente neste ciclo.')
      }
    }

    const proposed = delegacaoPreparada({ ...input, idempotencyKey }, prompt, target, timestamp, policy)
    let item = store.delegations.find((candidate) =>
      ['prepared', 'visible'].includes(candidate.state) &&
      candidate.sessionFingerprint === proposed.sessionFingerprint &&
      candidate.correlationFingerprint === proposed.correlationFingerprint &&
      candidate.legacyUnverified !== true
    )
    let created = false
    if (
      item &&
      (
        item.promptFingerprint !== proposed.promptFingerprint ||
        item.target !== proposed.target ||
        fingerprintAutoridadeMaterial(item.authorityEnvelope) !==
          fingerprintAutoridadeMaterial(proposed.authorityEnvelope)
      )
    ) {
      throw new Error('Chave de idempotencia conflita com briefing, alvo ou autoridade material diferente.')
    }
    if (!item) {
      item = proposed
      store.delegations = [...store.delegations, item].slice(-policy.delegationRetention)
      created = true
    }
    if (item.state === 'visible') {
      return { result: 'duplicate', delegation: item, created }
    }
    const transition = aplicarTransicao(item, 'visible', {
      evidence: visibilityEvidence
    }, policy, timestamp)
    return { ...transition, created }
  })
}

export async function atualizarDelegacao(casa, id, state, input = {}, { at } = {}) {
  const timestamp = agora(at)
  return alterar(casa, async (store, policy) => {
    const item = store.delegations.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Delegacao inexistente: ${id}`)
    if (state !== 'verified') return aplicarTransicao(item, state, input, policy, timestamp)
    const auditActionId = textoIntegralSeguro(
      input?.auditActionId,
      'Acao de verificacao da auditoria',
      240,
      { required: true }
    )
    const auditEvidenceId = textoIntegralSeguro(
      input?.auditEvidenceId,
      'Evidencia de verificacao da auditoria',
      240,
      { required: true }
    )
    if (item.reportAuditActionId === null || item.reportAuditEvidenceId === null) {
      throw new Error('Delegacao sem relato vinculado a acao e evidencia reais da auditoria.')
    }
    const auditProof = await resolverVerificacaoDelegacaoAuditoria(casa, {
      sessionFingerprint: item.sessionFingerprint,
      reportActionId: item.reportAuditActionId,
      reportEvidenceId: item.reportAuditEvidenceId,
      verificationActionId: auditActionId,
      verificationEvidenceId: auditEvidenceId
    })
    if (auditProof.result !== 'verified') {
      throw new Error('Verificacao da delegacao nao e posterior ao relato, independente e do mesmo objeto auditado.')
    }
    return aplicarTransicao(item, state, { ...input, auditProof }, policy, timestamp)
  })
}

export async function observarDelegacao(casa, input, { at } = {}) {
  const observedState = input?.state === 'completed' ? 'reported' : input?.state
  const timestamp = agora(at)
  return alterar(casa, (store, policy) => {
    const agentId = textoIntegralSeguro(input?.agentId, 'Identificador do executor', 500)
    if (!agentId) return { result: 'ignored', delegation: null }
    const agentFingerprint = hash(agentId)
    const sessionFingerprint = hash(input?.sessionId || 'session-unknown')
    let item = store.delegations.find((candidate) => candidate.agentFingerprint === agentFingerprint)

    if (!item && observedState === 'running') {
      const candidates = store.delegations.filter((candidate) =>
        candidate.sessionFingerprint === sessionFingerprint &&
        candidate.state === 'visible' &&
        candidate.agentFingerprint === null
      )
      if (candidates.length === 1) {
        item = candidates[0]
        item.agentFingerprint = agentFingerprint
      } else {
        item = delegacaoNaoRastreada(input, agentFingerprint, `agent-start:${agentId}`, timestamp)
        store.delegations = [...store.delegations, item].slice(-policy.delegationRetention)
        return { result: 'failed', delegation: item }
      }
    }

    if (!item) {
      item = delegacaoNaoRastreada(input, agentFingerprint, `agent-stop:${agentId}`, timestamp)
      store.delegations = [...store.delegations, item].slice(-policy.delegationRetention)
    }

    if (observedState === 'running') {
      return aplicarTransicao(item, 'running', {
        ...input,
        evidence: input?.evidence ?? `agent-start:${agentId}`
      }, policy, timestamp)
    }

    if (observedState === 'reported') {
      const evidence = textoIntegralSeguro(input?.evidence, 'Evidencia do relato', 2000)
      if (item.state !== 'running') {
        if (evidence) item.reportEvidenceFingerprint = hash(evidence)
        item.resultSummary = textoSeguro(input?.summary, 500)
        item.updatedAt = timestamp
        return { result: item.state, delegation: item }
      }
      if (!evidence) {
        return aplicarTransicao(item, 'failed', {
          reason: 'SubagentStop sem evidencia verificavel do relato.',
          evidence: `agent-stop:${agentId}`
        }, policy, timestamp)
      }
      return aplicarTransicao(item, 'reported', {
        ...input,
        evidence
      }, policy, timestamp)
    }

    return aplicarTransicao(item, observedState, input, policy, timestamp)
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
      if (existing.status === 'observing' && existing.occurrences >= policy.improvement.minimumOccurrencesReady) {
        existing.transitionHistory.push({
          from: 'observing',
          to: 'ready',
          kind: 'evidence-threshold',
          recordedAt: timestamp
        })
        existing.status = 'ready'
      }
      existing.updatedAt = timestamp
      return { result: 'reinforced', candidate: existing }
    }
    const candidate = {
      lifecycleVersion: 2,
      id: `improvement-${randomUUID()}`,
      fingerprint,
      category,
      destination,
      statement,
      status: 'observing',
      occurrences: 1,
      artifact: null,
      artifactRef: null,
      materializedAt: null,
      installedReadback: null,
      transitionHistory: [{
        from: null,
        to: 'observing',
        kind: 'candidate-created',
        recordedAt: timestamp
      }],
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
    const next = input.status ?? candidate.status
    if (!IMPROVEMENT_STATES.has(next)) throw new Error(`Estado de melhoria operacional invalido: ${next}`)
    if (next !== candidate.status && !(IMPROVEMENT_TRANSITIONS[candidate.status] ?? []).includes(next)) {
      throw new Error(`Transicao de melhoria operacional invalida: ${candidate.status} -> ${next}`)
    }
    if (next === 'implementation-required') {
      const target = textoSeguro(input.artifact, 500)
      if (!target) throw new Error('Implementacao requerida precisa indicar o alvo de codigo.')
      candidate.artifact = target
      candidate.artifactRef = null
      candidate.materializedAt = null
      candidate.installedReadback = null
    }
    if (next === 'materialized-pending-release') {
      const reference = input.artifactRef ?? candidate.artifactRef
      if (!referenciaMelhoriaValida(reference)) {
        throw new Error('Materializacao operacional exige referencia portatil verificavel.')
      }
      candidate.artifact = reference.path
      candidate.artifactRef = { ...reference }
      candidate.materializedAt = candidate.materializedAt ?? timestamp
      candidate.installedReadback = null
    }
    if (next === 'installed-verified') {
      const readback = input.installedReadback
      if (!readbackMelhoriaValido(readback)) {
        throw new Error('Estado installed-verified exige readback integro da release instalada.')
      }
      candidate.installedReadback = { ...readback }
    }
    if (next !== candidate.status) {
      candidate.transitionHistory = [...candidate.transitionHistory, {
        from: candidate.status,
        to: next,
        kind: 'state-transition',
        recordedAt: timestamp
      }].slice(-50)
      candidate.status = next
    }
    candidate.updatedAt = timestamp
    return { result: candidate.status, candidate }
  })
}
