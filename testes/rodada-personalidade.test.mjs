import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  avaliarRodadaPersonalidade,
  criarEvidenciaPromocao,
  criarPlanoRodadaPersonalidade,
  lerHistoricoPersonalidade,
  registrarRodadaPersonalidade
} from '../runtime/rodada-personalidade.mjs'

const sourceRoot = new URL('../', import.meta.url)
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)

async function fixture() {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'omni-personality-round-plugin-'))
  const evalDir = join(pluginRoot, 'contratos', 'eval')
  const personalityDir = join(pluginRoot, 'contratos', 'personalidade')
  await mkdir(evalDir, { recursive: true })
  await mkdir(personalityDir, { recursive: true })
  await writeFile(
    join(evalDir, 'personalidade.json'),
    await readFile(new URL('contratos/eval/personalidade.json', sourceRoot), 'utf8'),
    'utf8'
  )
  await writeFile(join(evalDir, 'casos-aprendidos.json'), `${JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-learned-eval-cases-v1',
    cases: []
  }, null, 2)}\n`, 'utf8')
  await writeFile(
    join(personalityDir, 'manifest.json'),
    await readFile(new URL('contratos/personalidade/manifest.json', sourceRoot), 'utf8'),
    'utf8'
  )
  return pluginRoot
}

function responseFor(testCase) {
  return testCase.esperado
}

function provenance() {
  return {
    source: 'controlled-test-capture',
    provider: 'provider-test',
    model: 'same-model',
    modelVersion: 'same-version',
    settingsFingerprint: HASH_A,
    baselineSessionFingerprint: HASH_B,
    candidateSessionFingerprint: HASH_C,
    baselineReceiptFingerprint: HASH_D,
    candidateReceiptFingerprint: HASH_E,
    baselineOmniInjected: false,
    candidateOmniInjected: true
  }
}

test('plano aponta a v3 ativa, a baseline controlada e cobre os candidatos aprendidos', async () => {
  const plan = await criarPlanoRodadaPersonalidade()
  assert.equal(plan.candidate, 'omni-persona-v3-candidate')
  assert.equal(plan.baseline, 'controle-mesmo-modelo-sem-omni')
  assert.equal(plan.baselineProtocol.kind, 'same-model-without-omni-context')
  assert.equal(plan.cases.length, 26)
  assert.ok(plan.cases.some((item) => item.id === 'identidade-nao-apaga-sob-carga'))
  assert.ok(plan.cases.some((item) => item.id === 'relatorio-fecha-com-estado-e-evidencia'))
  assert.ok(plan.cases.some((item) => item.id === 'didatica-com-modelo-mental-e-analogia'))
  assert.ok(plan.cases.some((item) => item.id === 'fidelidade-ao-pedido-sem-expansao'))
  assert.deepEqual(plan.pendingLearnedCandidates, [])
  assert.equal(
    plan.learnedCandidates.find((item) => item.id === 'improvement-7998c0fb-4167-4d47-83db-a987fa6a0d82').state,
    'covered-by-canonical-case'
  )
  assert.equal(
    plan.learnedCandidates.find((item) => item.id === 'improvement-0ac4a466-8d86-493e-954a-7cc8903ae9c3').state,
    'covered-by-canonical-case'
  )
  assert.equal(plan.performsModelCalls, false)
})

