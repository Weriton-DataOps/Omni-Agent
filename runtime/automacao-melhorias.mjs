import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  atualizarDelegacao,
  lerCicloOperacional,
  verificarEFecharDelegacaoImplementacao
} from './ciclo-operacional.mjs'
import {
  lerRepositorioCanonico,
  materializarMelhoriaConfigurada,
  registrarImplementacaoOperacional,
  registrarReadbackOperacionalInstalado
} from './evolucao.mjs'
import { verificarIntegridadeRelease } from './integridade-release.mjs'
import { criarSolicitacaoDelegacao } from './porta-delegacao.mjs'
import {
  capturarBaselineReleaseOperacional,
  prepararReleaseAutonomaOperacional,
  recuperarBaselineReleaseOperacionalLegado
} from './release-autonoma.mjs'

const CONTRACT_PATH = new URL('../contratos/operacao/automacao-melhorias.json', import.meta.url)
const SCHEMA_VERSION = 1
const STATES = new Set([
  'baseline-captured',
  'queued',
  'dispatch-required',
  'running',
  'reported-unverified',
  'awaiting-release',
  'completed'
])
const HASH = /^[a-f0-9]{64}$/
const PORTABLE_ARTIFACT = /^(?:contratos|hooks|runtime|scripts|skills)\/[A-Za-z0-9._/-]+$/
const GIT_SHA = /^[a-f0-9]{40,64}$/
const BASELINE_CONTRACT = 'omni-operational-release-baseline-v1'
const RAIZ_CARREGADA = fileURLToPath(new URL('../', import.meta.url))
const SERIAL_PIPELINE_STATES = new Set([
  'baseline-captured',
  'queued',
  'dispatch-required',
  'running',
  'reported-unverified',
  'awaiting-release'
])

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function dataValida(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

async function contrato() {
  const value = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-operational-improvement-automation-v1' ||
    !Array.isArray(value.states) ||
    value.states.some((item) => !STATES.has(item)) ||
    value.retry?.baseSeconds !== 600 ||
    value.retry?.maximumSeconds !== 3600 ||
    value.retry?.neverTerminalForTransientFailure !== true ||
    value.retry?.requiresDifferentDelegationGeneration !== true ||
    value.execution?.authorityMode !== 'standing-self-correction' ||
    value.execution?.destinationCapability !== 'omni-self-correction' ||
    value.execution?.sourceRepository !== 'configured-canonical-omni-repository-only' ||
    value.execution?.dispatchThrough !== 'omni-neutral-delegation-v1' ||
    value.execution?.requiresRealStartedEvent !== true ||
    value.execution?.requiresCleanGitBaselineBeforeDispatch !== true ||
    value.execution?.baselineContract !== BASELINE_CONTRACT ||
    value.execution?.repositorySerialization !== 'one-candidate-until-installed-or-superseded' ||
    value.execution?.legacyBaselineRecovery?.installedReadbackFirst !== true ||
    value.execution?.legacyBaselineRecovery?.recoverOnlySingleAuditedArtifact !== true ||
    value.execution?.legacyBaselineRecovery?.unprovableDisposition !== 'legacy-unrecoverable-without-blind-release-retry' ||
    value.execution?.baselineDivergence !== 'recapture-only-when-single-audited-artifact-remains' ||
    value.execution?.implementationReceiptMarker !== 'OMNI_IMPLEMENTATION_RECEIPT' ||
    value.execution?.requiresAuditedMutationAndReadback !== true ||
    value.execution?.requiresRegressionGates !== true ||
    value.execution?.releaseThrough !== 'omni-autonomous-operational-release' ||
    value.execution?.releaseRetryForward !== true ||
    value.execution?.completionState !== 'installed-verified' ||
    Object.values(value.privacy ?? {}).some((item) => item !== false)
  ) throw new Error('Contrato de automacao de melhorias fora da versao 1.')
  return value
}

function vazio(at = agora()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    store: { id: 'omni-local-operational-improvement-automation', createdAt: at, updatedAt: at },
    jobs: []
  }
}

