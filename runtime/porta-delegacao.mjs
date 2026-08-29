import { createHash } from 'node:crypto'

import {
  lerAuditoriaAutocorrecao,
  resolverTurnoAtivoAuditoria
} from './auditoria-autocorrecao.mjs'
import {
  atualizarDelegacao,
  lerCicloOperacional,
  prepararDelegacaoIdempotente,
  resolverAutoridadePermanenteAutocorrecao
} from './ciclo-operacional.mjs'

export const CONTRATO_PORTA_DELEGACAO = 'omni-neutral-delegation-v1'

const HASH_SHA256 = /^[a-f0-9]{64}$/
const EFFECT_CLASSES = new Set([
  'read',
  'execute',
  'write',
  'network',
  'remote-write',
  'destructive',
  'financial',
  'privilege'
])
const EVIDENCE_KINDS = new Set([
  'delivery',
  'execution',
  'report',
  'diagnostic',
  'checkpoint',
  'rollback',
  'compensation',
  'other'
])
const RISK_VALUES = {
  reversibility: new Set(['unclassified', 'reversible', 'compensable', 'irreversible']),
  reach: new Set([
    'unclassified',
    'local-isolated',
    'single-scoped-target',
    'multi-target',
    'production-or-external'
  ]),
  data: new Set(['unclassified', 'public', 'project', 'personal', 'secret']),
  mode: new Set(['proceed', 'prepare-and-proceed', 'owner-decision'])
}
const EVENT_TARGET = {
  delivered: 'visible',
  started: 'running',
  reported: 'reported',
  blocked: 'blocked',
  failed: 'failed',
  cancelled: 'cancelled'
}
const EVENT_FROM = {
  delivered: new Set(['prepared']),
  started: new Set(['visible', 'blocked']),
  reported: new Set(['running']),
  blocked: new Set(['running', 'reported']),
  failed: new Set(['prepared', 'visible', 'running', 'reported', 'blocked']),
  cancelled: new Set(['prepared', 'visible', 'running', 'reported', 'blocked'])
}
const STALE_FROM = {
  delivered: new Set(['visible', 'running', 'reported', 'verified', 'closed', 'blocked', 'failed', 'cancelled']),
  started: new Set(['running', 'reported', 'verified', 'closed', 'failed', 'cancelled']),
  reported: new Set(['reported', 'verified', 'closed', 'failed', 'cancelled']),
  blocked: new Set(['blocked', 'verified', 'closed', 'failed', 'cancelled']),
  failed: new Set(['failed', 'verified', 'closed', 'cancelled']),
  cancelled: new Set(['cancelled', 'verified', 'closed', 'failed'])
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function objeto(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} precisa ser um objeto.`)
  }
  return value
}

function chavesExatas(value, permitidas, obrigatorias, label) {
  const keys = Object.keys(value)
  const extras = keys.filter((key) => !permitidas.includes(key))
  const ausentes = obrigatorias.filter((key) => !Object.hasOwn(value, key))
  if (extras.length > 0 || ausentes.length > 0) {
    throw new Error(`${label} fora do contrato.`)
  }
}

function texto(value, label, maximum, { minimum = 1 } = {}) {
  const result = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`${label} fora do contrato.`)
  }
  return result
}

function listaDeTextos(value, label, { minimum = 0, maximum = 20 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} fora do contrato.`)
  }
  return value.map((item) => texto(item, label, 240))
}

function validarBrief(value) {
  const brief = objeto(value, 'Briefing')
  const fields = ['objective', 'scope', 'constraints', 'successCriteria']
  chavesExatas(brief, fields, fields, 'Briefing')
  return {
    objective: texto(brief.objective, 'Objetivo', 500, { minimum: 3 }),
    scope: listaDeTextos(brief.scope, 'Escopo'),
    constraints: listaDeTextos(brief.constraints, 'Restricoes'),
    successCriteria: listaDeTextos(brief.successCriteria, 'Criterios de sucesso', { minimum: 1 })
  }
}

