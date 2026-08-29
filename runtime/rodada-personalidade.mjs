import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { avaliarResposta, validarSuite } from './eval-personalidade.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const HASH_SHA256 = /^[a-f0-9]{64}$/i
const STORE_SCHEMA_VERSION = 2

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function texto(value, label, maximum = 300) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maximum) throw new Error(`${label} invalido.`)
  return normalized
}

function fingerprint(value, label) {
  const normalized = texto(value, label, 64).toLowerCase()
  if (!HASH_SHA256.test(normalized)) throw new Error(`${label} precisa ser SHA-256.`)
  return normalized
}

function fingerprintOpcional(value, label) {
  if (value === undefined || value === null || value === '') return null
  return fingerprint(value, label)
}

async function lerJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function validarBaselineProtocol(protocol) {
  if (
    protocol?.kind !== 'same-model-without-omni-context' ||
    protocol.sameProvider !== true ||
    protocol.sameModel !== true ||
    protocol.sameModelVersion !== true ||
    protocol.sameSettings !== true ||
    protocol.sameInputs !== true ||
    protocol.omniPersonalityInjected !== false ||
    protocol.omniContextInjected !== false
  ) throw new Error('A baseline nao descreve um controle honesto do mesmo modelo sem o Omni.')
  return protocol
}

function classificarCasoAprendido(item, canonicalIds) {
  const base = {
    id: texto(item?.id, 'ID do caso aprendido'),
    category: texto(item?.category, 'Categoria do caso aprendido'),
    destination: texto(item?.destination, 'Destino do caso aprendido'),
    evidenceFingerprint: fingerprint(item?.evidence?.fingerprint, 'Fingerprint da evidencia'),
    occurrences: Number.isInteger(item?.evidence?.occurrences) ? item.evidence.occurrences : 0
  }
  if (item?.readiness === 'covered-by-canonical-case') {
    const caseId = item?.scenario?.caseId
    if (typeof caseId === 'string' && canonicalIds.has(caseId)) {
      return { ...base, state: 'covered-by-canonical-case', canonicalCaseId: caseId }
    }
  }
  if (item?.readiness === 'executable' && item?.scenario && typeof item.scenario === 'object') {
    try {
      const scenario = validarSuite({
        schemaVersion: 1,
        suite: 'learned-candidate-validation',
        baseline: 'control',
        candidate: 'candidate',
        cases: [{ id: item.id, ...item.scenario }]
      }).cases[0]
      return {
        ...base,
        state: canonicalIds.has(scenario.id) ? 'covered-by-canonical-case' : 'executable-awaiting-incorporation',
        canonicalCaseId: canonicalIds.has(scenario.id) ? scenario.id : null
      }
    } catch {
      // Um cenario incompleto volta a ser pendencia explicita; nunca finge cobertura.
    }
  }
  return { ...base, state: 'pending-scenario', canonicalCaseId: null }
}

async function lerFonteDoPlano(pluginRoot) {
  const suitePath = join(pluginRoot, 'contratos', 'eval', 'personalidade.json')
  const learnedPath = join(pluginRoot, 'contratos', 'eval', 'casos-aprendidos.json')
  const manifestPath = join(pluginRoot, 'contratos', 'personalidade', 'manifest.json')
  const suiteRaw = await readFile(suitePath, 'utf8')
  const suite = validarSuite(JSON.parse(suiteRaw))
  validarBaselineProtocol(suite.baselineProtocol)
  const [learned, manifest] = await Promise.all([lerJson(learnedPath), lerJson(manifestPath)])
  if (learned?.schemaVersion !== 1 || !Array.isArray(learned.cases)) {
    throw new Error('Casos aprendidos fora do contrato v1.')
  }
  const canonicalIds = new Set(suite.cases.map((item) => item.id))
  return {
    suite,
    suiteSha256: sha256(suiteRaw),
    manifest,
    learned: learned.cases.map((item) => classificarCasoAprendido(item, canonicalIds))
  }
}

