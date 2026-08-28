import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

import {
  fingerprintObjetivo,
  OBJECTIVE_FINGERPRINT_ALGORITHM
} from './passe.mjs'

export const AUDIT_SELF_CORRECTION_SCHEMA_VERSION = 1

const CONTRACT_PATH = new URL('../contratos/operacao/auditoria-autocorrecao.json', import.meta.url)
const TURN_STATES = new Set(['open', 'executing', 'repairing', 'verified', 'blocked'])
const ACTION_STATES = new Set(['running', 'reported', 'succeeded', 'failed'])
const EFFECTS = new Set(['verification', 'mutation', 'execution', 'delegation'])
const FINDING_STATES = new Set(['open', 'corrected', 'unresolved'])
const CORRECTION_STATES = new Set(['requested', 'verified', 'failed'])

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}

function normalized(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function dateValid(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function fingerprintValid(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function safeToolName(value) {
  const name = String(value ?? 'tool')
    .replace(/[^a-zA-Z0-9_.:-]/g, '')
    .slice(0, 80)
  return name || 'tool'
}

async function contract() {
  const value = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  const retention = value?.retention
  const stopGate = value?.stopGate
  const correction = value?.correction
  const privacyFields = [
    'storeRawRequest',
    'storeRawResponse',
    'storeRawToolInput',
    'storeRawToolOutput',
    'storeRawError',
    'storeSecrets'
  ]
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-audit-self-correction-v1' ||
    value.enabled !== true ||
    !Number.isInteger(retention?.turns) || retention.turns < 10 ||
    !Number.isInteger(retention?.actionsPerTurn) || retention.actionsPerTurn < 10 ||
    !Number.isInteger(retention?.evidencePerTurn) || retention.evidencePerTurn < 10 ||
    !Number.isInteger(retention?.findingsPerTurn) || retention.findingsPerTurn < 5 ||
    !Number.isInteger(retention?.correctionsPerTurn) || retention.correctionsPerTurn < 5 ||
    stopGate?.enabled !== true ||
    stopGate.maximumBlocksPerTurn !== 1 ||
    stopGate.recursionGuardRequired !== true ||
    correction?.producesRepairDirectiveOnly !== true ||
    correction.neverExecutesExternalMutation !== true ||
    correction.idempotentByFindingFingerprint !== true ||
    value.authority?.doesNotGrantNewAuthority !== true ||
    value.objectiveBinding?.algorithm !== OBJECTIVE_FINGERPRINT_ALGORITHM ||
    value.objectiveBinding?.legacyWithoutAlgorithm !== 'unverifiable' ||
    value.objectiveBinding?.storeRawObjective !== false ||
    !privacyFields.every((field) => value.privacy?.[field] === false)
  ) {
    throw new Error('Contrato de auditoria e autocorreção fora da versão segura v1.')
  }
  return value
}

function emptyStore(at = now()) {
  return {
    schemaVersion: AUDIT_SELF_CORRECTION_SCHEMA_VERSION,
    store: { id: 'omni-local-audit-self-correction', createdAt: at, updatedAt: at },
    sessions: [],
    turns: []
  }
}

export function caminhoDaAuditoriaAutocorrecao(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa da auditoria precisa ser absoluta.')
  return join(casa, 'audits', 'self-correction.json')
}

function commitmentValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      ['answer-current-request', 'perform-requested-work', 'verify-real-state'].includes(item.kind) &&
      ['open', 'fulfilled', 'blocked'].includes(item.state)
  )
}

function actionValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('audit-action-') &&
      fingerprintValid(item.toolUseFingerprint) &&
      fingerprintValid(item.strategyFingerprint) &&
      (item.semanticBindingFingerprint === undefined ||
        item.semanticBindingFingerprint === null ||
        fingerprintValid(item.semanticBindingFingerprint)) &&
      (item.requestBindingFingerprint === undefined ||
        item.requestBindingFingerprint === null ||
        fingerprintValid(item.requestBindingFingerprint)) &&
      (item.scopeFingerprint === null || fingerprintValid(item.scopeFingerprint)) &&
      Array.isArray(item.targetFingerprints) &&
      item.targetFingerprints.every(fingerprintValid) &&
      (item.bindingMode === undefined || ['target', 'scope', 'none'].includes(item.bindingMode)) &&
      typeof item.toolName === 'string' && item.toolName.length > 0 && item.toolName.length <= 80 &&
      (item.actionFamily === undefined || (typeof item.actionFamily === 'string' && item.actionFamily.length > 0 && item.actionFamily.length <= 40)) &&
      EFFECTS.has(item.effect) &&
      ACTION_STATES.has(item.state) &&
      dateValid(item.recordedAt)
  )
}

function evidenceValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('audit-evidence-') &&
      typeof item.sourceActionId === 'string' &&
      ['state-readback', 'mutation-result', 'execution-result', 'delegation-report', 'task-report'].includes(item.kind) &&
      fingerprintValid(item.fingerprint) &&
      dateValid(item.recordedAt)
  )
}

function findingValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('audit-finding-') &&
      typeof item.code === 'string' &&
      ['warning', 'error'].includes(item.severity) &&
      fingerprintValid(item.fingerprint) &&
      FINDING_STATES.has(item.state) &&
      dateValid(item.detectedAt) &&
      dateValid(item.updatedAt)
  )
}

function correctionValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('audit-correction-') &&
      fingerprintValid(item.findingFingerprint) &&
      ['execute-request', 'verify-state', 'change-strategy', 'verify-delegation', 'remove-unverified-claim'].includes(item.kind) &&
      CORRECTION_STATES.has(item.state) &&
      item.mode === 'repair-directive' &&
      item.rollback === 'ledger-only' &&
      Number.isInteger(item.attempts) && item.attempts >= 1 &&
      dateValid(item.createdAt) &&
      dateValid(item.updatedAt)
  )
}

function turnValid(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' && item.id.startsWith('audit-turn-') &&
      fingerprintValid(item.sessionFingerprint) &&
      fingerprintValid(item.requestFingerprint) &&
      (item.requestFingerprintAlgorithm === undefined ||
        item.requestFingerprintAlgorithm === OBJECTIVE_FINGERPRINT_ALGORITHM) &&
      (item.requestTargetFingerprints === undefined ||
        (Array.isArray(item.requestTargetFingerprints) && item.requestTargetFingerprints.every(fingerprintValid))) &&
      (item.requestActionFamily === undefined ||
        (typeof item.requestActionFamily === 'string' && item.requestActionFamily.length > 0 && item.requestActionFamily.length <= 40)) &&
      ['conversation', 'inspection', 'execution', 'mutation'].includes(item.requestKind) &&
      Number.isInteger(item.requestLength) && item.requestLength > 0 &&
      Array.isArray(item.commitments) && item.commitments.every(commitmentValid) &&
      Array.isArray(item.actions) && item.actions.every(actionValid) &&
      Array.isArray(item.evidence) && item.evidence.every(evidenceValid) &&
      Array.isArray(item.findings) && item.findings.every(findingValid) &&
      Array.isArray(item.corrections) && item.corrections.every(correctionValid) &&
      TURN_STATES.has(item.state) &&
      Number.isInteger(item.stopAttempts) && item.stopAttempts >= 0 &&
      Number.isInteger(item.stopBlocksIssued) && item.stopBlocksIssued >= 0 && item.stopBlocksIssued <= 1 &&
      dateValid(item.openedAt) &&
      dateValid(item.updatedAt) &&
      (item.closedAt === null || dateValid(item.closedAt))
  )
}

