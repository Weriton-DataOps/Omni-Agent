import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { geracaoPadraoFalha, lerFalhas } from './falhas.mjs'
import { pareceConterSegredo } from './memoria.mjs'
import { prepararDelegacaoVisivelIdempotente } from './ciclo-operacional.mjs'
import { resolverTurnoAtivoAuditoria } from './auditoria-autocorrecao.mjs'

export const FAILURE_AUTOMATION_SCHEMA_VERSION = 3

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const POLICY_PATH = new URL('../contratos/aprendizado/falhas.json', import.meta.url)
const STATES = new Set(['queued', 'running', 'blocked', 'completed', 'superseded'])
const DISPATCH_STATES = new Set(['not-requested', 'requested'])

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
    value?.schemaVersion !== 3 ||
    value?.policy !== 'failure-learning-v3' ||
    value?.verifiedFixTests?.source !== 'audit-self-correction' ||
    value?.verifiedFixTests?.requireDistinctActions !== true ||
    value?.verifiedFixTests?.requireDistinctExecutions !== true ||
    value?.verifiedFixTests?.requireConsistentStrategy !== true ||
    value?.verifiedFixTests?.requireConsistentCriterion !== true ||
    value?.verifiedFixTests?.requireAutomationJob !== true ||
    value?.verifiedFixTests?.requirePatternBinding !== true ||
    value?.verifiedFixTests?.requireHypothesisBinding !== true ||
    value?.verifiedFixTests?.requireDispatchBeforeVerification !== true ||
    value?.verifiedFixTests?.requireExplicitCommandBinding !== true ||
    value?.verifiedFixTests?.requireActionFamilyBinding !== true ||
    automation?.enabled !== true ||
    automation?.executor !== 'background-subagent' ||
    automation?.requiresOwnerPrompt !== false ||
    automation?.dispatchGuarantee !== 'request-only' ||
    automation?.hostExecutionRequired !== true ||
    !Number.isInteger(value.minimumSuccessfulFixTests) ||
    value.minimumSuccessfulFixTests < 2 ||
    !Number.isInteger(automation.leaseMinutes) ||
    automation.leaseMinutes < 5 ||
    !Number.isInteger(automation.maximumConcurrentJobs) ||
    automation.maximumConcurrentJobs < 1 ||
    !Array.isArray(automation.excludedActions) ||
    !Array.isArray(automation.ownerAuthorizationRequiredFor)
  ) throw new Error('Automação de falhas fora do contrato v1.')
  return { ...automation, minimumSuccessfulFixTests: value.minimumSuccessfulFixTests }
}

function emptyStore(at = now()) {
  return {
    schemaVersion: FAILURE_AUTOMATION_SCHEMA_VERSION,
    store: { id: 'omni-local-failure-automation', createdAt: at, updatedAt: at },
    jobs: []
  }
}

function migrateLegacy(store) {
  const migrated = structuredClone(store)
  migrated.schemaVersion = FAILURE_AUTOMATION_SCHEMA_VERSION
  migrated.jobs = migrated.jobs.map((job) => ({
    ...job,
    dispatchState: job.attempts > 0 ? 'requested' : 'not-requested',
    dispatchRequestedAt: job.attempts > 0 ? job.updatedAt : null
  }))
  return migrated
}

