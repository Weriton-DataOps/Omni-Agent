import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'

export const EVAL_HISTORY_SCHEMA_VERSION = 1
const SUITE_PATH = new URL('../contratos/eval/omni-core.json', import.meta.url)

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeText(value, label, minimum = 2, maximum = 200) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} precisa ter entre ${minimum} e ${maximum} caracteres.`)
  }
  if (pareceConterSegredo(text)) throw new Error(`${label} parece conter segredo.`)
  return text
}

export function caminhoDoHistoricoEval(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do histórico de evals precisa ser absoluta.')
  return join(casa, 'evals', 'history.json')
}

function emptyStore(createdAt = now()) {
  return {
    schemaVersion: EVAL_HISTORY_SCHEMA_VERSION,
    store: { id: 'omni-local-eval-history', createdAt, updatedAt: createdAt },
    runs: []
  }
}

export async function lerSuiteOmni() {
  const suite = JSON.parse(await readFile(SUITE_PATH, 'utf8'))
  const required = [
    'input', 'context', 'expectedBehavior', 'allowedBehavior', 'forbiddenBehavior',
    'successCriteria', 'evidence', 'score'
  ]
  if (
    suite?.schemaVersion !== 1 ||
    suite.suite !== 'omni-core-v1' ||
    suite.target !== 'omni' ||
    !Array.isArray(suite.cases) ||
    suite.cases.length === 0 ||
    new Set(suite.cases.map((item) => item.id)).size !== suite.cases.length ||
    !suite.cases.every((item) => required.every((field) => Object.hasOwn(item, field))) ||
    Math.abs(suite.cases.reduce((sum, item) => sum + item.score.weight, 0) - 1) > 1e-9
  ) {
    throw new Error('Suíte omni-core-v1 fora do contrato.')
  }
  return suite
}

function runValid(run, caseIds) {
  const structural = Boolean(
      run &&
      typeof run.id === 'string' &&
      run.id.startsWith('eval-run-') &&
      run.target === 'omni' &&
      run.suite === 'omni-core-v1' &&
      typeof run.changeId === 'string' &&
      typeof run.label === 'string' &&
      Number.isFinite(Date.parse(run.executedAt)) &&
      Array.isArray(run.results) &&
      run.results.length > 0 &&
      new Set(run.results.map((item) => item.caseId)).size === run.results.length &&
      run.results.every((item) =>
        caseIds.has(item.caseId) &&
        typeof item.passed === 'boolean' &&
        typeof item.score === 'number' && item.score >= 0 && item.score <= 1 &&
        typeof item.latencyMs === 'number' && item.latencyMs >= 0 &&
        typeof item.costUsd === 'number' && item.costUsd >= 0 &&
        typeof item.evidenceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(item.evidenceFingerprint)
      ) &&
      run.metrics &&
      Number.isInteger(run.metrics.sampleCount) && run.metrics.sampleCount > 0 &&
      typeof run.metrics.successRate === 'number' && run.metrics.successRate >= 0 && run.metrics.successRate <= 1 &&
      typeof run.metrics.averageScore === 'number' && run.metrics.averageScore >= 0 && run.metrics.averageScore <= 1 &&
      typeof run.metrics.averageLatencyMs === 'number' && run.metrics.averageLatencyMs >= 0 &&
      typeof run.metrics.totalCostUsd === 'number' && run.metrics.totalCostUsd >= 0
  )
  if (!structural) return false
  const expected = metrics(run.results)
  return Object.entries(expected).every(([key, value]) => Math.abs(run.metrics[key] - value) < 1e-9)
}

function validateStore(store, path, caseIds) {
  if (
    store?.schemaVersion !== EVAL_HISTORY_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-eval-history' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !Array.isArray(store.runs) ||
    !store.runs.every((run) => runValid(run, caseIds))
  ) {
    throw new Error(`Histórico de evals fora do contrato v1: ${path}`)
  }
}

async function acquireLock(casa) {
  const directory = join(casa, 'evals')
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'history.lock')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      return async () => {
        await handle.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 10_000) await unlink(lockPath).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('O histórico de evals está ocupado por outra escrita.')
}

async function load(casa, caseIds) {
  const path = caminhoDoHistoricoEval(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > EVAL_HISTORY_SCHEMA_VERSION) {
      throw new Error(`Histórico de evals v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validateStore(store, path, caseIds)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: emptyStore(), initialized: true }
    throw error
  }
}

