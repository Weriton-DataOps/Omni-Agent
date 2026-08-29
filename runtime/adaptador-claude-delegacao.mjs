import { createHash } from 'node:crypto'

import { registrarDelegacaoAuditoria } from './auditoria-autocorrecao.mjs'
import {
  confirmarInicioAutomacaoFalha,
  localizarDespachoAtivoAutomacaoFalha,
  prepararDespachoAutomaticoFalha
} from './automacao-falhas.mjs'
import {
  adiarDespachoAutomaticoMelhoria,
  confirmarInicioAutomacaoMelhoria,
  localizarDespachoAtivoAutomacaoMelhoria,
  prepararDespachoAutomaticoMelhoria,
  registrarRelatoAutomacaoMelhoria
} from './automacao-melhorias.mjs'
import { lerCicloOperacional, observarEvento } from './ciclo-operacional.mjs'
import {
  CONTRATO_PORTA_DELEGACAO,
  receberEventoDelegacao
} from './porta-delegacao.mjs'

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function texto(value, maximum = 500) {
  const result = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return result ? result.slice(0, maximum) : null
}

function evento({ delegationId, kind, executorRef = null, summary, evidenceRefs, eventKey, at }) {
  return {
    schemaVersion: 1,
    contract: CONTRATO_PORTA_DELEGACAO,
    messageType: 'event',
    eventId: `claude-${kind}-${hash(eventKey).slice(0, 32)}`,
    delegationId,
    kind,
    occurredAt: agora(at),
    executorRef,
    summary,
    evidenceRefs
  }
}

function referenciasDeInicio(input, delegation, executorRef) {
  const refs = [{ kind: 'execution', ref: `claude-agent-start:${executorRef}` }]
  if (delegation.authorityEnvelope.risk.mode !== 'prepare-and-proceed') return refs

  const checkpoint = texto(input?.checkpoint_ref ?? input?.checkpointRef, 240)
  const rollback = texto(input?.rollback_ref ?? input?.rollbackRef, 240)
  const compensation = texto(input?.compensation_ref ?? input?.compensationRef, 240)
  if (checkpoint && (rollback || compensation)) {
    refs.push({ kind: 'checkpoint', ref: checkpoint })
    refs.push(rollback
      ? { kind: 'rollback', ref: rollback }
      : { kind: 'compensation', ref: compensation })
    return refs
  }

  // Delegacoes antigas nao declaravam classes de efeito. Nesse caso, o unico
  // efeito verificavel neste ponto e abrir o executor isolado: o estado
  // preparado e o checkpoint, e interromper o executor e a compensacao. Uma
  // solicitacao neutra com efeitos declarados continua obrigada a fornecer
  // referencias materiais do alvo; o adaptador nao as inventa.
  if (delegation.authorityEnvelope.effectFingerprints.length === 0) {
    refs.push({ kind: 'checkpoint', ref: `claude-pre-start:${delegation.id}` })
    refs.push({ kind: 'compensation', ref: `claude-stop-executor:${executorRef}` })
    return refs
  }
  throw new Error('Inicio Claude exige checkpoint e rollback ou compensacao explicitos para efeitos declarados.')
}

export function enriquecerEventoFerramentaClaude(input) {
  const toolName = texto(input?.tool_name, 80)
  const operationClass = /^(?:Agent|TaskStop)$/i.test(toolName ?? '')
    ? 'delegation-control'
    : null
  return operationClass ? { ...input, omni_operation_class: operationClass } : input
}

export async function registrarEntregaClaude(casa, request, { source = 'claude-visible-output', at } = {}) {
  const safeSource = texto(source, 160) ?? 'claude-visible-output'
  return receberEventoDelegacao(casa, evento({
    delegationId: request.delegationId,
    kind: 'delivered',
    summary: 'O adaptador Claude tornou o briefing visivel no canal de destino.',
    evidenceRefs: [{ kind: 'delivery', ref: `${safeSource}:${request.delegationId}` }],
    eventKey: `${request.delegationId}:${safeSource}`,
    at
  }))
}

export async function contextoAutomacaoFalhasClaude(
  casa,
  { sessionId = 'session-unknown', hookEventName = 'UserPromptSubmit', at } = {}
) {
  const dispatch = await prepararDespachoAutomaticoFalha(casa, { sessionId }, { at })
  if (dispatch.result !== 'dispatch-required') return null
  await registrarEntregaClaude(casa, dispatch.request, {
    source: `hook-additional-context:${hookEventName}`,
    at
  })
  return [
    `[failure-dispatch-required] AUTOMAÇÃO DE FALHAS: o trabalho ${dispatch.job.id} continua obrigatório até o adaptador registrar um início real.`,
    `Delegação explícita: ${dispatch.request.delegationId}. O briefing está visível abaixo.`,
    'O runtime registrou `dispatch-required`; attempts continua em zero e isso não alega execução.',
    'Inicie agora um subagente em segundo plano com o briefing integral abaixo. Não peça nova autorização ao proprietário:',
    '<failure-dispatch-briefing>',
    dispatch.prompt,
    '</failure-dispatch-briefing>'
  ].join('\n')
}

