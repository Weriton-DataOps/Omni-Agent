import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  observarVotoPersonalidade,
  registrarUltimaRespostaPersonalidade
} from '../runtime/feedback-personalidade.mjs'
import {
  executarRodadaPersonalidadeAutomatica,
  processarFilaEvalPersonalidade
} from '../runtime/executor-eval-personalidade.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'
import { lerAutomacaoMelhorias } from '../runtime/automacao-melhorias.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import { configurarRepositorioCanonico } from '../runtime/evolucao.mjs'

const pluginRoot = new URL('../', import.meta.url)
const rootPath = fileURLToPath(pluginRoot)
const HOUR = 60 * 60 * 1_000

function inicializarGit(repo) {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'omni-tests@example.invalid'],
    ['config', 'user.name', 'Omni Tests'],
    ['config', 'core.autocrlf', 'false'],
    ['add', '.'],
    ['commit', '-m', 'fixture baseline']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
}

function releasePreparada(capturedRuns = []) {
  return async ({ run }) => {
    capturedRuns.push(run)
    return { result: 'published-installed-verified', roundId: run.id }
  }
}

async function respostaControlada(request) {
  const payload = JSON.parse(request.prompt)
  if (request.kind === 'judge') {
    return {
      decisions: payload.cases.map((item) => ({ id: item.id, passed: true, reasonCode: 'criteria-met' }))
    }
  }
  const suite = JSON.parse(await readFile(new URL('contratos/eval/personalidade.json', pluginRoot), 'utf8'))
  const expected = new Map(suite.cases.map((item) => [item.id, item.esperado]))
  return {
    responses: payload.cases.map((item) => ({
      id: item.id,
      text: request.kind === 'candidate' ? expected.get(item.id) : 'Resposta neutra de controle.'
    }))
  }
}