function validateStore(store, path) {
  if (
    store?.schemaVersion !== AUDIT_SELF_CORRECTION_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-audit-self-correction' ||
    !dateValid(store.store?.createdAt) ||
    !dateValid(store.store?.updatedAt) ||
    !Array.isArray(store.sessions) ||
    !store.sessions.every((item) =>
      fingerprintValid(item?.sessionFingerprint) &&
      (item.activeTurnId === null || typeof item.activeTurnId === 'string') &&
      ['active', 'closed'].includes(item.state) &&
      dateValid(item.updatedAt)
    ) ||
    !Array.isArray(store.turns) ||
    !store.turns.every(turnValid)
  ) throw new Error(`Auditoria e autocorreção fora do contrato v1: ${path}`)
}

async function acquireLock(casa) {
  const directory = join(casa, 'audits')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'self-correction.lock')
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
  throw new Error('A auditoria e autocorreção está ocupada por outra escrita.')
}

async function load(casa) {
  const path = caminhoDaAuditoriaAutocorrecao(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > AUDIT_SELF_CORRECTION_SCHEMA_VERSION) {
      throw new Error(`Auditoria v${store.schemaVersion} é mais nova que este plugin.`)
    }
    validateStore(store, path)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: emptyStore(), initialized: true }
    throw error
  }
}

