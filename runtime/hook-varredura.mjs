import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { casaDoOmni } from './memoria.mjs'
import { varrerAtividadesDoDia } from './varredura-diaria.mjs'
import { sincronizarAutomacaoFalhas } from './automacao-falhas.mjs'
import { auditarSaudeSistema } from './auditoria-sistema.mjs'
import { processarFilaEvalPersonalidade } from './executor-eval-personalidade.mjs'
import { processarReleasePendenteMelhoria } from './automacao-melhorias.mjs'

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

export async function tratarHookVarredura(input, env = process.env, deps = {}) {
  if (!['SessionStart', 'Stop'].includes(input?.hook_event_name)) {
    return { suppressOutput: true }
  }
  const resolverCasa = deps.casaDoOmni ?? casaDoOmni
  const casa = resolverCasa(env)
  const stages = [
    {
      id: 'daily-scan',
      run: () => (deps.varrerAtividadesDoDia ?? varrerAtividadesDoDia)(casa, { automatic: true })
    },
    {
      id: 'failure-automation',
      run: () => (deps.sincronizarAutomacaoFalhas ?? sincronizarAutomacaoFalhas)(casa)
    },
    {
      id: 'system-audit',
      run: () => (deps.auditarSaudeSistema ?? auditarSaudeSistema)(casa, { repair: true })
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
  const outcomes = []
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
  return { suppressOutput: true, stages: outcomes }
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