function validarEfeitos(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Classes de efeito fora do contrato.')
  }
  const effects = [...new Set(value.map((item) => texto(item, 'Classe de efeito', 80)))].sort()
  if (effects.length !== value.length || effects.some((item) => !EFFECT_CLASSES.has(item))) {
    throw new Error('Classes de efeito fora do contrato.')
  }
  return effects
}

function validarRisco(value) {
  const risk = objeto(value, 'Risco')
  const fields = ['reversibility', 'reach', 'data', 'mode']
  chavesExatas(risk, fields, fields, 'Risco')
  const normalized = Object.fromEntries(fields.map((field) => [
    field,
    texto(risk[field], `Risco ${field}`, 80)
  ]))
  if (fields.some((field) => !RISK_VALUES[field].has(normalized[field]))) {
    throw new Error('Risco fora do contrato.')
  }
  return normalized
}

function validarEntradaSolicitacao(value) {
  const input = objeto(value, 'Solicitacao de delegacao')
  const required = [
    'sessionId',
    'idempotencyKey',
    'destinationCapability',
    'brief',
    'effectClasses',
    'risk'
  ]
  chavesExatas(input, [...required, 'parentAuthorityRef', 'authorityMode'], required, 'Solicitacao de delegacao')
  const parentAuthorityRef = input.parentAuthorityRef === undefined
    ? null
    : texto(input.parentAuthorityRef, 'Autoridade superior', 64)
  if (parentAuthorityRef !== null && !HASH_SHA256.test(parentAuthorityRef)) {
    throw new Error('Autoridade superior fora do contrato.')
  }
  return {
    sessionId: texto(input.sessionId, 'Sessao', 500),
    idempotencyKey: texto(input.idempotencyKey, 'Chave de idempotencia', 240),
    destinationCapability: texto(input.destinationCapability, 'Capacidade de destino', 240),
    brief: validarBrief(input.brief),
    effectClasses: validarEfeitos(input.effectClasses),
    risk: validarRisco(input.risk),
    parentAuthorityRef,
    authorityMode: input.authorityMode === undefined
      ? 'current-turn'
      : texto(input.authorityMode, 'Modo de autoridade', 80)
  }
}

function validarReferenciaEvidencia(value) {
  const reference = objeto(value, 'Referencia de evidencia')
  chavesExatas(reference, ['kind', 'ref', 'sha256'], ['kind', 'ref'], 'Referencia de evidencia')
  const kind = texto(reference.kind, 'Tipo da evidencia', 80)
  if (!EVIDENCE_KINDS.has(kind)) throw new Error('Tipo da evidencia fora do contrato.')
  const sha256 = reference.sha256 === undefined || reference.sha256 === null
    ? null
    : texto(reference.sha256, 'Hash da evidencia', 64)
  if (sha256 !== null && !HASH_SHA256.test(sha256)) {
    throw new Error('Hash da evidencia fora do contrato.')
  }
  return {
    kind,
    ref: texto(reference.ref, 'Referencia de evidencia', 240),
    sha256
  }
}

function validarEvento(value) {
  const event = objeto(value, 'Evento de delegacao')
  const fields = [
    'schemaVersion',
    'contract',
    'messageType',
    'eventId',
    'delegationId',
    'kind',
    'occurredAt',
    'executorRef',
    'summary',
    'evidenceRefs'
  ]
  chavesExatas(event, fields, fields, 'Evento de delegacao')
  if (event.kind === 'verified' || event.kind === 'closed') {
    throw new Error('Executor externo nao pode verificar ou fechar delegacao.')
  }
  if (
    event.schemaVersion !== 1 ||
    event.contract !== CONTRATO_PORTA_DELEGACAO ||
    event.messageType !== 'event' ||
    !Object.hasOwn(EVENT_TARGET, event.kind)
  ) {
    throw new Error('Evento de delegacao fora do contrato.')
  }
  const occurredAt = texto(event.occurredAt, 'Data do evento', 40)
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error('Data do evento fora do contrato.')
  const executorRef = event.executorRef === null
    ? null
    : texto(event.executorRef, 'Executor', 240)
  if (['started', 'reported', 'blocked'].includes(event.kind) && executorRef === null) {
    throw new Error('Evento exige identificador do executor.')
  }
  if (!Array.isArray(event.evidenceRefs) || event.evidenceRefs.length < 1 || event.evidenceRefs.length > 8) {
    throw new Error('Referencias de evidencia fora do contrato.')
  }
  const evidenceRefs = event.evidenceRefs.map(validarReferenciaEvidencia)
  const referenceKeys = evidenceRefs.map((item) => JSON.stringify(item))
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new Error('Referencias de evidencia duplicadas.')
  }
  const delegationId = texto(event.delegationId, 'Delegacao', 300)
  if (!/^delegation-/.test(delegationId)) throw new Error('Delegacao fora do contrato.')
  return {
    schemaVersion: 1,
    contract: CONTRATO_PORTA_DELEGACAO,
    messageType: 'event',
    eventId: texto(event.eventId, 'Evento', 240),
    delegationId,
    kind: event.kind,
    occurredAt,
    executorRef,
    summary: texto(event.summary, 'Resumo do evento', 500),
    evidenceRefs
  }
}