export async function criarPlanoRodadaPersonalidade({ pluginRoot = raiz } = {}) {
  const { suite, suiteSha256, manifest, learned } = await lerFonteDoPlano(pluginRoot)
  const unresolved = learned.filter((item) => item.state !== 'covered-by-canonical-case')
  const gates = [
    { id: 'candidate-is-active-personality', passed: suite.candidate === manifest.id },
    { id: 'active-personality-is-v3', passed: manifest.id === 'omni-persona-v3-candidate' },
    { id: 'historical-v2-is-not-target', passed: suite.candidate !== 'omni-persona-v2-candidate' },
    { id: 'controlled-baseline-declared', passed: suite.baseline === 'controle-mesmo-modelo-sem-omni' },
    { id: 'learned-candidates-resolved', passed: unresolved.length === 0 }
  ]
  return {
    schemaVersion: 1,
    suite: suite.suite,
    suiteSha256,
    baseline: suite.baseline,
    baselineProtocol: suite.baselineProtocol,
    candidate: suite.candidate,
    activePersonality: { id: manifest.id, status: manifest.status },
    cases: suite.cases,
    learnedCandidates: learned,
    pendingLearnedCandidates: unresolved.map((item) => item.id),
    gates,
    performsModelCalls: false,
    automaticExecutor: {
      contract: 'omni-controlled-personality-eval-v1',
      available: true,
      trigger: 'reviewable-personality-candidate',
      persistsRawResponses: false
    },
    execution: [
      'Use o mesmo provedor, modelo, versao, configuracao e entradas nos dois conjuntos.',
      'Capture a baseline sem ativacao, personalidade, contexto ou memoria do Omni.',
      `Capture a candidata com ${manifest.id} ativa e o plugin da release sob teste carregado.`,
      'Avalie automaticamente todos os casos, inclusive os criterios semanticos, com um juiz local controlado.',
      'Forneca as respostas somente em memoria para a rodada; o registro local guarda apenas hashes e resultados.',
      'Promova somente uma rodada produzida pelo executor local controlado, com recibos vinculados e todos os gates verdes.'
    ]
  }
}

function mapaDeRespostas(value, label) {
  const map = value instanceof Map ? value : new Map(Object.entries(value ?? {}))
  for (const [id, response] of map) {
    if (typeof id !== 'string' || typeof response !== 'string') {
      throw new Error(`${label} contem resposta invalida.`)
    }
  }
  return map
}

function hashConjunto(cases, responses) {
  const digest = createHash('sha256')
  for (const testCase of cases) {
    digest.update(testCase.id, 'utf8')
    digest.update('\0', 'utf8')
    digest.update(responses.get(testCase.id) ?? '', 'utf8')
    digest.update('\0', 'utf8')
  }
  return digest.digest('hex')
}

function normalizarProveniencia(value) {
  const source = value?.source ?? 'controlled-manual-capture'
  const baselineInjected = value?.baselineOmniInjected
  const candidateInjected = value?.candidateOmniInjected
  const baselineSessionFingerprint = fingerprint(value?.baselineSessionFingerprint, 'Fingerprint da sessao baseline')
  const candidateSessionFingerprint = fingerprint(value?.candidateSessionFingerprint, 'Fingerprint da sessao candidata')
  const captureVerified = value?.trustMode === 'local-controlled-runner-v1' && value?.captureVerified === true
  return {
    source: texto(source, 'Fonte da proveniencia'),
    provider: texto(value?.provider, 'Provedor'),
    model: texto(value?.model, 'Modelo'),
    modelVersion: texto(value?.modelVersion, 'Versao do modelo'),
    settingsFingerprint: fingerprint(value?.settingsFingerprint, 'Fingerprint das configuracoes'),
    baselineSessionFingerprint,
    candidateSessionFingerprint,
    baselineReceiptFingerprint: fingerprintOpcional(
      value?.baselineReceiptFingerprint,
      'Fingerprint do recibo alegado da baseline'
    ),
    candidateReceiptFingerprint: fingerprintOpcional(
      value?.candidateReceiptFingerprint,
      'Fingerprint do recibo alegado da candidata'
    ),
    baselineOmniInjected: baselineInjected === true,
    candidateOmniInjected: candidateInjected === true,
    trustMode: captureVerified ? 'local-controlled-runner-v1' : 'caller-claim',
    captureVerified,
    triggerFingerprint: fingerprintOpcional(value?.triggerFingerprint, 'Fingerprint do gatilho'),
    evaluatedPayloadFingerprint: fingerprintOpcional(
      value?.evaluatedPayloadFingerprint,
      'Fingerprint do payload avaliado'
    ),
    controlled:
      baselineInjected === false &&
      candidateInjected === true &&
      baselineSessionFingerprint !== candidateSessionFingerprint
  }
}

