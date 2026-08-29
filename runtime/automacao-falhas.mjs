import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { geracaoPadraoFalha, lerFalhas } from './falhas.mjs'
import { pareceConterSegredo } from './memoria.mjs'
import { criarSolicitacaoDelegacao } from './porta-delegacao.mjs'

export const FAILURE_AUTOMATION_SCHEMA_VERSION = 4

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const POLICY_PATH = new URL('../contratos/aprendizado/falhas.json', import.meta.url)
const STATES = new Set(['queued', 'running', 'needs-owner', 'completed', 'superseded'])
const DISPATCH_STATES = new Set(['not-requested', 'requested'])
const REASON_CLASSES = new Set([null, 'retryable', 'owner-authority', 'legacy-unverified', 'lease-expired'])
const HASH = /^[a-f0-9]{64}$/

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
    automation?.executorCapability !== 'failure-validation' ||
    automation?.transport !== 'adapter-owned' ||
    automation?.requiresOwnerPrompt !== false ||
    automation?.dispatchGuarantee !== 'required-until-started-event' ||
    automation?.realStartEventRequired !== true ||
    automation?.startEvidence !== 'neutral-delegation-started' ||
    automation?.stopGateRequiresStart !== true ||
    automation?.retryableFailureDisposition !== 'requeue-different-strategy' ||
    automation?.terminalBlockedState !== false ||
    automation?.ownerDecisionOnlyForConcreteAuthorityExpansion !== true ||
    !Number.isInteger(value.minimumSuccessfulFixTests) ||
    value.minimumSuccessfulFixTests < 2 ||
    !Number.isInteger(automation.dispatchTimeoutMinutes) ||
    automation.dispatchTimeoutMinutes < 1 ||
    !Number.isInteger(automation.leaseMinutes) ||
    automation.leaseMinutes < 5 ||
    !Number.isInteger(automation.maximumConcurrentJobs) ||
    automation.maximumConcurrentJobs < 1 ||
    !Array.isArray(automation.excludedActions) ||
    !Array.isArray(automation.ownerAuthorizationRequiredFor) ||
    !Array.isArray(automation.ownerAuthorityEffects) ||
    automation.ownerAuthorityEffects.length === 0
  ) throw new Error('Automação de falhas fora do contrato proativo v4.')
  return { ...automation, minimumSuccessfulFixTests: value.minimumSuccessfulFixTests }
}

function emptyStore(at = now()) {
  return {
    schemaVersion: FAILURE_AUTOMATION_SCHEMA_VERSION,
    store: { id: 'omni-local-failure-automation', createdAt: at, updatedAt: at },
    jobs: []
  }
}

function clearDispatch(job, { preserveAuthority = false } = {}) {
  job.dispatchState = 'not-requested'
  job.dispatchRequestedAt = null
  job.dispatchExpiresAt = null
  job.dispatchSessionFingerprint = null
  job.delegationId = null
  if (!preserveAuthority) job.authorityFingerprint = null
  job.startedAt = null
  job.leaseUntil = null
  job.executorFingerprint = null
  job.stopBlocksIssued = 0
}

function migrateLegacy(store) {
  const migrated = structuredClone(store)
  migrated.schemaVersion = FAILURE_AUTOMATION_SCHEMA_VERSION
  migrated.jobs = (Array.isArray(migrated.jobs) ? migrated.jobs : []).map((legacy) => {
    const legacyState = legacy.state
    const legacyAttempts = Number.isInteger(legacy.attempts) && legacy.attempts >= 0 ? legacy.attempts : 0
    const terminal = ['completed', 'superseded'].includes(legacyState)
    return {
      ...legacy,
      state: terminal ? legacyState : 'queued',
      attempts: terminal ? legacyAttempts : 0,
      legacyAttempts,
      dispatchState: 'not-requested',
      dispatchRequestedAt: null,
      dispatchExpiresAt: null,
      dispatchSessionFingerprint: null,
      delegationId: null,
      authorityFingerprint: null,
      startedAt: null,
      leaseUntil: null,
      executorFingerprint: null,
      evidenceFingerprint: legacy.evidenceFingerprint ?? null,
      reasonFingerprint: legacy.reasonFingerprint ?? null,
      reasonClass: terminal ? null : (legacyState === 'blocked' || legacyAttempts > 0 ? 'legacy-unverified' : null),
      requiredEffectFingerprint: null,
      targetFingerprint: null,
      nextAttemptAt: null,
      strategyFingerprints: [],
      stopBlocksIssued: 0,
      queuedAt: legacy.queuedAt ?? legacy.updatedAt ?? migrated.store?.createdAt ?? now(),
      updatedAt: legacy.updatedAt ?? migrated.store?.updatedAt ?? now()
    }
  })
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
  return value === null || (typeof value === 'string' && HASH.test(value))
}

