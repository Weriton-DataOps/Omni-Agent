import assert from 'node:assert/strict'
import test from 'node:test'

import { tratarHookVarredura } from '../runtime/hook-varredura.mjs'

const CASA = 'C:\\omni-hook-test'
const ORDER = [
  'daily-scan',
  'system-audit',
  'personality-eval',
  'operational-release'
]

function dependencies({ failures = new Map(), calls = [] } = {}) {
  const execute = (stage) => async (...args) => {
    calls.push({ stage, args })
    if (failures.has(stage)) throw new Error(failures.get(stage))
    return { result: `${stage}-ok`, detail: `resultado interno ${stage}` }
  }
  return {
    casaDoOmni: () => CASA,
    withMaintenanceLock: async (_casa, operation) => operation(),
    varrerAtividadesDoDia: execute('daily-scan'),
    auditarSaudeSistema: execute('system-audit'),
    processarFilaEvalPersonalidade: execute('personality-eval'),
    processarReleasePendenteMelhoria: execute('operational-release'),
    registrarTelemetriaAutocorrecao: async (_casa, input) => {
      assert.equal(input.profile, 'maintenance')
      return { status: 'healthy' }
    }
  }
}

test('falha na varredura nao impede auditoria, eval ou release no mesmo ciclo', async () => {
  const calls = []
  const result = await tratarHookVarredura(
    { hook_event_name: 'SessionStart' },
    {},
    dependencies({ failures: new Map([['daily-scan', 'SEGREDO-DA-VARREDURA']]), calls })
  )

  assert.deepEqual(calls.map((item) => item.stage), ORDER)
  assert.equal(result.stages[0].status, 'rejected')
  assert.equal(result.stages.filter((item) => item.status === 'fulfilled').length, 3)
  assert.equal(result.suppressOutput, true)
  assert.equal(result.maintenance, 'completed')
  assert.equal(result.telemetry, 'persisted')
})

test('falha no eval ainda executa a release operacional', async () => {
  const calls = []
  const result = await tratarHookVarredura(
    { hook_event_name: 'Stop' },
    {},
    dependencies({ failures: new Map([['personality-eval', 'RESPOSTA-BRUTA-DO-EVAL']]), calls })
  )

  assert.deepEqual(calls.map((item) => item.stage), ORDER)
  assert.equal(result.stages[2].status, 'rejected')
  assert.equal(result.stages[3].status, 'fulfilled')
  assert.equal(calls.filter((item) => item.stage === 'operational-release').length, 1)
})

test('multiplas falhas ficam somente em fingerprints e nunca vazam texto bruto', async () => {
  const secrets = [
    'TOKEN-SUPER-SECRETO-123',
    'CONVERSA-BRUTA-NAO-PERSISTIR',
    'CAMINHO-PRIVADO-DO-USUARIO'
  ]
  const failures = new Map([
    ['daily-scan', secrets[0]],
    ['system-audit', secrets[1]],
    ['operational-release', secrets[2]]
  ])
  const result = await tratarHookVarredura(
    { hook_event_name: 'SessionStart' },
    {},
    dependencies({ failures })
  )
  const raw = JSON.stringify(result)

  for (const secret of secrets) assert.doesNotMatch(raw, new RegExp(secret))
  const rejected = result.stages.filter((item) => item.status === 'rejected')
  assert.equal(rejected.length, 3)
  assert.ok(rejected.every((item) => /^[a-f0-9]{64}$/.test(item.errorFingerprint)))
  assert.ok(rejected.every((item) => !Object.hasOwn(item, 'error')))
})

test('caminho feliz preserva ordem e evita reconciliacao duplicada na auditoria', async () => {
  const calls = []
  const result = await tratarHookVarredura(
    { hook_event_name: 'Stop' },
    { OMNI_HOME: CASA },
    dependencies({ calls })
  )

  assert.deepEqual(calls.map((item) => item.stage), ORDER)
  assert.equal(new Set(calls.map((item) => item.stage)).size, ORDER.length)
  assert.deepEqual(calls[0].args, [CASA, { automatic: true }])
  assert.deepEqual(calls[1].args, [CASA, { repair: true, reconcile: false }])
  assert.deepEqual(calls[2].args, [{ casa: CASA }])
  assert.deepEqual(calls[3].args, [CASA])
  assert.ok(result.stages.every((item) => item.status === 'fulfilled'))
  assert.ok(result.stages.every((item) => /^[a-f0-9]{64}$/.test(item.resultFingerprint)))
})

test('single-flight agrega evento concorrente sem iniciar uma segunda manutencao', async () => {
  const result = await tratarHookVarredura(
    { hook_event_name: 'SessionStart' },
    {},
    {
      casaDoOmni: () => CASA,
      withMaintenanceLock: async () => {
        const error = new Error('busy')
        error.name = 'LocalJsonLockTimeoutError'
        throw error
      },
      varrerAtividadesDoDia: () => { throw new Error('nao deveria executar') }
    }
  )
  assert.deepEqual(result, { suppressOutput: true, maintenance: 'coalesced-in-flight' })
})

test('falha de manutencao no Stop fica em telemetria e nunca prolonga a conversa', async () => {
  const result = await tratarHookVarredura(
    { hook_event_name: 'Stop' },
    {},
    {
      ...dependencies(),
      registrarTelemetriaAutocorrecao: async () => { throw new Error('telemetry unavailable') }
    }
  )
  assert.equal(result.telemetry, 'rejected')
  assert.equal(result.suppressOutput, true)
  assert.equal(result.hookSpecificOutput, undefined)
})

test('evento alheio nao resolve casa nem executa qualquer etapa', async () => {
  let calls = 0
  const forbidden = () => {
    calls += 1
    throw new Error('nao deveria executar')
  }
  const result = await tratarHookVarredura(
    { hook_event_name: 'UserPromptSubmit' },
    {},
    {
      casaDoOmni: forbidden,
      withMaintenanceLock: forbidden,
      varrerAtividadesDoDia: forbidden,
      auditarSaudeSistema: forbidden,
      processarFilaEvalPersonalidade: forbidden,
      processarReleasePendenteMelhoria: forbidden,
      registrarTelemetriaAutocorrecao: forbidden
    }
  )

  assert.equal(calls, 0)
  assert.deepEqual(result, { suppressOutput: true })
})
