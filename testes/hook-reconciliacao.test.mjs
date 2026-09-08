import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  executarReconciliacaoOperacional,
  tratarHookReconciliacao
} from '../runtime/hook-reconciliacao.mjs'

const CASA = 'C:\\omni-reconciliation-test'

function dependencies({ failure = null, calls = [], telemetryFailure = false } = {}) {
  return {
    casaDoOmni: () => CASA,
    withReconciliationLock: async (_casa, operation) => operation(),
    sincronizarAutomacaoFalhas: async () => {
      calls.push('failure-automation')
      if (failure === 'failure-automation') throw new Error('raw failure')
      return { jobs: [{ state: 'running', delegationId: 'delegation-active' }] }
    },
    lerAutomacaoMelhorias: async () => ({
      jobs: [{ state: 'awaiting-release', delegationId: 'delegation-improvement' }]
    }),
    reconciliarDelegacoesOperacionais: async (_casa, input) => {
      calls.push(['delegation-reconciliation', input])
      return { result: 'reconciled' }
    },
    reconciliarTurnosPendentesAuditoria: async (_casa, input) => {
      calls.push(['historical-turn-reconciliation', input.hook_event_name])
      return { result: 'reconciled' }
    },
    registrarTelemetriaAutocorrecao: async (_casa, input) => {
      assert.equal(input.profile, 'reconciliation')
      if (telemetryFailure) throw new Error('raw telemetry failure')
      return { status: 'healthy' }
    }
  }
}

test('SessionStart reconcilia delegacoes e turnos antes do trabalho normal', async () => {
  const calls = []
  const result = await tratarHookReconciliacao(
    { hook_event_name: 'SessionStart', session_id: 'session-1' },
    {},
    dependencies({ calls })
  )
  assert.equal(result.telemetry, 'persisted')
  assert.deepEqual(result.stages.map((item) => item.status), ['fulfilled', 'fulfilled', 'fulfilled'])
  assert.deepEqual(calls[1], [
    'delegation-reconciliation',
    { activeDelegationIds: ['delegation-active', 'delegation-improvement'] }
  ])
  assert.deepEqual(calls[2], ['historical-turn-reconciliation', 'SessionStart'])
})

test('falha da fila nao arquiva delegacao com binding desconhecido e nao impede turnos', async () => {
  const calls = []
  const result = await tratarHookReconciliacao(
    { hook_event_name: 'Stop', session_id: 'session-1' },
    {},
    dependencies({ failure: 'failure-automation', calls })
  )
  assert.deepEqual(result.stages.map((item) => item.status), ['rejected', 'rejected', 'fulfilled'])
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === 'delegation-reconciliation'), false)
  assert.deepEqual(calls.at(-1), ['historical-turn-reconciliation', 'Stop'])
  assert.equal(result.hookSpecificOutput, undefined)
  assert.equal(result.suppressOutput, true)
})

test('falha da telemetria fica silenciosa e retorna apenas fingerprint seguro', async () => {
  const result = await tratarHookReconciliacao(
    { hook_event_name: 'SessionStart', session_id: 'session-1' },
    {},
    dependencies({ telemetryFailure: true })
  )
  assert.equal(result.telemetry, 'rejected')
  assert.match(result.telemetryErrorFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(result.hookSpecificOutput, undefined)
  assert.equal(result.suppressOutput, true)
  assert.equal(JSON.stringify(result).includes('raw telemetry failure'), false)
})

test('lock compartilhado impede duas reconciliacoes concorrentes do mesmo estado', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-reconciliation-lock-'))
  let active = 0
  let maximumActive = 0
  const deps = {
    sincronizarAutomacaoFalhas: async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 40))
      active -= 1
      return { jobs: [] }
    },
    lerAutomacaoMelhorias: async () => ({ jobs: [] }),
    reconciliarDelegacoesOperacionais: async () => ({ result: 'unchanged' }),
    reconciliarTurnosPendentesAuditoria: async () => ({ result: 'unchanged' })
  }
  try {
    await Promise.all([
      executarReconciliacaoOperacional(casa, { hook_event_name: 'SessionStart' }, deps),
      executarReconciliacaoOperacional(casa, { hook_event_name: 'Stop' }, deps)
    ])
    assert.equal(maximumActive, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