function jobValido(job) {
  return Boolean(
    job &&
    typeof job.id === 'string' && job.id.startsWith('improvement-job-') &&
    typeof job.candidateId === 'string' && job.candidateId.startsWith('improvement-') &&
    HASH.test(job.candidateFingerprint ?? '') &&
    HASH.test(job.targetFingerprint ?? '') &&
    STATES.has(job.state) &&
    Number.isInteger(job.generation) && job.generation >= 1 &&
    Number.isInteger(job.attempts) && job.attempts >= 0 &&
    (job.delegationId === null || /^delegation-/.test(job.delegationId)) &&
    (job.dispatchSessionFingerprint === null || HASH.test(job.dispatchSessionFingerprint)) &&
    (job.executorFingerprint === null || HASH.test(job.executorFingerprint)) &&
    (job.reasonFingerprint === null || HASH.test(job.reasonFingerprint)) &&
    (job.retryAt === null || dataValida(job.retryAt)) &&
    (job.baselineRepositoryFingerprint === null || HASH.test(job.baselineRepositoryFingerprint)) &&
    (job.baselineCommitSha === null || GIT_SHA.test(job.baselineCommitSha)) &&
    (job.baselineBranchFingerprint === null || HASH.test(job.baselineBranchFingerprint)) &&
    (job.baselineStatusFingerprint === null || HASH.test(job.baselineStatusFingerprint)) &&
    (job.baselineCapturedAt === null || dataValida(job.baselineCapturedAt)) &&
    (job.artifactFingerprint === null || HASH.test(job.artifactFingerprint)) &&
    (job.implementationReceiptFingerprint === null || HASH.test(job.implementationReceiptFingerprint)) &&
    Number.isInteger(job.releaseAttempts) && job.releaseAttempts >= 0 &&
    (job.releaseRetryAt === null || dataValida(job.releaseRetryAt)) &&
    dataValida(job.createdAt) && dataValida(job.updatedAt)
  )
}

function validarStore(store, path) {
  if (
    store?.schemaVersion !== SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-operational-improvement-automation' ||
    !dataValida(store.store?.createdAt) ||
    !dataValida(store.store?.updatedAt) ||
    !Array.isArray(store.jobs) ||
    !store.jobs.every(jobValido)
  ) throw new Error(`Automacao de melhorias fora do contrato v1: ${path}`)
}

export function caminhoDaAutomacaoMelhorias(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'runs', 'operational-improvement-automation.json')
}

async function adquirirTrava(casa) {
  const path = join(casa, 'runs', 'operational-improvement-automation.lock')
  await mkdir(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(path).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 120_000) await unlink(path).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    }
  }
  throw new Error('Automacao de melhorias ocupada por outra escrita.')
}

async function ler(casa) {
  const path = caminhoDaAutomacaoMelhorias(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    store.jobs = (store.jobs ?? []).map((job) => ({
      ...job,
      baselineRepositoryFingerprint: job.baselineRepositoryFingerprint ?? null,
      baselineCommitSha: job.baselineCommitSha ?? null,
      baselineBranchFingerprint: job.baselineBranchFingerprint ?? null,
      baselineStatusFingerprint: job.baselineStatusFingerprint ?? null,
      baselineCapturedAt: job.baselineCapturedAt ?? null,
      artifactFingerprint: job.artifactFingerprint ?? null,
      implementationReceiptFingerprint: job.implementationReceiptFingerprint ?? null,
      releaseAttempts: job.releaseAttempts ?? 0,
      releaseRetryAt: job.releaseRetryAt ?? null
    }))
    validarStore(store, path)
    return store
  } catch (error) {
    if (error?.code === 'ENOENT') return vazio()
    throw error
  }
}

async function alterar(casa, mutate) {
  const policy = await contrato()
  const release = await adquirirTrava(casa)
  try {
    const store = await ler(casa)
    const result = await mutate(store, policy)
    store.store.updatedAt = agora()
    validarStore(store, caminhoDaAutomacaoMelhorias(casa))
    const path = caminhoDaAutomacaoMelhorias(casa)
    const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
    return result
  } finally {
    await release()
  }
}

export async function lerAutomacaoMelhorias(casa) {
  return alterar(casa, (store) => store)
}

function proximoRetry(job, policy, timestamp) {
  const delay = Math.min(
    policy.retry.maximumSeconds,
    policy.retry.baseSeconds * (2 ** Math.min(3, Math.max(0, job.generation - 1)))
  )
  return new Date(Date.parse(timestamp) + delay * 1000).toISOString()
}

