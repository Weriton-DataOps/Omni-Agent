import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  adaptarInicioSubagenteClaude,
  registrarEntregaClaude
} from '../runtime/adaptador-claude-delegacao.mjs'
import { abrirTurnoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import { criarSolicitacaoDelegacao } from '../runtime/porta-delegacao.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-claude-delegation-adapter-'))
}

function request(sessionId, suffix, mode = 'proceed') {
  return {
    sessionId,
    idempotencyKey: `adapter-request-${suffix}`,
    destinationCapability: `capability-${suffix}`,
    brief: {
      objective: `Executar objetivo ${suffix}`,
      scope: [`scope-${suffix}`],
      constraints: ['preservar privacidade'],
      successCriteria: ['devolver evidencia correlacionada']
    },
    effectClasses: ['read', 'execute'],
    risk: {
      reversibility: 'reversible',
      reach: 'local-isolated',
      data: 'project',
      mode
    }
  }
}

async function prepare(casa, sessionId, suffix, mode = 'proceed') {
  const created = await criarSolicitacaoDelegacao(casa, request(sessionId, suffix, mode))
  await registrarEntregaClaude(casa, created.request, { source: `adapter-test-${suffix}` })
  return created
}

test('adaptador usa delegationId explicito, separa trabalhos simultaneos e e idempotente por executor', async () => {
  const casa = await home()
  const sessionId = 'adapter-explicit-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'Delegue dois trabalhos independentes e acompanhe os dois.'
    })
    const first = await prepare(casa, sessionId, 'first')
    const second = await prepare(casa, sessionId, 'second')

    const started = await adaptarInicioSubagenteClaude(casa, {
      session_id: sessionId,
      delegation_id: second.request.delegationId,
      agent_id: 'claude-agent-second',
      agent_type: 'executor'
    })
    assert.equal(started.result, 'running')

    const duplicate = await adaptarInicioSubagenteClaude(casa, {
      session_id: sessionId,
      delegation_id: second.request.delegationId,
      agent_id: 'claude-agent-second',
      agent_type: 'executor'
    })
    assert.equal(duplicate.result, 'duplicate')
    await assert.rejects(
      adaptarInicioSubagenteClaude(casa, {
        session_id: sessionId,
        delegation_id: second.request.delegationId,
        agent_id: 'claude-agent-wrong',
        agent_type: 'executor'
      }),
      /outro executor/i
    )
    await assert.rejects(
      adaptarInicioSubagenteClaude(casa, {
        session_id: 'another-session',
        delegation_id: first.request.delegationId,
        agent_id: 'claude-agent-cross-session',
        agent_type: 'executor'
      }),
      /sessao atual/i
    )

    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations.find((item) => item.id === first.request.delegationId).state, 'visible')
    assert.equal(cycle.delegations.find((item) => item.id === second.request.delegationId).state, 'running')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('adaptador nao inventa checkpoint material para efeitos declarados', async () => {
  const casa = await home()
  const sessionId = 'adapter-checkpoint-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'Delegue a alteracao reversivel com checkpoint.'
    })
    const created = await prepare(casa, sessionId, 'checkpoint', 'prepare-and-proceed')
    const base = {
      session_id: sessionId,
      delegation_id: created.request.delegationId,
      agent_id: 'claude-agent-checkpoint',
      agent_type: 'executor'
    }
    await assert.rejects(
      adaptarInicioSubagenteClaude(casa, base),
      /checkpoint.*rollback ou compensacao explicitos/i
    )
    const started = await adaptarInicioSubagenteClaude(casa, {
      ...base,
      checkpoint_ref: 'snapshot-before-change',
      rollback_ref: 'restore-snapshot-before-change'
    })
    assert.equal(started.result, 'running')
    assert.match(started.delegation.checkpointFingerprint, /^[a-f0-9]{64}$/)
    assert.match(started.delegation.rollbackFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
