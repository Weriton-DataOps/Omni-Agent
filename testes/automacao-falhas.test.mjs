import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import {
  bloquearAutomacaoFalha,
  caminhoDaAutomacaoFalhas,
  confirmarInicioAutomacaoFalha,
  concluirAutomacaoFalha,
  prepararDespachoAutomaticoFalha,
  reivindicarAutomacaoFalha,
  sincronizarAutomacaoFalhas
} from '../runtime/automacao-falhas.mjs'
import {
  adaptarInicioSubagenteClaude,
  registrarEntregaClaude
} from '../runtime/adaptador-claude-delegacao.mjs'
import {
  analisarPadraoFalha,
  avaliarPadraoFalha,
  lerFalhas,
  registrarFalha,
  testarCorrecaoFalha as testarCorrecaoFalhaReal,
  vinculoVerificacaoFalha
} from '../runtime/falhas.mjs'

let startSequence = 0

async function iniciarTrabalhoReal(casa, id, { at } = {}) {
  startSequence += 1
  const sessionId = `failure-worker-${startSequence}-${id}`
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Inicie o executor real da validação de falha.'
  }, { at })
  const dispatch = await prepararDespachoAutomaticoFalha(casa, {
    sessionId
  }, { at })
  assert.equal(dispatch.result, 'dispatch-required')
  await registrarEntregaClaude(casa, dispatch.request, { at })
  const adapter = await adaptarInicioSubagenteClaude(casa, {
    hook_event_name: 'SubagentStart',
    session_id: sessionId,
    delegation_id: dispatch.request.delegationId,
    agent_id: `subagent-${startSequence}`,
    agent_type: 'background-subagent',
    cwd: casa
  }, { at })
  const started = adapter.automation ?? await confirmarInicioAutomacaoFalha(casa, {
    sessionId,
    delegationId: dispatch.request.delegationId,
    executorId: `subagent-${startSequence}`
  }, { at })
  assert.equal(started.result, 'started')
  if (id) assert.equal(started.job.patternId, id)
  return { ...started, prompt: dispatch.prompt, delegation: dispatch.delegation }
}

async function testarCorrecaoFalha(casa, id, input, options = {}) {
  const automation = await sincronizarAutomacaoFalhas(casa)
  let job = automation.jobs.find((item) => item.patternId === id && ['queued', 'running'].includes(item.state))
  if (job?.state === 'queued') {
    job = (await iniciarTrabalhoReal(casa, id, options)).job
  }
  const pattern = (await lerFalhas(casa)).patterns.find((item) => item.id === id)
  const bindingMarker = vinculoVerificacaoFalha(pattern, job?.id)
  const execution = input.evidenceId ?? input.auditActionId
  const actionRecordedAt = input.actionRecordedAt ?? '2099-01-01T00:00:00.000Z'
  const sessionId = `failure-automation-${execution}`
  const toolUseId = `tool-${execution}`
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Verifique a correção da falha automatizada.'
  }, { at: new Date(Date.parse(actionRecordedAt) - 1_000).toISOString() })
  const recorded = await registrarAcaoAuditoria(casa, {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: 'Bash',
    tool_input: {
      command: `${input.strategy ?? 'node --test testes/automacao-falhas.test.mjs'} # omni-failure-binding:${bindingMarker}`
    },
    cwd: 'C:\\projetos\\teste'
  }, { at: actionRecordedAt })
  return testarCorrecaoFalhaReal(casa, id, {
    auditActionId: recorded.action.id,
    automationJobId: job?.id,
    criterion: input.criterion ?? input.outcome,
    generation: input.generation
  })
}

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-failure-automation-'))
}

async function candidate(casa, suffix = 'base') {
  const failure = {
    agent: 'omni',
    action: 'executar Bash',
    failureClass: 'permission',
    signature: `permissao negada ${suffix}`
  }
  await registrarFalha(casa, { ...failure, evidenceId: `${suffix}-run-1` })
  await registrarFalha(casa, { ...failure, evidenceId: `${suffix}-run-2` })
  return registrarFalha(casa, { ...failure, evidenceId: `${suffix}-run-3` })
}

