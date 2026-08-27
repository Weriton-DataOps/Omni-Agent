import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { geracaoPadraoFalha, lerFalhas } from './falhas.mjs'
import { pareceConterSegredo } from './memoria.mjs'

export const FAILURE_AUTOMATION_SCHEMA_VERSION = 1

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const POLICY_PATH = new URL('../contratos/aprendizado/falhas.json', import.meta.url)
const STATES = new Set(['queued', 'running', 'blocked', 'completed'])

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function safeText(value, label, minimum = 2, maximum = 500) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} precisa ter entre ${minimum} e ${maximum} caracteres.`)
  }
  if (pareceConterSegredo(text)) throw new Error(`${label} parece conter segredo.`)
  return text
}

async function policy() {
  const value = JSON.parse(await readFile(POLICY_PATH, 'utf8'))
  const automation = value?.automaticCandidateValidation
  if (
    value?.schemaVersion !== 1 ||
    automation?.enabled !== true ||
    automation?.executor !== 'background-subagent' ||
    automation?.requiresOwnerPrompt !== false ||
    !Number.isInteger(automation.leaseMinutes) ||
    automation.leaseMinutes < 5 ||
    !Number.isInteger(automation.maximumConcurrentJobs) ||
    automation.maximumConcurrentJobs < 1 ||
    !Array.isArray(automation.excludedActions) ||
    !Array.isArray(automation.ownerAuthorizationRequiredFor)
  ) throw new Error('Automação de falhas fora do contrato v1.')
  return automation
}

function emptyStore(at = now()) {
  return {
    schemaVersion: FAILURE_AUTOMATION_SCHEMA_VERSION,
    store: { id: 'omni-local-failure-automation', createdAt: at, updatedAt: at },
    jobs: []
  }
}

export function caminhoDaAutomacaoFalhas(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa da automação de falhas precisa ser absoluta.')
  return join(casa, 'learning', 'failure-automation.json')
}

function dateOrNull(value) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function fingerprintOrNull(value) {
  return value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
}

function validJob(job) {
  return Boolean(
    job &&
      typeof job.id === 'string' && job.id.startsWith('failure-job-') &&
      typeof job.patternId === 'string' && job.patternId.startsWith('failure-pattern-') &&
      /^[a-f0-9]{64}$/.test(job.generationFingerprint ?? '') &&
      STATES.has(job.state) &&
      Number.isInteger(job.attempts) && job.attempts >= 0 &&
      dateOrNull(job.leaseUntil) &&
      fingerprintOrNull(job.executorFingerprint) &&
      fingerprintOrNull(job.evidenceFingerprint) &&
      fingerprintOrNull(job.reasonFingerprint) &&
      Number.isFinite(Date.parse(job.queuedAt)) &&
      Number.isFinite(Date.parse(job.updatedAt))
  )
}

function validateStore(store, path) {
  if (
    store?.schemaVersion !== FAILURE_AUTOMATION_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-failure-automation' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !Array.isArray(store.jobs) ||
    !store.jobs.every(validJob)
  ) throw new Error(`Automação de falhas fora do contrato v1: ${path}`)
}

async function lock(casa) {
  const directory = join(casa, 'learning')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'failure-automation.lock')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 120_000) await unlink(path).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('A automação de falhas está ocupada por outra escrita.')
}

async function load(casa) {
  const path = caminhoDaAutomacaoFalhas(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > FAILURE_AUTOMATION_SCHEMA_VERSION) {
      throw new Error(`Automação de falhas v${store.schemaVersion} é mais nova que este plugin.`)
    }
    validateStore(store, path)
    return store
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore()
    throw error
  }
}

async function save(casa, store) {
  const path = caminhoDaAutomacaoFalhas(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  validateStore(store, path)
  await mkdir(join(casa, 'learning'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function generation(pattern) {
  return geracaoPadraoFalha(pattern)
}

function eligible(pattern, contract) {
  return ['candidate', 'analyzed', 'testing', 'ready-for-eval'].includes(pattern.status) &&
    !contract.excludedActions.some((action) => pattern.action.toLowerCase() === action.toLowerCase())
}

export async function sincronizarAutomacaoFalhas(casa, { at } = {}) {
  const [failures, contract] = await Promise.all([lerFalhas(casa), policy()])
  const timestamp = now(at)
  const release = await lock(casa)
  try {
    const store = await load(casa)
    for (const job of store.jobs) {
      if (job.state === 'running' && Date.parse(job.leaseUntil) <= Date.parse(timestamp)) {
        job.state = 'queued'
        job.leaseUntil = null
        job.executorFingerprint = null
        job.updatedAt = timestamp
      }
    }
    for (const pattern of failures.patterns) {
      if (pattern.status === 'evaluated') {
        for (const job of store.jobs.filter((item) => item.patternId === pattern.id && item.state !== 'completed')) {
          job.state = 'completed'
          job.leaseUntil = null
          job.updatedAt = timestamp
        }
        continue
      }
      if (!eligible(pattern, contract)) continue
      const generationFingerprint = generation(pattern)
      if (store.jobs.some((item) => item.generationFingerprint === generationFingerprint)) continue
      store.jobs.push({
        id: `failure-job-${randomUUID()}`,
        patternId: pattern.id,
        generationFingerprint,
        state: 'queued',
        attempts: 0,
        leaseUntil: null,
        executorFingerprint: null,
        evidenceFingerprint: null,
        reasonFingerprint: null,
        queuedAt: timestamp,
        updatedAt: timestamp
      })
    }
    store.jobs = store.jobs.slice(-200)
    await save(casa, store)
    return store
  } finally {
    await release()
  }
}

function promptFor(job, pattern, contract) {
  const operator = join(raiz, 'scripts', 'omni.ps1')
  return [
    'Você é o subagente executor temporário de validação de falhas do Omni. Trabalhe em segundo plano e não peça ao proprietário para conduzir o ciclo.',
    '',
    `Trabalho: ${job.id}`,
    `Padrão: ${pattern.id}`,
    `Geração da evidência: ${job.generationFingerprint}`,
    `Ação: ${pattern.action}`,
    `Classe: ${pattern.failureClass}`,
    `Ocorrências distintas: ${pattern.occurrences}`,
    `Operador canônico: powershell -NoProfile -ExecutionPolicy Bypass -File "${operator}"`,
    '',
    'Objetivo obrigatório:',
    '1. Recupere evidência local suficiente nas sessões JSONL e no projeto relacionado. Não invente causa raiz a partir do hash.',
    '2. Determine causa raiz e hipótese verificável; registre com `falha-analisar <padrao> --geracao <geracao> --causa <texto> --hipotese <texto>`.',
    '3. Defina um único critério de aceitação determinístico. Execute a correção duas vezes de verdade, em execuções independentes.',
    '4. Após cada execução, registre com `falha-testar <padrao> --geracao <geracao> --execucao <id-unico> --criterio <mesmo-criterio> --resultado <resumo-seguro>`; acrescente `--falhou` quando falhar.',
    '5. Se os dois testes forem bem-sucedidos e consistentes, rode `falha-avaliar <padrao> --geracao <geracao>` para gerar o eval e a proposta avaliável.',
    `6. Finalize com \`falha-automacao-concluir ${job.id} --execucao <id-da-evidencia>\`. Se faltar evidência ou autoridade, use \`falha-automacao-bloquear ${job.id} --motivo <motivo-seguro>\`.
`,
    'Fronteiras:',
    `- exigem autorização do proprietário: ${contract.ownerAuthorizationRequiredFor.join(', ')};`,
    '- não faça commit, push, publicação, compra, chamada paga, mudança destrutiva ou escalada de privilégio;',
    '- erro bruto, comando sensível, conversa e segredo não entram no store; registre apenas resumo e identificadores;',
    '- a falha do próprio executor não deve abrir outro executor; marque este trabalho como bloqueado com evidência.',
    '',
    'Entregue ao Omni: causa comprovada, hipótese, os dois IDs de execução, resultado de cada teste, eval e proposta criada ou motivo real do bloqueio.'
  ].join('\n')
}

