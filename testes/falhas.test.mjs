import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  analisarPadraoFalha,
  avaliarPadraoFalha,
  caminhoDasFalhas,
  lerFalhas,
  registrarFalha,
  testarCorrecaoFalha
} from '../runtime/falhas.mjs'
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
      evidenceId: 'teste-2', outcome: 'resultado completamente diferente', success: true
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

test('eval de falha alimenta pipeline 25 mas ainda exige decisao humana', async () => {
  const casa = await home('omni-failures-improvement-')
  try {
    const pattern = await evaluatedPattern(casa)
    const draft = await proporMelhoriaDeFalha(casa, pattern.id)
    assert.equal(draft.result, 'draft')
    assert.equal(draft.proposal.category, 'failure-pattern')
    assert.equal(draft.proposal.destination, 'capability')

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
    const future = '{"schemaVersion":2,"store":{"id":"future"},"patterns":[]}\n'
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