function identifierOrNull(value) {
  return value === null || (typeof value === 'string' && value.length >= 3 && value.length <= 500)
}

function validJob(job) {
  const base = Boolean(
    job &&
      typeof job.id === 'string' && job.id.startsWith('failure-job-') &&
      typeof job.patternId === 'string' && job.patternId.startsWith('failure-pattern-') &&
      HASH.test(job.generationFingerprint ?? '') &&
      STATES.has(job.state) &&
      DISPATCH_STATES.has(job.dispatchState) &&
      dateOrNull(job.dispatchRequestedAt) &&
      dateOrNull(job.dispatchExpiresAt) &&
      fingerprintOrNull(job.dispatchSessionFingerprint) &&
      identifierOrNull(job.delegationId) &&
      fingerprintOrNull(job.authorityFingerprint) &&
      Number.isInteger(job.attempts) && job.attempts >= 0 &&
      Number.isInteger(job.legacyAttempts) && job.legacyAttempts >= 0 &&
      dateOrNull(job.startedAt) &&
      dateOrNull(job.leaseUntil) &&
      fingerprintOrNull(job.executorFingerprint) &&
      fingerprintOrNull(job.evidenceFingerprint) &&
      fingerprintOrNull(job.reasonFingerprint) &&
      REASON_CLASSES.has(job.reasonClass) &&
      fingerprintOrNull(job.requiredEffectFingerprint) &&
      fingerprintOrNull(job.targetFingerprint) &&
      dateOrNull(job.nextAttemptAt) &&
      Array.isArray(job.strategyFingerprints) &&
      job.strategyFingerprints.every((item) => HASH.test(item)) &&
      new Set(job.strategyFingerprints).size === job.strategyFingerprints.length &&
      Number.isInteger(job.stopBlocksIssued) && job.stopBlocksIssued >= 0 &&
      Number.isFinite(Date.parse(job.queuedAt)) &&
      Number.isFinite(Date.parse(job.updatedAt))
  )
  if (!base) return false
  if (job.state === 'queued') {
    if (job.startedAt !== null || job.leaseUntil !== null || job.executorFingerprint !== null) return false
    if (job.dispatchState === 'requested') {
      return job.dispatchRequestedAt !== null && job.dispatchExpiresAt !== null &&
        job.dispatchSessionFingerprint !== null && job.delegationId !== null && job.authorityFingerprint !== null
    }
    return job.dispatchRequestedAt === null && job.dispatchExpiresAt === null &&
      job.dispatchSessionFingerprint === null && job.delegationId === null && job.authorityFingerprint === null
  }
  if (job.state === 'running') {
    return job.dispatchState === 'requested' && job.dispatchRequestedAt !== null &&
      job.dispatchExpiresAt === null && job.dispatchSessionFingerprint !== null &&
      job.delegationId !== null && job.authorityFingerprint !== null &&
      job.attempts >= 1 && job.startedAt !== null && job.leaseUntil !== null &&
      job.executorFingerprint !== null
  }
  if (job.state === 'needs-owner') {
    return job.dispatchState === 'not-requested' && job.dispatchRequestedAt === null &&
      job.dispatchExpiresAt === null && job.dispatchSessionFingerprint === null &&
      job.delegationId === null && job.authorityFingerprint !== null &&
      job.startedAt === null && job.leaseUntil === null && job.executorFingerprint === null &&
      job.reasonClass === 'owner-authority' && job.requiredEffectFingerprint !== null &&
      job.targetFingerprint !== null
  }
  return true
}