export async function reivindicarAutomacaoFalha(casa, input, { at } = {}) {
  const executor = safeText(input?.executorId, 'Identificador do executor', 3, 240)
  const timestamp = now(at)
  await sincronizarAutomacaoFalhas(casa, { at: timestamp })
  const [failures, contract] = await Promise.all([lerFalhas(casa), policy()])
  const release = await lock(casa)
  try {
    const store = await load(casa)
    if (store.jobs.filter((item) => item.state === 'running').length >= contract.maximumConcurrentJobs) {
      return { result: 'busy', job: null, prompt: null }
    }
    const job = store.jobs.find((item) => item.state === 'queued')
    if (!job) return { result: 'empty', job: null, prompt: null }
    const pattern = failures.patterns.find((item) => item.id === job.patternId)
    if (!pattern || !eligible(pattern, contract)) return { result: 'stale', job: null, prompt: null }
    job.state = 'running'
    job.attempts += 1
    job.executorFingerprint = hash(executor)
    job.leaseUntil = new Date(Date.parse(timestamp) + contract.leaseMinutes * 60_000).toISOString()
    job.updatedAt = timestamp
    await save(casa, store)
    return { result: 'claimed', job, prompt: promptFor(job, pattern, contract) }
  } finally {
    await release()
  }
}