async function save(casa, store, policy) {
  const path = caminhoDaAuditoriaAutocorrecao(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  store.turns = store.turns.slice(-policy.retention.turns)
  const retainedTurns = new Set(store.turns.map((item) => item.id))
  for (const session of store.sessions) {
    if (session.activeTurnId && !retainedTurns.has(session.activeTurnId)) session.activeTurnId = null
  }
  store.sessions = store.sessions.slice(-policy.retention.turns)
  validateStore(store, path)
  await mkdir(join(casa, 'audits'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function change(casa, mutate) {
  const policy = await contract()
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa)
    const result = await mutate(loaded.store, policy)
    await save(casa, loaded.store, policy)
    return result
  } finally {
    await release()
  }
}

export async function lerAuditoriaAutocorrecao(casa) {
  return change(casa, (store) => store)
}

function classifyRequest(prompt) {
  const text = normalized(prompt)
  const lead = '(?:(?:por favor|agora|ja|entao|tambem|nesse caso)[, ]+)*'
  const modal = '(?:quero que |preciso que |pode(?: tambem)? |vamos )?'
  const direct = (verbs) => new RegExp(`^${lead}${modal}(?:${verbs})\\b`).test(text)
  const textualCreation = new RegExp(
    `^${lead}${modal}(?:faca|fazer)\\s+(?:(?:um|uma)\\s+)?(?:teste de humor|analogia|resumo|explicacao|comparacao|piada|exemplo|texto|roteiro|lista|mapa mental)\\b`
  ).test(text)
  const discursiveInspection = new RegExp(
    `^${lead}${modal}(?:analise|analisar|avalie|avaliar|compare|comparar)\\b`
  ).test(text)
  const externalTarget = /\b(?:arquivo|pasta|diretorio|repo(?:sitorio)?|git|github|codigo|build|teste(?:s)?\s+(?:automatizado|da suite|do repo)|sessao|janela|processo|servidor|banco(?: de dados)?|api|url|site|pagina|plugin|instalacao|release|branch|commit|log|terminal|workspace|vs code|vscode|ultima conversa|ultimas mensagens|transcrito|historico)\b/.test(text)
  const realStateRequest = /\b(?:estado real|estado atual|o que foi feito|o que esta rodando|esta aberto|esta aberta|esta funcionando|confira|verifique|inspecione|audite)\b/.test(text)
  if (textualCreation && !externalTarget && !realStateRequest) return 'conversation'
  if (discursiveInspection && !externalTarget && !realStateRequest) return 'conversation'
  if (new RegExp(`^${lead}${modal}(?:faca|fazer)\\s+(?:essa|esse|esta|este|a|o|uma|um)?\\s*(?:correcao|ajuste|alteracao|mudanca|implementacao|edicao)\\b`).test(text)) {
    return 'mutation'
  }
  if (new RegExp(`^${lead}${modal}(?:faca|fazer)\\s+(?:essa|esse|esta|este|a|o|uma|um)?\\s*(?:verificacao|auditoria|inspecao|conferencia)\\b`).test(text)) {
    return 'inspection'
  }
  if (direct('implemente|implementar|corrija|corrigir|crie|criar|edite|editar|altere|alterar|remova|remover|apague|apagar|instale|instalar|atualize|atualizar|publique|publicar|suba|subir|grave|gravar|registre|registrar|aplique|aplicar|incorpore|incorporar')) {
    return 'mutation'
  }
  if (direct('faca|fazer|execute|executar|rode|rodar|inicie|iniciar|abra|abrir|feche|fechar|delegue|delegar|envie|enviar|continue|continuar|siga|seguir')) return 'execution'
  if (direct('verifique|verifica|verificar|confira|conferir|avalie|avaliar|analise|analisar|audite|auditar|inspecione|inspecionar|veja|ver|procure|procurar|leia|ler|compare|comparar')) return 'inspection'
  if (/^mao na massa\b/.test(text)) return 'execution'
  if (
    /\b(?:leve|levando) (?:isso )?em consideracao\b/.test(text) &&
    /\b(correcao|corrigir|implementacao|implementar|ajuste|ajustar)\b/.test(text)
  ) {
    return 'mutation'
  }
  if (
    /\b(?:pedi|mandei|autorizei) (?:pra|para) (?:ele|voce|vc|tu)?\s*(?:mesmo )?(?:fazer|corrigir|implementar|executar|ajustar)\b/.test(text)
  ) return 'execution'
  return 'conversation'
}

function requestActionFamily(prompt) {
  const text = normalized(prompt)
  if (/\b(?:build|compile|compilar|empacotar|bundle)\b/.test(text)) return 'build'
  if (/\b(?:testes?|testar|suite|smoke)\b/.test(text)) return 'test'
  if (/\b(?:delegar|delegue|subagente|executor|agente em segundo plano)\b/.test(text)) return 'delegation'
  if (/\b(?:git|repo(?:sitorio)?|branch|commit|push|pull|diff)\b/.test(text)) return 'repository'
  if (/\b(?:plugin|instalacao|instalar|atualizar|release|versao)\b/.test(text)) return 'plugin'
  if (/\b(?:arquivo|codigo|manifesto|contrato|schema|script|modulo|m[oó]dulo|artefato)\b/.test(text)) return 'file'
  if (/\b(?:sessao|janela|vscode|vs code)\b/.test(text)) return 'workspace'
  if (/\b(?:servidor|banco de dados|api|url|site|pagina)\b/.test(text)) return 'external-system'
  return 'generic'
}

function commitmentsFor(requestKind) {
  const commitments = [{ id: 'commitment-answer', kind: 'answer-current-request', state: 'open' }]
  if (requestKind !== 'conversation') {
    commitments.push({ id: 'commitment-perform', kind: 'perform-requested-work', state: 'open' })
    commitments.push({ id: 'commitment-verify', kind: 'verify-real-state', state: 'open' })
  }
  return commitments
}

function sessionFor(store, sessionFingerprint, timestamp) {
  let session = store.sessions.find((item) => item.sessionFingerprint === sessionFingerprint)
  if (!session) {
    session = { sessionFingerprint, activeTurnId: null, state: 'active', updatedAt: timestamp }
    store.sessions.push(session)
  }
  session.state = 'active'
  session.updatedAt = timestamp
  return session
}

function activeTurn(store, sessionId) {
  const sessionFingerprint = hash(sessionId || 'session-unknown')
  const session = store.sessions.find((item) => item.sessionFingerprint === sessionFingerprint)
  const turn = session?.activeTurnId
    ? store.turns.find((item) => item.id === session.activeTurnId)
    : null
  return { session, turn, sessionFingerprint }
}

function turnBindingFingerprint(turn) {
  return hash({
    id: turn.id,
    sessionFingerprint: turn.sessionFingerprint,
    requestFingerprint: turn.requestFingerprint,
    openedAt: turn.openedAt
  })
}

function bindingTurnoAtivo(store, sessionId) {
  const { session, turn, sessionFingerprint } = activeTurn(store, sessionId)
  if (
    !session ||
    session.state !== 'active' ||
    !turn ||
    ['verified', 'blocked'].includes(turn.state)
  ) {
    return { result: 'active-turn-not-found', binding: null }
  }
  return {
    result: 'active',
    binding: {
      sessionFingerprint,
      turnFingerprint: turnBindingFingerprint(turn),
      requestFingerprint: turn.requestFingerprint,
      requestFingerprintAlgorithm: turn.requestFingerprintAlgorithm ?? 'legacy-unverifiable',
      openedAt: turn.openedAt
    }
  }
}

export async function resolverTurnoAtivoAuditoria(casa, sessionId) {
  const store = await lerAuditoriaAutocorrecao(casa)
  return bindingTurnoAtivo(store, sessionId)
}

export function resolverTurnoAtivoAuditoriaSync(casa, sessionId) {
  const path = caminhoDaAuditoriaAutocorrecao(casa)
  let store
  try {
    store = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { result: 'active-turn-not-found', binding: null }
    throw error
  }
  if (store.schemaVersion > AUDIT_SELF_CORRECTION_SCHEMA_VERSION) {
    throw new Error(`Auditoria v${store.schemaVersion} e mais nova que este plugin.`)
  }
  validateStore(store, path)
  return bindingTurnoAtivo(store, sessionId)
}

function compatibleAuditObject(reference, verification) {
  const referenceTargets = new Set(reference.targetFingerprints ?? [])
  const verificationTargets = verification.targetFingerprints ?? []
  if (referenceTargets.size > 0 && verificationTargets.length > 0) {
    return verificationTargets.some((item) => referenceTargets.has(item))
  }
  return reference.scopeFingerprint !== null &&
    verification.scopeFingerprint !== null &&
    reference.scopeFingerprint === verification.scopeFingerprint
}

export async function resolverVerificacaoDelegacaoAuditoria(casa, {
  sessionFingerprint,
  reportActionId,
  reportEvidenceId,
  verificationActionId,
  verificationEvidenceId
} = {}) {
  const store = await lerAuditoriaAutocorrecao(casa)
  for (const turn of store.turns) {
    if (turn.sessionFingerprint !== sessionFingerprint) continue
    const reportActionIndex = turn.actions.findIndex((item) => item.id === reportActionId)
    const verificationActionIndex = turn.actions.findIndex((item) => item.id === verificationActionId)
    if (reportActionIndex < 0 || verificationActionIndex <= reportActionIndex) continue
    const reportAction = turn.actions[reportActionIndex]
    const verificationAction = turn.actions[verificationActionIndex]
    const reportEvidence = turn.evidence.find((item) =>
      item.id === reportEvidenceId &&
      item.sourceActionId === reportAction.id &&
      item.kind === 'delegation-report'
    )
    const verificationEvidence = turn.evidence.find((item) =>
      item.id === verificationEvidenceId &&
      item.sourceActionId === verificationAction.id &&
      item.kind === 'state-readback'
    )
    const valid =
      reportAction.effect === 'delegation' &&
      reportAction.state === 'reported' &&
      verificationAction.effect === 'verification' &&
      verificationAction.state === 'succeeded' &&
      Boolean(reportEvidence) &&
      Boolean(verificationEvidence) &&
      Date.parse(verificationAction.recordedAt) >= Date.parse(reportAction.recordedAt) &&
      Date.parse(verificationEvidence.recordedAt) >= Date.parse(verificationAction.recordedAt) &&
      compatibleAuditObject(reportAction, verificationAction)
    if (!valid) continue
    return {
      result: 'verified',
      reportAction,
      reportEvidence,
      verificationAction,
      verificationEvidence
    }
  }
  return {
    result: 'unverified-delegation',
    reportAction: null,
    reportEvidence: null,
    verificationAction: null,
    verificationEvidence: null
  }
}

export async function resolverImplementacaoOperacionalAuditoria(casa, {
  mutationActionId,
  mutationEvidenceId,
  verificationActionId,
  verificationEvidenceId,
  targetFingerprints = [],
  notBefore
} = {}) {
  if (!dateValid(notBefore) || !Array.isArray(targetFingerprints) || !targetFingerprints.every(fingerprintValid)) {
    return { result: 'unverified-implementation', receipt: null }
  }
  const expectedTargets = new Set(targetFingerprints)
  const store = await lerAuditoriaAutocorrecao(casa)
  for (const turn of store.turns) {
    const mutationIndex = turn.actions.findIndex((item) => item.id === mutationActionId)
    const verificationIndex = turn.actions.findIndex((item) => item.id === verificationActionId)
    if (mutationIndex < 0 || verificationIndex <= mutationIndex) continue
    const mutation = turn.actions[mutationIndex]
    const verification = turn.actions[verificationIndex]
    const mutationEvidence = turn.evidence.find((item) =>
      item.id === mutationEvidenceId &&
      item.sourceActionId === mutation.id &&
      item.kind === 'mutation-result'
    )
    const verificationEvidence = turn.evidence.find((item) =>
      item.id === verificationEvidenceId &&
      item.sourceActionId === verification.id &&
      item.kind === 'state-readback'
    )
    const targetFingerprint = mutation.targetFingerprints.find((item) =>
      expectedTargets.has(item) && verification.targetFingerprints.includes(item)
    )
    const valid =
      mutation.effect === 'mutation' &&
      mutation.state === 'succeeded' &&
      verification.effect === 'verification' &&
      verification.state === 'succeeded' &&
      Boolean(mutationEvidence) &&
      Boolean(verificationEvidence) &&
      Boolean(targetFingerprint) &&
      Date.parse(mutation.recordedAt) > Date.parse(notBefore) &&
      Date.parse(mutationEvidence.recordedAt) >= Date.parse(mutation.recordedAt) &&
      Date.parse(verification.recordedAt) > Date.parse(mutation.recordedAt) &&
      Date.parse(verificationEvidence.recordedAt) >= Date.parse(verification.recordedAt) &&
      compatibleAuditObject(mutation, verification)
    if (!valid) continue
    return {
      result: 'verified',
      receipt: {
        sessionFingerprint: turn.sessionFingerprint,
        mutationActionId: mutation.id,
        mutationEvidenceId: mutationEvidence.id,
        mutationActionFingerprint: mutation.toolUseFingerprint,
        mutationEvidenceFingerprint: mutationEvidence.fingerprint,
        verificationActionId: verification.id,
        verificationEvidenceId: verificationEvidence.id,
        verificationActionFingerprint: verification.toolUseFingerprint,
        verificationEvidenceFingerprint: verificationEvidence.fingerprint,
        targetFingerprint,
        verifiedAt: verificationEvidence.recordedAt
      }
    }
  }
  return { result: 'unverified-implementation', receipt: null }
}

function abandonTurn(turn, policy, timestamp) {
  const fingerprint = hash(`${turn.id}:turn-abandoned:${turn.requestFingerprint}`)
  let finding = turn.findings.find((item) => item.fingerprint === fingerprint)
  if (!finding) {
    finding = {
      id: `audit-finding-${randomUUID()}`,
      code: 'turn-abandoned',
      severity: 'error',
      fingerprint,
      state: 'unresolved',
      detectedAt: timestamp,
      updatedAt: timestamp
    }
    turn.findings.push(finding)
  } else {
    finding.state = 'unresolved'
    finding.updatedAt = timestamp
  }

  let correction = turn.corrections.find((item) => item.findingFingerprint === fingerprint)
  if (!correction) {
    correction = {
      id: `audit-correction-${randomUUID()}`,
      findingFingerprint: fingerprint,
      kind: 'execute-request',
      state: 'failed',
      mode: 'repair-directive',
      rollback: 'ledger-only',
      attempts: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    turn.corrections.push(correction)
  } else {
    correction.state = 'failed'
    correction.updatedAt = timestamp
  }

  for (const unresolved of turn.findings.filter((item) => item.state === 'open')) {
    unresolved.state = 'unresolved'
    unresolved.updatedAt = timestamp
  }
  for (const failed of turn.corrections.filter((item) => item.state === 'requested')) {
    failed.state = 'failed'
    failed.updatedAt = timestamp
  }
  turn.findings = turn.findings.slice(-policy.retention.findingsPerTurn)
  turn.corrections = turn.corrections.slice(-policy.retention.correctionsPerTurn)
  turn.state = 'blocked'
  turn.closedAt = timestamp
  turn.updatedAt = timestamp
  for (const commitment of turn.commitments.filter((item) => item.state === 'open')) commitment.state = 'blocked'
}

export async function abrirTurnoAuditoria(casa, input, { at } = {}) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt) return { result: 'ignored', turn: null, context: null }
  const timestamp = now(at)
  return change(casa, (store, policy) => {
    const sessionFingerprint = hash(input?.session_id || 'session-unknown')
    const session = sessionFor(store, sessionFingerprint, timestamp)
    const previous = session.activeTurnId
      ? store.turns.find((item) => item.id === session.activeTurnId)
      : null
    if (previous && !['verified', 'blocked'].includes(previous.state)) {
      abandonTurn(previous, policy, timestamp)
    }
    const requestKind = classifyRequest(prompt)
    const turn = {
      id: `audit-turn-${randomUUID()}`,
      sessionFingerprint,
      requestFingerprint: fingerprintObjetivo(prompt),
      requestFingerprintAlgorithm: OBJECTIVE_FINGERPRINT_ALGORITHM,
      requestTargetFingerprints: requestTargetFingerprints(prompt, input?.cwd),
      requestActionFamily: requestActionFamily(prompt),
      requestKind,
      requestLength: prompt.length,
      commitments: commitmentsFor(requestKind),
      actions: [],
      evidence: [],
      findings: [],
      corrections: [],
      state: 'open',
      stopAttempts: 0,
      stopBlocksIssued: 0,
      openedAt: timestamp,
      updatedAt: timestamp,
      closedAt: null
    }
    store.turns.push(turn)
    session.activeTurnId = turn.id
    return { result: 'opened', turn, context: contextoAuditoriaObrigatoria(turn) }
  })
}

function commandFrom(input) {
  if (typeof input?.tool_input === 'string') return input.tool_input
  if (!input?.tool_input || typeof input.tool_input !== 'object') return ''
  for (const field of ['command', 'cmd', 'script', 'code']) {
    if (typeof input.tool_input[field] === 'string') return input.tool_input[field]
  }
  return ''
}

function commandTokens(command) {
  return [...String(command ?? '').matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .map((value) => value.replace(/^[;&|()]+|[;&|()]+$/g, ''))
    .filter(Boolean)
}

function commandTargetValues(command) {
  const tokens = commandTokens(command)
  const values = []
  const add = (value) => {
    const cleaned = String(value ?? '').trim().replace(/^['"]|['"]$/g, '')
    if (cleaned && !cleaned.startsWith('-')) values.push(cleaned)
  }
  const directCommands = new Set([
    'set-content', 'add-content', 'get-content', 'test-path',
    'remove-item', 'new-item', 'touch', 'mkdir', 'rm', 'del'
  ])
  for (let index = 0; index < tokens.length; index += 1) {
    const name = normalized(tokens[index]).replace(/\.exe$/, '')
    if (!directCommands.has(name)) continue
    let candidate = tokens[index + 1]
    if (/^-(?:literalpath|path)$/i.test(candidate ?? '')) candidate = tokens[index + 2]
    add(candidate)
  }

  const sedIndex = tokens.findIndex((token) => normalized(token).replace(/\.exe$/, '') === 'sed')
  if (sedIndex >= 0) {
    const inPlaceIndex = tokens.findIndex((token, index) =>
      index > sedIndex && /^-[a-z]*i[a-z]*$/i.test(token)
    )
    if (inPlaceIndex >= 0) {
      const positional = tokens.slice(inPlaceIndex + 1).filter((token) => !token.startsWith('-'))
      // O primeiro posicional e a expressao sed; os seguintes sao os alvos alterados.
      for (const target of positional.slice(1)) add(target)
    }
  }

  const interpreterIndex = tokens.findIndex((token) =>
    /^(?:node|python|python\d*(?:\.\d+)?|py)(?:\.exe)?$/i.test(token)
  )
  if (interpreterIndex >= 0) {
    const script = tokens.slice(interpreterIndex + 1).find((token) =>
      !token.startsWith('-') && /(?:[\\/]|\.(?:mjs|cjs|js|py|ts))$/i.test(token)
    )
    add(script)
  }

  const separator = tokens.findIndex((token, index) => token === '--' &&
    tokens.slice(0, index).some((part) => normalized(part) === 'git'))
  if (separator >= 0) for (const target of tokens.slice(separator + 1)) add(target)

  for (const match of String(command ?? '').matchAll(/(?:^|\s)(?:>>?|2>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)) {
    add(match[1] ?? match[2] ?? match[3])
  }
  return [...new Set(values)]
}

function targetVariants(value, cwd) {
  const raw = String(value ?? '').trim().replace(/^[`'"<]|[`'">.,;:!?)]$/g, '')
  if (!raw) return []
  const portable = raw.replace(/\\/g, '/')
  const name = basename(portable)
  const extension = extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  // Preserve both native and portable spelling. Other trusted modules may bind
  // an absolute Windows target with backslashes, while prompts and commands
  // generally use forward slashes.
  const variants = [raw, portable, name, stem]
  if (cwd && (isAbsolute(raw) || /[\\/]/.test(raw))) {
    variants.push(resolve(cwd, raw).replace(/\\/g, '/'))
  }
  return [...new Set(variants.map(normalized).filter((item) => item.length >= 2))]
}

function requestTargetValues(prompt) {
  const text = String(prompt ?? '')
  const values = []
  const add = (value) => {
    const cleaned = String(value ?? '').trim()
    if (cleaned) values.push(cleaned)
  }
  for (const match of text.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'/g)) {
    const value = match[1] ?? match[2] ?? match[3]
    if (/[\\/]/.test(value) || /\.[a-z0-9]{1,12}$/i.test(value)) add(value)
  }
  for (const match of text.matchAll(/\b(?:[a-z]:[\\/][^\r\n,;]+|[\w.-]+(?:[\\/][\w .-]+)+|[\w.-]+\.[a-z0-9]{1,12})\b/gi)) {
    add(match[0])
  }
  for (const match of text.matchAll(/\b(?:arquivo|manifesto|contrato|schema|script|teste|modulo|m[oó]dulo)\s+(?:do|da|de|o|a)?\s*([\w.-]{2,80})\b/gi)) {
    const value = normalized(match[1])
    if (!['agora', 'atual', 'quebrado', 'quebrada', 'novo', 'nova', 'certo', 'correto', 'com', 'sem', 'que', 'para', 'por', 'resultado'].includes(value)) add(match[1])
  }
  for (const match of text.matchAll(/\b(manifesto|contrato|schema)\b/gi)) add(match[1])
  return [...new Set(values)]
}

function requestTargetFingerprints(prompt, cwd) {
  return [...new Set(requestTargetValues(prompt)
    .flatMap((value) => targetVariants(value, cwd))
    .map(hash))].sort()
}

function commandIsScopeVerification(command) {
  const value = normalized(command)
  return /\b(git status|git diff|npm(?:\.cmd)? test|npm(?:\.cmd)? run check|node --test|node --check|pytest|python(?:\.exe)? -m (?:pytest|unittest)|get-childitem|select-string|rg|grep|findstr)\b/.test(value)
}

function semanticBindingFrom(input) {
  const match = commandFrom(input).match(/\bomni-(?:failure|shortcut)-binding\s*:\s*([a-f0-9]{64})\b/i)
  return match ? match[1].toLowerCase() : null
}

function requestBindingFrom(input, requestFingerprint) {
  const match = commandFrom(input).match(/\bomni-request-binding\s*:\s*([a-f0-9]{64})\b/i)
  if (!match || match[1].toLowerCase() !== requestFingerprint) return null
  return match[1].toLowerCase()
}

function classifyEffect(input) {
  const tool = normalized(input?.tool_name)
  if (['read', 'grep', 'glob', 'websearch', 'webfetch', 'listagents', 'taskoutput', 'viewimage'].includes(tool)) {
    return 'verification'
  }
  if (['write', 'edit', 'notebookedit', 'applypatch'].includes(tool)) return 'mutation'
  if (['agent', 'task', 'sendmessage'].includes(tool)) return 'delegation'
  const command = normalized(commandFrom(input))
  if (command) {
    const explicitInterpreterVerification =
      /\bnode(?:\.exe)?\s+(?:--test|--check|--version|-v)\b/.test(command) ||
      /\bpython(?:\.exe|\d+(?:\.\d+)?)?\s+(?:--version|-v|-m\s+(?:pytest|unittest))\b/.test(command)
    const interpreterMutation =
      (/\bnode(?:\.exe)?\b/.test(command) || /\bpython(?:\.exe|\d+(?:\.\d+)?)?\b/.test(command)) &&
      !explicitInterpreterVerification
    const inPlaceSed = /\bsed(?:\.exe)?\b[^\r\n;&|]*\s-[a-z]*i[a-z]*\b/.test(command)
  const gitApply = /\bgit\s+apply\b/.test(command)
    const npmGenerator = /\bnpm(?:\.cmd)?\s+(?:run\s+)?(?:generate|gen|build|compile|bundle|scaffold|migrate|format|fix|write|update)(?:[:\w.-]*)?\b/.test(command)
    const remoteMutation =
      /\bcurl\b.*\s(?:-x|--request)\s*(?:post|put|patch|delete)\b/.test(command) ||
      /\binvoke-restmethod\b.*\b-method\s+(?:post|put|patch|delete)\b/.test(command)
    if (
      interpreterMutation ||
      inPlaceSed ||
      gitApply ||
      npmGenerator ||
      remoteMutation ||
      /\b(rm|del|remove-item|move-item|copy-item|rename-item|new-item|set-content|add-content|mkdir|touch|git push|git commit|git clone|git checkout|git restore|git reset|git merge|git rebase|git cherry-pick|npm publish|npm install|drop|delete|update|insert|create|alter)\b/.test(command) ||
      /(^|\s)(?:>|>>)(\s|$)/.test(command)
    ) {
      return 'mutation'
    }
    if (/\b(git status|git diff|git log|git show|git rev-parse|npm(?:\.cmd)? test|npm(?:\.cmd)? run check|node --(?:test|check|version)|node -v|python(?:\.exe|\d+(?:\.\d+)?)? (?:--version|-v|-m (?:pytest|unittest))|pytest|test-path|get-content|get-childitem|select-string|rg|grep|findstr|curl)\b/.test(command)) {
      return 'verification'
    }
  }
  return 'execution'
}

function actionFamily(input, effect) {
  const tool = normalized(input?.tool_name)
  if (['read', 'grep', 'glob', 'write', 'edit', 'notebookedit', 'applypatch'].includes(tool)) return 'file'
  if (['agent', 'task', 'sendmessage'].includes(tool)) return 'delegation'
  if (['websearch', 'webfetch'].includes(tool)) return 'external-system'
  const command = normalized(commandFrom(input))
  if (/\b(?:npm(?:\.cmd)?|pnpm|yarn)\s+(?:run\s+)?(?:build|compile|bundle)\b/.test(command)) return 'build'
  if (/\b(?:npm(?:\.cmd)?\s+(?:run\s+)?(?:test|check|lint)|pnpm\s+(?:test|check|lint)|yarn\s+(?:test|check|lint)|node(?:\.exe)?\s+--(?:test|check)|pytest|python(?:\.exe)?\s+-m\s+(?:pytest|unittest))\b/.test(command)) return 'test'
  if (/\bgit\s+(?:status|diff|log|show|rev-parse|apply|commit|push|pull|merge|rebase|checkout|restore|reset)\b/.test(command)) return 'repository'
  if (/\b(?:claude(?:\.exe)?\s+plugin|plugin\s+(?:list|update|validate)|npm(?:\.cmd)?\s+(?:pack|publish))\b/.test(command)) return 'plugin'
  if (/\b(?:code|code-insiders|cursor|windsurf)(?:\.exe)?\b/.test(command)) return 'workspace'
  if (/\b(?:curl|invoke-restmethod|invoke-webrequest)\b/.test(command)) return 'external-system'
  return effect === 'delegation' ? 'delegation' : 'generic'
}

function bindingFor(input) {
  const toolInput = input?.tool_input && typeof input.tool_input === 'object'
    ? input.tool_input
    : {}
  const command = commandFrom(input)
  const rawTargets = [
    input?.agent_transcript_path,
    toolInput.file_path,
    toolInput.path,
    toolInput.notebook_path,
    toolInput.directory,
    ...(Array.isArray(toolInput.paths) ? toolInput.paths : []),
    ...(Array.isArray(toolInput.files) ? toolInput.files : []),
    ...(Array.isArray(toolInput.targets) ? toolInput.targets : []),
    ...commandTargetValues(command)
  ]
  const cwd = input?.cwd ?? toolInput.cwd
  const targetFingerprints = [...new Set(rawTargets
    .filter((value) => typeof value === 'string' && value.trim())
    .flatMap((value) => targetVariants(value, cwd))
    .map(hash))]
    .sort()
  const scope = cwd
  return {
    scopeFingerprint: typeof scope === 'string' && scope.trim() ? hash(normalized(scope)) : null,
    targetFingerprints,
    bindingMode: targetFingerprints.length > 0
      ? 'target'
      : commandIsScopeVerification(command) ? 'scope' : 'none'
  }
}

function verificaMesmoObjeto(reference, verification) {
  if (reference.targetFingerprints.length > 0) {
    const expected = new Set(reference.targetFingerprints)
    return verification.targetFingerprints.some((item) => expected.has(item))
  }
  return reference.scopeFingerprint !== null &&
    verification.scopeFingerprint !== null &&
    reference.scopeFingerprint === verification.scopeFingerprint &&
    verification.bindingMode === 'scope'
}

function upsertEvidence(turn, action, kind, timestamp, policy) {
  const fingerprint = hash(`${action.toolUseFingerprint}:${kind}:${action.state}`)
  const existing = turn.evidence.find((item) => item.fingerprint === fingerprint)
  if (existing) return existing
  const evidence = {
    id: `audit-evidence-${randomUUID()}`,
    sourceActionId: action.id,
    kind,
    fingerprint,
    recordedAt: timestamp
  }
  turn.evidence.push(evidence)
  turn.evidence = turn.evidence.slice(-policy.retention.evidencePerTurn)
  return evidence
}

function recordAction(turn, input, policy, timestamp, override = {}) {
  const effect = override.effect ?? classifyEffect(input)
  const toolName = safeToolName(override.toolName ?? input?.tool_name)
  const sourceId = override.sourceId ?? input?.tool_use_id ?? `${toolName}:${timestamp}`
  const toolUseFingerprint = hash(sourceId)
  const strategyFingerprint = hash({ toolName, effect, input: input?.tool_input ?? null })
  const binding = override.binding ?? bindingFor(input)
  let action = turn.actions.find((item) => item.toolUseFingerprint === toolUseFingerprint)
  const state = override.state ?? (input?.hook_event_name === 'PostToolUseFailure' ? 'failed' : 'succeeded')
  if (!action) {
    action = {
      id: `audit-action-${randomUUID()}`,
      toolUseFingerprint,
      strategyFingerprint,
      semanticBindingFingerprint: semanticBindingFrom(input),
      requestBindingFingerprint: override.requestBindingFingerprint ?? requestBindingFrom(input, turn.requestFingerprint),
      actionFamily: override.actionFamily ?? actionFamily(input, effect),
      scopeFingerprint: binding.scopeFingerprint,
      targetFingerprints: binding.targetFingerprints,
      bindingMode: binding.bindingMode,
      toolName,
      effect,
      state,
      recordedAt: timestamp
    }
    turn.actions.push(action)
  } else {
    action.state = state
    action.semanticBindingFingerprint = semanticBindingFrom(input)
    action.requestBindingFingerprint = override.requestBindingFingerprint ?? requestBindingFrom(input, turn.requestFingerprint)
    action.actionFamily = override.actionFamily ?? actionFamily(input, effect)
    action.scopeFingerprint = binding.scopeFingerprint
    action.bindingMode = binding.bindingMode
    if (binding.targetFingerprints.length > 0) action.targetFingerprints = binding.targetFingerprints
    action.recordedAt = timestamp
    if (state === 'reported') {
      turn.actions = turn.actions.filter((item) => item !== action)
      turn.actions.push(action)
    }
  }
  turn.actions = turn.actions.slice(-policy.retention.actionsPerTurn)
  if (state === 'succeeded') {
    const kind = effect === 'verification'
      ? 'state-readback'
      : effect === 'mutation'
        ? 'mutation-result'
        : effect === 'delegation'
          ? 'delegation-report'
          : 'execution-result'
    upsertEvidence(turn, action, kind, timestamp, policy)
  }
  return action
}

export async function registrarAcaoAuditoria(casa, input, { at } = {}) {
  const timestamp = now(at)
  return change(casa, (store, policy) => {
    const { turn } = activeTurn(store, input?.session_id)
    if (!turn || ['verified', 'blocked'].includes(turn.state)) return { result: 'ignored', action: null }
    const action = recordAction(turn, input, policy, timestamp)
    turn.state = 'executing'
    turn.updatedAt = timestamp
    const evidence = turn.evidence.find((item) => item.sourceActionId === action.id) ?? null
    return { result: action.state, action, evidence }
  })
}

export async function registrarDelegacaoAuditoria(casa, input, state, { at } = {}) {
  const timestamp = now(at)
  return change(casa, (store, policy) => {
    const { turn } = activeTurn(store, input?.session_id)
    if (!turn || ['verified', 'blocked'].includes(turn.state)) return { result: 'ignored', action: null }
    const action = recordAction(turn, input, policy, timestamp, {
      effect: 'delegation',
      toolName: input?.agent_type ?? 'Agent',
      sourceId: `agent:${input?.agent_id ?? 'unknown'}`,
      state: state === 'reported' ? 'reported' : 'running',
      requestBindingFingerprint: turn.requestFingerprint,
      binding: {
        scopeFingerprint: typeof input?.cwd === 'string' && input.cwd.trim()
          ? hash(normalized(input.cwd))
          : null,
        targetFingerprints: [],
        bindingMode: typeof input?.cwd === 'string' && input.cwd.trim() ? 'scope' : 'none'
      }
    })
    const evidence = state === 'reported'
      ? upsertEvidence(turn, action, 'delegation-report', timestamp, policy)
      : null
    turn.state = 'executing'
    turn.updatedAt = timestamp
    return { result: action.state, action, evidence }
  })
}

export async function registrarConclusaoTarefaAuditoria(casa, input, { at } = {}) {
  const timestamp = now(at)
  return change(casa, (store, policy) => {
    const { turn } = activeTurn(store, input?.session_id)
    if (!turn || ['verified', 'blocked'].includes(turn.state)) return { result: 'ignored', evidence: null }
    const source = hash(input?.task_id ?? `${input?.session_id}:task`)
    const fingerprint = hash(`task-report:${source}`)
    if (turn.evidence.some((item) => item.fingerprint === fingerprint)) return { result: 'duplicate', evidence: null }
    const evidence = {
      id: `audit-evidence-${randomUUID()}`,
      sourceActionId: `task:${source}`,
      kind: 'task-report',
      fingerprint,
      recordedAt: timestamp
    }
    turn.evidence.push(evidence)
    turn.evidence = turn.evidence.slice(-policy.retention.evidencePerTurn)
    turn.updatedAt = timestamp
    return { result: 'recorded', evidence }
  })
}

function actionAfter(turn, candidate, reference) {
  return turn.actions.indexOf(candidate) > turn.actions.indexOf(reference)
}

function actionBoundToRequest(turn, action) {
  const expected = new Set(turn.requestTargetFingerprints ?? [])
  if (expected.size > 0) return action.targetFingerprints.some((item) => expected.has(item))
  const family = turn.requestActionFamily ?? 'legacy-unverifiable'
  if (['generic', 'file', 'workspace', 'external-system', 'legacy-unverifiable'].includes(family)) return false
  return action.actionFamily === family && action.requestBindingFingerprint === turn.requestFingerprint
}

function satisfiesRequestedWork(turn, succeeded) {
  if (turn.requestKind === 'conversation') return true
  const bound = succeeded.filter((item) => actionBoundToRequest(turn, item))
  if (turn.requestKind === 'mutation') {
    return succeeded.some((mutation) => {
      if (mutation.effect !== 'mutation') return false
      if (actionBoundToRequest(turn, mutation)) return true
      return bound.some((verification) =>
        verification.effect === 'verification' &&
        actionAfter(turn, verification, mutation) &&
        verificaMesmoObjeto(mutation, verification)
      )
    })
  }
  if (turn.requestKind === 'inspection') {
    return bound.some((item) => item.effect === 'verification')
  }
  return bound.length > 0
}

function currentFindings(turn, input, policy) {
  const findings = []
  const succeeded = turn.actions.filter((item) => item.state === 'succeeded' || item.state === 'reported')
  const verifications = turn.actions.filter((item) => item.effect === 'verification' && item.state === 'succeeded')
  const material = succeeded.filter((item) => item.effect !== 'verification')

  if (!satisfiesRequestedWork(turn, succeeded)) {
    findings.push({ code: 'requested-action-not-executed', severity: 'error', subject: turn.requestFingerprint })
  }

  const mutations = turn.actions.filter((item) => item.effect === 'mutation' && item.state === 'succeeded')
  const lastMutation = mutations.at(-1)
  if (
    policy.stopGate.requireVerificationAfterMutation &&
    lastMutation &&
    !verifications.some((item) => actionAfter(turn, item, lastMutation) && verificaMesmoObjeto(lastMutation, item))
  ) findings.push({ code: 'mutation-without-readback', severity: 'error', subject: lastMutation.toolUseFingerprint })

  const delegations = turn.actions.filter((item) => item.effect === 'delegation')
  const running = delegations.find((item) => item.state === 'running')
  if (running) findings.push({ code: 'delegation-still-running', severity: 'error', subject: running.toolUseFingerprint })
  const lastReported = delegations.filter((item) => item.state === 'reported' || item.state === 'succeeded').at(-1)
  if (
    policy.stopGate.requireVerificationAfterDelegation &&
    lastReported &&
    !verifications.some((item) => actionAfter(turn, item, lastReported) && compatibleAuditObject(lastReported, item))
  ) findings.push({ code: 'delegation-without-independent-verification', severity: 'error', subject: lastReported.toolUseFingerprint })

  const failed = turn.actions.filter((item) => item.state === 'failed')
  const lastFailed = failed.at(-1)
  if (lastFailed && !succeeded.some((item) => actionAfter(turn, item, lastFailed))) {
    findings.push({ code: 'unresolved-tool-failure', severity: 'error', subject: lastFailed.strategyFingerprint })
  }
  const failuresByStrategy = new Map()
  for (const action of failed) failuresByStrategy.set(
    action.strategyFingerprint,
    (failuresByStrategy.get(action.strategyFingerprint) ?? 0) + 1
  )
  for (const [strategy, count] of failuresByStrategy) {
    if (count > policy.correction.maximumIdenticalFailedStrategies) {
      findings.push({ code: 'repeated-failed-strategy', severity: 'error', subject: strategy })
    }
  }

  const answer = typeof input?.last_assistant_message === 'string' ? normalized(input.last_assistant_message) : ''
  const claimsCompletion = /\b(conclui|corrigi|feito|pronto|resolvido|implementei|funcionando|passou|finalizado)\b/.test(answer)
  const hasEvidence = turn.evidence.some((item) => ['state-readback', 'execution-result'].includes(item.kind))
  if (
    policy.stopGate.rejectUnverifiedCompletionClaims &&
    turn.requestKind !== 'conversation' &&
    claimsCompletion &&
    (!hasEvidence || (material.length > 0 && findings.some((item) => /without|unresolved|still-running/.test(item.code))))
  ) findings.push({ code: 'completion-claim-without-evidence', severity: 'error', subject: turn.requestFingerprint })

  return findings
}

const CORRECTION_BY_FINDING = {
  'requested-action-not-executed': 'execute-request',
  'mutation-without-readback': 'verify-state',
  'delegation-still-running': 'verify-delegation',
  'delegation-without-independent-verification': 'verify-delegation',
  'unresolved-tool-failure': 'change-strategy',
  'repeated-failed-strategy': 'change-strategy',
  'completion-claim-without-evidence': 'remove-unverified-claim'
}

const REPAIR_TEXT = {
  'requested-action-not-executed': 'execute o trabalho solicitado ou declare o bloqueio real',
  'mutation-without-readback': 'leia o estado alterado e confirme o resultado real',
  'delegation-still-running': 'acompanhe a delegação até um estado terminal',
  'delegation-without-independent-verification': 'verifique independentemente o resultado delegado',
  'unresolved-tool-failure': 'diagnostique a causa e use uma estratégia materialmente diferente',
  'repeated-failed-strategy': 'pare de repetir a mesma estratégia e escolha outra abordagem',
  'completion-claim-without-evidence': 'retire a alegação de sucesso ou produza evidência verificável'
}

function reconcileFindings(turn, detected, policy, timestamp) {
  const current = new Set()
  for (const item of detected) {
    const fingerprint = hash(`${turn.id}:${item.code}:${item.subject}`)
    current.add(fingerprint)
    let finding = turn.findings.find((candidate) => candidate.fingerprint === fingerprint)
    if (!finding) {
      finding = {
        id: `audit-finding-${randomUUID()}`,
        code: item.code,
        severity: item.severity,
        fingerprint,
        state: 'open',
        detectedAt: timestamp,
        updatedAt: timestamp
      }
      turn.findings.push(finding)
    } else {
      finding.state = 'open'
      finding.updatedAt = timestamp
    }
    let correction = turn.corrections.find((candidate) => candidate.findingFingerprint === fingerprint)
    if (!correction) {
      correction = {
        id: `audit-correction-${randomUUID()}`,
        findingFingerprint: fingerprint,
        kind: CORRECTION_BY_FINDING[item.code],
        state: 'requested',
        mode: 'repair-directive',
        rollback: 'ledger-only',
        attempts: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      turn.corrections.push(correction)
    }
  }
  for (const finding of turn.findings.filter((item) => item.state === 'open' && !current.has(item.fingerprint))) {
    finding.state = 'corrected'
    finding.updatedAt = timestamp
    const correction = turn.corrections.find((item) => item.findingFingerprint === finding.fingerprint)
    if (correction) {
      correction.state = 'verified'
      correction.updatedAt = timestamp
    }
  }
  turn.findings = turn.findings.slice(-policy.retention.findingsPerTurn)
  turn.corrections = turn.corrections.slice(-policy.retention.correctionsPerTurn)
  return turn.findings.filter((item) => item.state === 'open')
}

function repairReason(openFindings) {
  const actions = [...new Map(
    openFindings
      .map((item) => [item.code, REPAIR_TEXT[item.code]])
      .filter(([, action]) => Boolean(action))
  )]
  return [
    'A auditoria obrigatória encontrou divergência antes do fechamento.',
    ...actions.map(([code, action], index) => `${index + 1}. [${code}] ${action}.`),
    'Continue neste mesmo turno, corrija somente dentro da autoridade do pedido atual e conclua após verificar o estado real.'
  ].join('\n')
}

export async function auditarParada(casa, input, { at } = {}) {
  const timestamp = now(at)
  return change(casa, (store, policy) => {
    const { session, turn } = activeTurn(store, input?.session_id)
    if (!turn || ['verified', 'blocked'].includes(turn.state)) {
      return { result: 'ignored', decision: null, reason: null, turn: null }
    }
    turn.stopAttempts += 1
    const detected = currentFindings(turn, input, policy)
    const openFindings = reconcileFindings(turn, detected, policy, timestamp)
    turn.updatedAt = timestamp
    if (openFindings.length === 0) {
      turn.state = 'verified'
      turn.closedAt = timestamp
      for (const commitment of turn.commitments) commitment.state = 'fulfilled'
      if (session) session.activeTurnId = null
      return { result: 'verified', decision: null, reason: null, turn }
    }

    const recursionActive = input?.stop_hook_active === true
    const canBlock =
      !recursionActive &&
      turn.stopBlocksIssued < policy.stopGate.maximumBlocksPerTurn
    if (canBlock) {
      turn.stopBlocksIssued += 1
      turn.state = 'repairing'
      return { result: 'repair-required', decision: 'block', reason: repairReason(openFindings), turn }
    }

    turn.state = 'blocked'
    turn.closedAt = timestamp
    for (const commitment of turn.commitments.filter((item) => item.state === 'open')) commitment.state = 'blocked'
    for (const finding of openFindings) finding.state = 'unresolved'
    for (const correction of turn.corrections.filter((item) => item.state === 'requested')) {
      correction.state = 'failed'
      correction.updatedAt = timestamp
    }
    if (session) session.activeTurnId = null
    return { result: 'blocked', decision: null, reason: null, turn }
  })
}

export async function encerrarSessaoAuditoria(casa, input, { at } = {}) {
  const timestamp = now(at)
  return change(casa, (store, policy) => {
    const { session, turn } = activeTurn(store, input?.session_id)
    if (!session) return { result: 'ignored' }
    if (turn && !['verified', 'blocked'].includes(turn.state)) {
      abandonTurn(turn, policy, timestamp)
    }
    session.activeTurnId = null
    session.state = 'closed'
    session.updatedAt = timestamp
    return { result: 'closed' }
  })
}

export function contextoAuditoriaObrigatoria(turn) {
  return [
    'AUDITORIA E AUTOCORREÇÃO OBRIGATÓRIAS:',
    `turno=${turn.id}; tipo=${turn.requestKind}; vinculo=${turn.requestFingerprint}.`,
    `Se o objeto nao estiver nomeado no pedido, correlacione o comando com \`omni-request-binding:${turn.requestFingerprint}\`; o marcador sozinho nunca prova cumprimento.`,
    'Antes de concluir, confronte pedido, compromissos, ações, evidência e estado real.',
    'Corrija divergências reversíveis dentro do pedido atual; não repita estratégia que já falhou.',
    'Mudança e resultado delegado exigem verificação independente. Não declare sucesso sem evidência.',
    'Esta auditoria não concede autoridade nova nem autoriza efeitos fora do pedido atual.'
  ].join(' ')
}