async function backupBeforeMigration(path, raw, version) {
  const backup = `${path}.v${version}.backup`
  try {
    await writeFile(backup, raw, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
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
      DISPATCH_STATES.has(job.dispatchState) &&
      dateOrNull(job.dispatchRequestedAt) &&
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
    const raw = await readFile(path, 'utf8')
    let store = JSON.parse(raw)
    if (store.schemaVersion > FAILURE_AUTOMATION_SCHEMA_VERSION) {
      throw new Error(`Automação de falhas v${store.schemaVersion} é mais nova que este plugin.`)
    }
    if ([1, 2].includes(store.schemaVersion)) {
      await backupBeforeMigration(path, raw, store.schemaVersion)
      store = migrateLegacy(store)
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
        job.dispatchState = 'not-requested'
        job.dispatchRequestedAt = null
        job.updatedAt = timestamp
      }
      if (
        job.state === 'queued' &&
        job.dispatchState === 'requested' &&
        Date.parse(job.leaseUntil) <= Date.parse(timestamp)
      ) {
        job.leaseUntil = null
        job.dispatchState = 'not-requested'
        job.dispatchRequestedAt = null
        job.updatedAt = timestamp
      }
    }
    const patternsById = new Map(failures.patterns.map((pattern) => [pattern.id, pattern]))
    for (const job of store.jobs.filter((item) => item.state === 'queued')) {
      const pattern = patternsById.get(job.patternId)
      if (!pattern) {
        job.state = 'superseded'
        job.updatedAt = timestamp
        continue
      }
      if (pattern.status === 'evaluated') {
        job.state = 'completed'
        job.leaseUntil = null
        job.evidenceFingerprint = hash(
          `evaluation:${pattern.id}:${job.generationFingerprint}:${pattern.evaluation?.evaluatedAt ?? 'unknown'}`
        )
        job.reasonFingerprint = null
        job.updatedAt = timestamp
        continue
      }
      if (!eligible(pattern, contract) || job.generationFingerprint !== generation(pattern)) {
        job.state = 'superseded'
        job.updatedAt = timestamp
      }
    }
    for (const pattern of failures.patterns) {
      if (pattern.status === 'evaluated') {
        continue
      }
      if (!eligible(pattern, contract)) continue
      const generationFingerprint = generation(pattern)
      const sameGeneration = store.jobs.filter(
        (item) => item.patternId === pattern.id && item.generationFingerprint === generationFingerprint
      )
      const active = sameGeneration.filter((item) => item.state === 'queued' || item.state === 'running')
      if (active.length > 1) {
        const keeper = active.find((item) => item.state === 'running') ?? active[0]
        for (const duplicate of active) {
          if (duplicate.id === keeper.id) continue
          duplicate.state = 'superseded'
          duplicate.leaseUntil = null
          duplicate.updatedAt = timestamp
        }
      }
      if (sameGeneration.some((item) => item.state !== 'superseded')) continue
      store.jobs.push({
        id: `failure-job-${randomUUID()}`,
        patternId: pattern.id,
        generationFingerprint,
        state: 'queued',
        attempts: 0,
        leaseUntil: null,
        executorFingerprint: null,
        dispatchState: 'not-requested',
        dispatchRequestedAt: null,
        evidenceFingerprint: null,
        reasonFingerprint: null,
        queuedAt: timestamp,
        updatedAt: timestamp
      })
    }
    const activeJobs = store.jobs.filter((item) => item.state === 'queued' || item.state === 'running')
    const terminalJobs = store.jobs.filter((item) => item.state !== 'queued' && item.state !== 'running').slice(-200)
    store.jobs = [...terminalJobs, ...activeJobs.filter((item) => !terminalJobs.some((terminal) => terminal.id === item.id))]
    await save(casa, store)
    return store
  } finally {
    await release()
  }
}

function promptFor(job, pattern) {
  const operator = join(raiz, 'scripts', 'omni.ps1')
  return [
    'Você é o subagente executor temporário de validação de falhas do Omni. Conduza o ciclo em segundo plano com a autoridade herdada da tarefa original.',
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
    `0. Como primeiro passo, reivindique exatamente este trabalho com \`falha-automacao-reivindicar --executor subagent-${job.id} --job ${job.id}\`. Se outro trabalho for devolvido, bloqueie e não prossiga.`,
    '1. Recupere evidência local suficiente nas sessões JSONL e no projeto relacionado. Sustente a causa raiz em evidência recuperada, nunca apenas no hash.',
    '2. Determine causa raiz e hipótese verificável; registre com `falha-analisar <padrao> --geracao <geracao> --causa <texto> --hipotese <texto>`.',
    `3. Depois da análise, rode \`falha-evidencias ${pattern.id} --job ${job.id}\` e copie o \`bindingMarker\`. Defina um único critério determinístico e acrescente \`# <bindingMarker>\` ao fim de cada comando real de verificação. Execute a mesma estratégia duas vezes de verdade, em execuções independentes; uma ação sem esse marcador não pertence a este trabalho.`,
    `4. Após cada execução, rode novamente \`falha-evidencias ${pattern.id} --job ${job.id}\` e escolha a ação vinculada. Registre com \`falha-testar ${pattern.id} --job ${job.id} --geracao ${job.generationFingerprint} --acao-auditoria <id> --evidencia-auditoria <id> --criterio <mesmo-criterio>\`. Resultado, sucesso e IDs livres não são aceitos.`,
    '5. Se os dois testes forem bem-sucedidos e consistentes, rode `falha-avaliar <padrao> --geracao <geracao>` para gerar o eval e a proposta avaliável.',
    `6. Finalize com \`falha-automacao-concluir ${job.id} --execucao <id-da-evidencia>\`. Se faltar evidência ou autoridade, use \`falha-automacao-bloquear ${job.id} --motivo <motivo-seguro>\`.
`,
    'Autoridade e controle de efeito:',
    '- O envelope de autoridade é o objetivo, o alvo, o escopo material e os efeitos explicitamente autorizados na tarefa original. Passos instrumentais proporcionais dentro desse envelope já estão autorizados.',
    '- Ausência de autoridade para uma nova classe de efeito não amplia o envelope. Nesse caso, registre a expansão concreta como bloqueio para decisão do Omni, sem devolver ao proprietário operações que já estavam autorizadas.',
    '- Antes de alterar estado, registre o estado inicial e um checkpoint verificável; escolha uma via reversível e prepare rollback proporcional ao efeito.',
    '- Depois de cada alteração, verifique o resultado real e anexe evidência da execução e, quando usado, da reversão.',
    '- Registre no store somente resumo seguro e identificadores; a evidência local protegida preserva os detalhes necessários.',
    '- Se o próprio executor falhar, finalize este job como bloqueado com evidência e devolva-o ao Omni para outra estratégia, preservando um único ciclo.',
    '',
    'Entregue ao Omni: causa comprovada, hipótese, os dois IDs de ação/evidência verificados, eval e proposta criada ou motivo real do bloqueio.'
  ].join('\n')
}