function normalizarRevisao(value, cases) {
  const reviewer = value?.reviewer
  const attestationFingerprint = typeof value?.attestationFingerprint === 'string' &&
    HASH_SHA256.test(value.attestationFingerprint)
    ? value.attestationFingerprint.toLowerCase()
    : null
  const attestedAt = typeof value?.attestedAt === 'string' && Number.isFinite(Date.parse(value.attestedAt))
    ? new Date(value.attestedAt).toISOString()
    : null
  const decisions = value?.decisions && typeof value.decisions === 'object' ? value.decisions : {}
  const ids = new Set(cases.map((item) => item.id))
  const extras = Object.keys(decisions).filter((id) => !ids.has(id))
  const reviewed = cases.filter((item) => typeof decisions[item.id] === 'boolean')
  const claimed = ['owner', 'automatic-judge'].includes(reviewer) &&
    attestationFingerprint !== null && attestedAt !== null
  const trustedAutomaticJudge = reviewer === 'automatic-judge' &&
    value?.source === 'omni-controlled-local-judge-v1' && value?.verified === true
  const trustedOwnerEvent = reviewer === 'owner' &&
    value?.source === 'owner-live-hook-v1' && value?.verified === true
  const verified = claimed && (trustedAutomaticJudge || trustedOwnerEvent)
  const decisionFingerprint = sha256(JSON.stringify(
    cases.map((item) => [item.id, typeof decisions[item.id] === 'boolean' ? decisions[item.id] : null])
  ))
  return {
    reviewer: verified
      ? trustedAutomaticJudge ? 'automatic-judge' : 'owner-live'
      : claimed ? 'unverified-claim' : 'invalid',
    claim: claimed
      ? {
          fingerprint: attestationFingerprint,
          attestedAt,
          decisionFingerprint,
          authenticated: verified,
          internallyVerified: verified,
          authority: trustedAutomaticJudge ? 'omni-controlled-local-judge-v1' :
            trustedOwnerEvent ? 'owner-live-hook-v1' : 'caller-claim'
        }
      : null,
    decisions: new Map(cases.map((item) => [item.id, decisions[item.id] === true])),
    verified,
    complete: claimed && extras.length === 0 && reviewed.length === cases.length,
    approved: claimed && extras.length === 0 && reviewed.length === cases.length &&
      cases.every((item) => decisions[item.id] === true)
  }
}