test('rodada registra resultados e autoavaliacao como alegacao nao autenticada', async () => {
  const pluginRoot = await fixture()
  const casa = await mkdtemp(join(tmpdir(), 'omni-personality-round-home-'))
  try {
    const plan = await criarPlanoRodadaPersonalidade({ pluginRoot })
    const baselineResponses = Object.fromEntries(plan.cases.map((item) => [item.id, 'x']))
    const candidateResponses = Object.fromEntries(plan.cases.map((item) => [item.id, responseFor(item)]))
    const decisions = Object.fromEntries(plan.cases.map((item) => [item.id, true]))
    const input = {
      pluginRoot,
      roundId: 'personality-run-test',
      baselineResponses,
      candidateResponses,
      humanReview: {
        reviewer: 'owner',
        decisions,
        attestationFingerprint: HASH_A,
        attestedAt: '2026-08-28T11:59:00.000Z'
      },
      provenance: provenance(),
      at: '2026-08-28T12:00:00.000Z'
    }
    const evaluated = await avaliarRodadaPersonalidade(input)
    assert.equal(evaluated.status, 'unverified-claim')
    assert.equal(evaluated.metrics.cases, 26)
    assert.equal(evaluated.metrics.candidateScore, 1)
    assert.equal(evaluated.rawResponsesStored, false)
    assert.notEqual(evaluated.responseSets.baselineSha256, evaluated.responseSets.candidateSha256)
    assert.doesNotMatch(JSON.stringify(evaluated), /estante com catalogo/)
    assert.equal(evaluated.ownerReviewClaim.authenticated, false)
    assert.equal(evaluated.ownerReviewClaim.internallyVerified, false)
    assert.equal(evaluated.ownerReviewClaim.receiptFingerprint, HASH_A)
    assert.match(evaluated.ownerReviewClaim.bindingFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(evaluated.gates.find((item) => item.id === 'receipt-claims-distinct-and-explicitly-bound').passed, true)
    assert.equal(evaluated.trust.captureReceiptClaims.length, 2)
    assert.ok(evaluated.trust.captureReceiptClaims.every((item) => item.internallyVerified === false))
    assert.ok(evaluated.trust.captureReceiptClaims.every((item) => /^[a-f0-9]{64}$/.test(item.bindingFingerprint)))
    assert.equal(new Set([
      ...evaluated.trust.captureReceiptClaims.map((item) => item.receiptFingerprint),
      evaluated.ownerReviewClaim.receiptFingerprint
    ]).size, 3)
    assert.equal(evaluated.gates.find((item) => item.id === 'review-produced-by-verifiable-local-authority').passed, false)
    assert.throws(() => criarEvidenciaPromocao(evaluated), /Promocao bloqueada/)

    const recorded = await registrarRodadaPersonalidade(casa, input)
    assert.equal(recorded.run.status, 'unverified-claim')
    const history = await lerHistoricoPersonalidade(casa)
    assert.equal(history.runs.length, 1)
    assert.equal(history.runs[0].id, 'personality-run-test')
    assert.doesNotMatch(JSON.stringify(history), /estante com catalogo/)
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
    await rm(casa, { recursive: true, force: true })
  }
})

test('recibos alegados iguais nao provam duas capturas distintas', async () => {
  const plan = await criarPlanoRodadaPersonalidade()
  const responses = Object.fromEntries(plan.cases.map((item) => [item.id, responseFor(item)]))
  const decisions = Object.fromEntries(plan.cases.map((item) => [item.id, true]))
  const run = await avaliarRodadaPersonalidade({
    roundId: 'personality-run-repeated-claim',
    baselineResponses: responses,
    candidateResponses: responses,
    humanReview: {
      reviewer: 'owner',
      decisions,
      attestationFingerprint: HASH_A,
      attestedAt: '2026-08-28T11:59:00.000Z'
    },
    provenance: {
      ...provenance(),
      baselineReceiptFingerprint: HASH_D,
      candidateReceiptFingerprint: HASH_D
    }
  })
  assert.equal(run.status, 'unverified-claim')
  assert.equal(run.gates.find((item) => item.id === 'receipt-claims-distinct-and-explicitly-bound').passed, false)
  assert.equal(run.trust.promotable, false)
})

test('historico passed de personalidade e rebaixado sem revalidacao interna', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-personality-legacy-home-'))
  try {
    await mkdir(join(casa, 'evals'), { recursive: true })
    await writeFile(join(casa, 'evals', 'personality-history.json'), `${JSON.stringify({
      schemaVersion: 1,
      store: {
        id: 'omni-local-personality-evals',
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z'
      },
      runs: [{ id: 'legacy-self-asserted', status: 'passed', trust: { promotable: true } }]
    })}\n`, 'utf8')
    const history = await lerHistoricoPersonalidade(casa)
    assert.equal(history.runs[0].status, 'unverified-legacy-claim')
    assert.equal(history.runs[0].trust.promotable, false)
    assert.equal(history.runs[0].trust.migratedAsTrusted, false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('promocao e recusada com revisao parcial e sem prova externa', async () => {
  const plan = await criarPlanoRodadaPersonalidade()
  const responses = Object.fromEntries(plan.cases.map((item) => [item.id, responseFor(item)]))
  const decisions = Object.fromEntries(plan.cases.map((item) => [item.id, true]))
  delete decisions[plan.cases[0].id]
  const run = await avaliarRodadaPersonalidade({
    roundId: 'personality-run-blocked',
    baselineResponses: responses,
    candidateResponses: responses,
    humanReview: {
      reviewer: 'owner',
      decisions,
      attestationFingerprint: HASH_A,
      attestedAt: '2026-08-28T11:59:00.000Z'
    },
    provenance: provenance()
  })
  assert.equal(run.status, 'unverified-claim')
  assert.equal(run.gates.find((item) => item.id === 'learned-candidates-resolved').passed, true)
  assert.equal(run.gates.find((item) => item.id === 'owner-review-claim-complete').passed, false)
  assert.throws(() => criarEvidenciaPromocao(run), /Promocao bloqueada/)
})