function validateStore(store, path) {
  if (
    store?.schemaVersion !== FAILURE_AUTOMATION_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-failure-automation' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !Array.isArray(store.jobs) ||
    !store.jobs.every(validJob)
  ) throw new Error(`Automação de falhas fora do contrato v4: ${path}`)
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
    if ([1, 2, 3].includes(store.schemaVersion)) {
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

function newJob(pattern, generationFingerprint, timestamp) {
  return {
    id: `failure-job-${randomUUID()}`,
    patternId: pattern.id,
    generationFingerprint,
    state: 'queued',
    attempts: 0,
    legacyAttempts: 0,
    dispatchState: 'not-requested',
    dispatchRequestedAt: null,
    dispatchExpiresAt: null,
    dispatchSessionFingerprint: null,
    delegationId: null,
    authorityFingerprint: null,
    startedAt: null,
    leaseUntil: null,
    executorFingerprint: null,
    evidenceFingerprint: null,
    reasonFingerprint: null,
    reasonClass: null,
    requiredEffectFingerprint: null,
    targetFingerprint: null,
    nextAttemptAt: null,
    strategyFingerprints: [],
    stopBlocksIssued: 0,
    queuedAt: timestamp,
    updatedAt: timestamp
  }
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
        clearDispatch(job)
        job.reasonClass = 'lease-expired'
        job.reasonFingerprint = hash(`lease-expired:${job.id}:${job.attempts}`)
        job.nextAttemptAt = timestamp
        job.updatedAt = timestamp
      } else if (
        job.state === 'queued' && job.dispatchState === 'requested' &&
        Date.parse(job.dispatchExpiresAt) <= Date.parse(timestamp)
      ) {
        clearDispatch(job)
        job.updatedAt = timestamp
      }
    }

    const patternsById = new Map(failures.patterns.map((pattern) => [pattern.id, pattern]))
    for (const job of store.jobs.filter((item) => ['queued', 'running', 'needs-owner'].includes(item.state))) {
      const pattern = patternsById.get(job.patternId)
      if (!pattern) {
        job.state = 'superseded'
        clearDispatch(job)
        job.updatedAt = timestamp
        continue
      }
      if (pattern.status === 'evaluated') {
        // A avaliação pronta não pode fingir que o executor terminou. Um job em
        // execução só fecha por concluirAutomacaoFalha, com evidência própria.
        if (job.state === 'running') continue
        job.state = 'completed'
        clearDispatch(job)
        job.evidenceFingerprint = hash(
          `evaluation:${pattern.id}:${job.generationFingerprint}:${pattern.evaluation?.evaluatedAt ?? 'unknown'}`
        )
        job.reasonFingerprint = null
        job.reasonClass = null
        job.requiredEffectFingerprint = null
        job.targetFingerprint = null
        job.updatedAt = timestamp
        continue
      }
      if (!eligible(pattern, contract) || job.generationFingerprint !== generation(pattern)) {
        job.state = 'superseded'
        clearDispatch(job)
        job.updatedAt = timestamp
      }
    }

    for (const pattern of failures.patterns) {
      if (pattern.status === 'evaluated' || !eligible(pattern, contract)) continue
      const generationFingerprint = generation(pattern)
      const sameGeneration = store.jobs.filter(
        (item) => item.patternId === pattern.id && item.generationFingerprint === generationFingerprint
      )
      const active = sameGeneration.filter((item) => ['queued', 'running', 'needs-owner'].includes(item.state))
      if (active.length > 1) {
        const keeper = active.find((item) => item.state === 'running') ??
          active.find((item) => item.state === 'needs-owner') ?? active[0]
        for (const duplicate of active) {
          if (duplicate.id === keeper.id) continue
          duplicate.state = 'superseded'
          clearDispatch(duplicate)
          duplicate.updatedAt = timestamp
        }
      }
      if (sameGeneration.some((item) => item.state !== 'superseded')) continue
      store.jobs.push(newJob(pattern, generationFingerprint, timestamp))
    }

    const activeJobs = store.jobs.filter((item) => ['queued', 'running', 'needs-owner'].includes(item.state))
    const terminalJobs = store.jobs.filter((item) => !['queued', 'running', 'needs-owner'].includes(item.state)).slice(-200)
    store.jobs = [...terminalJobs, ...activeJobs.filter((item) => !terminalJobs.some((terminal) => terminal.id === item.id))]
    await save(casa, store)
    return store
  } finally {
    await release()
  }
}