test('executor controlado cobre baseline, candidata e juiz sem persistir respostas brutas', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-'))
  try {
    const result = await executarRodadaPersonalidadeAutomatica({
      casa,
      pluginRoot: rootPath,
      triggerFingerprint: 'a'.repeat(64),
      invoke: respostaControlada,
      at: '2026-08-29T12:00:00.000Z'
    })
    assert.equal(result.run.status, 'passed')
    assert.equal(result.run.trust.promotable, true)
    assert.equal(result.run.rawResponsesStored, false)
    assert.ok(result.run.gates.every((gate) => gate.passed))
    assert.equal(result.run.provenance.triggerFingerprint, 'a'.repeat(64))
    assert.equal(
      result.run.provenance.evaluatedPayloadFingerprint,
      (await calcularFingerprintPayload(rootPath)).fingerprint
    )
    assert.equal(result.run.judgeDiagnostics.length, 26)
    assert.ok(result.run.judgeDiagnostics.every((item) => item.reasonCode === 'criteria-met'))
    assert.ok(result.run.judgeDiagnostics.every((item) => /^[a-f0-9]{64}$/.test(item.reasonCodeHash)))
    const raw = await readFile(join(casa, 'evals', 'personality-history.json'), 'utf8')
    assert.doesNotMatch(raw, /Resposta neutra de controle/)
    assert.doesNotMatch(raw, /biblioteca sem catalogo/i)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('fila executa bootstrap uma vez e usa historico como idempotencia', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-queue-'))
  const root = rootPath
  let calls = 0
  const invoke = async (request) => {
    calls += 1
    return respostaControlada(request)
  }
  try {
    const first = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: root,
      invoke,
      prepareRelease: releasePreparada()
    })
    assert.equal(first.result, 'passed')
    assert.ok(calls > 0)
    const afterFirst = calls
    const second = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: root,
      invoke,
      prepareRelease: releasePreparada()
    })
    assert.equal(second.result, 'idle')
    assert.equal(calls, afterFirst)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('falha gera correcao canonica, respeita backoff e promove somente o ajuste retestado', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-correction-'))
  const t0 = Date.parse('2026-08-29T12:00:00.000Z')
  let judgeCalls = 0
  const capturedRuns = []
  const invoke = async (request) => {
    if (request.kind !== 'judge') return respostaControlada(request)
    judgeCalls += 1
    const payload = JSON.parse(request.prompt)
    return {
      decisions: payload.cases.map((item) => ({
        id: item.id,
        passed: judgeCalls > 1 || item.id !== 'voz-perceptivel-sem-piada',
        reasonCode: judgeCalls === 1 && item.id === 'voz-perceptivel-sem-piada'
          ? 'increase-distinctive-voice'
          : 'criteria-met'
      }))
    }
  }
  try {
    const first = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0,
      prepareRelease: releasePreparada(capturedRuns)
    })
    assert.equal(first.result, 'retry-scheduled')
    assert.deepEqual(first.correctionPlan.directiveIds, ['increase-distinctive-voice'])
    assert.equal(judgeCalls, 1)

    const duringBackoff = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0 + 30 * 60_000,
      prepareRelease: releasePreparada(capturedRuns)
    })
    assert.equal(duringBackoff.result, 'backoff')
    assert.equal(judgeCalls, 1)

    const corrected = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0 + HOUR + 1,
      prepareRelease: releasePreparada(capturedRuns)
    })
    assert.equal(corrected.result, 'passed')
    assert.equal(judgeCalls, 2)
    assert.equal(capturedRuns.length, 1)
    assert.deepEqual(capturedRuns[0].adjustments.directiveIds, ['increase-distinctive-voice'])

    const state = JSON.parse(await readFile(join(casa, 'evals', 'personality-automation.json'), 'utf8'))
    assert.equal(state.last.correction.attempts, 1)
    assert.equal(state.last.phase, 'completed')
    assert.equal(state.last.promotion, 'published-installed-verified')
    const persisted = await readFile(join(casa, 'evals', 'personality-history.json'), 'utf8')
    assert.doesNotMatch(persisted, /Resposta neutra de controle/)
    assert.doesNotMatch(persisted, /biblioteca sem catalogo/i)
    assert.match(persisted, /increase-distinctive-voice/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('uma correcao falha esgota a unica tentativa automatica sem loop', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-exhausted-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-auto-personality-exhausted-repo-'))
  const t0 = Date.parse('2026-08-29T12:00:00.000Z')
  let judgeCalls = 0
  const invoke = async (request) => {
    if (request.kind !== 'judge') return respostaControlada(request)
    judgeCalls += 1
    const payload = JSON.parse(request.prompt)
    return {
      decisions: payload.cases.map((item) => ({
        id: item.id,
        passed: item.id !== 'voz-perceptivel-sem-piada',
        reasonCode: item.id === 'voz-perceptivel-sem-piada'
          ? 'increase-distinctive-voice'
          : 'criteria-met'
      }))
    }
  }
  try {
    await writeFile(join(repo, 'package.json'), '{"name":"omni-agent","version":"0.0.0"}\n', 'utf8')
    inicializarGit(repo)
    await configurarRepositorioCanonico(casa, repo)
    const first = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0,
      prepareRelease: releasePreparada()
    })
    assert.equal(first.result, 'retry-scheduled')

    const second = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0 + HOUR + 1,
      prepareRelease: releasePreparada()
    })
    assert.equal(second.result, 'improvement-routed')
    assert.equal(judgeCalls, 2)
    assert.equal(second.operationalBridge.result, 'routed')

    const third = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0 + 24 * HOUR,
      prepareRelease: releasePreparada()
    })
    assert.equal(third.result, 'improvement-routed')
    assert.equal(judgeCalls, 2)
    const state = JSON.parse(await readFile(join(casa, 'evals', 'personality-automation.json'), 'utf8'))
    assert.equal(state.last.phase, 'correction-exhausted')
    assert.equal(state.last.correction.attempts, 1)
    assert.equal(state.last.operationalBridge.result, 'routed')
    assert.equal(state.last.operationalBridge.proposals.length, 1)
    assert.equal(state.last.operationalBridge.proposals[0].caseId, 'voz-perceptivel-sem-piada')
    assert.equal(state.last.operationalBridge.proposals[0].reasonCode, 'increase-distinctive-voice')
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.improvementCandidates.length, 1)
    assert.equal(cycle.improvementCandidates[0].status, 'implementation-required')
    assert.equal(cycle.improvementCandidates[0].occurrences, 2)
    assert.equal(cycle.improvementCandidates[0].sourceRefs.length, 2)
    assert.ok(cycle.improvementCandidates[0].sourceRefs.every((item) =>
      item.kind === 'personality-eval' &&
      /^[a-f0-9]{64}$/.test(item.evalRoundFingerprint) &&
      /^[a-f0-9]{64}$/.test(item.reasonCodeHash)
    ))
    const automation = await lerAutomacaoMelhorias(casa)
    assert.equal(automation.jobs.length, 1)
    assert.equal(automation.jobs[0].candidateId, cycle.improvementCandidates[0].id)
    assert.equal(automation.jobs[0].state, 'queued')
    const persisted = JSON.stringify({ state, cycle, automation })
    assert.doesNotMatch(persisted, /Resposta neutra de controle/)
    assert.doesNotMatch(persisted, /biblioteca sem catalogo/i)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('promocao nao concluida reabre com backoff sem repetir a rodada paga', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-promotion-retry-'))
  const t0 = Date.parse('2026-08-29T12:00:00.000Z')
  let modelCalls = 0
  let promotionCalls = 0
  const invoke = async (request) => {
    modelCalls += 1
    return respostaControlada(request)
  }
  const prepareRelease = async ({ run }) => {
    promotionCalls += 1
    if (promotionCalls === 1) return { result: 'source-repository-unconfigured', roundId: run.id }
    if (promotionCalls === 2) return { result: 'release-reverted', roundId: run.id }
    return { result: 'published-installed-verified', roundId: run.id }
  }
  try {
    const first = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0,
      prepareRelease
    })
    assert.equal(first.result, 'retry-scheduled')
    assert.equal(first.promotion.result, 'source-repository-unconfigured')
    const callsAfterEval = modelCalls
    const firstState = JSON.parse(await readFile(join(casa, 'evals', 'personality-automation.json'), 'utf8'))

    const reverted = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0 + HOUR + 1,
      prepareRelease
    })
    assert.equal(reverted.result, 'retry-scheduled')
    assert.equal(reverted.promotion.result, 'release-reverted')
    assert.equal(modelCalls, callsAfterEval)
    const secondState = JSON.parse(await readFile(join(casa, 'evals', 'personality-automation.json'), 'utf8'))
    assert.notEqual(secondState.last.strategyFingerprint, firstState.last.strategyFingerprint)

    const completed = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke,
      now: t0 + 2 * HOUR + 2,
      prepareRelease
    })
    assert.equal(completed.result, 'passed')
    assert.equal(completed.promotion.result, 'published-installed-verified')
    assert.equal(modelCalls, callsAfterEval)
    assert.equal(promotionCalls, 3)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('candidato positivo dispara eval e preserva o ajuste positivo testado', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-positive-'))
  const capturedRuns = []
  try {
    for (const [index, sessionId] of ['sessao-positiva-um', 'sessao-positiva-dois'].entries()) {
      await registrarUltimaRespostaPersonalidade(casa, {
        sessionId,
        answer: `Resposta privada ${index}`
      }, {
        pluginRoot: rootPath,
        at: `2026-08-29T12:0${index}:00.000Z`
      })
      const vote = await observarVotoPersonalidade(casa, {
        sessionId,
        origin: 'owner-live',
        feedback: 'O humor dessa resposta funcionou muito bem.'
      }, {
        pluginRoot: rootPath,
        at: `2026-08-29T12:0${index}:30.000Z`
      })
      assert.equal(vote.result, 'recorded')
    }

    const result = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: rootPath,
      invoke: respostaControlada,
      now: Date.parse('2026-08-29T13:00:00.000Z'),
      prepareRelease: releasePreparada(capturedRuns)
    })
    assert.equal(result.result, 'passed')
    assert.equal(capturedRuns.length, 1)
    assert.deepEqual(capturedRuns[0].adjustments.directiveIds, ['preserve-humor-level'])
    assert.equal(capturedRuns[0].adjustments.candidateIds.length, 1)
    const state = JSON.parse(await readFile(join(casa, 'evals', 'personality-automation.json'), 'utf8'))
    assert.equal(state.last.triggerKind, 'candidate')
    const raw = await readFile(join(casa, 'feedback', 'personality-feedback.json'), 'utf8')
    assert.doesNotMatch(raw, /Resposta privada/)
    assert.doesNotMatch(raw, /humor dessa resposta funcionou/i)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('mudanca de payload reabre a fila mesmo apos rodada promovida', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-payload-home-'))
  const fixture = await mkdtemp(join(tmpdir(), 'omni-auto-personality-payload-plugin-'))
  const copiedRoot = join(fixture, 'plugin')
  let calls = 0
  let promotions = 0
  let capturedError = null
  const invoke = async (request) => {
    calls += 1
    try {
      return await respostaControlada(request)
    } catch (error) {
      capturedError = error
      throw error
    }
  }
  try {
    await cp(rootPath, copiedRoot, {
      recursive: true,
      filter: (source) => !['.git', 'node_modules', '.codex-tmp'].includes(source.split(/[\\/]/).at(-1))
    })
    const prepareRelease = async ({ run }) => {
      try {
        promotions += 1
        await appendFile(
          join(copiedRoot, 'contratos', 'eval', 'resultados', 'README.md'),
          `\n<!-- simulated promotion ${promotions} -->\n`,
          'utf8'
        )
        const release = await calcularFingerprintPayload(copiedRoot)
        return {
          result: 'published-installed-verified',
          roundId: run.id,
          releaseFingerprint: release.fingerprint
        }
      } catch (error) {
        capturedError = error
        throw error
      }
    }
    const first = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: copiedRoot,
      invoke,
      now: Date.parse('2026-08-29T12:00:00.000Z'),
      prepareRelease
    })
    assert.equal(first.result, 'passed', capturedError?.stack ?? JSON.stringify(first))
    const afterFirst = calls

    const unchanged = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: copiedRoot,
      invoke,
      now: Date.parse('2026-08-29T12:05:00.000Z'),
      prepareRelease
    })
    assert.equal(unchanged.result, 'idle')
    assert.notEqual(unchanged.triggerFingerprint, first.triggerFingerprint)
    assert.equal(calls, afterFirst)
    assert.equal(promotions, 1)

    await appendFile(join(copiedRoot, 'contratos', 'personalidade', 'omni-persona-v3.md'), '\n<!-- payload test -->\n', 'utf8')
    const changed = await processarFilaEvalPersonalidade({
      casa,
      pluginRoot: copiedRoot,
      invoke,
      now: Date.parse('2026-08-29T12:10:00.000Z'),
      prepareRelease
    })
    assert.equal(changed.result, 'passed')
    assert.notEqual(changed.triggerFingerprint, first.triggerFingerprint)
    assert.ok(calls > afterFirst)
    assert.equal(promotions, 2)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(fixture, { recursive: true, force: true })
  }
})