export async function contextoAutomacaoMelhoriasClaude(
  casa,
  { sessionId = 'session-unknown', hookEventName = 'UserPromptSubmit', at } = {}
) {
  const dispatch = await prepararDespachoAutomaticoMelhoria(casa, { sessionId }, { at })
  if (dispatch.result !== 'dispatch-required') return null
  await registrarEntregaClaude(casa, dispatch.request, {
    source: `hook-additional-context:${hookEventName}:operational-improvement`,
    at
  })
  return [
    `[implementation-dispatch-required] AUTOCORRECAO OPERACIONAL: o trabalho ${dispatch.job.id} permanece aberto ate patch, testes, recibo auditado e release instalada.`,
    `Delegacao explicita: ${dispatch.request.delegationId}. O briefing integral esta visivel abaixo.`,
    'Inicie agora um subagente em segundo plano. A autoridade permanente cobre somente correcao reversivel no repositorio canonico do Omni; nao peca nova aprovacao.',
    '<operational-improvement-dispatch-briefing>',
    dispatch.prompt,
    '</operational-improvement-dispatch-briefing>'
  ].join('\n')
}

export async function contextoProximaAutomacaoClaude(
  casa,
  { sessionId = 'session-unknown', hookEventName = 'UserPromptSubmit', at } = {}
) {
  const [activeFailure, activeImprovement] = await Promise.all([
    localizarDespachoAtivoAutomacaoFalha(casa, { sessionId }, { at }),
    localizarDespachoAtivoAutomacaoMelhoria(casa, { sessionId })
  ])
  if (activeFailure.job && activeImprovement.job) {
    const deferred = await adiarDespachoAutomaticoMelhoria(casa, {
      sessionId,
      reason: 'arbitragem sequencial priorizou a automacao de falha; melhoria retorna a fila'
    }, { at })
    if (deferred.result !== 'deferred') {
      return { kind: 'ambiguous-pending', context: null }
    }
    const failure = await contextoAutomacaoFalhasClaude(casa, { sessionId, hookEventName, at })
    return { kind: 'failure', context: failure, deferredImprovementJobId: deferred.job.id }
  }
  if (activeFailure.job) {
    const failure = await contextoAutomacaoFalhasClaude(casa, { sessionId, hookEventName, at })
    return { kind: 'failure', context: failure }
  }
  if (activeImprovement.job) {
    return { kind: 'improvement-pending', context: null }
  }
  const failure = await contextoAutomacaoFalhasClaude(casa, { sessionId, hookEventName, at })
  if (failure) return { kind: 'failure', context: failure }
  const improvement = await contextoAutomacaoMelhoriasClaude(casa, { sessionId, hookEventName, at })
  return improvement ? { kind: 'improvement', context: improvement } : { kind: null, context: null }
}

async function delegacaoDoInicio(casa, input) {
  const explicit = texto(input?.delegation_id ?? input?.delegationId, 500)
  if (explicit) return { delegationId: explicit, automationJob: null, source: 'explicit-hook-field' }
  const [failure, improvement] = await Promise.all([
    localizarDespachoAtivoAutomacaoFalha(casa, { sessionId: input?.session_id }),
    localizarDespachoAtivoAutomacaoMelhoria(casa, { sessionId: input?.session_id })
  ])
  const pending = [
    failure.job?.delegationId ? { job: failure.job, source: 'failure-job-binding' } : null,
    improvement.job?.delegationId ? { job: improvement.job, source: 'improvement-job-binding' } : null
  ].filter(Boolean)
  if (pending.length === 0) return { delegationId: null, automationJob: null, source: null }
  if (pending.length > 1) {
    return { delegationId: null, automationJob: null, source: 'ambiguous-automation-binding' }
  }
  return {
    delegationId: pending[0].job.delegationId,
    automationJob: pending[0].job,
    source: pending[0].source
  }
}