function promptFor(job, pattern) {
  const operator = join(raiz, 'scripts', 'omni.ps1')
  const previousStrategies = job.strategyFingerprints.length === 0
    ? 'nenhuma estratégia anterior registrada'
    : `${job.strategyFingerprints.length} estratégia(s) anterior(es) já falharam; use uma estratégia materialmente diferente`
  return [
    'Você é o executor temporário de validação de falhas do Omni. Conduza o ciclo no canal externo com a autoridade herdada da tarefa original.',
    '',
    `Trabalho: ${job.id}`,
    `Padrão: ${pattern.id}`,
    `Geração da evidência: ${job.generationFingerprint}`,
    `Tentativa real esperada: ${job.attempts + 1}`,
    `Histórico seguro: ${previousStrategies}.`,
    `Ação: ${pattern.action}`,
    `Classe: ${pattern.failureClass}`,
    `Ocorrências distintas: ${pattern.occurrences}`,
    `Operador canônico: powershell -NoProfile -ExecutionPolicy Bypass -File "${operator}"`,
    '',
    'Este trabalho já está vinculado a uma solicitação neutra de delegação. Somente o evento `started` do adaptador confirma o início; não reivindique o trabalho por comando.',
    'Objetivo obrigatório:',
    '1. Recupere evidência local suficiente nas sessões JSONL e no projeto relacionado. Sustente a causa raiz em evidência recuperada, nunca apenas no hash.',
    '2. Determine causa raiz e hipótese verificável; registre com `falha-analisar <padrao> --geracao <geracao> --causa <texto> --hipotese <texto>`.',
    `3. Depois da análise, rode \`falha-evidencias ${pattern.id} --job ${job.id}\` e copie o \`bindingMarker\`. Defina um único critério determinístico e acrescente \`# <bindingMarker>\` ao fim de cada comando real de verificação. Execute a mesma estratégia duas vezes de verdade, em execuções independentes; uma ação sem esse marcador não pertence a este trabalho.`,
    `4. Após cada execução, rode novamente \`falha-evidencias ${pattern.id} --job ${job.id}\` e escolha a ação vinculada. Registre com \`falha-testar ${pattern.id} --job ${job.id} --geracao ${job.generationFingerprint} --acao-auditoria <id> --evidencia-auditoria <id> --criterio <mesmo-criterio>\`. Resultado, sucesso e IDs livres não são aceitos.`,
    '5. Se os dois testes forem bem-sucedidos e consistentes, rode `falha-avaliar <padrao> --geracao <geracao>` para gerar o eval e a proposta avaliável.',
    `6. Finalize com \`falha-automacao-concluir ${job.id} --execucao <id-da-evidencia>\`. Falha técnica deve usar \`falha-automacao-bloquear ${job.id} --tipo retryable --motivo <motivo-seguro> --evidencia <id> --estrategia <estrategia>\`; somente uma expansão concreta de autoridade usa \`--tipo owner-authority --efeito <codigo> --alvo <alvo-concreto>\`.`,
    '',
    'Autoridade e controle de efeito:',
    '- O envelope de autoridade é o objetivo, o alvo, o escopo material e os efeitos explicitamente autorizados na tarefa original. Passos instrumentais proporcionais dentro desse envelope já estão autorizados.',
    '- Falha de ferramenta, permissão já concedida que não funcionou ou estratégia insuficiente não pede o proprietário: registre evidência e reagende com outra estratégia.',
    '- Somente uma nova classe concreta de efeito fora do envelope pode entrar em needs-owner, sempre com efeito e alvo explícitos.',
    '- Antes de alterar estado, registre o estado inicial e um checkpoint verificável; escolha uma via reversível e prepare rollback proporcional ao efeito.',
    '- Depois de cada alteração, verifique o resultado real e anexe evidência da execução e, quando usado, da reversão.',
    '- Registre no store somente resumo seguro e identificadores; a evidência local protegida preserva os detalhes necessários.',
    '',
    'Entregue ao Omni: causa comprovada, hipótese, os dois IDs de ação/evidência verificados, eval e proposta criada, nova tentativa agendada ou expansão concreta de autoridade.'
  ].join('\n')
}

