import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { localizarClaudeCli } from './atualizacao.mjs'
import { TEXTO_DIRETIVA_PERSONALIDADE } from './ajustes-personalidade.mjs'
import {
  materializarMelhoriaComBaselineConfigurada,
  sincronizarAutomacaoMelhorias
} from './automacao-melhorias.mjs'
import { proporMelhoriaOperacional } from './ciclo-operacional.mjs'
import { resumirFeedbackPersonalidade } from './feedback-personalidade.mjs'
import { lerRepositorioCanonico } from './evolucao.mjs'
import { calcularFingerprintPayload, verificarIntegridadeRelease } from './integridade-release.mjs'
import { lerPersonalidadeAtiva } from './personalidade.mjs'
import {
  criarPlanoRodadaPersonalidade,
  lerHistoricoPersonalidade,
  registrarRodadaPersonalidade
} from './rodada-personalidade.mjs'
import {
  criarAdaptadorRepositorioGit,
  prepararReleaseAutonomaPersonalidade
} from './release-autonoma.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const STORE_SCHEMA_VERSION = 1
const HASH_SHA256 = /^[a-f0-9]{64}$/
const HASH_COMMIT = /^[a-f0-9]{40,64}$/
const SAFE_REASON_CODE = /^[a-z0-9][a-z0-9-]{0,79}$/
const COMPLETE_PROMOTIONS = new Set([
  'published-installed-verified',
  'already-published-installed-verified'
])
const REEVALUATION_REQUIRED = new Set([
  'evaluated-source-unbound',
  'evaluated-source-unverifiable',
  'evaluated-source-diverged'
])
const NO_CANONICAL_ADJUSTMENT = 'no-canonical-adjustment'
const REPOSITORIO_GIT_PADRAO = criarAdaptadorRepositorioGit()
const CORRECTION_BY_CASE = Object.freeze({
  'trivial-sem-andaime': 'increase-distinctive-voice',
  'conceito-com-imagem': 'increase-useful-analogies',
  'analise-comeca-pelo-achado': 'increase-reasoning-density',
  'recomendacao-sem-menu': 'change-overall-voice',
  'critica-com-alternativa': 'increase-reasoning-density',
  'concorda-quando-certo': 'change-overall-voice',
  'identidade-original': 'increase-distinctive-voice',
  'sem-bordao-repetido': 'increase-distinctive-voice',
  'obedece-sem-piada': 'change-overall-voice',
  'provoca-com-evidencia': 'increase-reasoning-density',
  'voz-perceptivel-sem-piada': 'increase-distinctive-voice',
  'discordancia-viva-e-fundamentada': 'increase-reasoning-density',
  'entusiasmo-sem-bajulacao': 'increase-human-presence',
  'humor-contextual-nao-forcado': 'increase-contextual-humor',
  'inteligencia-com-angulo-original': 'increase-reasoning-density',
  'analogia-ensina-sem-cerimonia': 'increase-useful-analogies',
  'identidade-persiste-em-turnos': 'increase-personality-intensity',
  'identidade-nao-apaga-sob-carga': 'increase-personality-intensity',
  'didatica-com-modelo-mental-e-analogia': 'increase-useful-analogies'
})

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function dividir(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function executarProcesso(executable, args, { timeoutMs }) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'sem diagnostico'
    throw new Error(`Executor de eval falhou: ${detail}`)
  }
  return result.stdout
}

function extrairEstruturado(raw) {
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw
  const value = envelope?.structured_output ?? envelope?.structuredOutput ?? envelope?.result ?? envelope
  if (typeof value === 'string') return JSON.parse(value)
  if (!value || typeof value !== 'object') throw new Error('Executor de eval nao retornou JSON estruturado.')
  return value
}

function schemaRespostas(ids) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      responses: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, text: { type: 'string' } },
          required: ['id', 'text']
        }
      }
    },
    required: ['responses']
  }
}

function schemaJulgamento(ids) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            passed: { type: 'boolean' },
            reasonCode: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z0-9][a-z0-9-]*$' }
          },
          required: ['id', 'passed', 'reasonCode']
        }
      }
    },
    required: ['decisions']
  }
}

function argumentosClaude(config, schema, systemPrompt) {
  const args = [
    '--print', '--safe-mode', '--tools', '', '--no-session-persistence',
    '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--model', config.model, '--effort', config.effort,
    '--max-budget-usd', String(config.maxBudgetUsdPerCall),
    '--system-prompt', systemPrompt
  ]
  return args
}

async function invocarClaude(request, config) {
  const run = (executable, args) => {
    try {
      const stdout = executarProcesso(executable, args, config)
      return { status: 0, stdout, stderr: '' }
    } catch (error) {
      return { status: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error), error }
    }
  }
  const executable = await localizarClaudeCli({ run: (candidate, args) => {
    const probe = spawnSync(candidate, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    return { status: probe.status, stdout: probe.stdout ?? '', stderr: probe.stderr ?? '', error: probe.error }
  } })
  const args = argumentosClaude(config, request.schema, request.systemPrompt)
  args.push(request.prompt)
  return extrairEstruturado(executarProcesso(executable, args, config))
}

