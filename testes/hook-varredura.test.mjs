import assert from 'node:assert/strict'
import test from 'node:test'

import { tratarHookVarredura } from '../runtime/hook-varredura.mjs'

const CASA = 'C:\\omni-hook-test'
const ORDEM = [
  'daily-scan',
  'failure-automation',
  'system-audit',
  'personality-eval',
  'operational-release'
]

function dependencias({ failures = new Map(), calls = [] } = {}) {
  const execute = (stage) => async (...args) => {
    calls.push({ stage, args })
    if (failures.has(stage)) throw new Error(failures.get(stage))
    return { result: `${stage}-ok`, detail: `resultado interno ${stage}` }
  }
  return {
    casaDoOmni: () => CASA,
    varrerAtividadesDoDia: execute('daily-scan'),
    sincronizarAutomacaoFalhas: execute('failure-automation'),
    auditarSaudeSistema: execute('system-audit'),
    processarFilaEvalPersonalidade: execute('personality-eval'),
    processarReleasePendenteMelhoria: execute('operational-release')
  }
}

test('falha na primeira etapa nao impede auditoria, eval ou release no mesmo ciclo', async () => {
  const calls = []
  const result = await tratarHookVarredura(
    { hook_event_name: 'SessionStart' },
    {},
    dependencias({ failures: new Map([['daily-scan', 'SEGREDO-DA-VARREDURA']]), calls })
  )

  assert.deepEqual(calls.map((item) => item.stage), ORDEM)
  assert.deepEqual(result.stages.map((item) => item.status), [
    'rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'
  ])
  assert.equal(result.suppressOutput, true)
})

test('falha no eval ainda executa a release operacional', async () => {
  const calls = []
  const result = await tratarHookVarredura(
    { hook_event_name: 'Stop' },
    {},
    dependencias({ failures: new Map([['personality-eval', 'RESPOSTA-BRUTA-DO-EVAL']]), calls })
  )

  assert.deepEqual(calls.map((item) => item.stage), ORDEM)
  assert.equal(result.stages[3].status, 'rejected')
  assert.equal(result.stages[4].status, 'fulfilled')
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
    dependencias({ failures })
  )
  const raw = JSON.stringify(result)

  for (const secret of secrets) assert.doesNotMatch(raw, new RegExp(secret))
  const rejected = result.stages.filter((item) => item.status === 'rejected')
  assert.equal(rejected.length, 3)
  assert.ok(rejected.every((item) => /^[a-f0-9]{64}$/.test(item.errorFingerprint)))
  assert.ok(rejected.every((item) => !Object.hasOwn(item, 'error')))
})

test('caminho feliz preserva ordem, argumentos e uma chamada por etapa', async () => {
  const calls = []
  const env = { OMNI_HOME: CASA }
  const result = await tratarHookVarredura(
    { hook_event_name: 'Stop' },
    env,
    dependencias({ calls })
  )

  assert.deepEqual(calls.map((item) => item.stage), ORDEM)
  assert.equal(new Set(calls.map((item) => item.stage)).size, ORDEM.length)
  assert.deepEqual(calls[0].args, [CASA, { automatic: true }])
  assert.deepEqual(calls[1].args, [CASA])
  assert.deepEqual(calls[2].args, [CASA, { repair: true }])
  assert.deepEqual(calls[3].args, [{ casa: CASA }])
  assert.deepEqual(calls[4].args, [CASA])
  assert.ok(result.stages.every((item) => item.status === 'fulfilled'))
  assert.ok(result.stages.every((item) => /^[a-f0-9]{64}$/.test(item.resultFingerprint)))
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
      varrerAtividadesDoDia: forbidden,
      sincronizarAutomacaoFalhas: forbidden,
      auditarSaudeSistema: forbidden,
      processarFilaEvalPersonalidade: forbidden,
      processarReleasePendenteMelhoria: forbidden
    }
  )

  assert.equal(calls, 0)
  assert.deepEqual(result, { suppressOutput: true })
})