// Compatibilidade de leitura: este comando não constitui prova de execução.
// Somente confirmarInicioAutomacaoFalha, após um evento neutro `started`, muda queued -> running.
export async function reivindicarAutomacaoFalha(casa, input, { at } = {}) {
  safeText(input?.executorId, 'Identificador do executor', 3, 240)
  const requestedJobId = input?.jobId === undefined
    ? null
    : safeText(input.jobId, 'Identificador do trabalho', 3, 240)
  const store = await sincronizarAutomacaoFalhas(casa, { at })
  const job = store.jobs.find((item) =>
    (requestedJobId === null || item.id === requestedJobId) && ['queued', 'running'].includes(item.state)
  ) ?? null
  if (!job) return { result: 'empty', job: null, prompt: null }
  return { result: job.state === 'running' ? 'already-started' : 'start-event-required', job, prompt: null }
}

function solicitacaoDaFalha(job, pattern, sessionId, contract) {
  return {
    sessionId,
    idempotencyKey: `failure-dispatch:${job.id}:attempt-${job.attempts + 1}`,
    destinationCapability: contract.executorCapability,
    brief: {
      objective: `Validar com evidencia o padrao de falha ${pattern.id}.`,
      scope: [
        'recuperar evidencia local vinculada ao padrao',
        'determinar causa raiz e hipotese verificavel',
        'executar duas verificacoes independentes e consistentes',
        'registrar eval e proposta somente quando os gates passarem'
      ],
      constraints: [
        'preservar privacidade e nao persistir conversa bruta',
        'usar somente a autoridade material herdada do pedido',
        'reagendar falha tecnica com estrategia materialmente diferente'
      ],
      successCriteria: [
        'causa raiz sustentada por evidencia',
        'dois testes reais vinculados ao mesmo criterio',
        'eval e proposta rastreaveis ou bloqueio concreto de autoridade'
      ]
    },
    effectClasses: ['read', 'execute'],
    risk: {
      reversibility: 'reversible',
      reach: 'local-isolated',
      data: 'personal',
      mode: 'proceed'
    }
  }
}