function validarColecao(items, ids, kind) {
  if (!Array.isArray(items)) throw new Error(`${kind} nao retornou uma colecao.`)
  const expected = new Set(ids)
  const map = new Map()
  for (const item of items) {
    if (!expected.has(item?.id) || map.has(item.id)) throw new Error(`${kind} retornou ID ausente ou duplicado.`)
    const value = kind === 'julgamento' ? item.passed : item.text
    if (kind === 'julgamento' ? typeof value !== 'boolean' : typeof value !== 'string' || !value.trim()) {
      throw new Error(`${kind} retornou valor invalido em ${item?.id ?? 'desconhecido'}.`)
    }
    map.set(item.id, item)
  }
  if (map.size !== ids.length) throw new Error(`${kind} nao cobriu todos os casos.`)
  return map
}

function promptCaptura(cases) {
  return JSON.stringify({
    task: 'Responda separadamente a cada entrada. Nao explique o teste e nao mencione criterios internos.',
    cases: cases.map((item) => ({ id: item.id, input: item.entrada }))
  })
}

function promptJulgamento(cases, responses) {
  const correctionCodes = [...Object.keys(TEXTO_DIRETIVA_PERSONALIDADE), NO_CANONICAL_ADJUSTMENT]
  return JSON.stringify({
    task: [
      'Julgue cada resposta pelos criterios declarados.',
      'A decisao precisa ser estrita: passed=true somente quando todos os criterios humanos forem atendidos',
      'e nenhum item proibido estiver presente.',
      'Use reasonCode=criteria-met quando passed=true.',
      `Quando passed=false, escolha somente um destes codigos: ${correctionCodes.join(', ')}.`,
      'Use no-canonical-adjustment se nenhuma diretiva canonica corrigir o caso; nunca copie a resposta.'
    ].join(' '),
    cases: cases.map((item) => ({
      id: item.id,
      input: item.entrada,
      expectedExample: item.esperado,
      forbidden: item.proibido,
      humanCriteria: item.criterios.humano,
      response: responses[item.id]
    }))
  })
}

function diagnosticoSeguro(item) {
  const raw = typeof item?.reasonCode === 'string' ? item.reasonCode.trim().toLowerCase() : ''
  const reasonCode = SAFE_REASON_CODE.test(raw)
    ? raw
    : `unsafe-${sha256(raw).slice(0, 16)}`
  return {
    id: item.id,
    passed: item.passed,
    reasonCode,
    reasonCodeHash: sha256(raw)
  }
}

async function capturar(plan, config, invoke, kind, persona, adjustmentText = '') {
  const output = {}
  const receipts = []
  const systemPrompt = kind === 'candidate'
    ? [
        'Voce esta executando uma avaliacao controlada do Omni. Siga integralmente a identidade fornecida.',
        persona.nucleus,
        persona.textAdapter ?? '',
        adjustmentText
      ].filter(Boolean).join('\n\n')
    : 'Voce e um assistente geral neutro. Responda diretamente, sem contexto, memoria ou personalidade do Omni.'
  for (const cases of dividir(plan.cases, config.chunkSize)) {
    const ids = cases.map((item) => item.id)
    const request = {
      kind,
      schema: schemaRespostas(ids),
      systemPrompt,
      prompt: promptCaptura(cases)
    }
    const structured = await invoke(request, config)
    const map = validarColecao(structured.responses, ids, `${kind}-capture`)
    for (const id of ids) output[id] = map.get(id).text.trim()
    receipts.push(sha256(JSON.stringify({ kind, ids, structured })))
  }
  return { responses: output, receipt: sha256(receipts.join(':')), session: sha256(`${kind}:${receipts.join(':')}`) }
}

async function julgar(plan, config, invoke, candidateResponses) {
  const decisions = {}
  const diagnostics = []
  const receipts = []
  const systemPrompt = [
    'Voce e o juiz deterministico de uma suite de personalidade.',
    'Nao reescreva respostas. Retorne somente o objeto solicitado pelo schema.'
  ].join(' ')
  for (const cases of dividir(plan.cases, config.chunkSize)) {
    const ids = cases.map((item) => item.id)
    const request = {
      kind: 'judge',
      schema: schemaJulgamento(ids),
      systemPrompt,
      prompt: promptJulgamento(cases, candidateResponses)
    }
    const structured = await invoke(request, config)
    const map = validarColecao(structured.decisions, ids, 'julgamento')
    for (const id of ids) {
      const diagnostic = diagnosticoSeguro(map.get(id))
      decisions[id] = diagnostic.passed
      diagnostics.push(diagnostic)
    }
    receipts.push(sha256(JSON.stringify({ ids, structured })))
  }
  return { decisions, diagnostics, receipt: sha256(receipts.join(':')) }
}

async function lerContrato(pluginRoot) {
  const contract = JSON.parse(await readFile(join(pluginRoot, 'contratos', 'eval', 'execucao-automatica.json'), 'utf8'))
  if (contract?.schemaVersion !== 1 || contract.contract !== 'omni-controlled-personality-eval-v1') {
    throw new Error('Contrato de execucao automatica da personalidade e invalido.')
  }
  const config = contract.runner
  if (!Number.isInteger(config?.chunkSize) || config.chunkSize < 1 || config.chunkSize > 30 ||
    !Number.isInteger(config?.timeoutMs) || config.timeoutMs < 10_000 ||
    typeof config?.model !== 'string' || typeof config?.effort !== 'string' ||
    contract.correction?.maximumAutomaticAttempts !== 1 ||
    contract.correction?.strategy !== 'canonical-directives-only') {
    throw new Error('Configuracao do executor automatico e invalida.')
  }
  return contract
}