async function finish(casa, id, state, value, { at } = {}) {
  const label = state === 'blocked' ? 'Motivo do bloqueio' : 'Identificador da evidência'
  const safe = safeText(value, label, 3, 500)
  const timestamp = now(at)
  const failures = await lerFalhas(casa)
  const release = await lock(casa)
  try {
    const store = await load(casa)
    const job = store.jobs.find((item) => item.id === id)
    if (!job) return { result: 'not-found', job: null }
    if (job.state !== 'running') return { result: 'not-running', job }
    const pattern = failures.patterns.find((item) => item.id === job.patternId)
    if (!pattern || generation(pattern) !== job.generationFingerprint) {
      job.state = 'completed'
      job.leaseUntil = null
      job.reasonFingerprint = hash('geracao de evidencia substituida durante a execucao')
      job.updatedAt = timestamp
      await save(casa, store)
      return { result: 'stale-generation', job }
    }
    job.state = state
    job.leaseUntil = null
    job.evidenceFingerprint = state === 'completed' ? hash(safe) : null
    job.reasonFingerprint = state === 'blocked' ? hash(safe) : null
    job.updatedAt = timestamp
    await save(casa, store)
    return { result: state, job }
  } finally {
    await release()
  }
}

export function concluirAutomacaoFalha(casa, id, evidenceId, options) {
  return finish(casa, id, 'completed', evidenceId, options)
}

export function bloquearAutomacaoFalha(casa, id, reason, options) {
  return finish(casa, id, 'blocked', reason, options)
}

export async function contextoAutomacaoFalhas(casa) {
  const store = await sincronizarAutomacaoFalhas(casa)
  const queued = store.jobs.filter((item) => item.state === 'queued').length
  if (!queued) return null
  return [
    `AUTOMAÇÃO DE FALHAS: há ${queued} validação(ões) candidata(s) aguardando executor.`,
    'Antes de encerrar este turno, reivindique no máximo uma com o operador canônico:',
    '`falha-automacao-reivindicar --executor <id-unico-desta-sessao>`.',
    'Use imediatamente o campo `prompt` retornado para iniciar um subagente com execução em segundo plano.',
    'Não peça autorização ao proprietário. As fronteiras de risco estão no próprio briefing; se uma delas for atingida, o subagente registra bloqueio.'
  ].join('\n')
}