export async function prepararDespachoAutomaticoFalha(casa, input, { at } = {}) {
  const sessionId = safeText(input?.sessionId, 'Identificador da sessao', 3, 500)
  const timestamp = now(at)

  await sincronizarAutomacaoFalhas(casa, { at: timestamp })
  const [failures, contract] = await Promise.all([lerFalhas(casa), policy()])
  const sessionFingerprint = hash(sessionId)
  const release = await lock(casa)
  try {
    const store = await load(casa)
    const pending = store.jobs.find((item) =>
      item.state === 'queued' && item.dispatchState === 'requested' &&
      item.dispatchSessionFingerprint === sessionFingerprint
    )
    if (pending) {
      const pattern = failures.patterns.find((item) => item.id === pending.patternId)
      if (pattern) {
        let neutral
        try {
          neutral = await criarSolicitacaoDelegacao(
            casa,
            solicitacaoDaFalha(pending, pattern, sessionId, contract),
            { at: timestamp }
          )
        } catch (error) {
          if (/turno Omni auditado ativo/i.test(error?.message ?? '')) {
            return { result: 'active-turn-required', job: null, prompt: null, request: null, delegation: null }
          }
          throw error
        }
        return {
          result: 'dispatch-required',
          job: pending,
          prompt: promptFor(pending, pattern),
          request: neutral.request,
          delegation: neutral.delegation,
          delegationResult: neutral.result
        }
      }
      clearDispatch(pending)
      pending.updatedAt = timestamp
    }

    if (store.jobs.some((item) => item.state === 'queued' && item.dispatchState === 'requested')) {
      await save(casa, store)
      return { result: 'busy', job: null, prompt: null, delegation: null }
    }
    if (store.jobs.filter((item) => item.state === 'running').length >= contract.maximumConcurrentJobs) {
      await save(casa, store)
      return { result: 'busy', job: null, prompt: null, delegation: null }
    }

    let job = null
    let pattern = null
    for (const candidate of store.jobs.filter((item) =>
      item.state === 'queued' && item.dispatchState === 'not-requested' &&
      (item.nextAttemptAt === null || Date.parse(item.nextAttemptAt) <= Date.parse(timestamp))
    )) {
      const current = failures.patterns.find((item) => item.id === candidate.patternId)
      if (!current || !eligible(current, contract) || generation(current) !== candidate.generationFingerprint) {
        candidate.state = 'superseded'
        clearDispatch(candidate)
        candidate.updatedAt = timestamp
        continue
      }
      job = candidate
      pattern = current
      break
    }
    if (!job) {
      await save(casa, store)
      return { result: 'empty', job: null, prompt: null, delegation: null }
    }

    const prompt = promptFor(job, pattern)
    let neutral
    try {
      neutral = await criarSolicitacaoDelegacao(
        casa,
        solicitacaoDaFalha(job, pattern, sessionId, contract),
        { at: timestamp }
      )
    } catch (error) {
      if (/turno Omni auditado ativo/i.test(error?.message ?? '')) {
        return { result: 'active-turn-required', job: null, prompt: null, request: null, delegation: null }
      }
      throw error
    }

    job.state = 'queued'
    job.dispatchState = 'requested'
    job.dispatchRequestedAt = timestamp
    job.dispatchExpiresAt = new Date(Date.parse(timestamp) + contract.dispatchTimeoutMinutes * 60_000).toISOString()
    job.dispatchSessionFingerprint = sessionFingerprint
    job.delegationId = neutral.request.delegationId
    job.authorityFingerprint = neutral.request.authority.ref
    job.startedAt = null
    job.leaseUntil = null
    job.executorFingerprint = null
    job.nextAttemptAt = null
    job.stopBlocksIssued = 0
    job.updatedAt = timestamp
    await save(casa, store)
    return {
      result: 'dispatch-required',
      job,
      prompt,
      request: neutral.request,
      delegation: neutral.delegation,
      delegationResult: neutral.result
    }
  } finally {
    await release()
  }
}