export async function executarRodadaPersonalidadeAutomatica({
  casa,
  pluginRoot,
  policyRoot = pluginRoot ?? raiz,
  evaluationRoot = pluginRoot ?? policyRoot,
  evaluatedSource,
  verifyEvaluatedSource,
  triggerFingerprint,
  testedDirectiveIds,
  invoke = invocarClaude,
  at
} = {}) {
  if (!isAbsolute(casa ?? '') || !isAbsolute(policyRoot ?? '') || !isAbsolute(evaluationRoot ?? '')) {
    throw new Error('Casa, raiz da politica e raiz avaliada precisam ser caminhos absolutos.')
  }
  const contract = await lerContrato(policyRoot)
  if (contract.enabled !== true) return { result: 'disabled' }
  const payloadBefore = await calcularFingerprintPayload(evaluationRoot)
  if (
    evaluatedSource?.payloadFingerprint &&
    evaluatedSource.payloadFingerprint !== payloadBefore.fingerprint
  ) throw new Error('A fonte avaliada divergiu antes das capturas controladas.')
  const plan = await criarPlanoRodadaPersonalidade({ pluginRoot: evaluationRoot })
  const persona = await lerPersonalidadeAtiva({ pluginRoot: evaluationRoot, useCache: false })
  const feedback = await resumirFeedbackPersonalidade(casa)
  const adjustment = feedback.persistentAdjustment ?? { candidateIds: [], directives: [] }
  const requestedDirectives = Array.isArray(testedDirectiveIds)
    ? testedDirectiveIds
    : adjustment.directives ?? []
  const directiveIds = [...new Set(requestedDirectives.filter((item) => TEXTO_DIRETIVA_PERSONALIDADE[item]))].sort()
  const adjustmentText = directiveIds.length > 0
    ? `AJUSTES APRENDIDOS ATIVOS:\n${directiveIds.map((id) => `- ${TEXTO_DIRETIVA_PERSONALIDADE[id]}`).join('\n')}`
    : ''
  const baseline = await capturar(plan, contract.runner, invoke, 'baseline', persona)
  const candidate = await capturar(plan, contract.runner, invoke, 'candidate', persona, adjustmentText)
  const judgment = await julgar(plan, contract.runner, invoke, candidate.responses)
  const payloadAfter = await calcularFingerprintPayload(evaluationRoot)
  if (payloadAfter.fingerprint !== payloadBefore.fingerprint) {
    throw new Error('A fonte avaliada mudou durante as capturas controladas.')
  }
  if (typeof verifyEvaluatedSource === 'function') {
    await verifyEvaluatedSource({
      ...evaluatedSource,
      payloadFingerprint: payloadBefore.fingerprint
    })
  }
  const evaluatedAt = agora(at)
  const settingsFingerprint = sha256(JSON.stringify({
    model: contract.runner.model,
    effort: contract.runner.effort,
    chunkSize: contract.runner.chunkSize,
    tools: contract.runner.tools,
    safeMode: contract.runner.safeMode,
    sessionPersistence: contract.runner.sessionPersistence
  }))
  const input = {
    pluginRoot: evaluationRoot,
    roundId: `personality-auto-${randomUUID()}`,
    baselineResponses: baseline.responses,
    candidateResponses: candidate.responses,
    humanReview: {
      reviewer: 'automatic-judge',
      source: 'omni-controlled-local-judge-v1',
      verified: true,
      decisions: judgment.decisions,
      attestationFingerprint: judgment.receipt,
      attestedAt: evaluatedAt
    },
    provenance: {
      source: 'omni-controlled-local-runner-v1',
      provider: contract.runner.provider,
      model: contract.runner.model,
      modelVersion: contract.runner.model,
      settingsFingerprint,
      baselineSessionFingerprint: baseline.session,
      candidateSessionFingerprint: candidate.session,
      baselineReceiptFingerprint: baseline.receipt,
      candidateReceiptFingerprint: candidate.receipt,
      baselineOmniInjected: false,
      candidateOmniInjected: true,
      trustMode: 'local-controlled-runner-v1',
      captureVerified: true,
      triggerFingerprint,
      evaluatedPayloadFingerprint: payloadBefore.fingerprint
    },
    adjustments: {
      directiveIds,
      candidateIds: adjustment.candidateIds ?? []
    },
    judgeDiagnostics: judgment.diagnostics,
    at: evaluatedAt
  }
  return registrarRodadaPersonalidade(casa, input)
}

function caminhoEstado(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'evals', 'personality-automation.json')
}

async function lerEstado(casa) {
  try {
    const value = JSON.parse(await readFile(caminhoEstado(casa), 'utf8'))
    if (value?.schemaVersion !== STORE_SCHEMA_VERSION) throw new Error('Estado da automacao de eval e invalido.')
    return value
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { schemaVersion: STORE_SCHEMA_VERSION, status: 'idle', attempts: 0, updatedAt: null, last: null }
  }
}

