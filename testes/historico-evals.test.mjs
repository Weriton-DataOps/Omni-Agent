import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  caminhoDoHistoricoEval,
  compararRodadasEval,
  lerSuiteOmni,
  registrarRodadaEval
} from '../runtime/historico-evals.mjs'

const result = (caseId, score = 0.8, passed = true) => ({
  caseId,
  passed,
  score,
  latencyMs: 100,
  costUsd: 0.01,
  evidence: `evidencia verificavel para ${caseId}`
})

test('suite cobre o núcleo do Omni com pesos normalizados', async () => {
  const suite = await lerSuiteOmni()
  assert.equal(suite.target, 'omni')
  assert.equal(suite.cases.length, 21)
  assert.ok(Math.abs(suite.cases.reduce((sum, item) => sum + item.score.weight, 0) - 1) < 1e-9)
  assert.ok(suite.cases.some((item) => item.id === 'safety-boundaries'))
  for (const id of ['cognitive-continuity', 'specialist-boundary', 'skill-utility-and-fit']) {
    assert.ok(suite.cases.some((item) => item.id === id), `caso ausente: ${id}`)
  }
})

test('histórico guarda métricas e hash, nunca evidência bruta', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-evals-'))
  try {
    const recorded = await registrarRodadaEval(home, {
      changeId: 'mudanca-contexto-v1',
      label: 'linha de base',
      results: [result('conversation-personality')]
    })
    assert.equal(recorded.run.metrics.successRate, 1)
    const raw = await readFile(caminhoDoHistoricoEval(home), 'utf8')
    assert.doesNotMatch(raw, /evidencia verificavel/)
    assert.match(recorded.run.results[0].evidenceFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('comparação detecta melhoria e bloqueia regressão de segurança', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-evals-'))
  try {
    const before = await registrarRodadaEval(home, {
      changeId: 'antes', label: 'antes',
      results: [result('conversation-personality', 0.6), result('safety-boundaries', 1)]
    })
    const after = await registrarRodadaEval(home, {
      changeId: 'depois', label: 'depois',
      results: [result('conversation-personality', 0.9), result('safety-boundaries', 1)]
    })
    assert.equal((await compararRodadasEval(home, before.run.id, after.run.id)).result, 'improved')

    const unsafe = await registrarRodadaEval(home, {
      changeId: 'insegura', label: 'insegura',
      results: [result('conversation-personality', 1), result('safety-boundaries', 0, false)]
    })
    assert.equal((await compararRodadasEval(home, after.run.id, unsafe.run.id)).result, 'regressed')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('runtime recusa histórico produzido por schema futuro', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-evals-'))
  const path = caminhoDoHistoricoEval(home)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ schemaVersion: 99 }), 'utf8')
    await assert.rejects(registrarRodadaEval(home, {
      changeId: 'mudanca', label: 'rodada', results: [result('conversation-personality')]
    }), /mais novo/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
