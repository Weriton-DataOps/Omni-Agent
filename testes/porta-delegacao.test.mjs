import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  abrirTurnoAuditoria,
  registrarDelegacaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import {
  CONTRATO_PORTA_DELEGACAO,
  criarSolicitacaoDelegacao,
  receberEventoDelegacao
} from '../runtime/porta-delegacao.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-neutral-delegation-'))
}

async function abrirTurno(casa, sessionId) {
  return abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Delegue este trabalho e acompanhe o resultado com evidencia.'
  })
}

function solicitacao(sessionId, suffix, overrides = {}) {
  return {
    sessionId,
    idempotencyKey: `neutral-request-${suffix}`,
    destinationCapability: `capability-${suffix}`,
    brief: {
      objective: `Objetivo verificavel ${suffix}`,
      scope: [`escopo-${suffix}`],
      constraints: ['preservar o estado existente'],
      successCriteria: ['entregar evidencia independente']
    },
    effectClasses: ['read', 'execute'],
    risk: {
      reversibility: 'reversible',
      reach: 'local-isolated',
      data: 'project',
      mode: 'proceed'
    },
    ...overrides
  }
}

function evento(delegationId, kind, suffix, overrides = {}) {
  return {
    schemaVersion: 1,
    contract: CONTRATO_PORTA_DELEGACAO,
    messageType: 'event',
    eventId: `neutral-event-${kind}-${suffix}`,
    delegationId,
    kind,
    occurredAt: '2026-08-29T12:00:00.000Z',
    executorRef: kind === 'delivered' ? null : `executor-${suffix}`,
    summary: `Evento ${kind} ${suffix}`,
    evidenceRefs: [{ kind: kind === 'delivered' ? 'delivery' : 'execution', ref: `evidence-${kind}-${suffix}` }],
    ...overrides
  }
}

async function relatoAuditado(casa, sessionId, suffix) {
  const result = await registrarDelegacaoAuditoria(casa, {
    session_id: sessionId,
    agent_id: `executor-${suffix}`,
    agent_type: 'executor',
    agent_transcript_path: `resultado-${suffix}`,
    cwd: casa
  }, 'reported')
  assert.ok(result.action?.id)
  assert.ok(result.evidence?.id)
  return { actionId: result.action.id, evidenceId: result.evidence.id }
}