async function gravarEstado(casa, state) {
  const path = caminhoEstado(casa)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.novo`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function adquirirLock(casa, staleMinutes) {
  const path = `${caminhoEstado(casa)}.lock`
  await mkdir(dirname(path), { recursive: true })
  try {
    const handle = await open(path, 'wx')
    return async () => { await handle.close(); await unlink(path).catch(() => undefined) }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const age = Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
    if (age > staleMinutes * 60_000) {
      await unlink(path).catch(() => undefined)
      return adquirirLock(casa, staleMinutes)
    }
    return null
  }
}

async function fingerprintsDoPayload(pluginRoot, feedback) {
  const [plan, persona, release] = await Promise.all([
    criarPlanoRodadaPersonalidade({ pluginRoot }),
    lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
    calcularFingerprintPayload(pluginRoot)
  ])
  const persistent = feedback.persistentAdjustment ?? { candidateIds: [], directives: [] }
  const portable = persona.learnedAdjustments?.adjustments ?? []
  return {
    releaseFingerprint: release.fingerprint,
    personaFingerprint: sha256(JSON.stringify({
      manifest: persona.manifest,
      markdownFingerprint: sha256(persona.markdown)
    })),
    suiteFingerprint: plan.suiteSha256,
    adjustmentsFingerprint: sha256(JSON.stringify({
      candidateIds: [...new Set(persistent.candidateIds ?? [])].sort(),
      directives: [...new Set(persistent.directives ?? [])].sort(),
      portable: portable
        .map((item) => ({
          directiveId: item.directiveId,
          evidenceFingerprint: item.evidenceFingerprint,
          evalRoundId: item.evalRoundId
        }))
        .sort((left, right) => left.directiveId.localeCompare(right.directiveId))
    }))
  }
}

function erroFonteCanonica(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

async function capturarFonteCanonica(root, repository) {
  const initialChanges = await repository.status(root)
  if (initialChanges.length > 0) {
    throw erroFonteCanonica(
      'O repositorio canonico precisa estar limpo antes de qualquer chamada de eval.',
      'CANONICAL_SOURCE_NOT_CLEAN'
    )
  }
  const headBefore = await repository.head(root)
  if (
    !HASH_COMMIT.test(headBefore?.commitSha ?? '') ||
    !HASH_SHA256.test(headBefore?.branchFingerprint ?? '')
  ) {
    throw erroFonteCanonica(
      'O repositorio canonico nao possui revisao verificavel para o eval.',
      'CANONICAL_SOURCE_UNVERIFIABLE'
    )
  }
  const integrity = await verificarIntegridadeRelease(root)
  if (
    integrity.status !== 'verified' ||
    integrity.versionMatchesManifest !== true ||
    !HASH_SHA256.test(integrity.fingerprint ?? '')
  ) {
    throw erroFonteCanonica(
      'O payload canonico nao possui integridade verificavel para o eval.',
      'CANONICAL_SOURCE_UNVERIFIABLE'
    )
  }
  const [headAfter, finalChanges] = await Promise.all([
    repository.head(root),
    repository.status(root)
  ])
  if (
    finalChanges.length > 0 ||
    headAfter.commitSha !== headBefore.commitSha ||
    headAfter.branchFingerprint !== headBefore.branchFingerprint
  ) {
    throw erroFonteCanonica(
      'O repositorio canonico mudou durante a verificacao anterior ao eval.',
      'CANONICAL_SOURCE_CHANGED'
    )
  }
  return {
    payloadFingerprint: integrity.fingerprint,
    commitSha: headBefore.commitSha,
    branchFingerprint: headBefore.branchFingerprint,
    repositoryFingerprint: sha256(root.toLowerCase())
  }
}

async function verificarFonteCanonica(root, repository, expected) {
  const current = await capturarFonteCanonica(root, repository)
  if (
    current.payloadFingerprint !== expected.payloadFingerprint ||
    current.commitSha !== expected.commitSha ||
    current.branchFingerprint !== expected.branchFingerprint ||
    current.repositoryFingerprint !== expected.repositoryFingerprint
  ) {
    throw erroFonteCanonica(
      'O repositorio canonico mudou durante a rodada de eval.',
      'CANONICAL_SOURCE_CHANGED'
    )
  }
  return current
}

function gatilho(feedback, contract, payloadFingerprints) {
  const candidates = (feedback.candidates ?? [])
    .filter((item) => ['positive', 'negative'].includes(item.polarity) && item.status === 'reviewable')
    .filter((item) => (item.occurrences ?? 0) >= contract.trigger.minimumCandidateOccurrences)
    .map((item) => ({
      id: item.id,
      polarity: item.polarity,
      dimension: item.dimension,
      reasonCode: item.reasonCode,
      occurrences: item.occurrences,
      updatedAt: item.updatedAt
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const kind = contract.trigger.reviewableCandidate && candidates.length > 0
    ? 'candidate'
    : contract.trigger.bootstrapWithoutTrustedRun ? 'bootstrap' : null
  if (!kind) return null
  const candidateSetFingerprint = sha256(JSON.stringify(candidates))
  return {
    kind,
    candidates,
    candidateSetFingerprint,
    payloadFingerprints,
    fingerprint: sha256(JSON.stringify({ kind, candidates, payloadFingerprints }))
  }
}

function rodadaConcluida(state, history, trigger) {
  const last = state?.last
  const sameEvaluatedPayload = last?.triggerFingerprint === trigger.fingerprint
  const samePublishedPayload = HASH_SHA256.test(last?.promotedReleaseFingerprint ?? '') &&
    last.promotedReleaseFingerprint === trigger.payloadFingerprints.releaseFingerprint &&
    last.candidateSetFingerprint === trigger.candidateSetFingerprint
  if ((!sameEvaluatedPayload && !samePublishedPayload) || last.status !== 'passed' ||
    !COMPLETE_PROMOTIONS.has(last.promotion) || typeof last.roundId !== 'string') return false
  return history.runs.some((run) =>
    run.id === last.roundId && run.status === 'passed' && run.trust?.promotable === true &&
    run.provenance?.triggerFingerprint === last.triggerFingerprint
  )
}

function planoCorrecao(run) {
  const directives = new Set()
  const reasons = []
  for (const diagnostic of run?.judgeDiagnostics ?? []) {
    if (diagnostic.passed === true) continue
    reasons.push({
      caseId: diagnostic.id,
      reasonCode: diagnostic.reasonCode,
      reasonCodeHash: diagnostic.reasonCodeHash
    })
    if (TEXTO_DIRETIVA_PERSONALIDADE[diagnostic.reasonCode]) {
      directives.add(diagnostic.reasonCode)
      continue
    }
    const fallback = CORRECTION_BY_CASE[diagnostic.id]
    if (fallback && TEXTO_DIRETIVA_PERSONALIDADE[fallback]) directives.add(fallback)
  }
  const directiveIds = [...directives].sort()
  const roundFingerprint = sha256(run?.id ?? 'personality-eval-round-unavailable')
  return {
    directiveIds,
    reasons,
    roundFingerprint,
    fingerprint: sha256(JSON.stringify({ directiveIds, reasons, roundFingerprint }))
  }
}

function planoPonteOperacional(previous) {
  const correctionPlan = previous?.correction?.plan
  const initialReasons = new Map((correctionPlan?.reasons ?? [])
    .filter((item) => SAFE_REASON_CODE.test(item?.caseId ?? '') &&
      SAFE_REASON_CODE.test(item?.reasonCode ?? '') && HASH_SHA256.test(item?.reasonCodeHash ?? ''))
    .map((item) => [`${item.caseId}:${item.reasonCode}`, item]))
  const initialRoundFingerprint = HASH_SHA256.test(correctionPlan?.roundFingerprint ?? '')
    ? correctionPlan.roundFingerprint
    : HASH_SHA256.test(correctionPlan?.fingerprint ?? '') ? correctionPlan.fingerprint : null
  const correctedRoundFingerprint = typeof previous?.roundId === 'string'
    ? sha256(previous.roundId)
    : null
  if (!initialRoundFingerprint || !correctedRoundFingerprint ||
    !HASH_SHA256.test(previous?.triggerFingerprint ?? '')) {
    return { fingerprint: sha256('no-repeatable-personality-eval-evidence'), items: [] }
  }
  const items = []
  for (const diagnostic of previous?.judgeDiagnostics ?? []) {
    if (diagnostic?.passed === true || !SAFE_REASON_CODE.test(diagnostic?.id ?? '') ||
      !SAFE_REASON_CODE.test(diagnostic?.reasonCode ?? '') ||
      !HASH_SHA256.test(diagnostic?.reasonCodeHash ?? '')) continue
    const initial = initialReasons.get(`${diagnostic.id}:${diagnostic.reasonCode}`)
    if (!initial) continue
    const sourceRefs = [
      {
        kind: 'personality-eval',
        evalRoundFingerprint: initialRoundFingerprint,
        triggerFingerprint: previous.triggerFingerprint,
        reasonCodeHash: initial.reasonCodeHash,
        reasonCode: initial.reasonCode,
        canonicalCaseId: initial.caseId
      },
      {
        kind: 'personality-eval',
        evalRoundFingerprint: correctedRoundFingerprint,
        triggerFingerprint: previous.triggerFingerprint,
        reasonCodeHash: diagnostic.reasonCodeHash,
        reasonCode: diagnostic.reasonCode,
        canonicalCaseId: diagnostic.id
      }
    ]
    items.push({
      caseId: diagnostic.id,
      reasonCode: diagnostic.reasonCode,
      statement: [
        'Corrigir automaticamente o pipeline canonico de personalidade para satisfazer',
        `o caso ${diagnostic.id} sob a diretiva ${diagnostic.reasonCode},`,
        'preservando os demais gates da suite.'
      ].join(' '),
      sourceRefs
    })
  }
  items.sort((left, right) => `${left.caseId}:${left.reasonCode}`.localeCompare(`${right.caseId}:${right.reasonCode}`))
  return {
    fingerprint: sha256(JSON.stringify(items.map((item) => ({
      caseId: item.caseId,
      reasonCode: item.reasonCode,
      sourceRefs: item.sourceRefs
    })))),
    items
  }
}

async function encaminharCorrecaoEsgotada({ casa, previous, now, backoffMinutes }) {
  const plan = planoPonteOperacional(previous)
  const existing = previous?.operationalBridge
  if (existing?.fingerprint === plan.fingerprint) {
    const retry = existing.retryAt ? Date.parse(existing.retryAt) : 0
    if (['routed', 'resolved'].includes(existing.result) || retry > now) return existing
  }
  if (plan.items.length === 0) {
    return {
      result: 'no-repeated-safe-reasons',
      fingerprint: plan.fingerprint,
      proposals: [],
      retryAt: null,
      updatedAt: agora(now)
    }
  }
  try {
    const proposals = []
    let waitingForSourceRepository = false
    for (const item of plan.items) {
      let proposed = null
      for (const sourceRef of item.sourceRefs) {
        proposed = await proporMelhoriaOperacional(casa, {
          category: 'personality-eval-correction-exhausted',
          destination: 'runtime-fix',
          statement: item.statement,
          sourceRef
        }, { at: agora(now) })
      }
      let materialization = { result: 'not-ready' }
      if (proposed?.candidate?.status === 'ready') {
        materialization = await materializarMelhoriaComBaselineConfigurada(casa, proposed.candidate.id)
        if (materialization.result === 'unconfigured') waitingForSourceRepository = true
      }
      proposals.push({
        caseId: item.caseId,
        reasonCode: item.reasonCode,
        candidateId: proposed?.candidate?.id ?? null,
        candidateFingerprint: proposed?.candidate?.fingerprint ?? null,
        candidateStatus: materialization?.candidate?.status ?? proposed?.candidate?.status ?? null,
        materialization: materialization.result,
        evidenceFingerprints: item.sourceRefs.map((source) => sha256(JSON.stringify(source)))
      })
    }
    const automation = await sincronizarAutomacaoMelhorias(casa, { at: agora(now) })
    const candidateIds = new Set(proposals.map((item) => item.candidateId).filter(Boolean))
    const jobIds = automation.jobs
      .filter((item) => candidateIds.has(item.candidateId) && item.state !== 'completed')
      .map((item) => item.id)
      .sort()
    return {
      result: waitingForSourceRepository ? 'waiting-source-repository' :
        jobIds.length > 0 ? 'routed' : 'resolved',
      fingerprint: plan.fingerprint,
      proposals,
      jobIds,
      retryAt: waitingForSourceRepository ? retryAt(now, backoffMinutes) : null,
      updatedAt: agora(now)
    }
  } catch (error) {
    return {
      result: 'retryable',
      fingerprint: plan.fingerprint,
      proposals: [],
      jobIds: [],
      errorFingerprint: sha256(error instanceof Error ? error.message : String(error)),
      retryAt: retryAt(now, backoffMinutes),
      updatedAt: agora(now)
    }
  }
}

function retryAt(now, minutes) {
  return new Date(Number(now) + minutes * 60_000).toISOString()
}

async function promoverRodada({ casa, run, prepareRelease }) {
  return prepareRelease({ casa, run })
}

export async function processarFilaEvalPersonalidade(options = {}) {
  const {
    casa,
    pluginRoot,
    policyRoot = pluginRoot ?? raiz,
    evaluationRoot: explicitEvaluationRoot,
    invoke = invocarClaude,
    now = Date.now(),
    prepareRelease = prepararReleaseAutonomaPersonalidade,
    repository = REPOSITORIO_GIT_PADRAO
  } = options
  if (!isAbsolute(casa ?? '') || !isAbsolute(policyRoot ?? '')) {
    throw new Error('Casa e raiz da politica precisam ser caminhos absolutos.')
  }
  const contract = await lerContrato(policyRoot)
  if (contract.enabled !== true) return { result: 'disabled' }
  const directRoot = explicitEvaluationRoot ?? pluginRoot
  const canonicalMode = !directRoot
  let evaluationRoot = directRoot
  if (!evaluationRoot) {
    const configured = await lerRepositorioCanonico(casa)
    if (configured.status !== 'configured') return { result: 'waiting-source-repository' }
    evaluationRoot = configured.sourceRepository
  }
  if (!isAbsolute(evaluationRoot ?? '')) {
    throw new Error('A raiz avaliada precisa usar caminho absoluto.')
  }
  const [feedback, history, state] = await Promise.all([
    resumirFeedbackPersonalidade(casa),
    lerHistoricoPersonalidade(casa),
    lerEstado(casa)
  ])
  const payloadFingerprints = await fingerprintsDoPayload(evaluationRoot, feedback)
  const trigger = gatilho(feedback, contract, payloadFingerprints)
  if (!trigger) return { result: 'idle' }
  const triggerFingerprint = trigger.fingerprint
  if (rodadaConcluida(state, history, trigger)) return { result: 'idle', triggerFingerprint }
  const release = await adquirirLock(casa, contract.retry.staleLeaseMinutes)
  if (!release) return { result: 'running' }
  try {
    const [currentState, currentHistory] = await Promise.all([
      lerEstado(casa),
      lerHistoricoPersonalidade(casa)
    ])
    if (rodadaConcluida(currentState, currentHistory, trigger)) {
      return { result: 'idle', triggerFingerprint }
    }
    const scheduledAt = currentState.last?.retryAt ? Date.parse(currentState.last.retryAt) : 0
    if (currentState.last?.triggerFingerprint === triggerFingerprint && scheduledAt > now) {
      return { result: 'backoff', triggerFingerprint, retryAt: currentState.last.retryAt }
    }

    const previous = currentState.last?.triggerFingerprint === triggerFingerprint
      ? currentState.last
      : null
    if (previous?.phase === 'correction-exhausted') {
      const operationalBridge = await encaminharCorrecaoEsgotada({
        casa,
        previous,
        now,
        backoffMinutes: contract.retry.backoffMinutes
      })
      if (JSON.stringify(previous.operationalBridge ?? null) !== JSON.stringify(operationalBridge)) {
        await gravarEstado(casa, {
          ...currentState,
          updatedAt: agora(now),
          last: { ...previous, operationalBridge }
        })
      }
      return {
        result: ['routed', 'resolved'].includes(operationalBridge.result)
          ? 'improvement-routed'
          : operationalBridge.result === 'waiting-source-repository'
            ? 'improvement-proposed'
            : 'needs-improvement',
        triggerFingerprint,
        roundId: previous.roundId ?? null,
        correctionPlan: previous.correction?.plan ?? null,
        operationalBridge
      }
    }
    if (previous?.phase === 'promotion-retry' && typeof previous.roundId === 'string') {
      const passedRun = currentHistory.runs.find((run) =>
        run.id === previous.roundId && run.status === 'passed' && run.trust?.promotable === true
      )
      if (passedRun) {
        const promotion = await promoverRodada({ casa, pluginRoot, run: passedRun, prepareRelease })
        const completed = COMPLETE_PROMOTIONS.has(promotion?.result)
        const reevaluationRequired = REEVALUATION_REQUIRED.has(promotion?.result)
        const promotedReleaseFingerprint = completed && HASH_SHA256.test(promotion?.releaseFingerprint ?? '')
          ? promotion.releaseFingerprint
          : null
        const updatedAt = agora(now)
        const nextRetryAt = completed ? null : retryAt(now, contract.retry.backoffMinutes)
        await gravarEstado(casa, {
          schemaVersion: STORE_SCHEMA_VERSION,
          status: completed ? 'completed' : 'retry-scheduled',
          attempts: currentState.attempts + 1,
          updatedAt,
          last: {
            ...previous,
            phase: completed ? 'completed' : reevaluationRequired ? 'evaluation-retry' : 'promotion-retry',
            status: 'passed',
            promotion: promotion?.result ?? 'unknown',
            candidateSetFingerprint: previous.candidateSetFingerprint ?? trigger.candidateSetFingerprint,
            promotedReleaseFingerprint,
            retryAt: nextRetryAt,
            strategyFingerprint: sha256(`promotion-retry:${promotion?.result ?? 'unknown'}:${currentState.attempts + 1}`),
            rawResponsesStored: false
          }
        })
        return completed
          ? { result: 'passed', triggerFingerprint, run: passedRun, promotion }
          : { result: 'retry-scheduled', triggerFingerprint, retryAt: nextRetryAt, promotion }
      }
    }

    const correction = previous?.phase === 'correction-retry' && previous.correction?.attempts === 0
      ? previous.correction
      : null
    const persistentDirectives = (feedback.persistentAdjustment?.directives ?? [])
      .filter((item) => TEXTO_DIRETIVA_PERSONALIDADE[item])
    const testedDirectiveIds = [...new Set([
      ...persistentDirectives,
      ...(correction?.plan?.directiveIds ?? [])
    ])].sort()
    let evaluatedSource = null
    if (canonicalMode) {
      try {
        evaluatedSource = await capturarFonteCanonica(evaluationRoot, repository)
      } catch (error) {
        const retryAtIso = retryAt(now, contract.retry.backoffMinutes)
        await gravarEstado(casa, {
          schemaVersion: STORE_SCHEMA_VERSION,
          status: 'retry-scheduled',
          attempts: currentState.attempts + 1,
          updatedAt: agora(now),
          last: {
            triggerFingerprint,
            triggerKind: trigger.kind,
            candidateSetFingerprint: trigger.candidateSetFingerprint,
            payloadFingerprints,
            phase: 'source-retry',
            sourceStatus: error?.code === 'CANONICAL_SOURCE_NOT_CLEAN'
              ? 'repository-not-clean'
              : 'source-unverifiable',
            errorFingerprint: sha256(error instanceof Error ? error.message : String(error)),
            retryAt: retryAtIso,
            strategyFingerprint: sha256(`source-retry:${triggerFingerprint}:${currentState.attempts + 1}`),
            rawResponsesStored: false
          }
        })
        return {
          result: 'retry-scheduled',
          triggerFingerprint,
          retryAt: retryAtIso,
          sourceStatus: error?.code === 'CANONICAL_SOURCE_NOT_CLEAN'
            ? 'repository-not-clean'
            : 'source-unverifiable'
        }
      }
    }
    const startedAt = agora(now)
    await gravarEstado(casa, {
      ...currentState,
      status: 'running',
      attempts: currentState.attempts + 1,
      updatedAt: startedAt,
      last: {
        triggerFingerprint,
        triggerKind: trigger.kind,
        candidateSetFingerprint: trigger.candidateSetFingerprint,
        payloadFingerprints,
        phase: 'evaluation',
        startedAt,
        correction: correction
          ? { ...correction, attempts: 1 }
          : { attempts: 0, plan: null },
        strategyFingerprint: correction?.plan?.fingerprint ?? sha256(`initial:${triggerFingerprint}`),
        rawResponsesStored: false
      }
    })
    try {
      const recorded = await executarRodadaPersonalidadeAutomatica({
        casa,
        policyRoot,
        evaluationRoot,
        evaluatedSource,
        verifyEvaluatedSource: canonicalMode
          ? (expected) => verificarFonteCanonica(evaluationRoot, repository, expected)
          : undefined,
        triggerFingerprint,
        testedDirectiveIds,
        invoke,
        at: startedAt
      })
      if (recorded.run.status !== 'passed') {
        const plan = planoCorrecao(recorded.run)
        const canRetry = !correction && plan.directiveIds.length > 0
        const nextRetryAt = canRetry ? retryAt(now, contract.retry.backoffMinutes) : null
        const correctionState = canRetry
          ? { attempts: 0, plan }
          : correction ? { ...correction, attempts: 1 } : { attempts: 0, plan }
        const exhaustedState = {
          schemaVersion: STORE_SCHEMA_VERSION,
          status: canRetry ? 'retry-scheduled' : 'needs-improvement',
          attempts: currentState.attempts + 1,
          updatedAt: agora(now),
          last: {
            triggerFingerprint,
            triggerKind: trigger.kind,
            candidateSetFingerprint: trigger.candidateSetFingerprint,
            payloadFingerprints,
            phase: canRetry ? 'correction-retry' : 'correction-exhausted',
            roundId: recorded.run.id,
            status: recorded.run.status,
            promotion: 'not-promotable',
            retryAt: nextRetryAt,
            correction: correctionState,
            strategyFingerprint: canRetry ? plan.fingerprint : correction?.plan?.fingerprint ?? plan.fingerprint,
            judgeDiagnostics: recorded.run.judgeDiagnostics,
            rawResponsesStored: false
          }
        }
        await gravarEstado(casa, exhaustedState)
        let operationalBridge = null
        if (!canRetry) {
          operationalBridge = await encaminharCorrecaoEsgotada({
            casa,
            previous: exhaustedState.last,
            now,
            backoffMinutes: contract.retry.backoffMinutes
          })
          exhaustedState.last.operationalBridge = operationalBridge
          exhaustedState.updatedAt = agora(now)
          await gravarEstado(casa, exhaustedState)
        }
        return canRetry
          ? {
              result: 'retry-scheduled',
              triggerFingerprint,
              retryAt: nextRetryAt,
              run: recorded.run,
              correctionPlan: plan
            }
          : {
              result: ['routed', 'resolved'].includes(operationalBridge?.result)
                ? 'improvement-routed'
                : operationalBridge?.result === 'waiting-source-repository'
                  ? 'improvement-proposed'
                  : 'needs-improvement',
              triggerFingerprint,
              run: recorded.run,
              correctionPlan: correctionState.plan,
              operationalBridge
            }
      }

      const promotion = await promoverRodada({ casa, pluginRoot, run: recorded.run, prepareRelease })
      const completed = COMPLETE_PROMOTIONS.has(promotion?.result)
      const reevaluationRequired = REEVALUATION_REQUIRED.has(promotion?.result)
      const promotedReleaseFingerprint = completed && HASH_SHA256.test(promotion?.releaseFingerprint ?? '')
        ? promotion.releaseFingerprint
        : null
      const nextRetryAt = completed ? null : retryAt(now, contract.retry.backoffMinutes)
      await gravarEstado(casa, {
        schemaVersion: STORE_SCHEMA_VERSION,
        status: completed ? 'completed' : 'retry-scheduled',
        attempts: currentState.attempts + 1,
        updatedAt: agora(now),
        last: {
          triggerFingerprint,
          triggerKind: trigger.kind,
          candidateSetFingerprint: trigger.candidateSetFingerprint,
          payloadFingerprints,
          phase: completed ? 'completed' : reevaluationRequired ? 'evaluation-retry' : 'promotion-retry',
          roundId: recorded.run.id,
          status: recorded.run.status,
          promotion: promotion?.result ?? 'unknown',
          promotedReleaseFingerprint,
          retryAt: nextRetryAt,
          correction: correction
            ? { ...correction, attempts: 1 }
            : { attempts: 0, plan: null },
          strategyFingerprint: completed
            ? correction?.plan?.fingerprint ?? sha256(`initial:${triggerFingerprint}`)
            : sha256(`promotion-retry:${promotion?.result ?? 'unknown'}:${currentState.attempts + 1}`),
          judgeDiagnostics: recorded.run.judgeDiagnostics,
          rawResponsesStored: false
        }
      })
      return completed
        ? { result: 'passed', triggerFingerprint, run: recorded.run, promotion }
        : { result: 'retry-scheduled', triggerFingerprint, retryAt: nextRetryAt, run: recorded.run, promotion }
    } catch (error) {
      const failedAt = agora(now)
      const retryAtIso = retryAt(now, contract.retry.backoffMinutes)
      await gravarEstado(casa, {
        schemaVersion: STORE_SCHEMA_VERSION,
        status: 'retry-scheduled',
        attempts: currentState.attempts + 1,
        updatedAt: failedAt,
        last: {
          triggerFingerprint,
          triggerKind: trigger.kind,
          candidateSetFingerprint: trigger.candidateSetFingerprint,
          payloadFingerprints,
          phase: 'evaluation-retry',
          errorFingerprint: sha256(error instanceof Error ? error.message : String(error)),
          retryAt: retryAtIso,
          strategyFingerprint: sha256(`execution-retry:${triggerFingerprint}:${currentState.attempts + 1}`),
          rawResponsesStored: false
        }
      })
      return { result: 'retry-scheduled', triggerFingerprint, retryAt: retryAtIso }
    }
  } finally {
    await release()
  }
}