export async function reivindicarAutomacaoFalha(casa, input, { at } = {}) {
  const executor = safeText(input?.executorId, 'Identificador do executor', 3, 240)
  const requestedJobId = input?.jobId === undefined
    ? null
    : safeText(input.jobId, 'Identificador do trabalho', 3, 240)
  const timestamp = now(at)
  await sincronizarAutomacaoFalhas(casa, { at: timestamp })
  const [failures, contract] = await Promise.all([lerFalhas(casa), policy()])
  const release = await lock(casa)
  try {
    const store = await load(casa)
    if (store.jobs.filter((item) => item.state === 'running').length >= contract.maximumConcurrentJobs) {
      return { result: 'busy', job: null, prompt: null }
    }
    let job = null
    let pattern = null
    let changed = false
    const candidates = store.jobs
      .filter((item) => item.state === 'queued' && (requestedJobId === null || item.id === requestedJobId))
      .sort((left, right) => Number(right.dispatchState === 'requested') - Number(left.dispatchState === 'requested'))
    for (const candidate of candidates) {
      const current = failures.patterns.find((item) => item.id === candidate.patternId)
      if (!current || !eligible(current, contract) || generation(current) !== candidate.generationFingerprint) {
        candidate.state = 'superseded'
        candidate.updatedAt = timestamp
        changed = true
        continue
      }
      job = candidate
      pattern = current
      break
    }
    if (!job) {
      if (changed) await save(casa, store)
      return { result: 'empty', job: null, prompt: null }
    }
    // Publicar o briefing reserva o despacho; nÃ£o prova inÃ­cio do executor.
    // Somente a reivindicaÃ§Ã£o real do worker move o job para `running`.
    job.state = 'running'
    job.attempts += 1
    job.executorFingerprint = hash(executor)
    job.dispatchState = 'requested'
    job.dispatchRequestedAt ??= timestamp
    job.leaseUntil = new Date(Date.parse(timestamp) + contract.leaseMinutes * 60_000).toISOString()
    job.updatedAt = timestamp
    await save(casa, store)
    return { result: 'claimed', job, prompt: promptFor(job, pattern) }
  } finally {
    await release()
  }
}

export async function prepararDespachoAutomaticoFalha(casa, input, { at } = {}) {
  const sessionId = safeText(input?.sessionId, 'Identificador da sessao', 3, 500)
  const executor = safeText(input?.executorId, 'Identificador do executor', 3, 240)
  const visibilitySource = safeText(
    input?.visibilitySource ?? 'hook-additional-context',
    'Fonte da visibilidade',
    3,
    240
  )
  const timestamp = now(at)
  const activeTurn = await resolverTurnoAtivoAuditoria(casa, sessionId)
  if (activeTurn.result !== 'active') {
    return { result: 'active-turn-required', job: null, prompt: null, delegation: null }
  }

  await sincronizarAutomacaoFalhas(casa, { at: timestamp })
  const [failures, contract] = await Promise.all([lerFalhas(casa), policy()])
  const release = await lock(casa)
  try {
    const store = await load(casa)
    if (store.jobs.filter((item) => item.state === 'running').length >= contract.maximumConcurrentJobs) {
      return { result: 'busy', job: null, prompt: null, delegation: null }
    }
    let job = null
    let pattern = null
    let changed = false
    for (const candidate of store.jobs.filter((item) =>
      item.state === 'queued' && item.dispatchState === 'not-requested'
    )) {
      const current = failures.patterns.find((item) => item.id === candidate.patternId)
      if (!current || !eligible(current, contract) || generation(current) !== candidate.generationFingerprint) {
        candidate.state = 'superseded'
        candidate.updatedAt = timestamp
        changed = true
        continue
      }
      job = candidate
      pattern = current
      break
    }
    if (!job) {
      if (changed) await save(casa, store)
      return { result: 'empty', job: null, prompt: null, delegation: null }
    }

    const prompt = promptFor(job, pattern)
    const visible = await prepararDelegacaoVisivelIdempotente(casa, {
      target: 'background-subagent',
      prompt,
      sessionId,
      idempotencyKey: `failure-dispatch:${job.id}`,
      visibilityEvidence: `${visibilitySource}:${job.id}:${job.generationFingerprint}`,
      authority: {
        source: 'owner-intent',
        turnFingerprint: activeTurn.binding.turnFingerprint,
        effects: [
          'recuperar evidencias locais no escopo da falha',
          'executar testes locais reversiveis',
          'registrar eval e proposta verificaveis'
        ],
        risk: {
          reversibility: 'reversible',
          reach: 'local-isolated',
          data: 'personal',
          mode: 'prepare-and-proceed'
        }
      }
    }, { at: timestamp })

    job.state = 'queued'
    job.executorFingerprint = null
    job.dispatchState = 'requested'
    job.dispatchRequestedAt = timestamp
    job.leaseUntil = new Date(Date.parse(timestamp) + contract.leaseMinutes * 60_000).toISOString()
    job.updatedAt = timestamp
    await save(casa, store)
    return {
      result: 'dispatch-requested',
      job,
      prompt,
      delegation: visible.delegation,
      delegationResult: visible.result
    }
  } finally {
    await release()
  }
}