function validarBindingRelato(value) {
  const binding = objeto(value, 'Binding da auditoria')
  chavesExatas(binding, ['actionId', 'evidenceId'], ['actionId', 'evidenceId'], 'Binding da auditoria')
  const actionId = texto(binding.actionId, 'Acao da auditoria', 240)
  const evidenceId = texto(binding.evidenceId, 'Evidencia da auditoria', 240)
  if (!/^audit-action-/.test(actionId) || !/^audit-evidence-/.test(evidenceId)) {
    throw new Error('Binding da auditoria fora do contrato.')
  }
  return { actionId, evidenceId }
}

async function confirmarBindingRelato(casa, sessionFingerprint, executorRef, binding) {
  const store = await lerAuditoriaAutocorrecao(casa)
  const expectedExecutorFingerprint = hash(`agent:${executorRef}`)
  for (const turn of store.turns) {
    if (turn.sessionFingerprint !== sessionFingerprint) continue
    const action = turn.actions.find((item) =>
      item.id === binding.actionId &&
      item.effect === 'delegation' &&
      item.state === 'reported' &&
      item.toolUseFingerprint === expectedExecutorFingerprint
    )
    if (!action) continue
    const evidence = turn.evidence.find((item) =>
      item.id === binding.evidenceId &&
      item.sourceActionId === action.id &&
      item.kind === 'delegation-report'
    )
    if (evidence) return true
  }
  return false
}

function materialDaEvidencia(event) {
  return JSON.stringify({
    contract: CONTRATO_PORTA_DELEGACAO,
    eventFingerprint: hash(event.eventId),
    kind: event.kind,
    evidenceFingerprints: event.evidenceRefs.map((item) => hash(JSON.stringify(item)))
  })
}

function materialDaReferencia(event, kinds) {
  const reference = event.evidenceRefs.find((item) => kinds.includes(item.kind))
  return reference ? `${reference.kind}:${hash(JSON.stringify(reference))}` : null
}