async function save(casa, store, caseIds) {
  const path = caminhoDoHistoricoEval(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  validateStore(store, path, caseIds)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function metrics(results) {
  const sampleCount = results.length
  return {
    sampleCount,
    successRate: results.filter((item) => item.passed).length / sampleCount,
    averageScore: results.reduce((sum, item) => sum + item.score, 0) / sampleCount,
    averageLatencyMs: results.reduce((sum, item) => sum + item.latencyMs, 0) / sampleCount,
    totalCostUsd: results.reduce((sum, item) => sum + item.costUsd, 0)
  }
}

export async function lerHistoricoEval(casa) {
  const suite = await lerSuiteOmni()
  const caseIds = new Set(suite.cases.map((item) => item.id))
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, caseIds)
    if (loaded.initialized) await save(casa, loaded.store, caseIds)
    return loaded.store
  } finally {
    await release()
  }
}

export async function registrarRodadaEval(casa, input, { at } = {}) {
  const suite = await lerSuiteOmni()
  const cases = new Map(suite.cases.map((item) => [item.id, item]))
  const changeId = safeText(input?.changeId, 'Identificador da mudança')
  const label = safeText(input?.label, 'Rótulo da rodada')
  if (!Array.isArray(input?.results) || input.results.length === 0) {
    throw new Error('A rodada precisa conter ao menos um resultado.')
  }
  const seen = new Set()
  const results = input.results.map((item) => {
    if (!cases.has(item?.caseId) || seen.has(item.caseId)) throw new Error('Caso de eval inválido ou duplicado.')
    seen.add(item.caseId)
    if (typeof item.passed !== 'boolean') throw new Error('Resultado de eval precisa declarar passed.')
    if (typeof item.score !== 'number' || item.score < 0 || item.score > 1) throw new Error('Score de eval inválido.')
    if (!Number.isFinite(item.latencyMs) || item.latencyMs < 0) throw new Error('Latência de eval inválida.')
    if (!Number.isFinite(item.costUsd) || item.costUsd < 0) throw new Error('Custo de eval inválido.')
    const evidence = safeText(item.evidence, 'Evidência do eval', 3, 500)
    return {
      caseId: item.caseId,
      passed: item.passed,
      score: item.score,
      latencyMs: item.latencyMs,
      costUsd: item.costUsd,
      evidenceFingerprint: hash(evidence)
    }
  })
  const executedAt = now(at)
  const run = {
    id: `eval-run-${randomUUID()}`,
    target: 'omni',
    suite: suite.suite,
    changeId,
    label,
    executedAt,
    results,
    metrics: metrics(results)
  }
  const caseIds = new Set(cases.keys())
  const release = await acquireLock(casa)
  try {
    const loaded = await load(casa, caseIds)
    loaded.store.runs.push(run)
    await save(casa, loaded.store, caseIds)
    return { result: 'recorded', run }
  } finally {
    await release()
  }
}

export async function compararRodadasEval(casa, beforeId, afterId) {
  const store = await lerHistoricoEval(casa)
  const before = store.runs.find((run) => run.id === beforeId)
  const after = store.runs.find((run) => run.id === afterId)
  if (!before || !after) return { result: 'not-found', comparison: null }
  const beforeCases = [...before.results.map((item) => item.caseId)].sort()
  const afterCases = [...after.results.map((item) => item.caseId)].sort()
  const sameCases = JSON.stringify(beforeCases) === JSON.stringify(afterCases)
  const safetyBefore = before.results.find((item) => item.caseId === 'safety-boundaries')
  const safetyAfter = after.results.find((item) => item.caseId === 'safety-boundaries')
  const gates = [
    { id: 'same-case-set', passed: sameCases },
    { id: 'success-rate-not-lower', passed: after.metrics.successRate >= before.metrics.successRate },
    { id: 'average-score-not-lower', passed: after.metrics.averageScore >= before.metrics.averageScore },
    { id: 'safety-not-regressed', passed: !safetyBefore || !safetyBefore.passed || safetyAfter?.passed === true }
  ]
  const qualityImproved =
    after.metrics.successRate > before.metrics.successRate ||
    after.metrics.averageScore > before.metrics.averageScore
  const efficiencyImproved =
    after.metrics.averageLatencyMs < before.metrics.averageLatencyMs ||
    after.metrics.totalCostUsd < before.metrics.totalCostUsd
  const passed = gates.every((gate) => gate.passed)
  return {
    result: !passed ? 'regressed' : qualityImproved || efficiencyImproved ? 'improved' : 'stable',
    comparison: {
      beforeId,
      afterId,
      gates,
      delta: {
        successRate: after.metrics.successRate - before.metrics.successRate,
        averageScore: after.metrics.averageScore - before.metrics.averageScore,
        averageLatencyMs: after.metrics.averageLatencyMs - before.metrics.averageLatencyMs,
        totalCostUsd: after.metrics.totalCostUsd - before.metrics.totalCostUsd
      }
    }
  }
}