function alegacaoCaptura(kind, plan, provenance, responseSetFingerprint) {
  const baseline = kind === 'baseline'
  const receiptFingerprint = baseline
    ? provenance.baselineReceiptFingerprint
    : provenance.candidateReceiptFingerprint
  const binding = {
    suite: plan.suite,
    suiteSha256: plan.suiteSha256,
    capture: kind,
    provider: provenance.provider,
    model: provenance.model,
    modelVersion: provenance.modelVersion,
    settingsFingerprint: provenance.settingsFingerprint,
    sessionFingerprint: baseline
      ? provenance.baselineSessionFingerprint
      : provenance.candidateSessionFingerprint,
    omniInjected: baseline ? provenance.baselineOmniInjected : provenance.candidateOmniInjected,
    responseSetFingerprint
  }
  return {
    status: receiptFingerprint
      ? provenance.captureVerified ? 'verified-local-capture' : 'caller-claim'
      : 'unavailable',
    receiptFingerprint,
    binding,
    bindingFingerprint: sha256(JSON.stringify(binding)),
    internallyVerified: provenance.captureVerified,
    verificationAuthority: provenance.captureVerified ? 'omni-controlled-local-runner-v1' : null
  }
}

function score(results) {
  const total = results.reduce((sum, item) => sum + item.peso, 0)
  const approved = results.filter((item) => item.automatico.passou).reduce((sum, item) => sum + item.peso, 0)
  return total === 0 ? 0 : Number((approved / total).toFixed(4))
}

function normalizarAjustes(value) {
  const directiveIds = Array.isArray(value?.directiveIds)
    ? [...new Set(value.directiveIds.filter((item) => typeof item === 'string' && /^[a-z0-9-]{3,80}$/.test(item)))]
    : []
  const candidateIds = Array.isArray(value?.candidateIds)
    ? [...new Set(value.candidateIds.filter((item) => typeof item === 'string' && /^personality-candidate-/.test(item)))]
    : []
  return {
    directiveIds,
    candidateIds,
    fingerprint: sha256(JSON.stringify({ directiveIds: [...directiveIds].sort(), candidateIds: [...candidateIds].sort() }))
  }
}

function normalizarDiagnosticosDoJuiz(value, cases) {
  if (!Array.isArray(value)) return []
  const expected = new Set(cases.map((item) => item.id))
  const byId = new Map()
  for (const item of value) {
    if (!expected.has(item?.id) || byId.has(item.id)) continue
    if (typeof item?.passed !== 'boolean' ||
      typeof item?.reasonCode !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.reasonCode) ||
      typeof item?.reasonCodeHash !== 'string' || !HASH_SHA256.test(item.reasonCodeHash)) continue
    byId.set(item.id, {
      id: item.id,
      passed: item.passed,
      reasonCode: item.reasonCode,
      reasonCodeHash: item.reasonCodeHash
    })
  }
  return cases.map((item) => byId.get(item.id)).filter(Boolean)
}

