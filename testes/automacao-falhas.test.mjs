import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  bloquearAutomacaoFalha,
  caminhoDaAutomacaoFalhas,
  concluirAutomacaoFalha,
  reivindicarAutomacaoFalha,
  sincronizarAutomacaoFalhas
} from '../runtime/automacao-falhas.mjs'
import {
  analisarPadraoFalha,
  avaliarPadraoFalha,
  registrarFalha,
  testarCorrecaoFalha
} from '../runtime/falhas.mjs'

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

test('candidata cria um unico trabalho idempotente e reivindicavel', async () => {
  const casa = await home()
  try {
    const failure = await candidate(casa)
    const first = await sincronizarAutomacaoFalhas(casa)
    const second = await sincronizarAutomacaoFalhas(casa)
    assert.equal(first.jobs.length, 1)
    assert.equal(second.jobs.length, 1)
    assert.equal(second.jobs[0].patternId, failure.pattern.id)
    assert.equal(second.jobs[0].state, 'queued')

    const claimed = await reivindicarAutomacaoFalha(casa, { executorId: 'executor-background-1' })
    assert.equal(claimed.result, 'claimed')
    assert.equal(claimed.job.state, 'running')
    assert.match(claimed.prompt, /subagente.*segundo plano/i)
    assert.match(claimed.prompt, /duas vezes de verdade/i)
    assert.match(claimed.prompt, /não peça ao proprietário/i)
    assert.match(claimed.prompt, new RegExp(failure.pattern.id))

    const empty = await reivindicarAutomacaoFalha(casa, { executorId: 'executor-background-2' })
    assert.equal(empty.result, 'busy')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('lease expirado recoloca trabalho na fila e bloqueio impede repeticao da geracao', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'lease')
    const claimed = await reivindicarAutomacaoFalha(
      casa,
      { executorId: 'executor-lease' },
      { at: '2026-08-27T01:00:00.000Z' }
    )
    const expired = await sincronizarAutomacaoFalhas(casa, { at: '2026-08-27T02:01:00.000Z' })
    assert.equal(expired.jobs[0].state, 'queued')

    const reclaimed = await reivindicarAutomacaoFalha(
      casa,
      { executorId: 'executor-reclaimed' },
      { at: '2026-08-27T02:02:00.000Z' }
    )
    const blocked = await bloquearAutomacaoFalha(
      casa,
      reclaimed.job.id,
      'teste exige nova permissao do ambiente',
      { at: '2026-08-27T02:03:00.000Z' }
    )
    assert.equal(blocked.result, 'blocked')
    const stable = await sincronizarAutomacaoFalhas(casa, { at: '2026-08-27T02:04:00.000Z' })
    assert.equal(stable.jobs.length, 1)
    assert.equal(stable.jobs[0].state, 'blocked')
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
      action: 'executar Agent',
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
    const claimed = await reivindicarAutomacaoFalha(casa, { executorId: 'executor-closing-race' })
    const generation = claimed.job.generationFingerprint
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
      claimed.job.id,
      'closing-race-evidence-id'
    )
    assert.equal(completed.result, 'completed')
    assert.equal(completed.job.state, 'completed')
    assert.match(completed.job.evidenceFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('fechamento tardio repara job concluido sem fingerprint', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'late-close')
    const claimed = await reivindicarAutomacaoFalha(casa, { executorId: 'executor-late-close' })
    const path = caminhoDaAutomacaoFalhas(casa)
    const store = JSON.parse(await readFile(path, 'utf8'))
    store.jobs[0].state = 'completed'
    store.jobs[0].leaseUntil = null
    store.jobs[0].evidenceFingerprint = null
    await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8')

    const repaired = await concluirAutomacaoFalha(
      casa,
      claimed.job.id,
      'late-closing-evidence-id'
    )
    assert.equal(repaired.result, 'completed')
    assert.match(repaired.job.evidenceFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