export async function sincronizarAutomacaoMelhorias(casa, { at } = {}) {
  const timestamp = agora(at)
  const cycle = await lerCicloOperacional(casa)
  const candidates = new Map((cycle.improvementCandidates ?? []).map((item) => [item.id, item]))
  const delegations = new Map((cycle.delegations ?? []).map((item) => [item.id, item]))
  return alterar(casa, (store, policy) => {
    for (const candidate of candidates.values()) {
      if (!['implementation-required', 'materialized-pending-release'].includes(candidate.status)) continue
      if (!store.jobs.some((item) => item.candidateId === candidate.id && item.state !== 'completed')) {
        store.jobs.push({
          id: `improvement-job-${randomUUID()}`,
          candidateId: candidate.id,
          candidateFingerprint: candidate.fingerprint,
          targetFingerprint: hash(candidate.artifact),
          state: candidate.status === 'implementation-required' ? 'queued' : 'awaiting-release',
          generation: 1,
          attempts: 0,
          delegationId: null,
          dispatchSessionFingerprint: null,
          executorFingerprint: null,
          reasonFingerprint: null,
          retryAt: null,
          baselineRepositoryFingerprint: null,
          baselineCommitSha: null,
          baselineBranchFingerprint: null,
          baselineStatusFingerprint: null,
          baselineCapturedAt: null,
          artifactFingerprint: null,
          implementationReceiptFingerprint: null,
          releaseAttempts: 0,
          releaseRetryAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      }
    }

    for (const job of store.jobs) {
      const candidate = candidates.get(job.candidateId)
      if (!candidate) continue
      if (candidate.status === 'installed-verified' || candidate.status === 'superseded') {
        job.state = 'completed'
        job.retryAt = null
        job.releaseRetryAt = null
        job.reasonFingerprint = null
      } else if (candidate.status === 'materialized-pending-release') {
        job.state = 'awaiting-release'
        job.retryAt = null
        job.artifactFingerprint = candidate.artifactRef?.contentFingerprint ??
          candidate.artifactRef?.semanticFingerprint ?? null
        job.implementationReceiptFingerprint = candidate.artifactRef?.implementationReceipt
          ? hash(JSON.stringify(candidate.artifactRef.implementationReceipt))
          : null
      } else if (candidate.status === 'implementation-required' && job.state === 'baseline-captured') {
        job.state = 'queued'
      } else if (candidate.status === 'implementation-required' && job.delegationId) {
        const delegation = delegations.get(job.delegationId)
        if (delegation?.state === 'running') job.state = 'running'
        if (delegation?.state === 'reported' && job.state !== 'reported-unverified') {
          job.state = 'reported-unverified'
          job.retryAt = proximoRetry(job, policy, timestamp)
          job.reasonFingerprint = hash('reported-without-verified-implementation-receipt')
        }
        if (['blocked', 'failed', 'cancelled'].includes(delegation?.state)) {
          if (job.retryAt === null) job.retryAt = proximoRetry(job, policy, timestamp)
          job.reasonFingerprint = hash(`delegation-${delegation.state}`)
        }
        if (
          job.retryAt &&
          Date.parse(job.retryAt) <= Date.parse(timestamp) &&
          ['reported-unverified', 'blocked', 'failed', 'cancelled'].includes(
            delegation?.state === 'reported' ? job.state : delegation?.state
          )
        ) {
          job.state = 'queued'
          job.generation += 1
          job.delegationId = null
          job.dispatchSessionFingerprint = null
          job.executorFingerprint = null
          job.retryAt = null
        }
      }
      job.updatedAt = timestamp
    }
    return store
  })
}

export async function materializarMelhoriaComBaselineConfigurada(casa, candidateId, {
  at,
  captureBaseline = capturarBaselineReleaseOperacional,
  materialize = materializarMelhoriaConfigurada
} = {}) {
  const timestamp = agora(at)
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) =>
    item.id === candidateId && item.status === 'ready'
  )
  if (!candidate) return { result: 'not-ready', candidateId }
  const automation = await lerAutomacaoMelhorias(casa)
  const pipelineOwner = automation.jobs
    .filter((item) => item.candidateId !== candidateId && SERIAL_PIPELINE_STATES.has(item.state))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
  if (pipelineOwner) {
    return {
      result: 'pipeline-busy',
      candidateId,
      ownerJobFingerprint: hash(pipelineOwner.id)
    }
  }
  const configuration = await lerRepositorioCanonico(casa)
  if (configuration.status !== 'configured') return { result: 'unconfigured', candidateId }
  const captured = await captureBaseline({
    casa,
    sourceRepository: configuration.sourceRepository,
    at: timestamp
  })
  if (captured.result !== 'captured') return { ...captured, candidateId }
  await alterar(casa, (store) => {
    let job = store.jobs.find((item) => item.candidateId === candidateId && item.state !== 'completed')
    if (!job) {
      job = {
        id: `improvement-job-${randomUUID()}`,
        candidateId,
        candidateFingerprint: candidate.fingerprint,
        targetFingerprint: hash(candidate.destination),
        state: 'baseline-captured',
        generation: 1,
        attempts: 0,
        delegationId: null,
        dispatchSessionFingerprint: null,
        executorFingerprint: null,
        reasonFingerprint: null,
        retryAt: null,
        baselineRepositoryFingerprint: null,
        baselineCommitSha: null,
        baselineBranchFingerprint: null,
        baselineStatusFingerprint: null,
        baselineCapturedAt: null,
        artifactFingerprint: null,
        implementationReceiptFingerprint: null,
        releaseAttempts: 0,
        releaseRetryAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      store.jobs.push(job)
    }
    if (job.candidateFingerprint !== candidate.fingerprint) {
      throw new Error('Baseline pertence a outra geracao da candidata operacional.')
    }
    job.baselineRepositoryFingerprint = captured.baseline.repositoryFingerprint
    job.baselineCommitSha = captured.baseline.commitSha
    job.baselineBranchFingerprint = captured.baseline.branchFingerprint
    job.baselineStatusFingerprint = captured.baseline.statusFingerprint
    job.baselineCapturedAt = captured.baseline.capturedAt
    job.reasonFingerprint = null
    job.updatedAt = timestamp
    return job
  })
  const result = await materialize(casa, candidateId)
  await sincronizarAutomacaoMelhorias(casa, { at: timestamp })
  return result
}

function promptExecucao(candidate, marker) {
  return [
    `Implemente a autocorrecao operacional ${candidate.id} no repositorio canonico configurado do Omni.`,
    `Objetivo aprendido: ${candidate.statement}`,
    `Alvo inicial: ${candidate.artifact}. Localize o menor arquivo correto dentro desse limite.`,
    'Antes de alterar, registre checkpoint recuperavel. Nao expanda objetivo, privilegio, segredo, custo ou alvo.',
    'Implemente a menor mudanca reversivel, rode teste focal, suite completa e leia novamente o artefato alterado.',
    'Nao publique nem instale nesta delegacao; a release autonoma so assume depois do recibo auditado.',
    `Na ultima linha, devolva ${marker} {"candidateId":"${candidate.id}","artifact":"caminho/portatil/do/arquivo"}`
  ].join('\n')
}

export async function prepararDespachoAutomaticoMelhoria(casa, {
  sessionId = 'session-unknown'
} = {}, { at } = {}) {
  const policy = await contrato()
  await sincronizarAutomacaoMelhorias(casa, { at })
  const configuration = await lerRepositorioCanonico(casa)
  if (configuration.status !== 'configured') return { result: 'source-repository-unconfigured', job: null }
  const store = await lerAutomacaoMelhorias(casa)
  const pipeline = store.jobs
    .filter((item) => SERIAL_PIPELINE_STATES.has(item.state))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  const job = pipeline[0]
  if (!job) return { result: 'idle', job: null }
  if (job.state !== 'queued') return { result: 'pipeline-busy', job: null }
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) =>
    item.id === job.candidateId && item.status === 'implementation-required'
  )
  if (!candidate) return { result: 'stale', job: null }
  const captured = await capturarBaselineReleaseOperacional({
    casa,
    sourceRepository: configuration.sourceRepository,
    at
  })
  if (captured.result !== 'captured') {
    await alterar(casa, (latest) => {
      const current = latest.jobs.find((item) => item.id === job.id)
      if (current) {
        current.reasonFingerprint = hash(`baseline:${captured.result}:${captured.statusFingerprint ?? 'none'}`)
        current.updatedAt = agora(at)
      }
      return current
    })
    return { result: captured.result, job: null }
  }
  await alterar(casa, (latest) => {
    const current = latest.jobs.find((item) => item.id === job.id)
    if (!current || current.state !== 'queued') throw new Error('Trabalho mudou durante a captura do baseline.')
    current.baselineRepositoryFingerprint = captured.baseline.repositoryFingerprint
    current.baselineCommitSha = captured.baseline.commitSha
    current.baselineBranchFingerprint = captured.baseline.branchFingerprint
    current.baselineStatusFingerprint = captured.baseline.statusFingerprint
    current.baselineCapturedAt = captured.baseline.capturedAt
    current.updatedAt = agora(at)
    return current
  })
  const prompt = promptExecucao(candidate, policy.execution.implementationReceiptMarker)
  const dispatch = await criarSolicitacaoDelegacao(casa, {
    sessionId,
    idempotencyKey: `operational-improvement:${candidate.id}:${job.generation}`,
    destinationCapability: policy.execution.destinationCapability,
    authorityMode: policy.execution.authorityMode,
    brief: {
      objective: `Implementar autocorrecao operacional ${candidate.id}`,
      scope: [`candidate:${candidate.id}`, `target-fingerprint:${job.targetFingerprint}`],
      constraints: [
        'somente repositorio canonico configurado do Omni',
        'mudanca reversivel sem segredos privilegios custos ou expansao de objetivo',
        'publicacao e instalacao ficam para o ciclo de release'
      ],
      successCriteria: [
        'mutacao auditada no menor artefato correto',
        'readback posterior do mesmo artefato',
        'testes focais e suite completa verdes',
        'recibo estruturado com caminho portatil'
      ]
    },
    effectClasses: ['read', 'execute', 'write'],
    risk: {
      reversibility: 'reversible',
      reach: 'single-scoped-target',
      data: 'project',
      mode: 'proceed'
    }
  }, { at })
  const updated = await alterar(casa, (latest) => {
    const current = latest.jobs.find((item) => item.id === job.id)
    if (!current) throw new Error('Trabalho de melhoria desapareceu antes do despacho.')
    current.state = 'dispatch-required'
    current.delegationId = dispatch.request.delegationId
    current.dispatchSessionFingerprint = hash(sessionId)
    current.reasonFingerprint = null
    current.retryAt = null
    current.updatedAt = agora(at)
    return current
  })
  return { result: 'dispatch-required', job: updated, request: dispatch.request, prompt }
}