export async function avaliarRodadaPersonalidade({
  pluginRoot = raiz,
  roundId = `personality-run-${randomUUID()}`,
  baselineResponses,
  candidateResponses,
  humanReview,
  provenance,
  adjustments,
  judgeDiagnostics,
  at
} = {}) {
  const plan = await criarPlanoRodadaPersonalidade({ pluginRoot })
  const baselineMap = mapaDeRespostas(baselineResponses, 'Baseline')
  const candidateMap = mapaDeRespostas(candidateResponses, 'Candidata')
  const review = normalizarRevisao(humanReview, plan.cases)
  const normalizedProvenance = normalizarProveniencia(provenance)
  const normalizedAdjustments = normalizarAjustes(adjustments)
  const normalizedJudgeDiagnostics = normalizarDiagnosticosDoJuiz(judgeDiagnostics, plan.cases)
  const baselineResults = plan.cases.map((item) => avaliarResposta(item, baselineMap.get(item.id)))
  const candidateResults = plan.cases.map((item) => avaliarResposta(item, candidateMap.get(item.id)))
  const baselineComplete = plan.cases.every((item) => baselineMap.has(item.id) && baselineMap.get(item.id).trim())
  const candidateComplete = plan.cases.every((item) => candidateMap.has(item.id) && candidateMap.get(item.id).trim())
  const baselineScore = score(baselineResults)
  const candidateScore = score(candidateResults)
  const responseSets = {
    baselineSha256: hashConjunto(plan.cases, baselineMap),
    candidateSha256: hashConjunto(plan.cases, candidateMap)
  }
  const captureReceiptClaims = [
    alegacaoCaptura('baseline', plan, normalizedProvenance, responseSets.baselineSha256),
    alegacaoCaptura('candidate', plan, normalizedProvenance, responseSets.candidateSha256)
  ]
  const ownerReviewClaim = review.claim
    ? {
        ...review.claim,
        status: review.verified ? 'verified-local-decision' : 'caller-claim',
        receiptFingerprint: review.claim.fingerprint,
        internallyVerified: review.verified,
        authority: review.claim.authority,
        binding: {
          suite: plan.suite,
          suiteSha256: plan.suiteSha256,
          baselineResponseSetFingerprint: responseSets.baselineSha256,
          candidateResponseSetFingerprint: responseSets.candidateSha256,
          decisionFingerprint: review.claim.decisionFingerprint
        }
      }
    : null
  if (ownerReviewClaim) {
    ownerReviewClaim.bindingFingerprint = sha256(JSON.stringify(ownerReviewClaim.binding))
  }
  const receiptClaims = [...captureReceiptClaims, ownerReviewClaim].filter(Boolean)
  const receiptClaimsDistinctAndBound = receiptClaims.length === 3 && receiptClaims.every((item) =>
    HASH_SHA256.test(item.receiptFingerprint ?? '') && HASH_SHA256.test(item.bindingFingerprint ?? '')
  ) && new Set(receiptClaims.map((item) => item.receiptFingerprint)).size === receiptClaims.length &&
    new Set(receiptClaims.map((item) => item.bindingFingerprint)).size === receiptClaims.length
  const caseResults = plan.cases.map((item, index) => ({
    id: item.id,
    weight: item.peso,
    baselineAutomaticPassed: baselineResults[index].automatico.passou,
    candidateAutomaticPassed: candidateResults[index].automatico.passou,
    humanApproved: review.decisions.get(item.id) === true
  }))
  const gates = [
    ...plan.gates,
    { id: 'controlled-baseline-claimed', passed: normalizedProvenance.controlled },
    { id: 'baseline-response-coverage', passed: Boolean(baselineComplete) },
    { id: 'candidate-response-coverage', passed: Boolean(candidateComplete) },
    { id: 'candidate-automatic-gates', passed: candidateResults.every((item) => item.automatico.passou) },
    { id: 'candidate-not-below-baseline', passed: candidateScore >= baselineScore },
    { id: 'owner-review-claim-complete', passed: review.complete },
    { id: 'owner-claimed-approval-for-all-cases', passed: review.approved },
    { id: 'receipt-claims-distinct-and-explicitly-bound', passed: receiptClaimsDistinctAndBound },
    {
      id: 'capture-receipts-produced-by-controlled-local-runner',
      passed: captureReceiptClaims.every((item) => item.internallyVerified === true)
    },
    { id: 'review-produced-by-verifiable-local-authority', passed: review.verified }
  ]
  const evaluatedAt = agora(at)
  const gatesPassed = gates.every((gate) => gate.passed)
  const trustedCapture = captureReceiptClaims.every((item) => item.internallyVerified === true)
  const status = gatesPassed ? 'passed' : trustedCapture && review.verified ? 'failed' : 'unverified-claim'
  return {
    schemaVersion: 1,
    id: texto(roundId, 'ID da rodada'),
    suite: plan.suite,
    suiteSha256: plan.suiteSha256,
    baseline: plan.baseline,
    candidate: plan.candidate,
    evaluatedAt,
    provenance: normalizedProvenance,
    responseSets,
    metrics: {
      cases: plan.cases.length,
      baselineScore,
      candidateScore,
      humanReviewed: review.complete ? plan.cases.length : 0,
      learnedCandidates: plan.learnedCandidates.length,
      pendingLearnedCandidates: plan.pendingLearnedCandidates.length
    },
    learnedCandidates: plan.learnedCandidates,
    adjustments: normalizedAdjustments,
    judgeDiagnostics: normalizedJudgeDiagnostics,
    ownerReviewClaim,
    trust: {
      captureReceiptClaims,
      verification: gatesPassed ? 'local-controlled-runner-v1' : 'incomplete',
      scope: 'single-owner-local-machine',
      callerSuppliedClaimsAreProof: false,
      decisionAuthority: review.claim?.authority ?? null,
      promotable: gatesPassed,
      reason: gatesPassed
        ? 'Capturas e decisao foram produzidas pelo executor local controlado e vinculadas por fingerprint.'
        : 'Um ou mais gates da rodada nao foram comprovados.'
    },
    caseResults,
    gates,
    status,
    rawResponsesStored: false
  }
}