test('candidata cria um unico trabalho e somente evento started confirma inicio', async () => {
  const casa = await home()
  try {
    const failure = await candidate(casa)
    const first = await sincronizarAutomacaoFalhas(casa)
    const second = await sincronizarAutomacaoFalhas(casa)
    assert.equal(first.jobs.length, 1)
    assert.equal(second.jobs.length, 1)
    assert.equal(second.jobs[0].patternId, failure.pattern.id)
    assert.equal(second.jobs[0].state, 'queued')

    const legacy = await reivindicarAutomacaoFalha(casa, { executorId: 'executor-background-1' })
    assert.equal(legacy.result, 'start-event-required')
    assert.equal(legacy.job.state, 'queued')
    assert.equal(legacy.job.attempts, 0)

    const started = await iniciarTrabalhoReal(casa, failure.pattern.id)
    assert.equal(started.job.state, 'running')
    assert.equal(started.job.dispatchState, 'requested')
    assert.equal(started.job.attempts, 1)
    assert.ok(Number.isFinite(Date.parse(started.job.dispatchRequestedAt)))
    assert.match(started.prompt, /executor temporário.*canal externo/i)
    assert.match(started.prompt, /duas vezes de verdade/i)
    assert.match(started.prompt, /falha-evidencias/i)
    assert.match(started.prompt, /--job/i)
    assert.match(started.prompt, /bindingMarker/)
    assert.match(started.prompt, /ação sem esse marcador não pertence/i)
    assert.match(started.prompt, /--acao-auditoria.*--evidencia-auditoria/i)
    assert.doesNotMatch(started.prompt, /--resultado|--falhou/i)
    assert.match(started.prompt, /autoridade herdada da tarefa original/i)
    assert.match(started.prompt, /envelope de autoridade.*objetivo.*alvo.*escopo material.*efeitos/i)
    assert.match(started.prompt, /checkpoint verificável/i)
    assert.match(started.prompt, /rollback proporcional/i)
    assert.match(started.prompt, /verifique o resultado real.*evidência/i)
    assert.doesNotMatch(started.prompt, /não faça commit|exigem autorização do proprietário/i)
    assert.match(started.prompt, new RegExp(failure.pattern.id))

    const duplicate = await reivindicarAutomacaoFalha(casa, { executorId: 'executor-background-2' })
    assert.equal(duplicate.result, 'already-started')
    assert.equal(duplicate.job.attempts, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('trabalho não pode concluir antes da análise, dois testes e eval', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'sem-eval')
    const started = await iniciarTrabalhoReal(casa, null)
    const result = await concluirAutomacaoFalha(casa, started.job.id, 'evidencia-inventada')
    assert.equal(result.result, 'not-evaluated')
    assert.equal(result.job.state, 'running')
    assert.equal(result.job.evidenceFingerprint, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('novas ocorrencias do mesmo ciclo reforcam o padrao sem multiplicar trabalhos', async () => {
  const casa = await home()
  try {
    const failure = await candidate(casa, 'stable-cycle')
    const first = await sincronizarAutomacaoFalhas(casa)
    const generation = first.jobs[0].generationFingerprint

    for (let index = 4; index <= 20; index += 1) {
      await registrarFalha(casa, {
        agent: 'omni',
        action: 'executar Bash',
        failureClass: 'permission',
        signature: 'permissao negada stable-cycle',
        evidenceId: `stable-cycle-run-${index}`
      })
      await sincronizarAutomacaoFalhas(casa)
    }

    const store = await sincronizarAutomacaoFalhas(casa)
    const pattern = (await lerFalhas(casa)).patterns.find((item) => item.id === failure.pattern.id)
    assert.equal(pattern.occurrences, 20)
    assert.equal(pattern.cycleFingerprint, generation)
    assert.equal(store.jobs.filter((item) => item.patternId === pattern.id && item.state === 'queued').length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('store de automacao v1 migra com backup sem perder trabalhos', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'migration')
    await sincronizarAutomacaoFalhas(casa)
    const path = caminhoDaAutomacaoFalhas(casa)
    const v1 = JSON.parse(await readFile(path, 'utf8'))
    v1.schemaVersion = 1
    const raw = `${JSON.stringify(v1, null, 2)}\n`
    await writeFile(path, raw, 'utf8')

    const migrated = await sincronizarAutomacaoFalhas(casa)
    assert.equal(migrated.schemaVersion, 4)
    assert.equal(migrated.jobs.length, 1)
    assert.equal(migrated.jobs[0].legacyAttempts, 0)
    assert.equal(await readFile(`${path}.v1.backup`, 'utf8'), raw)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('lease expirado e falha tecnica recolocam o mesmo trabalho na fila', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'lease')
    const started = await iniciarTrabalhoReal(casa, null, { at: '2026-08-27T01:00:00.000Z' })
    assert.equal(started.job.attempts, 1)
    const expired = await sincronizarAutomacaoFalhas(casa, { at: '2026-08-27T02:01:00.000Z' })
    assert.equal(expired.jobs[0].state, 'queued')
    assert.equal(expired.jobs[0].reasonClass, 'lease-expired')

    const restarted = await iniciarTrabalhoReal(casa, null, { at: '2026-08-27T02:02:00.000Z' })
    assert.equal(restarted.job.attempts, 2)
    const retry = await bloquearAutomacaoFalha(
      casa,
      restarted.job.id,
      'a primeira estratégia não encontrou a evidência',
      {
        kind: 'retryable',
        evidenceId: 'audit-evidence-lease-retry',
        strategy: 'buscar somente pelo caminho antigo',
        at: '2026-08-27T02:03:00.000Z'
      }
    )
    assert.equal(retry.result, 'retry-scheduled')
    const stable = await sincronizarAutomacaoFalhas(casa, { at: '2026-08-27T02:04:00.000Z' })
    assert.equal(stable.jobs.length, 1)
    assert.equal(stable.jobs[0].state, 'queued')
    assert.equal(stable.jobs[0].reasonClass, 'retryable')
    assert.equal(stable.jobs[0].reasonFingerprint.length, 64)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('dois resultados reais diferentes passam quando verificam o mesmo criterio', async () => {
  const casa = await home()
  try {
    const failure = await candidate(casa, 'criterion')
    await analisarPadraoFalha(casa, failure.pattern.id, {
      rootCause: 'o processo usava uma pasta sem permissao de escrita',
      hypothesis: 'usar a pasta temporaria permitida elimina a falha'
    })
    const first = await testarCorrecaoFalha(casa, failure.pattern.id, {
      evidenceId: 'criterion-test-run-1',
      criterion: 'processo termina com codigo zero e cria o artefato esperado',
      outcome: 'codigo zero; artefato criado em temp-run-1',
      success: true
    })
    const second = await testarCorrecaoFalha(casa, failure.pattern.id, {
      evidenceId: 'criterion-test-run-2',
      criterion: 'processo termina com codigo zero e cria o artefato esperado',
      outcome: 'codigo zero; artefato criado em temp-run-2',
      success: true
    })
    assert.equal(first.result, 'testing')
    assert.equal(second.result, 'ready-for-eval')
    assert.notEqual(
      second.pattern.fixTests[0].outcomeFingerprint,
      second.pattern.fixTests[1].outcomeFingerprint
    )
    assert.equal(
      second.pattern.fixTests[0].criterionFingerprint,
      second.pattern.fixTests[1].criterionFingerprint
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('falhas do proprio executor ficam fora da fila automatica', async () => {
  const casa = await home()
  try {
    const failure = {
      agent: 'omni',
      action: 'executar delegation-control',
      failureClass: 'tool-error',
      signature: 'executor em segundo plano falhou'
    }
    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(casa, { ...failure, evidenceId: `agent-run-${index}` })
    }
    const store = await sincronizarAutomacaoFalhas(casa)
    assert.equal(store.jobs.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('eval concluido nao rouba do subagente o fechamento com evidencia', async () => {
  const casa = await home()
  try {
    const failure = await candidate(casa, 'closing-race')
    const started = await iniciarTrabalhoReal(casa, failure.pattern.id)
    const generation = started.job.generationFingerprint
    await analisarPadraoFalha(casa, failure.pattern.id, {
      generation,
      rootCause: 'o comando escolhia uma pasta sem permissao de escrita',
      hypothesis: 'usar a pasta temporaria permitida elimina a falha'
    })
    for (let index = 1; index <= 2; index += 1) {
      await testarCorrecaoFalha(casa, failure.pattern.id, {
        generation,
        evidenceId: `closing-race-test-${index}`,
        criterion: 'processo termina com codigo zero',
        outcome: `execucao ${index} terminou com codigo zero`,
        success: true
      })
    }
    await avaliarPadraoFalha(casa, failure.pattern.id, { generation })
    const synchronized = await sincronizarAutomacaoFalhas(casa)
    assert.equal(synchronized.jobs[0].state, 'running')
    assert.equal(synchronized.jobs[0].evidenceFingerprint, null)

    const completed = await concluirAutomacaoFalha(
      casa,
      started.job.id,
      'closing-race-evidence-id'
    )
    assert.equal(completed.result, 'completed')
    assert.equal(completed.job.state, 'completed')
    assert.match(completed.job.evidenceFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('fechamento tardio só repara job avaliado sem fingerprint', async () => {
  const casa = await home()
  try {
    const failure = await candidate(casa, 'late-close')
    const started = await iniciarTrabalhoReal(casa, failure.pattern.id)
    const generation = started.job.generationFingerprint
    await analisarPadraoFalha(casa, failure.pattern.id, {
      generation,
      rootCause: 'o executor usava um alvo sem a permissão necessária',
      hypothesis: 'usar o alvo permitido elimina a falha'
    })
    for (let index = 1; index <= 2; index += 1) {
      await testarCorrecaoFalha(casa, failure.pattern.id, {
        generation,
        evidenceId: `late-close-test-${index}`,
        criterion: 'a execução termina com código zero',
        outcome: `execução ${index} terminou com código zero`,
        success: true
      })
    }
    await avaliarPadraoFalha(casa, failure.pattern.id, { generation })
    const path = caminhoDaAutomacaoFalhas(casa)
    const store = JSON.parse(await readFile(path, 'utf8'))
    store.jobs[0].state = 'completed'
    store.jobs[0].leaseUntil = null
    store.jobs[0].evidenceFingerprint = null
    await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8')

    const repaired = await concluirAutomacaoFalha(
      casa,
      started.job.id,
      'late-closing-evidence-id'
    )
    assert.equal(repaired.result, 'completed')
    assert.match(repaired.job.evidenceFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