export async function localizarDespachoAtivoAutomacaoMelhoria(casa, { sessionId } = {}) {
  await sincronizarAutomacaoMelhorias(casa)
  const store = await lerAutomacaoMelhorias(casa)
  const sessionFingerprint = hash(sessionId ?? 'session-unknown')
  const jobs = store.jobs.filter((item) =>
    item.state === 'dispatch-required' && item.dispatchSessionFingerprint === sessionFingerprint
  )
  return jobs.length === 1 ? { result: 'found', job: jobs[0] } : { result: jobs.length ? 'ambiguous' : 'idle', job: null }
}

export async function adiarDespachoAutomaticoMelhoria(casa, {
  sessionId,
  reason = 'arbitragem priorizou outra automacao ja pronta'
} = {}, { at } = {}) {
  const active = await localizarDespachoAtivoAutomacaoMelhoria(casa, { sessionId })
  if (!active.job) return { result: active.result, job: null }
  const cycle = await lerCicloOperacional(casa)
  const delegation = cycle.delegations.find((item) => item.id === active.job.delegationId)
  if (!delegation || !['prepared', 'visible'].includes(delegation.state)) {
    return { result: 'already-started-or-advanced', job: active.job }
  }
  await atualizarDelegacao(casa, delegation.id, 'cancelled', {
    reason,
    evidence: `arbiter-deferred:${active.job.id}:${delegation.id}`
  }, { at })
  const deferred = await alterar(casa, (store) => {
    const current = store.jobs.find((item) => item.id === active.job.id)
    if (!current || current.state !== 'dispatch-required' || current.delegationId !== delegation.id) {
      return null
    }
    current.state = 'queued'
    current.generation += 1
    current.delegationId = null
    current.dispatchSessionFingerprint = null
    current.executorFingerprint = null
    current.reasonFingerprint = hash(reason)
    current.retryAt = null
    current.updatedAt = agora(at)
    return current
  })
  return deferred ? { result: 'deferred', job: deferred, delegationId: delegation.id } : {
    result: 'state-changed',
    job: null,
    delegationId: delegation.id
  }
}

