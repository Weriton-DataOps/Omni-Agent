import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { reconciliarTurnosPendentesAuditoria } from './auditoria-autocorrecao.mjs'
import { sincronizarAutomacaoFalhas } from './automacao-falhas.mjs'
import { lerAutomacaoMelhorias } from './automacao-melhorias.mjs'
import { reconciliarDelegacoesOperacionais } from './ciclo-operacional.mjs'
import { casaDoOmni } from './memoria.mjs'
import { registrarTelemetriaAutocorrecao } from './telemetria-autocorrecao.mjs'
import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function fingerprintResult(value) {
  try {
    return hash(JSON.stringify(value ?? null))
  } catch {
    return hash(`unserializable:${typeof value}`)
  }
}

function fingerprintError(error) {
  return hash(`${error instanceof Error ? error.name : typeof error}:${error?.code ?? 'no-code'}`)
}

function activeDelegationIds(failureAutomation, improvementAutomation) {
  return [...new Set([
    ...(failureAutomation?.jobs ?? [])
      .filter((job) => !['completed', 'superseded'].includes(job.state))
      .map((job) => job.delegationId),
    ...(improvementAutomation?.jobs ?? [])
      .filter((job) => job.state !== 'completed')
      .map((job) => job.delegationId)
  ].filter(Boolean))]
}

async function withReconciliationLock(casa, operation) {
  const held = await acquireLocalFileLock(join(casa, 'runs', 'self-repair-reconciliation.lock'), {
    acquisitionTimeoutMs: 15_000,
    retryDelayMs: 25,
    staleLockMs: 60_000,
    heartbeatMs: 10_000,
    timeoutMessage: 'A reconciliacao operacional do Omni esta ocupada por outra execucao.'
  })
  try {
    return await operation()
  } finally {
    await held.release()
  }
}

async function executeReconciliation(casa, input, deps) {
  const outcomes = []
  let failureAutomation = null

  try {
    failureAutomation = await (deps.sincronizarAutomacaoFalhas ?? sincronizarAutomacaoFalhas)(casa)
    outcomes.push({
      stage: 'failure-automation',
      status: 'fulfilled',
      resultFingerprint: fingerprintResult(failureAutomation)
    })
  } catch (error) {
    outcomes.push({
      stage: 'failure-automation',
      status: 'rejected',
      errorFingerprint: fingerprintError(error)
    })
  }

  if (failureAutomation === null) {
    outcomes.push({
      stage: 'delegation-reconciliation',
      status: 'rejected',
      errorFingerprint: hash('dependency-unavailable:failure-automation')
    })
  } else {
    try {
      const improvementAutomation = await (deps.lerAutomacaoMelhorias ?? lerAutomacaoMelhorias)(casa)
      const result = await (deps.reconciliarDelegacoesOperacionais ?? reconciliarDelegacoesOperacionais)(casa, {
        activeDelegationIds: activeDelegationIds(failureAutomation, improvementAutomation)
      })
      outcomes.push({
        stage: 'delegation-reconciliation',
        status: 'fulfilled',
        resultFingerprint: fingerprintResult(result)
      })
    } catch (error) {
      outcomes.push({
        stage: 'delegation-reconciliation',
        status: 'rejected',
        errorFingerprint: fingerprintError(error)
      })
    }
  }

  try {
    const result = await (deps.reconciliarTurnosPendentesAuditoria ?? reconciliarTurnosPendentesAuditoria)(casa, input)
    outcomes.push({
      stage: 'historical-turn-reconciliation',
      status: 'fulfilled',
      resultFingerprint: fingerprintResult(result)
    })
  } catch (error) {
    outcomes.push({
      stage: 'historical-turn-reconciliation',
      status: 'rejected',
      errorFingerprint: fingerprintError(error)
    })
  }

  return outcomes
}

export async function executarReconciliacaoOperacional(casa, input = {}, deps = {}) {
  const withinLock = deps.withReconciliationLock ?? withReconciliationLock
  return withinLock(casa, () => executeReconciliation(casa, input, deps))
}

export async function tratarHookReconciliacao(input, env = process.env, deps = {}) {
  if (!['SessionStart', 'Stop'].includes(input?.hook_event_name)) return { suppressOutput: true }
  const casa = (deps.casaDoOmni ?? casaDoOmni)(env)
  let outcomes
  try {
    outcomes = await executarReconciliacaoOperacional(casa, input, deps)
  } catch (error) {
    const errorFingerprint = fingerprintError(error)
    outcomes = [
      'failure-automation',
      'delegation-reconciliation',
      'historical-turn-reconciliation'
    ].map((stage) => ({ stage, status: 'rejected', errorFingerprint }))
  }

  try {
    await (deps.registrarTelemetriaAutocorrecao ?? registrarTelemetriaAutocorrecao)(casa, {
      profile: 'reconciliation',
      event: input.hook_event_name,
      stages: outcomes
    })
    return {
      suppressOutput: true,
      telemetry: 'persisted',
      stages: outcomes
    }
  } catch (error) {
    const telemetryErrorFingerprint = fingerprintError(error)
    return {
      suppressOutput: true,
      telemetry: 'rejected',
      telemetryErrorFingerprint,
      stages: outcomes
    }
  }
}

async function standardInput() {
  let content = ''
  for await (const chunk of process.stdin) content += chunk
  return content.trim() ? JSON.parse(content) : {}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${JSON.stringify(await tratarHookReconciliacao(await standardInput()))}\n`)
  } catch (error) {
    process.stderr.write(`Reconciliacao do Omni: ${fingerprintError(error)}\n`)
    process.stdout.write(`${JSON.stringify({ suppressOutput: true })}\n`)
  }
}
