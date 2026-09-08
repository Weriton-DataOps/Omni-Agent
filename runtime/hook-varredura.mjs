import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditarSaudeSistema } from './auditoria-sistema.mjs'
import { processarReleasePendenteMelhoria } from './automacao-melhorias.mjs'
import { processarFilaEvalPersonalidade } from './executor-eval-personalidade.mjs'
import { casaDoOmni } from './memoria.mjs'
import { registrarTelemetriaAutocorrecao } from './telemetria-autocorrecao.mjs'
import { varrerAtividadesDoDia } from './varredura-diaria.mjs'
import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function fingerprintResultado(value) {
  try {
    return hash(JSON.stringify(value ?? null))
  } catch {
    return hash(`unserializable:${typeof value}`)
  }
}

function fingerprintErro(error) {
  const name = error instanceof Error ? error.name : typeof error
  const code = typeof error?.code === 'string' ? error.code : 'no-code'
  return hash(`${name}:${code}`)
}

async function withMaintenanceLock(casa, operation) {
  const held = await acquireLocalFileLock(join(casa, 'runs', 'self-repair-maintenance.lock'), {
    acquisitionTimeoutMs: 250,
    retryDelayMs: 25,
    staleLockMs: 120_000,
    heartbeatMs: 20_000,
    timeoutMessage: 'A manutencao do Omni ja esta em execucao.'
  })
  try {
    return await operation()
  } finally {
    await held.release()
  }
}

function maintenanceDegradedOutput(error) {
  const errorFingerprint = fingerprintErro(error)
  return {
    suppressOutput: true,
    maintenance: 'rejected',
    maintenanceErrorFingerprint: errorFingerprint
  }
}

export async function tratarHookVarredura(input, env = process.env, deps = {}) {
  if (!['SessionStart', 'Stop'].includes(input?.hook_event_name)) return { suppressOutput: true }
  const casa = (deps.casaDoOmni ?? casaDoOmni)(env)
  const withinMaintenance = deps.withMaintenanceLock ?? withMaintenanceLock
  try {
    return await withinMaintenance(casa, async () => {
      const outcomes = []
      const stages = [
        {
          id: 'daily-scan',
          run: () => (deps.varrerAtividadesDoDia ?? varrerAtividadesDoDia)(casa, { automatic: true })
        },
        {
          id: 'system-audit',
          run: () => (deps.auditarSaudeSistema ?? auditarSaudeSistema)(casa, {
            repair: true,
            reconcile: false
          })
        },
        {
          id: 'personality-eval',
          run: () => (deps.processarFilaEvalPersonalidade ?? processarFilaEvalPersonalidade)({ casa })
        },
        {
          id: 'operational-release',
          run: () => (deps.processarReleasePendenteMelhoria ?? processarReleasePendenteMelhoria)(casa)
        }
      ]
      for (const stage of stages) {
        try {
          outcomes.push({
            stage: stage.id,
            status: 'fulfilled',
            resultFingerprint: fingerprintResultado(await stage.run())
          })
        } catch (error) {
          outcomes.push({
            stage: stage.id,
            status: 'rejected',
            errorFingerprint: fingerprintErro(error)
          })
        }
      }
      try {
        await (deps.registrarTelemetriaAutocorrecao ?? registrarTelemetriaAutocorrecao)(casa, {
          profile: 'maintenance',
          event: input.hook_event_name,
          stages: outcomes
        })
        return { suppressOutput: true, maintenance: 'completed', telemetry: 'persisted', stages: outcomes }
      } catch (error) {
        return {
          ...maintenanceDegradedOutput(error),
          maintenance: 'completed-degraded',
          telemetry: 'rejected',
          telemetryErrorFingerprint: fingerprintErro(error),
          stages: outcomes
        }
      }
    })
  } catch (error) {
    if (error?.name === 'LocalJsonLockTimeoutError') {
      return { suppressOutput: true, maintenance: 'coalesced-in-flight' }
    }
    return maintenanceDegradedOutput(error)
  }
}

async function entradaPadrao() {
  let conteudo = ''
  for await (const parte of process.stdin) conteudo += parte
  return conteudo.trim() ? JSON.parse(conteudo) : {}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${JSON.stringify(await tratarHookVarredura(await entradaPadrao()))}\n`)
  } catch (erro) {
    process.stderr.write(`Varredura diaria do Omni: ${fingerprintErro(erro)}\n`)
    process.stdout.write(`${JSON.stringify({ suppressOutput: true })}\n`)
  }
}