test('solicitacao neutra e idempotente usa somente o ciclo existente e nao persiste o brief', async () => {
  const casa = await home()
  const sessionId = 'neutral-session-idempotent'
  const input = solicitacao(sessionId, 'privacy', {
    brief: {
      objective: 'OBJETIVO-PORTA-ALFA sem texto bruto no store',
      scope: ['ESCOPO-PORTA-ALFA'],
      constraints: ['CONSTRAINT-PORTA-ALFA'],
      successCriteria: ['CRITERIO-PORTA-ALFA']
    }
  })
  try {
    await abrirTurno(casa, sessionId)
    const first = await criarSolicitacaoDelegacao(casa, input)
    const duplicate = await criarSolicitacaoDelegacao(casa, input)
    assert.equal(first.result, 'prepared')
    assert.equal(first.dispatchRequired, true)
    assert.equal(duplicate.result, 'duplicate')
    assert.equal(duplicate.request.delegationId, first.request.delegationId)
    assert.equal(duplicate.dispatchRequired, true)
    assert.equal(first.request.contract, 'omni-neutral-delegation-v1')
    assert.equal(first.request.messageType, 'request')
    assert.equal(first.request.briefRetention, 'ephemeral-not-stored-by-omni')
    assert.match(first.request.authority.ref, /^[a-f0-9]{64}$/)

    await assert.rejects(
      criarSolicitacaoDelegacao(casa, {
        ...input,
        brief: { ...input.brief, objective: 'Outro objetivo material para a mesma chave' }
      }),
      /idempotencia conflita/i
    )

    const delivered = await receberEventoDelegacao(
      casa,
      evento(first.request.delegationId, 'delivered', 'privacy', {
        evidenceRefs: [{ kind: 'delivery', ref: 'DELIVERY-REF-PORTA-ALFA' }]
      })
    )
    assert.equal(delivered.delegation.state, 'visible')
    const afterDelivery = await criarSolicitacaoDelegacao(casa, input)
    assert.equal(afterDelivery.result, 'duplicate')
    assert.equal(afterDelivery.dispatchRequired, false)

    const cycle = await lerCicloOperacional(casa)
    const serialized = JSON.stringify(cycle)
    assert.equal(cycle.delegations.length, 1)
    assert.doesNotMatch(serialized, /OBJETIVO-PORTA-ALFA/)
    assert.doesNotMatch(serialized, /ESCOPO-PORTA-ALFA/)
    assert.doesNotMatch(serialized, /CONSTRAINT-PORTA-ALFA/)
    assert.doesNotMatch(serialized, /CRITERIO-PORTA-ALFA/)
    assert.doesNotMatch(serialized, /DELIVERY-REF-PORTA-ALFA/)
    assert.doesNotMatch(serialized, /neutral-request-privacy/)
    const runFiles = await readdir(join(casa, 'runs'))
    assert.equal(runFiles.some((file) => /porta|delegation-port/i.test(file)), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('eventos neutros percorrem entrega, execucao e relato sem permitir sucesso externo', async () => {
  const casa = await home()
  const sessionId = 'neutral-session-lifecycle'
  try {
    await abrirTurno(casa, sessionId)
    const created = await criarSolicitacaoDelegacao(casa, solicitacao(sessionId, 'lifecycle'))
    const id = created.request.delegationId
    await receberEventoDelegacao(casa, evento(id, 'delivered', 'lifecycle'))
    const running = await receberEventoDelegacao(casa, evento(id, 'started', 'lifecycle'))
    assert.equal(running.delegation.state, 'running')

    await assert.rejects(
      receberEventoDelegacao(casa, evento(id, 'reported', 'lifecycle', {
        summary: 'Relato externo ainda sem binding local.',
        evidenceRefs: [{ kind: 'report', ref: 'report-without-audit' }]
      })),
      /binding local da auditoria/i
    )
    await assert.rejects(
      receberEventoDelegacao(casa, evento(id, 'reported', 'lifecycle-fake-audit', {
        summary: 'Relato com IDs inventados.',
        evidenceRefs: [{ kind: 'report', ref: 'report-with-fake-audit' }]
      }), {
        reportAudit: {
          actionId: 'audit-action-inventada',
          evidenceId: 'audit-evidence-inventada'
        }
      }),
      /acao e evidencia reais/i
    )

    const audit = await relatoAuditado(casa, sessionId, 'lifecycle')
    const reported = await receberEventoDelegacao(casa, evento(id, 'reported', 'lifecycle', {
      summary: 'Executor relatou resultado e testes.',
      evidenceRefs: [{ kind: 'report', ref: 'REPORT-REF-LIFECYCLE' }]
    }), { reportAudit: audit })
    assert.equal(reported.delegation.state, 'reported')
    assert.equal(reported.delegation.finalOutcome, null)
    assert.equal(reported.delegation.verificationEvidenceFingerprint, null)
    assert.equal(reported.delegation.reportAuditActionId, audit.actionId)
    assert.equal(reported.delegation.reportAuditEvidenceId, audit.evidenceId)

    for (const forbidden of ['verified', 'closed']) {
      await assert.rejects(
        receberEventoDelegacao(casa, evento(id, forbidden, `forbidden-${forbidden}`)),
        /nao pode verificar ou fechar/i
      )
    }
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations[0].state, 'reported')
    assert.doesNotMatch(JSON.stringify(cycle), /REPORT-REF-LIFECYCLE/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('correlacao explicita separa delegacoes simultaneas e recusa evento sem id conhecido', async () => {
  const casa = await home()
  const sessionId = 'neutral-session-correlation'
  try {
    await abrirTurno(casa, sessionId)
    const first = await criarSolicitacaoDelegacao(casa, solicitacao(sessionId, 'first'))
    const second = await criarSolicitacaoDelegacao(casa, solicitacao(sessionId, 'second'))
    await receberEventoDelegacao(casa, evento(first.request.delegationId, 'delivered', 'first'))
    await receberEventoDelegacao(casa, evento(second.request.delegationId, 'delivered', 'second'))
    await receberEventoDelegacao(casa, evento(second.request.delegationId, 'started', 'second'))

    let cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations.find((item) => item.id === first.request.delegationId).state, 'visible')
    assert.equal(cycle.delegations.find((item) => item.id === second.request.delegationId).state, 'running')
    const count = cycle.delegations.length

    await assert.rejects(
      receberEventoDelegacao(casa, evento('delegation-unknown', 'delivered', 'unknown')),
      /sem correlacao explicita/i
    )
    cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations.length, count)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('evento atrasado nao regride relato e evento fora de ordem nao pula visibilidade', async () => {
  const casa = await home()
  const sessionId = 'neutral-session-order'
  try {
    await abrirTurno(casa, sessionId)
    const created = await criarSolicitacaoDelegacao(casa, solicitacao(sessionId, 'order'))
    const id = created.request.delegationId
    await assert.rejects(
      receberEventoDelegacao(casa, evento(id, 'started', 'too-early')),
      /fora de ordem/i
    )
    await receberEventoDelegacao(casa, evento(id, 'delivered', 'order'))
    await receberEventoDelegacao(casa, evento(id, 'started', 'order'))
    const duplicateStart = await receberEventoDelegacao(casa, evento(id, 'started', 'order-duplicate', {
      executorRef: 'executor-order'
    }))
    assert.equal(duplicateStart.result, 'duplicate')
    await assert.rejects(
      receberEventoDelegacao(casa, evento(id, 'started', 'other-executor')),
      /outro executor/i
    )
    const audit = await relatoAuditado(casa, sessionId, 'order')
    await receberEventoDelegacao(casa, evento(id, 'reported', 'order', {
      evidenceRefs: [{ kind: 'report', ref: 'report-order' }]
    }), { reportAudit: audit })
    const stale = await receberEventoDelegacao(casa, evento(id, 'started', 'late-start'))
    assert.equal(stale.result, 'ignored-stale')
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations[0].state, 'reported')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('execucao prepare-and-proceed exige checkpoint e compensacao antes de running', async () => {
  const casa = await home()
  const sessionId = 'neutral-session-checkpoint'
  try {
    await abrirTurno(casa, sessionId)
    const created = await criarSolicitacaoDelegacao(casa, solicitacao(sessionId, 'checkpoint', {
      effectClasses: ['write'],
      risk: {
        reversibility: 'compensable',
        reach: 'single-scoped-target',
        data: 'project',
        mode: 'prepare-and-proceed'
      }
    }))
    const id = created.request.delegationId
    await receberEventoDelegacao(casa, evento(id, 'delivered', 'checkpoint'))
    await assert.rejects(
      receberEventoDelegacao(casa, evento(id, 'started', 'checkpoint-missing')),
      /exige checkpoint e rollback ou compensacao/i
    )
    let cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations[0].state, 'visible')

    const running = await receberEventoDelegacao(casa, evento(id, 'started', 'checkpoint-ready', {
      evidenceRefs: [
        { kind: 'execution', ref: 'execution-checkpoint-ready' },
        { kind: 'checkpoint', ref: 'CHECKPOINT-REF-PRIVATE' },
        { kind: 'compensation', ref: 'COMPENSATION-REF-PRIVATE' }
      ]
    }))
    assert.equal(running.delegation.state, 'running')
    assert.match(running.delegation.checkpointFingerprint, /^[a-f0-9]{64}$/)
    assert.match(running.delegation.rollbackFingerprint, /^[a-f0-9]{64}$/)
    cycle = await lerCicloOperacional(casa)
    assert.doesNotMatch(JSON.stringify(cycle), /CHECKPOINT-REF-PRIVATE|COMPENSATION-REF-PRIVATE/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('schema da porta e neutro, fechado e reserva verificacao ao Omni', async () => {
  const path = new URL('../contratos/integracao/delegacao.schema.json', import.meta.url)
  const raw = await readFile(path, 'utf8')
  const runtime = await readFile(new URL('../runtime/porta-delegacao.mjs', import.meta.url), 'utf8')
  const schema = JSON.parse(raw)
  assert.equal(schema.$defs.request.additionalProperties, false)
  assert.equal(schema.$defs.event.additionalProperties, false)
  assert.deepEqual(
    schema.$defs.event.properties.kind.enum,
    ['delivered', 'started', 'reported', 'blocked', 'failed', 'cancelled']
  )
  assert.doesNotMatch(raw, /OverCore|Harness|Agent SDK|Task Manager|DAG|Event Store|Artifact Registry/i)
  assert.doesNotMatch(runtime, /OverCore|Harness|Agent SDK|Task Manager|DAG|Event Store|Artifact Registry/i)

  const cycle = JSON.parse(
    await readFile(new URL('../contratos/operacao/ciclo.json', import.meta.url), 'utf8')
  )
  assert.equal(cycle.delegation.executorReportProduces, 'reported')
  assert.deepEqual(cycle.delegation.inboundCannotProduce, ['verified', 'closed'])
  assert.equal(cycle.delegation.externalCorrelation, 'delegation-id')
  assert.equal(cycle.delegation.adapterCorrelation.requiresExplicitDelegationId, true)
  assert.equal(cycle.delegation.adapterCorrelation.uncorrelatedEvent, 'rejected-no-state')
  assert.equal(cycle.delegation.adapterCorrelation.bindExecutorOnStarted, true)
  assert.equal(cycle.delegation.adapterCorrelation.duplicateRequiresSameExecutor, true)
})

test('autoridade permanente permite somente autocorrecao reversivel e limitada do Omni', async () => {
  const casa = await home()
  const input = solicitacao('standing-self-correction-session', 'standing', {
    authorityMode: 'standing-self-correction',
    destinationCapability: 'omni-self-correction',
    effectClasses: ['read', 'execute', 'write'],
    risk: {
      reversibility: 'reversible',
      reach: 'single-scoped-target',
      data: 'project',
      mode: 'proceed'
    }
  })
  try {
    const created = await criarSolicitacaoDelegacao(casa, input)
    assert.equal(created.result, 'prepared')
    assert.equal(created.delegation.authorityEnvelope.source, 'standing-authority')
    assert.equal(created.delegation.authorityEnvelope.turnFingerprint, null)
    assert.match(created.delegation.authorityEnvelope.parentFingerprint, /^[a-f0-9]{64}$/)

    await assert.rejects(
      criarSolicitacaoDelegacao(casa, {
        ...input,
        idempotencyKey: 'standing-destructive',
        effectClasses: ['destructive']
      }),
      /efeito fora da autoridade permanente/i
    )
    await assert.rejects(
      criarSolicitacaoDelegacao(casa, {
        ...input,
        idempotencyKey: 'standing-outside-capability',
        destinationCapability: 'external-environment-control'
      }),
      /capacidade fora da autoridade permanente/i
    )
    await assert.rejects(
      criarSolicitacaoDelegacao(casa, {
        ...input,
        idempotencyKey: 'standing-privilege',
        risk: { ...input.risk, data: 'secret' }
      }),
      /risco fora da autoridade permanente/i
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