export async function confirmarInicioAutomacaoMelhoria(casa, {
  sessionId,
  delegationId,
  executorId
} = {}, { at } = {}) {
  if (!delegationId || !executorId) return { result: 'ignored', job: null }
  return alterar(casa, (store) => {
    const job = store.jobs.find((item) =>
      item.delegationId === delegationId &&
      item.dispatchSessionFingerprint === hash(sessionId ?? 'session-unknown')
    )
    if (!job) return { result: 'ignored', job: null }
    const executorFingerprint = hash(executorId)
    if (job.executorFingerprint && job.executorFingerprint !== executorFingerprint) {
      throw new Error('Trabalho de melhoria ja esta vinculado a outro executor.')
    }
    if (job.state === 'running') return { result: 'duplicate', job }
    if (job.state !== 'dispatch-required') return { result: 'ignored', job }
    job.state = 'running'
    job.executorFingerprint = executorFingerprint
    job.attempts += 1
    job.updatedAt = agora(at)
    return { result: 'running', job }
  })
}

function reciboDaMensagem(value, marker) {
  const text = typeof value === 'string' ? value : ''
  const match = new RegExp(`${marker}\\s+(\\{[^\\r\\n]{1,1000}\\})`).exec(text)
  if (!match) return null
  try {
    const receipt = JSON.parse(match[1])
    const artifact = String(receipt?.artifact ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (
      typeof receipt?.candidateId !== 'string' ||
      !PORTABLE_ARTIFACT.test(artifact) ||
      artifact.split('/').includes('..')
    ) return null
    return { candidateId: receipt.candidateId, artifact }
  } catch {
    return null
  }
}

export async function registrarRelatoAutomacaoMelhoria(casa, {
  delegationId,
  lastAssistantMessage
} = {}, { at } = {}) {
  const policy = await contrato()
  const store = await lerAutomacaoMelhorias(casa)
  const job = store.jobs.find((item) => item.delegationId === delegationId)
  if (!job) return { result: 'ignored', job: null }
  const receipt = reciboDaMensagem(lastAssistantMessage, policy.execution.implementationReceiptMarker)
  if (!receipt || receipt.candidateId !== job.candidateId) {
    const deferred = await alterar(casa, (latest, currentPolicy) => {
      const current = latest.jobs.find((item) => item.id === job.id)
      current.state = 'reported-unverified'
      current.reasonFingerprint = hash('missing-or-invalid-implementation-receipt')
      current.retryAt = proximoRetry(current, currentPolicy, agora(at))
      current.updatedAt = agora(at)
      return current
    })
    return { result: 'receipt-required', job: deferred }
  }
  try {
    const configuration = await lerRepositorioCanonico(casa)
    if (configuration.status !== 'configured') throw new Error('Repositorio canonico nao configurado.')
    const implementation = await registrarImplementacaoOperacional(
      casa,
      job.candidateId,
      configuration.sourceRepository,
      receipt.artifact,
      { now: at }
    )
    const auditReceipt = implementation.artifactRef?.implementationReceipt
    const requiredAt = [...(implementation.candidate?.transitionHistory ?? [])]
      .reverse()
      .find((item) => item.to === 'implementation-required')?.recordedAt
    await verificarEFecharDelegacaoImplementacao(casa, delegationId, {
      implementationReceipt: auditReceipt,
      targetFingerprints: auditReceipt?.targetFingerprint ? [auditReceipt.targetFingerprint] : [],
      notBefore: requiredAt
    }, { at })
    await sincronizarAutomacaoMelhorias(casa, { at })
    const latest = await lerAutomacaoMelhorias(casa)
    return {
      result: implementation.result,
      job: latest.jobs.find((item) => item.id === job.id),
      candidateId: job.candidateId
    }
  } catch (error) {
    const deferred = await alterar(casa, (latest, currentPolicy) => {
      const current = latest.jobs.find((item) => item.id === job.id)
      current.state = 'reported-unverified'
      current.reasonFingerprint = hash(`${error?.name ?? 'Error'}:${error?.code ?? 'unverified'}`)
      current.retryAt = proximoRetry(current, currentPolicy, agora(at))
      current.updatedAt = agora(at)
      return current
    })
    return { result: 'implementation-unverified', job: deferred }
  }
}

function baselineDoJob(job) {
  if (
    !HASH.test(job?.baselineRepositoryFingerprint ?? '') ||
    !GIT_SHA.test(job?.baselineCommitSha ?? '') ||
    !HASH.test(job?.baselineBranchFingerprint ?? '') ||
    !HASH.test(job?.baselineStatusFingerprint ?? '') ||
    !dataValida(job?.baselineCapturedAt)
  ) return null
  return {
    contract: BASELINE_CONTRACT,
    repositoryFingerprint: job.baselineRepositoryFingerprint,
    commitSha: job.baselineCommitSha,
    branchFingerprint: job.baselineBranchFingerprint,
    statusFingerprint: job.baselineStatusFingerprint,
    capturedAt: job.baselineCapturedAt
  }
}

function proximoRetryRelease(job, policy, timestamp) {
  const delay = Math.min(
    policy.retry.maximumSeconds,
    policy.retry.baseSeconds * (2 ** Math.min(3, Math.max(0, job.releaseAttempts - 1)))
  )
  return new Date(Date.parse(timestamp) + delay * 1000).toISOString()
}

async function tentarReadbackDaReleaseCarregada({ casa, candidateId, pluginRoot = RAIZ_CARREGADA, at }) {
  let integrity
  try {
    integrity = await verificarIntegridadeRelease(pluginRoot)
  } catch (error) {
    return {
      result: 'loaded-release-unverifiable',
      observationFingerprint: hash(`${error?.name ?? 'Error'}:${error?.code ?? 'unknown'}`)
    }
  }
  const observationFingerprint = hash(JSON.stringify({
    status: integrity.status,
    version: integrity.releaseVersion,
    fingerprint: integrity.fingerprint,
    declaredFingerprint: integrity.declaredFingerprint,
    versionMatchesManifest: integrity.versionMatchesManifest
  }))
  if (
    integrity.status !== 'verified' ||
    integrity.versionMatchesManifest !== true ||
    !HASH.test(integrity.fingerprint ?? '')
  ) return { result: 'loaded-release-unverifiable', observationFingerprint }
  await registrarReadbackOperacionalInstalado(casa, {
    pluginRoot,
    version: integrity.releaseVersion,
    payloadFingerprint: integrity.fingerprint,
    now: at
  })
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) => item.id === candidateId)
  return {
    result: ['installed-verified', 'superseded'].includes(candidate?.status)
      ? 'installed-readback-verified'
      : 'artifact-not-in-loaded-release',
    observationFingerprint
  }
}