export async function criarSolicitacaoDelegacao(casa, value, { at } = {}) {
  const input = validarEntradaSolicitacao(value)
  let authority
  if (input.authorityMode === 'standing-self-correction') {
    if (input.parentAuthorityRef !== null) {
      throw new Error('Autoridade permanente nao aceita fingerprint fornecido pelo chamador.')
    }
    const standing = await resolverAutoridadePermanenteAutocorrecao({
      destinationCapability: input.destinationCapability,
      effectClasses: input.effectClasses,
      risk: input.risk
    })
    authority = {
      source: standing.source,
      parentFingerprint: standing.parentFingerprint,
      intent: input.brief.objective,
      scope: standing.scope,
      effects: input.effectClasses,
      risk: input.risk
    }
  } else {
    if (input.authorityMode !== 'current-turn') {
      throw new Error('Modo de autoridade da delegacao fora do contrato.')
    }
    const active = await resolverTurnoAtivoAuditoria(casa, input.sessionId)
    if (active.result !== 'active') {
      throw new Error('Delegacao exige turno auditado ativo do Omni.')
    }
    authority = {
      source: input.parentAuthorityRef ? 'inherited-authority' : 'owner-intent',
      ...(input.parentAuthorityRef ? { parentFingerprint: input.parentAuthorityRef } : {}),
      turnFingerprint: active.binding.turnFingerprint,
      intent: input.brief.objective,
      scope: input.brief.scope.join(' | ') || input.destinationCapability,
      effects: input.effectClasses,
      risk: input.risk
    }
  }
  const prepared = await prepararDelegacaoIdempotente(casa, {
    target: input.destinationCapability,
    prompt: JSON.stringify(input.brief),
    sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
    authority
  }, { at })
  const delegation = prepared.delegation
  return {
    result: prepared.result,
    dispatchRequired: delegation.state === 'prepared',
    delegation,
    request: {
      schemaVersion: 1,
      contract: CONTRATO_PORTA_DELEGACAO,
      messageType: 'request',
      delegationId: delegation.id,
      idempotencyKey: input.idempotencyKey,
      issuedAt: delegation.createdAt,
      conversationRef: delegation.sessionFingerprint,
      destinationCapability: input.destinationCapability,
      brief: input.brief,
      authority: {
        ref: delegation.authorityFingerprint,
        effectClasses: input.effectClasses,
        risk: delegation.authorityEnvelope.risk
      },
      briefRetention: 'ephemeral-not-stored-by-omni'
    }
  }
}

export async function receberEventoDelegacao(casa, value, { reportAudit, at } = {}) {
  const event = validarEvento(value)
  const cycle = await lerCicloOperacional(casa)
  const delegation = cycle.delegations.find((item) => item.id === event.delegationId)
  if (!delegation) throw new Error('Delegacao externa sem correlacao explicita.')

  const target = EVENT_TARGET[event.kind]
  if (delegation.state === target) {
    if (
      event.executorRef !== null &&
      delegation.agentFingerprint !== null &&
      delegation.agentFingerprint !== hash(event.executorRef)
    ) {
      throw new Error('Evento duplicado pertence a outro executor da delegacao.')
    }
    if (
      target === 'reported' &&
      (delegation.reportAuditActionId === null || delegation.reportAuditEvidenceId === null)
    ) {
      throw new Error('Relato existente nao possui binding local da auditoria do Omni.')
    }
    return { result: 'duplicate', delegation }
  }
  if (!EVENT_FROM[event.kind].has(delegation.state)) {
    if (STALE_FROM[event.kind].has(delegation.state)) {
      return { result: 'ignored-stale', delegation }
    }
    throw new Error(`Evento externo fora de ordem: ${event.kind} em ${delegation.state}.`)
  }

  if (event.kind === 'reported' && reportAudit === undefined) {
    throw new Error('Relato externo exige binding local da auditoria do Omni.')
  }
  const audit = event.kind === 'reported' ? validarBindingRelato(reportAudit) : null
  if (audit && !(await confirmarBindingRelato(casa, delegation.sessionFingerprint, event.executorRef, audit))) {
    throw new Error('Relato externo nao corresponde a acao e evidencia reais da auditoria do Omni.')
  }
  if (event.kind === 'started' && delegation.authorityEnvelope.risk.mode === 'owner-decision') {
    throw new Error('Execucao aguarda decisao do proprietario no envelope de autoridade.')
  }
  const checkpoint = event.kind === 'started'
    ? materialDaReferencia(event, ['checkpoint'])
    : null
  const rollback = event.kind === 'started'
    ? materialDaReferencia(event, ['rollback', 'compensation'])
    : null
  if (
    event.kind === 'started' &&
    delegation.authorityEnvelope.risk.mode === 'prepare-and-proceed' &&
    (!checkpoint || !rollback)
  ) {
    throw new Error('Execucao exige checkpoint e rollback ou compensacao.')
  }

  return atualizarDelegacao(casa, delegation.id, target, {
    evidence: materialDaEvidencia(event),
    executorRef: event.executorRef,
    summary: event.summary,
    reason: event.summary,
    checkpoint,
    rollback,
    auditActionId: audit?.actionId,
    auditEvidenceId: audit?.evidenceId
  }, { at })
}