export async function adaptarInicioSubagenteClaude(casa, input, { at } = {}) {
  const executorRef = texto(input?.agent_id, 500)
  if (!executorRef) return { result: 'ignored', delegation: null, automation: null }
  const binding = await delegacaoDoInicio(casa, input)
  if (!binding.delegationId) {
    await observarEvento(casa, {
      eventType: 'delegation-start-uncorrelated',
      sessionId: input?.session_id,
      evidenceId: `claude-uncorrelated-start:${executorRef}`,
      cwd: input?.cwd,
      status: 'rejected',
      summary: 'Executor iniciou sem delegationId ou binding explicito do adaptador.'
    }, { at })
    return { result: 'uncorrelated', delegation: null, automation: null }
  }

  const cycle = await lerCicloOperacional(casa)
  const delegation = cycle.delegations.find((item) => item.id === binding.delegationId)
  if (!delegation) throw new Error('Delegacao Claude sem correlacao no ciclo operacional.')
  if (delegation.sessionFingerprint !== hash(input?.session_id ?? 'session-unknown')) {
    throw new Error('Inicio Claude nao corresponde a delegacao da sessao atual.')
  }

  const transition = await receberEventoDelegacao(casa, evento({
    delegationId: binding.delegationId,
    kind: 'started',
    executorRef,
    summary: 'O adaptador Claude confirmou o inicio real do executor.',
    evidenceRefs: referenciasDeInicio(input, delegation, executorRef),
    eventKey: `${binding.delegationId}:${executorRef}:start`,
    at
  }))
  const audit = await registrarDelegacaoAuditoria(casa, input, 'running', { at })
  const [failureAutomation, improvementAutomation] = await Promise.all([
    confirmarInicioAutomacaoFalha(casa, {
      sessionId: input?.session_id,
      delegationId: binding.delegationId,
      executorId: executorRef
    }, { at }),
    confirmarInicioAutomacaoMelhoria(casa, {
      sessionId: input?.session_id,
      delegationId: binding.delegationId,
      executorId: executorRef
    }, { at })
  ])
  const automation = failureAutomation.result !== 'ignored'
    ? failureAutomation
    : improvementAutomation
  await observarEvento(casa, {
    eventType: 'delegation-start',
    sessionId: input?.session_id,
    evidenceId: `claude-start:${binding.delegationId}:${executorRef}`,
    cwd: input?.cwd,
    status: transition.result,
    summary: `Executor ${texto(input?.agent_type, 80) ?? 'externo'} iniciado`
  }, { at })
  return { ...transition, audit, automation, correlationSource: binding.source }
}

async function delegacaoDoFim(casa, input) {
  const explicit = texto(input?.delegation_id ?? input?.delegationId, 500)
  if (explicit) return explicit
  const executorRef = texto(input?.agent_id, 500)
  if (!executorRef) return null
  const cycle = await lerCicloOperacional(casa)
  const fingerprint = hash(executorRef)
  const sessionFingerprint = hash(input?.session_id ?? 'session-unknown')
  return cycle.delegations.find((item) =>
    item.agentFingerprint === fingerprint && item.sessionFingerprint === sessionFingerprint
  )?.id ?? null
}

export async function adaptarFimSubagenteClaude(casa, input, { at } = {}) {
  const executorRef = texto(input?.agent_id, 500)
  const delegationId = await delegacaoDoFim(casa, input)
  if (!executorRef || !delegationId) {
    await observarEvento(casa, {
      eventType: 'delegation-report-uncorrelated',
      sessionId: input?.session_id,
      evidenceId: `claude-uncorrelated-report:${executorRef ?? 'unknown'}`,
      cwd: input?.cwd,
      status: 'rejected',
      summary: 'Relato recusado sem correlacao explicita com uma delegacao iniciada.'
    }, { at })
    return { result: 'uncorrelated', delegation: null }
  }

  const cycle = await lerCicloOperacional(casa)
  const delegation = cycle.delegations.find((item) => item.id === delegationId)
  if (!delegation || delegation.sessionFingerprint !== hash(input?.session_id ?? 'session-unknown')) {
    throw new Error('Relato Claude nao corresponde a delegacao da sessao atual.')
  }

  const audit = await registrarDelegacaoAuditoria(casa, input, 'reported', { at })
  if (!audit.action?.id || !audit.evidence?.id) {
    return { result: 'audit-binding-required', delegation: null, audit }
  }
  const rawSummary = texto(input?.last_assistant_message, 1000)
  const transition = await receberEventoDelegacao(casa, evento({
    delegationId,
    kind: 'reported',
    executorRef,
    summary: `Relato do executor recebido (${rawSummary?.length ?? 0} caracteres).`,
    evidenceRefs: [{
      kind: 'report',
      ref: texto(input?.agent_transcript_path, 240) ?? `claude-agent-report:${executorRef}`
    }],
    eventKey: `${delegationId}:${executorRef}:report:${input?.agent_transcript_path ?? ''}`,
    at
  }), {
    reportAudit: {
      actionId: audit.action.id,
      evidenceId: audit.evidence.id
    },
    at
  })
  const automation = await registrarRelatoAutomacaoMelhoria(casa, {
    delegationId,
    lastAssistantMessage: input?.last_assistant_message
  }, { at })
  await observarEvento(casa, {
    eventType: 'delegation-report',
    sessionId: input?.session_id,
    evidenceId: `claude-report:${delegationId}:${executorRef}`,
    cwd: input?.cwd,
    status: transition.result,
    summary: `Relato do executor recebido (${rawSummary?.length ?? 0} caracteres)`
  }, { at })
  return { ...transition, audit, automation }
}
