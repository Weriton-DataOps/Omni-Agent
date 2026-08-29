import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import {
  analisarPadraoFalha,
  avaliarPadraoFalha,
  caminhoDasFalhas,
  lerFalhas,
  listarEvidenciasVerificadasFalha,
  registrarFalha,
  testarCorrecaoFalha as testarCorrecaoFalhaReal,
  vinculoVerificacaoFalha
} from '../runtime/falhas.mjs'
import {
  confirmarInicioAutomacaoFalha,
  prepararDespachoAutomaticoFalha,
  sincronizarAutomacaoFalhas
} from '../runtime/automacao-falhas.mjs'
import {
  avaliarMelhoria,
  decidirMelhoria,
  proporMelhoriaDeFalha
} from '../runtime/autoaperfeicoamento.mjs'

const failure = {
  agent: 'omni',
  action: 'consultar disponibilidade do banco',
  failureClass: 'dependency',
  signature: 'ECONNREFUSED ao abrir conexao do Postgres'
}

async function registrarVerificacaoReal(casa, suffix, at, {
  failed = false,
  command = 'node --test testes/falhas.test.mjs',
  toolUseId = `tool-${suffix}`,
  bindingMarker = null
} = {}) {
  const sessionId = `failure-verification-${suffix}`
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Verifique a correção com o teste focal.'
  }, { at: new Date(Date.parse(at) - 1_000).toISOString() })
  return registrarAcaoAuditoria(casa, {
    hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse',
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: 'Bash',
    tool_input: {
      command: bindingMarker ? `${command} # omni-failure-binding:${bindingMarker}` : command
    },
    cwd: 'C:\\projetos\\teste'
  }, { at })
}

function sha(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

let startSequence = 0

async function iniciarTrabalhoReal(casa, id, { at } = {}) {
  startSequence += 1
  const sessionId = `failure-real-start-${startSequence}`
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Inicie a validação real desta falha.'
  }, { at })
  const dispatch = await prepararDespachoAutomaticoFalha(casa, {
    sessionId,
    executorId: 'host-model-test'
  }, { at })
  assert.equal(dispatch.result, 'dispatch-required')
  const started = await confirmarInicioAutomacaoFalha(casa, {
    sessionId,
    delegationId: dispatch.delegation.id,
    agentId: `failure-subagent-${startSequence}`
  }, { at })
  assert.equal(started.result, 'started')
  assert.equal(started.job.patternId, id)
  return started.job
}

async function testarCorrecaoFalha(casa, id, input, options = {}) {
  const execution = input.evidenceId ?? input.auditActionId
  const actionRecordedAt = input.actionRecordedAt ?? '2099-01-01T00:00:00.000Z'
  const automation = await sincronizarAutomacaoFalhas(casa)
  let job = automation.jobs.find((item) => item.patternId === id && ['queued', 'running'].includes(item.state))
  if (job?.state === 'queued') {
    job = await iniciarTrabalhoReal(casa, id)
  }
  const pattern = (await lerFalhas(casa)).patterns.find((item) => item.id === id)
  const bindingMarker = vinculoVerificacaoFalha(pattern, job?.id)
  const action = await registrarVerificacaoReal(casa, execution, actionRecordedAt, {
    command: input.strategy ?? 'node --test testes/falhas.test.mjs',
    toolUseId: `tool-${execution}`,
    bindingMarker
  })
  return testarCorrecaoFalhaReal(casa, id, {
    auditActionId: action.action.id,
    criterion: input.criterion ?? input.outcome,
    automationJobId: job?.id,
    generation: input.generation
  })
}

async function home(prefix = 'omni-failures-') {
  return mkdtemp(join(tmpdir(), prefix))
}

async function evaluatedPattern(casa) {
  await registrarFalha(casa, { ...failure, evidenceId: 'execucao-1' })
  await registrarFalha(casa, { ...failure, evidenceId: 'execucao-2' })
  const candidate = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-3' })
  await analisarPadraoFalha(casa, candidate.pattern.id, {
    rootCause: 'servico de banco ainda nao estava pronto',
    hypothesis: 'aguardar healthcheck antes de abrir conexoes'
  })
  await testarCorrecaoFalha(casa, candidate.pattern.id, {
    evidenceId: 'teste-correcao-1',
    outcome: 'healthcheck passou e a consulta respondeu',
    success: true
  })
  await testarCorrecaoFalha(casa, candidate.pattern.id, {
    evidenceId: 'teste-correcao-2',
    outcome: 'healthcheck passou e a consulta respondeu',
    success: true
  })
  return (await avaliarPadraoFalha(casa, candidate.pattern.id)).pattern
}