export async function confirmarInicioAutomacaoFalha(casa, input, { at } = {}) {
  const sessionId = safeText(input?.sessionId, 'Identificador da sessao', 3, 500)
  const delegationId = safeText(input?.delegationId, 'Identificador da delegacao', 3, 500)
  const executorId = safeText(input?.executorId ?? input?.agentId, 'Identificador do executor', 3, 500)
  const timestamp = now(at)
  await sincronizarAutomacaoFalhas(casa, { at: timestamp })
  const contract = await policy()
  const sessionFingerprint = hash(sessionId)
  const executorFingerprint = hash(executorId)
  const release = await lock(casa)
  try {
    const store = await load(casa)
    const alreadyStarted = store.jobs.find((item) =>
      item.state === 'running' && item.dispatchSessionFingerprint === sessionFingerprint &&
      item.delegationId === delegationId && item.executorFingerprint === executorFingerprint
    )
    if (alreadyStarted) return { result: 'already-started', job: alreadyStarted }

    const job = store.jobs.find((item) =>
      item.state === 'queued' && item.dispatchState === 'requested' &&
      item.dispatchSessionFingerprint === sessionFingerprint && item.delegationId === delegationId
    )
    if (!job || Date.parse(job.dispatchExpiresAt) <= Date.parse(timestamp)) return { result: 'ignored', job: null }
    if (store.jobs.filter((item) => item.state === 'running').length >= contract.maximumConcurrentJobs) {
      return { result: 'busy', job: null }
    }
    job.state = 'running'
    job.attempts += 1
    job.startedAt = timestamp
    job.executorFingerprint = executorFingerprint
    job.leaseUntil = new Date(Date.parse(timestamp) + contract.leaseMinutes * 60_000).toISOString()
    job.dispatchExpiresAt = null
    job.nextAttemptAt = null
    job.stopBlocksIssued = 0
    job.updatedAt = timestamp
    await save(casa, store)
    return { result: 'started', job }
  } finally {
    await release()
  }
}

export async function localizarDespachoAtivoAutomacaoFalha(casa, input, { at } = {}) {
  const sessionId = safeText(input?.sessionId, 'Identificador da sessao', 3, 500)
  const sessionFingerprint = hash(sessionId)
  const store = await sincronizarAutomacaoFalhas(casa, { at })
  const matches = store.jobs.filter((item) =>
    item.state === 'queued' &&
    item.dispatchState === 'requested' &&
    item.dispatchSessionFingerprint === sessionFingerprint &&
    item.delegationId !== null
  )
  if (matches.length > 1) {
    throw new Error('Mais de um despacho de falha ativo para a mesma sessao.')
  }
  return { result: matches.length === 1 ? 'found' : 'empty', job: matches[0] ?? null }
}

export async function exigirInicioDespachoAntesDaParada(casa, input, { at } = {}) {
  const sessionId = safeText(input?.sessionId, 'Identificador da sessao', 3, 500)
  const timestamp = now(at)
  const sessionFingerprint = hash(sessionId)
  const release = await lock(casa)
  try {
    const store = await load(casa)
    const job = store.jobs.find((item) =>
      item.state === 'queued' && item.dispatchState === 'requested' &&
      item.dispatchSessionFingerprint === sessionFingerprint
    )
    if (!job) return { result: 'clear', decision: null, reason: null, job: null }
    if (input?.stopHookActive === true || job.stopBlocksIssued >= 1) {
      return { result: 'pending-recursion', decision: null, reason: null, job }
    }
    job.stopBlocksIssued += 1
    job.updatedAt = timestamp
    await save(casa, store)
    return {
      result: 'start-required',
      decision: 'block',
      reason: [
        '[failure-dispatch-not-started] A automação proativa ainda não recebeu prova real de início.',
        `Trabalho: ${job.id}.`,
        `Delegação: ${job.delegationId}.`,
        'Inicie agora o executor pelo adaptador; somente o evento neutro `started` libera este gate.'
      ].join(' '),
      job
    }
  } finally {
    await release()
  }
}