async function finish(casa, id, state, value, { at } = {}) {
  const label = state === 'blocked' ? 'Motivo do bloqueio' : 'Identificador da evidência'
  const safe = safeText(value, label, 3, 500)
  const timestamp = now(at)
  const [failures, contract] = await Promise.all([lerFalhas(casa), policy()])
  const release = await lock(casa)
  try {
    const store = await load(casa)
    const job = store.jobs.find((item) => item.id === id)
    if (!job) return { result: 'not-found', job: null }
    const pattern = failures.patterns.find((item) => item.id === job.patternId)
    if (!pattern || generation(pattern) !== job.generationFingerprint) {
      job.state = 'superseded'
      job.leaseUntil = null
      job.reasonFingerprint = hash('geracao de evidencia substituida durante a execucao')
      job.updatedAt = timestamp
      await save(casa, store)
      return { result: 'stale-generation', job }
    }
    const successfulTests = pattern.fixTests.filter((item) =>
      item.verified &&
      item.success &&
      item.consistent &&
      item.automationJobId === job.id &&
      item.hypothesisFingerprint === pattern.analysis?.hypothesisFingerprint
    )
    const distinctActions = new Set(successfulTests.map((item) => item.auditActionId)).size
    const distinctExecutions = new Set(successfulTests.map((item) => item.executionFingerprint)).size
    const consistentStrategies = new Set(successfulTests.map((item) => item.strategyFingerprint)).size <= 1
    const consistentCriteria = new Set(successfulTests.map((item) => item.criterionFingerprint)).size <= 1
    const evaluated = pattern.status === 'evaluated' && pattern.evaluation?.passed === true &&
      distinctActions >= contract.minimumSuccessfulFixTests &&
      distinctExecutions >= contract.minimumSuccessfulFixTests &&
      consistentStrategies && consistentCriteria
    if (state === 'completed' && !evaluated) {
      return { result: 'not-evaluated', requiredStatus: 'evaluated', job }
    }
    if (
      state === 'completed' &&
      job.state === 'completed' &&
      job.evidenceFingerprint === null
    ) {
      job.evidenceFingerprint = hash(safe)
      job.reasonFingerprint = null
      job.updatedAt = timestamp
      await save(casa, store)
      return { result: 'completed', job }
    }
    if (job.state !== 'running') return { result: 'not-running', job }
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

export async function contextoAutomacaoFalhas(
  casa,
  { sessionId = 'session-unknown', hookEventName = 'UserPromptSubmit', at } = {}
) {
  const claimed = await prepararDespachoAutomaticoFalha(casa, {
    sessionId,
    executorId: `host-model:${hash(sessionId)}`,
    visibilitySource: `hook-additional-context:${hookEventName}`
  }, { at })
  if (claimed.result !== 'dispatch-requested') return null
  return [
    `AUTOMAÇÃO DE FALHAS: trabalho ${claimed.job.id} reivindicado de modo determinístico e despacho solicitado.`,
    `A delegação ${claimed.delegation.id} foi preparada e marcada como \`visible\` com o briefing abaixo.`,
    'O runtime registrou `dispatch-requested`; isso não prova que o host iniciou o subagente.',
    'Inicie agora um subagente em segundo plano com o briefing integral abaixo. Não peça nova autorização ao proprietário:',
    '<failure-dispatch-briefing>',
    claimed.prompt,
    '</failure-dispatch-briefing>'
  ].join('\n')
}