async function persistirBaselineRecuperado(casa, jobId, baseline, timestamp, reason = null) {
  return alterar(casa, (store) => {
    const current = store.jobs.find((item) => item.id === jobId)
    if (!current) return null
    current.baselineRepositoryFingerprint = baseline.repositoryFingerprint
    current.baselineCommitSha = baseline.commitSha
    current.baselineBranchFingerprint = baseline.branchFingerprint
    current.baselineStatusFingerprint = baseline.statusFingerprint
    current.baselineCapturedAt = baseline.capturedAt
    current.reasonFingerprint = reason ? hash(reason) : null
    current.releaseRetryAt = null
    current.updatedAt = timestamp
    return current
  })
}

export async function processarReleasePendenteMelhoria(casa, {
  at,
  releaseOperational = prepararReleaseAutonomaOperacional,
  recoverInstalled = tentarReadbackDaReleaseCarregada,
  recoverBaseline = recuperarBaselineReleaseOperacionalLegado
} = {}) {
  const timestamp = agora(at)
  await sincronizarAutomacaoMelhorias(casa, { at: timestamp })
  const store = await lerAutomacaoMelhorias(casa)
  const jobs = store.jobs
    .filter((item) =>
      item.state === 'awaiting-release' &&
      (item.releaseRetryAt === null || Date.parse(item.releaseRetryAt) <= Date.parse(timestamp))
    )
    .sort((left, right) => {
      const baselineOrder = Number(Boolean(baselineDoJob(right))) - Number(Boolean(baselineDoJob(left)))
      return baselineOrder || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    })
  const job = jobs[0]
  if (!job) return { result: 'idle', job: null }
  let baseline = baselineDoJob(job)
  if (!baseline) {
    const installed = await recoverInstalled({ casa, candidateId: job.candidateId, at: timestamp })
    await sincronizarAutomacaoMelhorias(casa, { at: timestamp })
    const afterReadback = await lerAutomacaoMelhorias(casa)
    const readbackJob = afterReadback.jobs.find((item) => item.id === job.id)
    if (readbackJob?.state === 'completed') {
      return { result: 'completed-from-installed-readback', recoveryResult: installed.result, job: readbackJob }
    }
    const configuration = await lerRepositorioCanonico(casa)
    const recovered = configuration.status === 'configured'
      ? await recoverBaseline({
          casa,
          candidateId: job.candidateId,
          sourceRepository: configuration.sourceRepository,
          at: timestamp
        })
      : { result: 'source-repository-unconfigured', baseline: null }
    if (recovered.result === 'recovered-single-audited-artifact' && recovered.baseline) {
      await persistirBaselineRecuperado(casa, job.id, recovered.baseline, timestamp, 'legacy-baseline-recovered')
      baseline = recovered.baseline
    } else {
      const blocked = await alterar(casa, (latest) => {
        const current = latest.jobs.find((item) => item.id === job.id)
        current.reasonFingerprint = hash(JSON.stringify({
          class: 'legacy-unrecoverable',
          installedObservation: installed.observationFingerprint ?? hash(installed.result),
          baselineObservation: recovered.observationFingerprint ?? recovered.statusFingerprint ?? hash(recovered.result)
        }))
        current.releaseRetryAt = null
        current.updatedAt = timestamp
        return current
      })
      return {
        result: 'legacy-unrecoverable',
        installedReadbackResult: installed.result,
        baselineRecoveryResult: recovered.result,
        baselineRecoveryObservation: {
          changedPathCount: recovered.changedPathCount ?? null,
          auditedArtifactIsOnlyChange: recovered.auditedArtifactIsOnlyChange ?? null,
          observedPathFingerprint: recovered.observedPathFingerprint ?? null,
          auditedPathFingerprint: recovered.auditedPathFingerprint ?? null
        },
        job: blocked
      }
    }
  }
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) =>
    item.id === job.candidateId && item.status === 'materialized-pending-release'
  )
  if (!candidate?.artifactRef) return { result: 'stale', job }
  const configuration = await lerRepositorioCanonico(casa)
  if (configuration.status !== 'configured') return { result: 'source-repository-unconfigured', job }

  let release
  try {
    release = await releaseOperational({
      casa,
      candidateId: candidate.id,
      baseline,
      sourceRepository: configuration.sourceRepository,
      allowedArtifacts: [candidate.artifactRef],
      at: timestamp
    })
  } catch (error) {
    release = {
      result: 'release-exception',
      errorFingerprint: hash(`${error?.name ?? 'Error'}:${error?.code ?? 'unknown'}`)
    }
  }
  if (release.result === 'baseline-diverged') {
    const recovered = await recoverBaseline({
      casa,
      candidateId: candidate.id,
      sourceRepository: configuration.sourceRepository,
      at: timestamp
    })
    if (recovered.result === 'recovered-single-audited-artifact' && recovered.baseline) {
      const recaptured = await persistirBaselineRecuperado(
        casa,
        job.id,
        recovered.baseline,
        timestamp,
        'baseline-diverged-recaptured'
      )
      return {
        result: 'baseline-recaptured',
        releaseResult: release.result,
        recoveryResult: recovered.result,
        job: recaptured
      }
    }
  }
  await sincronizarAutomacaoMelhorias(casa, { at: timestamp })
  const currentCycle = await lerCicloOperacional(casa)
  const currentCandidate = currentCycle.improvementCandidates.find((item) => item.id === candidate.id)
  const successful = ['published-installed-verified', 'already-published-installed-verified'].includes(release.result) &&
    currentCandidate?.status === 'installed-verified'
  const updated = await alterar(casa, (latest, policy) => {
    const current = latest.jobs.find((item) => item.id === job.id)
    current.releaseAttempts += 1
    if (successful) {
      current.state = 'completed'
      current.releaseRetryAt = null
      current.reasonFingerprint = null
    } else {
      current.state = 'awaiting-release'
      current.reasonFingerprint = HASH.test(release.errorFingerprint ?? '')
        ? release.errorFingerprint
        : hash(`operational-release:${release.result}`)
      current.releaseRetryAt = proximoRetryRelease(current, policy, timestamp)
    }
    current.updatedAt = timestamp
    return current
  })
  return {
    result: successful ? 'completed' : release.result,
    releaseResult: release.result,
    job: updated
  }
}

export async function exigirInicioDespachoMelhoriaAntesDaParada(casa, {
  sessionId,
  stopHookActive = false
} = {}) {
  const pending = await localizarDespachoAtivoAutomacaoMelhoria(casa, { sessionId })
  if (!pending.job) return { result: pending.result, decision: null, reason: null, job: null }
  const cycle = await lerCicloOperacional(casa)
  const delegation = cycle.delegations.find((item) => item.id === pending.job.delegationId)
  if (!delegation || !['prepared', 'visible'].includes(delegation.state)) {
    return { result: 'started-or-advanced', decision: null, reason: null, job: pending.job }
  }
  if (stopHookActive) {
    return { result: 'pending-recursion', decision: null, reason: null, job: pending.job }
  }
  return {
    result: 'implementation-dispatch-not-started',
    decision: 'block',
    reason: [
      `implementation-dispatch-not-started: ${pending.job.id}.`,
      `Inicie o executor em segundo plano com a delegacao ${pending.job.delegationId}.`,
      'A solicitacao visivel nao equivale a inicio real; preserve o briefing e continue sem pedir nova aprovacao.'
    ].join(' '),
    job: pending.job
  }
}