test('mudanca da fonte durante as chamadas reprova a rodada antes de persistir ou promover', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-source-change-home-'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'omni-auto-personality-source-change-plugin-'))
  const copiedRoot = join(fixtureRoot, 'plugin')
  let calls = 0
  try {
    await cp(rootPath, copiedRoot, {
      recursive: true,
      filter: (source) => !['.git', 'node_modules', '.codex-tmp'].includes(source.split(/[\\/]/).at(-1))
    })
    const invoke = async (request) => {
      calls += 1
      if (calls === 1) {
        await appendFile(
          join(copiedRoot, 'contratos', 'personalidade', 'omni-persona-v3.md'),
          '\n<!-- alterado durante o eval -->\n',
          'utf8'
        )
      }
      return respostaControlada(request)
    }
    await assert.rejects(
      executarRodadaPersonalidadeAutomatica({
        casa,
        pluginRoot: copiedRoot,
        triggerFingerprint: 'd'.repeat(64),
        invoke,
        at: '2026-08-29T12:00:00.000Z'
      }),
      /fonte avaliada mudou durante as capturas/
    )
    assert.ok(calls > 0)
    await assert.rejects(
      readFile(join(casa, 'evals', 'personality-history.json')),
      (error) => error.code === 'ENOENT'
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('fila usa politica carregada separada da fonte canonica configurada', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-canonical-home-'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'omni-auto-personality-canonical-repo-'))
  const canonicalRoot = join(fixtureRoot, 'plugin')
  const marker = 'MARCADOR-FONTE-CANONICA-B'
  const capturedRuns = []
  let candidateSawCanonicalSource = false
  try {
    await cp(rootPath, canonicalRoot, {
      recursive: true,
      filter: (source) => !['.git', 'node_modules', '.codex-tmp'].includes(source.split(/[\\/]/).at(-1))
    })
    const personaPath = join(canonicalRoot, 'contratos', 'personalidade', 'omni-persona-v3.md')
    const personaRaw = await readFile(personaPath, 'utf8')
    await writeFile(
      personaPath,
      personaRaw.replace(
        'PERSONALIDADE omni-persona-v3-candidate.',
        `PERSONALIDADE omni-persona-v3-candidate.\n${marker}.`
      ),
      'utf8'
    )
    const payload = await calcularFingerprintPayload(canonicalRoot)
    const integrityPath = join(canonicalRoot, 'contratos', 'atualizacao', 'integridade.json')
    const integrity = JSON.parse(await readFile(integrityPath, 'utf8'))
    integrity.identity.releaseFingerprint = payload.fingerprint
    await writeFile(integrityPath, `${JSON.stringify(integrity, null, 2)}\n`, 'utf8')
    inicializarGit(canonicalRoot)
    await configurarRepositorioCanonico(casa, canonicalRoot)

    const invoke = async (request) => {
      if (request.kind === 'candidate') {
        candidateSawCanonicalSource ||= request.systemPrompt.includes(marker)
      }
      return respostaControlada(request)
    }
    const result = await processarFilaEvalPersonalidade({
      casa,
      policyRoot: rootPath,
      invoke,
      prepareRelease: releasePreparada(capturedRuns)
    })
    assert.equal(result.result, 'passed')
    assert.equal(candidateSawCanonicalSource, true)
    assert.equal(capturedRuns.length, 1)
    assert.equal(capturedRuns[0].provenance.evaluatedPayloadFingerprint, payload.fingerprint)
    assert.notEqual(
      capturedRuns[0].provenance.evaluatedPayloadFingerprint,
      (await calcularFingerprintPayload(rootPath)).fingerprint
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('fonte canonica suja entra em backoff sem consumir nenhuma chamada de modelo', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-auto-personality-dirty-source-home-'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'omni-auto-personality-dirty-source-repo-'))
  const canonicalRoot = join(fixtureRoot, 'plugin')
  let calls = 0
  try {
    await cp(rootPath, canonicalRoot, {
      recursive: true,
      filter: (source) => !['.git', 'node_modules', '.codex-tmp'].includes(source.split(/[\\/]/).at(-1))
    })
    const payload = await calcularFingerprintPayload(canonicalRoot)
    const integrityPath = join(canonicalRoot, 'contratos', 'atualizacao', 'integridade.json')
    const integrity = JSON.parse(await readFile(integrityPath, 'utf8'))
    integrity.identity.releaseFingerprint = payload.fingerprint
    await writeFile(integrityPath, `${JSON.stringify(integrity, null, 2)}\n`, 'utf8')
    inicializarGit(canonicalRoot)
    await configurarRepositorioCanonico(casa, canonicalRoot)
    await appendFile(join(canonicalRoot, 'runtime', 'personalidade.mjs'), '\n// alteracao ainda nao estabilizada\n', 'utf8')

    const result = await processarFilaEvalPersonalidade({
      casa,
      policyRoot: rootPath,
      invoke: async (request) => {
        calls += 1
        return respostaControlada(request)
      },
      prepareRelease: releasePreparada()
    })
    assert.equal(result.result, 'retry-scheduled')
    assert.equal(result.sourceStatus, 'repository-not-clean')
    assert.equal(calls, 0)
    const state = JSON.parse(await readFile(join(casa, 'evals', 'personality-automation.json'), 'utf8'))
    assert.equal(state.last.phase, 'source-retry')
    assert.equal(state.last.sourceStatus, 'repository-not-clean')
    assert.equal(state.last.rawResponsesStored, false)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