test('uma falha isolada nao vira regra e evidencia repetida e deduplicada', async () => {
  const casa = await home()
  try {
    const first = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-unica' })
    assert.equal(first.result, 'observing')
    assert.equal(first.pattern.occurrences, 1)
    assert.equal(first.pattern.analysis, null)

    const duplicate = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-unica' })
    assert.equal(duplicate.result, 'duplicate-evidence')
    assert.equal(duplicate.pattern.occurrences, 1)

    const notReady = await analisarPadraoFalha(casa, first.pattern.id, {
      rootCause: 'causa ainda nao comprovada',
      hypothesis: 'hipotese ainda nao comprovada'
    })
    assert.equal(notReady.result, 'not-ready')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('store v1 migra para ciclo estavel com backup integral', async () => {
  const casa = await home('omni-failures-migration-')
  try {
    const path = caminhoDasFalhas(casa)
    await mkdir(dirname(path), { recursive: true })
    const at = '2026-08-27T10:00:00.000Z'
    const v1 = {
      schemaVersion: 1,
      store: { id: 'omni-local-failure-learning', createdAt: at, updatedAt: at },
      patterns: [{
        id: 'failure-pattern-migrated',
        agent: 'omni',
        action: 'executar tarefa',
        failureClass: 'logic',
        signatureFingerprint: 'a'.repeat(64),
        status: 'candidate',
        occurrences: 3,
        observations: [{ id: 'failure-observation-migrated', evidenceFingerprint: 'b'.repeat(64), observedAt: at }],
        analysis: null,
        fixTests: [],
        evaluation: null,
        createdAt: at,
        updatedAt: at
      }]
    }
    const raw = `${JSON.stringify(v1, null, 2)}\n`
    await writeFile(path, raw, 'utf8')
    const migrated = await lerFalhas(casa)
    assert.equal(migrated.schemaVersion, 6)
    assert.equal(migrated.patterns[0].cycleNumber, 1)
    assert.match(migrated.patterns[0].cycleFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(await readFile(`${path}.v1.backup`, 'utf8'), raw)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('store v2 preserva testes autodeclarados apenas como legado e invalida seu sucesso', async () => {
  const casa = await home('omni-failures-v2-untrusted-')
  try {
    const path = caminhoDasFalhas(casa)
    await mkdir(dirname(path), { recursive: true })
    const at = '2026-08-27T10:00:00.000Z'
    const legacyTest = (suffix) => ({
      id: `fix-test-${suffix}`,
      evidenceFingerprint: sha(`evidence-${suffix}`),
      outcomeFingerprint: sha(`outcome-${suffix}`),
      criterionFingerprint: sha('criterio'),
      success: true,
      consistent: true,
      testedAt: at,
      rawOutcome: `conteudo bruto ${suffix}`
    })
    const v2 = {
      schemaVersion: 2,
      store: { id: 'omni-local-failure-learning', createdAt: at, updatedAt: at },
      patterns: [{
        id: 'failure-pattern-v2-untrusted',
        agent: 'omni',
        action: 'executar verificacao',
        failureClass: 'logic',
        signatureFingerprint: sha('signature'),
        status: 'ready-for-eval',
        occurrences: 3,
        cycleNumber: 1,
        cycleFingerprint: sha('cycle'),
        cycleStartedAt: at,
        evaluationHistory: [],
        observations: [1, 2, 3].map((index) => ({
          id: `failure-observation-${index}`,
          evidenceFingerprint: sha(`observation-${index}`),
          observedAt: at
        })),
        analysis: { rootCause: 'causa', hypothesis: 'hipotese', analyzedAt: at },
        fixTests: [legacyTest('one'), legacyTest('two')],
        evaluation: null,
        createdAt: at,
        updatedAt: at
      }]
    }
    const raw = `${JSON.stringify(v2, null, 2)}\n`
    await writeFile(path, raw, 'utf8')
    const migrated = await lerFalhas(casa)
    assert.equal(migrated.schemaVersion, 6)
    assert.equal(migrated.patterns[0].status, 'analyzed')
    assert.equal(migrated.patterns[0].fixTests.length, 0)
    assert.equal(migrated.patterns[0].legacyUnverifiedFixTests.length, 2)
    assert.equal(JSON.stringify(migrated).includes('conteudo bruto'), false)
    assert.equal(await readFile(`${path}.v2.backup`, 'utf8'), raw)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('store v4 rebaixa testes sem marcador semântico para legado não verificado', async () => {
  const casa = await home('omni-failures-v4-unbound-')
  try {
    await evaluatedPattern(casa)
    const path = caminhoDasFalhas(casa)
    const v4 = JSON.parse(await readFile(path, 'utf8'))
    v4.schemaVersion = 4
    for (const pattern of v4.patterns) {
      for (const fixTest of pattern.fixTests) delete fixTest.verificationBindingFingerprint
    }
    const raw = `${JSON.stringify(v4, null, 2)}\n`
    await writeFile(path, raw, 'utf8')

    const migrated = await lerFalhas(casa)
    assert.equal(migrated.schemaVersion, 6)
    assert.equal(migrated.patterns[0].status, 'analyzed')
    assert.equal(migrated.patterns[0].fixTests.length, 0)
    assert.equal(migrated.patterns[0].legacyUnverifiedFixTests.length, 2)
    assert.equal(await readFile(`${path}.v4.backup`, 'utf8'), raw)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('teste de correção usa somente ação real verificada e posterior à análise', async () => {
  const casa = await home('omni-failures-real-audit-')
  try {
    await registrarFalha(casa, { ...failure, evidenceId: 'real-run-1' }, { at: '2026-08-28T09:00:00.000Z' })
    await registrarFalha(casa, { ...failure, evidenceId: 'real-run-2' }, { at: '2026-08-28T09:01:00.000Z' })
    const candidate = await registrarFalha(
      casa,
      { ...failure, evidenceId: 'real-run-3' },
      { at: '2026-08-28T09:02:00.000Z' }
    )
    await registrarVerificacaoReal(casa, 'before-analysis', '2026-08-28T09:30:00.000Z')
    await analisarPadraoFalha(casa, candidate.pattern.id, {
      rootCause: 'servico de banco ainda nao estava pronto',
      hypothesis: 'aguardar healthcheck antes de abrir conexoes'
    }, { at: '2026-08-28T10:00:00.000Z' })
    await sincronizarAutomacaoFalhas(casa, { at: '2026-08-28T10:00:20.000Z' })
    const claimed = await iniciarTrabalhoReal(casa, candidate.pattern.id, {
      at: '2026-08-28T10:00:30.000Z'
    })
    const analyzedPattern = (await lerFalhas(casa)).patterns.find((item) => item.id === candidate.pattern.id)
    const bindingMarker = vinculoVerificacaoFalha(analyzedPattern, claimed.id)

    await assert.rejects(
      testarCorrecaoFalhaReal(casa, candidate.pattern.id, {
        evidenceId: 'inventado', outcome: 'eu digo que passou', success: true, criterion: 'codigo zero'
      }),
      /autodeclarado/i
    )
    const failed = await registrarVerificacaoReal(casa, 'failed', '2026-08-28T10:01:00.000Z', {
      failed: true,
      bindingMarker
    })
    const unrelated = await registrarVerificacaoReal(casa, 'unrelated', '2026-08-28T10:01:30.000Z')
    const wrongFamily = await registrarVerificacaoReal(casa, 'wrong-family', '2026-08-28T10:01:45.000Z', {
      command: 'git status',
      bindingMarker
    })
    const first = await registrarVerificacaoReal(casa, 'first', '2026-08-28T10:02:00.000Z', { bindingMarker })
    const repeatedExecution = await registrarVerificacaoReal(
      casa,
      'repeated-execution',
      '2026-08-28T10:03:00.000Z',
      { toolUseId: 'tool-first', bindingMarker }
    )
    const second = await registrarVerificacaoReal(casa, 'second', '2026-08-28T10:04:00.000Z', { bindingMarker })

    const available = await listarEvidenciasVerificadasFalha(casa, candidate.pattern.id, {
      automationJobId: claimed.id
    })
    assert.equal(available.result, 'listed')
    assert.equal(available.evidence.length, 3)
    assert.deepEqual(
      available.evidence.map((item) => item.actionId),
      [first.action.id, repeatedExecution.action.id, second.action.id]
    )
    assert.equal(JSON.stringify(available).includes('node --test'), false)
    assert.equal(available.bindingMarker, `omni-failure-binding:${bindingMarker}`)
    assert.equal(available.evidence.some((item) => item.actionId === failed.action.id), false)
    assert.equal(available.evidence.some((item) => item.actionId === unrelated.action.id), false)
    assert.equal(available.evidence.some((item) => item.actionId === wrongFamily.action.id), false)

    const one = await testarCorrecaoFalhaReal(casa, candidate.pattern.id, {
      auditActionId: first.action.id,
      auditEvidenceId: available.evidence[0].evidenceId,
      automationJobId: claimed.id,
      criterion: 'processo termina com código zero'
    })
    const duplicateAction = await testarCorrecaoFalhaReal(casa, candidate.pattern.id, {
      auditActionId: first.action.id,
      automationJobId: claimed.id,
      criterion: 'processo termina com código zero'
    })
    const duplicateExecution = await testarCorrecaoFalhaReal(casa, candidate.pattern.id, {
      auditActionId: repeatedExecution.action.id,
      automationJobId: claimed.id,
      criterion: 'processo termina com código zero'
    })
    const remaining = await listarEvidenciasVerificadasFalha(casa, candidate.pattern.id, {
      automationJobId: claimed.id
    })
    assert.deepEqual(remaining.evidence.map((item) => item.actionId), [second.action.id])
    const two = await testarCorrecaoFalhaReal(casa, candidate.pattern.id, {
      auditActionId: second.action.id,
      auditEvidenceId: available.evidence[2].evidenceId,
      automationJobId: claimed.id,
      criterion: 'processo termina com código zero'
    })
    assert.equal(one.result, 'testing')
    assert.equal(duplicateAction.result, 'duplicate-evidence')
    assert.equal(duplicateExecution.result, 'duplicate-evidence')
    assert.equal(two.result, 'ready-for-eval')
    assert.notEqual(two.pattern.fixTests[0].auditActionId, two.pattern.fixTests[1].auditActionId)
    assert.equal(two.pattern.fixTests.every((item) => item.verified && item.source === 'audit-self-correction'), true)
    assert.equal(two.pattern.fixTests.every((item) =>
      item.automationJobId === claimed.id &&
      item.hypothesisFingerprint === two.pattern.analysis.hypothesisFingerprint &&
      item.verificationFamilyFingerprint === two.pattern.analysis.verificationFamilyFingerprint &&
      item.verificationBindingFingerprint === bindingMarker
    ), true)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('job real de outro padrão não valida a hipótese atual', async () => {
  const casa = await home('omni-failures-wrong-job-')
  try {
    const otherFailure = {
      agent: 'omni',
      action: 'executar PowerShell',
      failureClass: 'permission',
      signature: 'acesso negado ao criar arquivo temporario'
    }
    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(casa, { ...otherFailure, evidenceId: `outro-${index}` })
    }
    const other = (await lerFalhas(casa)).patterns[0]
    await analisarPadraoFalha(casa, other.id, {
      rootCause: 'diretorio temporario sem permissao de escrita',
      hypothesis: 'usar diretorio de trabalho permitido'
    }, { at: '2026-08-28T10:58:00.000Z' })

    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(casa, { ...failure, evidenceId: `atual-${index}` })
    }
    const current = (await lerFalhas(casa)).patterns.find((item) => item.id !== other.id)
    await analisarPadraoFalha(casa, current.id, {
      rootCause: 'servico de banco ainda nao estava pronto',
      hypothesis: 'aguardar healthcheck antes de abrir conexoes'
    }, { at: '2026-08-28T10:59:00.000Z' })

    await sincronizarAutomacaoFalhas(casa, { at: '2026-08-28T11:00:00.000Z' })
    const claimed = await iniciarTrabalhoReal(casa, other.id, {
      at: '2026-08-28T11:00:01.000Z'
    })
    assert.equal(claimed.patternId, other.id)
    const otherCurrent = (await lerFalhas(casa)).patterns.find((item) => item.id === other.id)
    const otherBinding = vinculoVerificacaoFalha(otherCurrent, claimed.id)
    const verification = await registrarVerificacaoReal(
      casa,
      'wrong-job-binding',
      '2026-08-28T11:01:00.000Z',
      { bindingMarker: otherBinding }
    )
    const rejected = await testarCorrecaoFalhaReal(casa, current.id, {
      auditActionId: verification.action.id,
      automationJobId: claimed.id,
      criterion: 'healthcheck passa e a consulta responde'
    })
    assert.equal(rejected.result, 'unverified-job')
    assert.equal(rejected.pattern.fixTests.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('tres falhas, causa e dois testes consistentes passam no eval', async () => {
  const casa = await home('omni-failures-flow-')
  try {
    const first = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-1' })
    const second = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-2' })
    const third = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-3' })
    assert.equal(first.result, 'observing')
    assert.equal(second.result, 'observing')
    assert.equal(third.result, 'candidate')

    const analyzed = await analisarPadraoFalha(casa, third.pattern.id, {
      rootCause: 'servico de banco ainda nao estava pronto',
      hypothesis: 'aguardar healthcheck antes de abrir conexoes'
    })
    assert.equal(analyzed.result, 'analyzed')

    const testOne = await testarCorrecaoFalha(casa, third.pattern.id, {
      evidenceId: 'teste-1', outcome: 'healthcheck passou e a consulta respondeu', success: true
    })
    const duplicate = await testarCorrecaoFalha(casa, third.pattern.id, {
      evidenceId: 'teste-1', outcome: 'healthcheck passou e a consulta respondeu', success: true
    })
    const testTwo = await testarCorrecaoFalha(casa, third.pattern.id, {
      evidenceId: 'teste-2', outcome: 'healthcheck passou e a consulta respondeu', success: true
    })
    assert.equal(testOne.result, 'testing')
    assert.equal(duplicate.result, 'duplicate-evidence')
    assert.equal(testTwo.result, 'ready-for-eval')

    const evaluation = await avaliarPadraoFalha(casa, third.pattern.id)
    assert.equal(evaluation.result, 'passed')
    assert.equal(evaluation.pattern.status, 'evaluated')
    assert.ok(evaluation.pattern.evaluation.gates.every((gate) => gate.passed))

    const raw = await readFile(caminhoDasFalhas(casa), 'utf8')
    assert.equal(raw.includes(failure.signature), false)
    assert.equal(raw.includes('execucao-1'), false)
    assert.equal(raw.includes('healthcheck passou e a consulta respondeu'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('teste falho ou inconsistente impede eval', async () => {
  const casa = await home('omni-failures-test-reset-')
  try {
    await registrarFalha(casa, { ...failure, evidenceId: 'execucao-1' })
    await registrarFalha(casa, { ...failure, evidenceId: 'execucao-2' })
    const candidate = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-3' })
    await analisarPadraoFalha(casa, candidate.pattern.id, {
      rootCause: 'servico de banco ainda nao estava pronto',
      hypothesis: 'aguardar healthcheck antes de abrir conexoes'
    })
    await testarCorrecaoFalha(casa, candidate.pattern.id, {
      evidenceId: 'teste-1', outcome: 'resultado esperado', success: true
    })
    const inconsistent = await testarCorrecaoFalha(casa, candidate.pattern.id, {
      evidenceId: 'teste-2', outcome: 'resultado completamente diferente', success: true,
      strategy: 'npm.cmd run check'
    })
    assert.equal(inconsistent.result, 'analyzed')
    const evaluation = await avaliarPadraoFalha(casa, candidate.pattern.id)
    assert.equal(evaluation.result, 'not-ready')
    const recoveredOne = await testarCorrecaoFalha(casa, candidate.pattern.id, {
      evidenceId: 'teste-3', outcome: 'resultado esperado', success: true
    })
    const recoveredTwo = await testarCorrecaoFalha(casa, candidate.pattern.id, {
      evidenceId: 'teste-4', outcome: 'resultado esperado', success: true
    })
    assert.equal(recoveredOne.result, 'testing')
    assert.equal(recoveredTwo.result, 'ready-for-eval')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('eval de falha escolhe rota operacional em vez de fabricar uma skill', async () => {
  const casa = await home('omni-failures-improvement-')
  try {
    const pattern = await evaluatedPattern(casa)
    const draft = await proporMelhoriaDeFalha(casa, pattern.id)
    assert.equal(draft.result, 'draft')
    assert.equal(draft.proposal.category, 'failure-pattern')
    assert.equal(draft.proposal.destination, 'operational-rule')
    assert.equal(draft.proposal.draft.implementation.kind, 'operational-rule')

    const evaluation = await avaliarMelhoria(casa, draft.proposal.id)
    assert.equal(evaluation.result, 'passed')
    const refused = await decidirMelhoria(casa, draft.proposal.id, 'approve')
    assert.equal(refused.result, 'portable-confirmation-required')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('nova ocorrencia invalida eval anterior e bloqueia a proposta antiga', async () => {
  const casa = await home('omni-failures-regression-')
  try {
    const pattern = await evaluatedPattern(casa)
    const draft = await proporMelhoriaDeFalha(casa, pattern.id)
    await avaliarMelhoria(casa, draft.proposal.id)
    await decidirMelhoria(casa, draft.proposal.id, 'approve', { portable: true, roleFit: true })

    const recurrence = await registrarFalha(casa, { ...failure, evidenceId: 'execucao-4' })
    assert.equal(recurrence.result, 'candidate')
    assert.equal(recurrence.pattern.evaluation, null)
    const reevaluation = await avaliarMelhoria(casa, draft.proposal.id)
    assert.equal(reevaluation.result, 'failed')
    assert.equal(reevaluation.proposal.status, 'draft')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('concorrencia nao perde ocorrencias, segredo e recusado e schema futuro e preservado', async () => {
  const casa = await home('omni-failures-safe-')
  try {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        registrarFalha(casa, { ...failure, evidenceId: `execucao-concorrente-${index}` })
      )
    )
    const store = await lerFalhas(casa)
    assert.equal(store.patterns.length, 1)
    assert.equal(store.patterns[0].occurrences, 6)

    const secret = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_')
    await assert.rejects(
      registrarFalha(casa, { ...failure, signature: secret, evidenceId: 'segredo-1' }),
      /segredo/i
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }

  const futureHome = await home('omni-failures-future-')
  try {
    const path = caminhoDasFalhas(futureHome)
    await mkdir(dirname(path), { recursive: true })
    const future = '{"schemaVersion":7,"store":{"id":"future"},"patterns":[]}\n'
    await writeFile(path, future, 'utf8')
    await assert.rejects(lerFalhas(futureHome), /mais novo que este plugin/i)
    assert.equal(await readFile(path, 'utf8'), future)
  } finally {
    await rm(futureHome, { recursive: true, force: true })
  }
})

test('reanalise substitui diagnostico errado e zera testes da hipotese antiga', async () => {
  const casa = await home('omni-failures-reanalise-')
  try {
    await registrarFalha(casa, { ...failure, evidenceId: 'ocorrencia-1' })
    await registrarFalha(casa, { ...failure, evidenceId: 'ocorrencia-2' })
    const candidate = await registrarFalha(casa, { ...failure, evidenceId: 'ocorrencia-3' })
    const id = candidate.pattern.id

    const errada = await analisarPadraoFalha(casa, id, {
      rootCause: 'o executor encerrou o processo antes do fim',
      hypothesis: 'manter o executor vivo ate a consulta terminar'
    })
    assert.equal(errada.result, 'analyzed')

    await testarCorrecaoFalha(casa, id, {
      evidenceId: 'teste-da-hipotese-antiga',
      outcome: 'passou pela razao errada',
      success: true
    })

    // O diagnostico medido chega depois. Antes desta correcao a reanalise era recusada
    // com not-ready e o CLI carimbava sucesso por cima.
    const certa = await analisarPadraoFalha(casa, id, {
      rootCause: 'latencia de I/O em share de rede estoura o timeout padrao',
      hypothesis: 'usar consulta que le apenas refs e index, sem percorrer o worktree'
    })
    assert.equal(certa.result, 'analyzed')
    assert.match(certa.pattern.analysis.rootCause, /latencia de I\/O/)
    assert.equal(certa.pattern.status, 'analyzed')
    assert.equal(certa.pattern.fixTests.length, 0, 'teste da hipotese antiga nao pode sobreviver')
    assert.equal(certa.pattern.evaluation, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('reanalise continua recusada depois da avaliacao concluida', async () => {
  const casa = await home('omni-failures-pos-eval-')
  try {
    const pattern = await evaluatedPattern(casa)
    const recusada = await analisarPadraoFalha(casa, pattern.id, {
      rootCause: 'tentativa tardia de reescrever a historia',
      hypothesis: 'nao deve ser aceita apos a avaliacao'
    })
    assert.equal(recusada.result, 'not-ready')
    assert.match(recusada.pattern.analysis.rootCause, /banco ainda nao estava pronto/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