export function criarEvidenciaPromocao(run) {
  if (run?.rawResponsesStored !== false) {
    throw new Error('Promocao nao aceita respostas brutas no registro.')
  }
  if (run?.status !== 'passed' || run?.trust?.promotable !== true ||
    !Array.isArray(run?.gates) || run.gates.some((gate) => gate.passed !== true)) {
    throw new Error('Promocao bloqueada: a rodada nao passou por todos os gates confiaveis.')
  }
  return {
    schemaVersion: 1,
    roundId: run.id,
    decidedAt: run.evaluatedAt,
    decidedBy: run.trust.decisionAuthority,
    suiteSha256: run.suiteSha256,
    baseline: run.baseline,
    candidate: run.candidate,
    responseSets: run.responseSets,
    caseResults: run.caseResults
  }
}

export function caminhoDoHistoricoPersonalidade(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'evals', 'personality-history.json')
}

function historicoVazio(at = agora()) {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    store: { id: 'omni-local-personality-evals', createdAt: at, updatedAt: at },
    runs: []
  }
}

function validarHistorico(store) {
  if (store?.schemaVersion === 1 && Array.isArray(store?.runs)) {
    store.runs = store.runs.map((run) => run?.status === 'passed'
      ? {
          ...run,
          status: 'unverified-legacy-claim',
          trust: {
            ...(run?.trust && typeof run.trust === 'object' ? run.trust : {}),
            internallyRevalidated: false,
            cryptographicVerification: 'unavailable',
            externalIdentity: 'unavailable',
            promotable: false,
            migratedAsTrusted: false
          }
        }
      : run)
    store.schemaVersion = STORE_SCHEMA_VERSION
  }
  if (
    store?.schemaVersion !== STORE_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-personality-evals' ||
    !Array.isArray(store.runs)
  ) throw new Error('Historico local de personalidade fora da versao 1.')
  return store
}

export async function lerHistoricoPersonalidade(casa) {
  const path = caminhoDoHistoricoPersonalidade(casa)
  try {
    return validarHistorico(await lerJson(path))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return historicoVazio()
  }
}

async function adquirirLock(casa) {
  const directory = join(casa, 'evals')
  const path = join(directory, 'personality-history.lock')
  await mkdir(directory, { recursive: true })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 10_000) await unlink(path).catch(() => undefined)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
  }
  throw new Error('Historico local de personalidade ocupado por outra escrita.')
}

export async function registrarRodadaPersonalidade(casa, input) {
  const run = await avaliarRodadaPersonalidade(input)
  const path = caminhoDoHistoricoPersonalidade(casa)
  const release = await adquirirLock(casa)
  try {
    let store = await lerHistoricoPersonalidade(casa)
    if (store.runs.length === 0 && store.store.createdAt !== run.evaluatedAt) {
      store = historicoVazio(run.evaluatedAt)
    }
    store.runs.push(run)
    store.runs = store.runs.slice(-100)
    store.store.updatedAt = run.evaluatedAt
    const temporary = `${path}.${process.pid}.novo`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
    return { result: 'recorded', run }
  } finally {
    await release()
  }
}