async function complete(casa, id, evidenceId, { at } = {}) {
  const safe = safeText(evidenceId, 'Identificador da evidência', 3, 500)
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
      clearDispatch(job)
      job.reasonFingerprint = hash('geracao de evidencia substituida durante a execucao')
      job.updatedAt = timestamp
      await save(casa, store)
      return { result: 'stale-generation', job }
    }
    const successfulTests = pattern.fixTests.filter((item) =>
      item.verified && item.success && item.consistent && item.automationJobId === job.id &&
      item.hypothesisFingerprint === pattern.analysis?.hypothesisFingerprint
    )
    const distinctActions = new Set(successfulTests.map((item) => item.auditActionId)).size
    const distinctExecutions = new Set(successfulTests.map((item) => item.executionFingerprint)).size
    const consistentStrategies = new Set(successfulTests.map((item) => item.strategyFingerprint)).size <= 1
    const consistentCriteria = new Set(successfulTests.map((item) => item.criterionFingerprint)).size <= 1
    const evaluated = pattern.status === 'evaluated' && pattern.evaluation?.passed === true &&
      distinctActions >= contract.minimumSuccessfulFixTests && distinctExecutions >= contract.minimumSuccessfulFixTests &&
      consistentStrategies && consistentCriteria
    if (!evaluated) return { result: 'not-evaluated', requiredStatus: 'evaluated', job }
    if (job.state === 'completed' && job.evidenceFingerprint === null) {
      job.evidenceFingerprint = hash(safe)
      job.reasonFingerprint = null
      job.reasonClass = null
      job.updatedAt = timestamp
      await save(casa, store)
      return { result: 'completed', job }
    }
    if (job.state !== 'running') return { result: 'not-running', job }
    job.state = 'completed'
    clearDispatch(job)
    job.evidenceFingerprint = hash(safe)
    job.reasonFingerprint = null
    job.reasonClass = null
    job.requiredEffectFingerprint = null
    job.targetFingerprint = null
    job.updatedAt = timestamp
    await save(casa, store)
    return { result: 'completed', job }
  } finally {
    await release()
  }
}

export function concluirAutomacaoFalha(casa, id, evidenceId, options) {
  return complete(casa, id, evidenceId, options)
}

export async function bloquearAutomacaoFalha(casa, id, reason, options = {}) {
  const safeReason = safeText(reason, 'Motivo seguro', 3, 500)
  const kind = options.kind ?? 'retryable'
  if (!['retryable', 'owner-authority'].includes(kind)) {
    throw new Error('Tipo de interrupção inválido; use retryable ou owner-authority.')
  }
  const timestamp = now(options.at)
  await sincronizarAutomacaoFalhas(casa, { at: timestamp })
  const contract = await policy()
  const release = await lock(casa)
  try {
    const store = await load(casa)
    const job = store.jobs.find((item) => item.id === id)
    if (!job) return { result: 'not-found', job: null }
    if (job.state !== 'running') return { result: 'not-running', job }
    if (kind === 'retryable') {
      const evidenceId = safeText(options.evidenceId, 'Evidência da tentativa', 3, 500)
      const strategy = safeText(options.strategy, 'Estratégia tentada', 3, 500)
      const strategyFingerprint = hash(strategy)
      if (job.strategyFingerprints.includes(strategyFingerprint)) return { result: 'strategy-repeated', job }
      job.state = 'queued'
      clearDispatch(job)
      job.reasonClass = 'retryable'
      job.reasonFingerprint = hash(`${safeReason}|${evidenceId}`)
      job.requiredEffectFingerprint = null
      job.targetFingerprint = null
      job.nextAttemptAt = timestamp
      job.strategyFingerprints.push(strategyFingerprint)
      job.updatedAt = timestamp
      await save(casa, store)
      return { result: 'retry-scheduled', job }
    }

    const effect = safeText(options.effect, 'Efeito que exige autoridade', 3, 80)
    const target = safeText(options.target, 'Alvo concreto da expansão', 3, 500)
    if (!contract.ownerAuthorityEffects.includes(effect)) throw new Error(`Efeito fora da taxonomia de autoridade: ${effect}`)
    if (job.authorityFingerprint === null) throw new Error('Expansão de autoridade sem envelope de origem verificável.')
    job.state = 'needs-owner'
    clearDispatch(job, { preserveAuthority: true })
    job.reasonClass = 'owner-authority'
    job.reasonFingerprint = hash(safeReason)
    job.requiredEffectFingerprint = hash(effect)
    job.targetFingerprint = hash(target)
    job.nextAttemptAt = null
    job.updatedAt = timestamp
    await save(casa, store)
    return { result: 'needs-owner', job }
  } finally {
    await release()
  }
}
