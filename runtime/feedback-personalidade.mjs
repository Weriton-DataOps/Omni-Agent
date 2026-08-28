import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PERSONALITY_FEEDBACK_SCHEMA_VERSION = 1

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HASH_SHA256 = /^[a-f0-9]{64}$/
const PERSONA_ID = /^omni-persona-v\d+-candidate$/
const OWNER_ORIGINS = new Set(['owner-live', 'owner-transcript'])
const POLARITIES = new Set(['positive', 'negative', 'mixed'])
const DIMENSIONS = new Set([
  'overall',
  'tone',
  'presence',
  'distinctiveness',
  'humor',
  'sarcasm',
  'analogies',
  'intelligence'
])
const REASON_DIMENSIONS = {
  'overall-approved': 'overall',
  'overall-rejected': 'overall',
  'tone-approved': 'tone',
  'tone-too-dry': 'tone',
  'presence-effective': 'presence',
  'presence-too-cold': 'presence',
  'voice-distinct': 'distinctiveness',
  'voice-generic': 'distinctiveness',
  'personality-present': 'distinctiveness',
  'personality-absent': 'distinctiveness',
  'humor-effective': 'humor',
  'humor-missing': 'humor',
  'sarcasm-effective': 'sarcasm',
  'sarcasm-missing': 'sarcasm',
  'analogy-effective': 'analogies',
  'analogy-missing': 'analogies',
  'intelligence-perceived': 'intelligence',
  'intelligence-flat': 'intelligence'
}
const REASON_CODES = new Set(Object.keys(REASON_DIMENSIONS))
const MAX_LAST_RESPONSES = 100
const MAX_VOTES = 500
const MAX_CANDIDATES = 100

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function now(value) {
  const date = value === undefined ? new Date() : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Horario do feedback de personalidade e invalido.')
  return date.toISOString()
}

function dateValid(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function nonEmptyText(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function validIdentity(personaId, releaseFingerprint) {
  return PERSONA_ID.test(personaId ?? '') && HASH_SHA256.test(releaseFingerprint ?? '')
}

function validLastResponse(item) {
  return exactKeys(item, [
    'sessionFingerprint',
    'turnFingerprint',
    'answerFingerprint',
    'personaId',
    'releaseFingerprint',
    'recordedAt'
  ]) &&
    HASH_SHA256.test(item.sessionFingerprint ?? '') &&
    HASH_SHA256.test(item.turnFingerprint ?? '') &&
    HASH_SHA256.test(item.answerFingerprint ?? '') &&
    validIdentity(item.personaId, item.releaseFingerprint) &&
    dateValid(item.recordedAt)
}

function validVote(item) {
  return exactKeys(item, [
    'id',
    'sessionFingerprint',
    'turnFingerprint',
    'answerFingerprint',
    'feedbackFingerprint',
    'personaId',
    'releaseFingerprint',
    'polarity',
    'dimensions',
    'reasonCodes',
    'recordedAt'
  ]) &&
    /^personality-vote-[0-9a-f-]{36}$/.test(item.id ?? '') &&
    HASH_SHA256.test(item.sessionFingerprint ?? '') &&
    HASH_SHA256.test(item.turnFingerprint ?? '') &&
    HASH_SHA256.test(item.answerFingerprint ?? '') &&
    HASH_SHA256.test(item.feedbackFingerprint ?? '') &&
    validIdentity(item.personaId, item.releaseFingerprint) &&
    POLARITIES.has(item.polarity) &&
    Array.isArray(item.dimensions) &&
    item.dimensions.length > 0 &&
    item.dimensions.length === new Set(item.dimensions).size &&
    item.dimensions.every((dimension) => DIMENSIONS.has(dimension)) &&
    Array.isArray(item.reasonCodes) &&
    item.reasonCodes.length > 0 &&
    item.reasonCodes.length === new Set(item.reasonCodes).size &&
    item.reasonCodes.every((reason) => REASON_CODES.has(reason)) &&
    dateValid(item.recordedAt)
}

function validCandidate(item) {
  return exactKeys(item, [
    'id',
    'personaId',
    'polarity',
    'dimension',
    'reasonCode',
    'status',
    'occurrences',
    'releaseFingerprints',
    'voteFingerprints',
    'createdAt',
    'updatedAt'
  ]) &&
    /^personality-candidate-[a-f0-9]{24}$/.test(item.id ?? '') &&
    PERSONA_ID.test(item.personaId ?? '') &&
    ['positive', 'negative'].includes(item.polarity) &&
    DIMENSIONS.has(item.dimension) &&
    REASON_CODES.has(item.reasonCode) &&
    REASON_DIMENSIONS[item.reasonCode] === item.dimension &&
    item.status === 'reviewable' &&
    Number.isInteger(item.occurrences) &&
    item.occurrences >= 2 &&
    Array.isArray(item.releaseFingerprints) &&
    item.releaseFingerprints.length > 0 &&
    item.releaseFingerprints.length === new Set(item.releaseFingerprints).size &&
    item.releaseFingerprints.every((fingerprint) => HASH_SHA256.test(fingerprint)) &&
    Array.isArray(item.voteFingerprints) &&
    item.voteFingerprints.length >= 2 &&
    item.voteFingerprints.length === new Set(item.voteFingerprints).size &&
    item.voteFingerprints.every((fingerprint) => HASH_SHA256.test(fingerprint)) &&
    dateValid(item.createdAt) &&
    dateValid(item.updatedAt)
}

function emptyStore(at = now()) {
  return {
    schemaVersion: PERSONALITY_FEEDBACK_SCHEMA_VERSION,
    store: {
      id: 'omni-local-personality-feedback',
      createdAt: at,
      updatedAt: at
    },
    retention: {
      maxLastResponses: MAX_LAST_RESPONSES,
      maxVotes: MAX_VOTES,
      evictedLastResponses: 0,
      evictedVotes: 0
    },
    lastResponses: [],
    votes: [],
    candidates: []
  }
}

function validateStore(store, path) {
  if (store?.schemaVersion > PERSONALITY_FEEDBACK_SCHEMA_VERSION) {
    throw new Error(
      `Feedback de personalidade v${store.schemaVersion} e mais novo que este plugin: ${path}`
    )
  }
  if (
    !exactKeys(store, ['schemaVersion', 'store', 'retention', 'lastResponses', 'votes', 'candidates']) ||
    store.schemaVersion !== PERSONALITY_FEEDBACK_SCHEMA_VERSION ||
    !exactKeys(store.store, ['id', 'createdAt', 'updatedAt']) ||
    store.store.id !== 'omni-local-personality-feedback' ||
    !dateValid(store.store.createdAt) ||
    !dateValid(store.store.updatedAt) ||
    !exactKeys(store.retention, [
      'maxLastResponses',
      'maxVotes',
      'evictedLastResponses',
      'evictedVotes'
    ]) ||
    store.retention.maxLastResponses !== MAX_LAST_RESPONSES ||
    store.retention.maxVotes !== MAX_VOTES ||
    !Number.isInteger(store.retention.evictedLastResponses) ||
    store.retention.evictedLastResponses < 0 ||
    !Number.isInteger(store.retention.evictedVotes) ||
    store.retention.evictedVotes < 0 ||
    !Array.isArray(store.lastResponses) ||
    store.lastResponses.length > MAX_LAST_RESPONSES ||
    !store.lastResponses.every(validLastResponse) ||
    new Set(store.lastResponses.map((item) => item.sessionFingerprint)).size !== store.lastResponses.length ||
    !Array.isArray(store.votes) ||
    store.votes.length > MAX_VOTES ||
    !store.votes.every(validVote) ||
    !Array.isArray(store.candidates) ||
    store.candidates.length > MAX_CANDIDATES ||
    !store.candidates.every(validCandidate)
  ) {
    throw new Error(`Feedback local de personalidade fora do contrato v1: ${path}`)
  }
  return store
}

export function caminhoDoFeedbackPersonalidade(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do feedback de personalidade precisa ser absoluta.')
  return join(casa, 'feedback', 'personality-feedback.json')
}

async function load(casa) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  try {
    return validateStore(JSON.parse(await readFile(path, 'utf8')), path)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore()
    throw error
  }
}

async function acquireLock(casa) {
  const directory = join(casa, 'feedback')
  const path = join(directory, 'personality-feedback.lock')
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
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
  }
  throw new Error('Feedback local de personalidade ocupado por outra escrita.')
}

async function save(casa, store, at = now()) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
  store.store.updatedAt = at
  validateStore(store, path)
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function activeIdentity(pluginRoot = PLUGIN_ROOT) {
  const [manifest, integrity] = await Promise.all([
    readFile(join(pluginRoot, 'contratos', 'personalidade', 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(pluginRoot, 'contratos', 'atualizacao', 'integridade.json'), 'utf8').then(JSON.parse)
  ])
  const personaId = manifest?.id
  const releaseFingerprint = integrity?.identity?.releaseFingerprint
  if (!validIdentity(personaId, releaseFingerprint)) {
    throw new Error('Identidade ativa da personalidade nao possui release verificavel.')
  }
  return { personaId, releaseFingerprint }
}

function hasNearby(value, first, second) {
  return new RegExp(`(?:${first}).{0,100}(?:${second})|(?:${second}).{0,100}(?:${first})`).test(value)
}

export function classificarFeedbackPersonalidade(value) {
  const text = normalize(value)
  if (!text || text.length > 100_000) return null

  const metalinguagemOuInstrucao = [
    /^(?:explique|defina|compare|analise|descreva)\b/,
    /^(?:use|escreva|crie|faca)\b.{0,100}\b(?:resposta|tom|jeito|personalidade|dialogo|conversa|voz|humor|sarcasmo|analogia)\b/,
    /^quero\s+(?:uma|que voce (?:use|escreva|crie|faca))\b.{0,100}\b(?:resposta|tom|jeito|personalidade|dialogo|conversa|voz)\b/,
    /^nao\s+(?:diga|escreva|use|afirme)\b/,
    /\b(?:no|para o|como)\s+exemplo\b/,
    /\b(?:frase|texto|cenario)\s+(?:de|do)\s+(?:exemplo|teste)\b/,
    /^o termo\b.{0,100}\b(?:aparece|significa|quer dizer)\b/,
    /^o documento\b.{0,100}\b(?:diz|descreve|menciona)\b/
  ].some((pattern) => pattern.test(text))
  if (metalinguagemOuInstrucao) return null

  const subject = '(?:resposta|tom|jeito|personalidade|dialogo|conversa|voz|voce|vc|omni|humor|sarcasmo|ironia|analogia|analogias|metafora|metaforas|inteligencia|raciocinio|perspicacia)'
  const retrospective = [
    /\b(?:essa|esta|ultima|sua|a)\s+resposta\b.{0,120}\b(?:ficou|veio|soou|parece|continua|segue|esta|ta|faltou|falta|sumiu|funcionou|nao funcionou)\b/,
    /\b(?:esse|este|seu|o)\s+(?:tom|jeito|dialogo|conversa|voz|personalidade)\b.{0,120}\b(?:ficou|veio|soou|parece|continua|segue|esta|ta|faltou|falta|sumiu|funcionou|nao funcionou)\b/,
    /\b(?:voce|vc|omni)\b.{0,80}\b(?:respondeu|ficou|veio|soa|parece|continua|segue|esta|ta)\b/,
    new RegExp(`\\b(?:gostei|curti|aprovei|nao gostei|nao curti|nao aprovei)\\b.{0,100}\\b${subject}\\b`),
    new RegExp(`\\bagora sim\\b.{0,100}\\b${subject}\\b`),
    /\b(?:faltou|sumiu|nada da|cade a)\b.{0,100}\b(?:personalidade|humor|sarcasmo|ironia|analogia|analogias|metafora|metaforas|inteligencia|raciocinio|perspicacia)\b/,
    /\b(?:humor|sarcasmo|ironia|analogia|analogias|metafora|metaforas|inteligencia|raciocinio|perspicacia)\b.{0,80}\b(?:funcionou|encaixou|ficou|foi|apareceu|sumiu|faltou|falta|nao apareceu|nao funcionou)\b/,
    /\b(?:quero mais|precisa de mais|preciso de mais)\b.{0,100}\b(?:personalidade|humor|sarcasmo|ironia|analogia|analogias|metafora|metaforas|inteligencia|raciocinio|perspicacia)\b.{0,100}\b(?:no seu jeito|na sua resposta|nesta resposta|nessa resposta|na conversa|no dialogo)\b/,
    /\bpersonalidade\b.{0,80}\b(?:apareceu|entrou|funcionou|nao apareceu|nao entrou|nao pegou|sumiu|esta ausente|esta presente)\b/
  ].some((pattern) => pattern.test(text))
  if (!retrospective) return null

  const stateVerb = '(?:esta|ta|ficou|continua|segue|soa|parece)'
  const goodAdjective = '(?:otim[oa]|excelente|perfeit[oa]|bo[ma]|natural|vivo|viva|marcante|inteligente)'
  const badAdjective = '(?:ruim|pessim[oa]|fraco|fraca|seco|seca|frio|fria|generico|generica|robotico|robotica|sem vida)'
  const negatedGoodPattern = new RegExp(
    `\\bnao\\s+${stateVerb}\\s+(?:muito\\s+)?${goodAdjective}(?:\\s+nem\\s+${goodAdjective})*\\b`,
    'g'
  )
  const negatedBadPattern = new RegExp(
    `\\bnao\\s+${stateVerb}\\s+(?:muito\\s+)?${badAdjective}(?:\\s+nem\\s+${badAdjective})*\\b`,
    'g'
  )
  const negatedBadSequences = text.match(negatedBadPattern) ?? []
  const positiveEvidence = text
    .replace(/\bnao\s+(?:gostei|curti|aprovei|apareceu|entrou|pegou|funcionou)\b/g, '')
    .replace(negatedGoodPattern, '')
  const negativeEvidence = text
    .replace(negatedBadPattern, '')
    .replace(/\bnao\s+(?:faltou|falta|sumiu)\b/g, '')

  const good = '(?:otim[oa]|excelente|perfeit[oa]|bo[ma]|natural|vivo|viva|marcante|inteligente)'
  const bad = '(?:ruim|pessim[oa]|fraco|fraca|seco|seca|frio|fria|generico|generica|robotico|robotica)'
  const positive = []
  const negative = []

  if (
    hasNearby(positiveEvidence, subject, good) ||
    new RegExp(`\\b(?:gostei|curti|aprovei)\\b.{0,80}\\b${subject}\\b`).test(positiveEvidence) ||
    new RegExp(`\\bagora sim\\b.{0,80}\\b${subject}\\b`).test(positiveEvidence)
  ) positive.push('overall-approved')
  if (
    hasNearby(negativeEvidence, subject, bad) ||
    new RegExp(`\\bnao (?:gostei|curti|aprovei)\\b.{0,80}\\b${subject}\\b`).test(text) ||
    new RegExp(`\\b${subject}\\b.{0,80}\\b(?:nao (?:esta|ta|ficou|continua|segue|soa|parece) (?:otim[oa]|excelente|perfeit[oa]|bo[ma]|natural|vivo|viva|marcante|inteligente)|poderia ser melhor|precisa melhorar|nao convenceu|nao funcionou)\\b`).test(text)
  ) negative.push('overall-rejected')

  if (negatedBadSequences.some((sequence) => /\b(?:seco|seca)\b/.test(sequence))) {
    positive.push('tone-approved')
  } else if (hasNearby(negativeEvidence, '(?:tom|resposta|jeito|dialogo|conversa|voce|vc|omni)', '(?:seco|seca)')) {
    negative.push('tone-too-dry')
  }
  if (negatedBadSequences.some((sequence) => /\b(?:frio|fria|sem vida)\b/.test(sequence))) {
    positive.push('presence-effective')
  } else if (hasNearby(negativeEvidence, '(?:resposta|jeito|dialogo|conversa|voce|vc|omni)', '(?:frio|fria|sem vida)')) {
    negative.push('presence-too-cold')
  }
  if (negatedBadSequences.some((sequence) => /\b(?:generico|generica|robotico|robotica)\b/.test(sequence))) {
    positive.push('voice-distinct')
  } else if (hasNearby(negativeEvidence, '(?:resposta|tom|jeito|dialogo|conversa|voz|voce|vc|omni)', '(?:generico|generica|robotico|robotica)')) {
    negative.push('voice-generic')
  }
  if (/\bpersonalidade\b.{0,60}\b(?:apareceu|entrou|funcionou|esta presente|ficou clara)\b|\b(?:apareceu|entrou|funcionou)\b.{0,60}\bpersonalidade\b/.test(positiveEvidence)) {
    positive.push('personality-present')
  }
  if (/\bpersonalidade\b.{0,60}\b(?:nao apareceu|nao entrou|nao pegou|nao funciona|nao funcionou|sumiu|esta ausente)\b|\b(?:faltou|falta|nada da|cade a|sem sinal de)\b.{0,60}\bpersonalidade\b/.test(text)) {
    negative.push('personality-absent')
  }

  const dimensionSignals = [
    ['humor', '(?:humor|piada|graca)', 'humor-effective', 'humor-missing'],
    ['sarcasm', '(?:sarcasmo|ironia)', 'sarcasm-effective', 'sarcasm-missing'],
    ['analogies', '(?:analogia|analogias|metafora|metaforas|imagem mental)', 'analogy-effective', 'analogy-missing'],
    ['intelligence', '(?:inteligencia|raciocinio|perspicacia)', 'intelligence-perceived', 'intelligence-flat']
  ]
  for (const [, dimension, positiveCode, negativeCode] of dimensionSignals) {
    if (
      new RegExp(`\\b${dimension}\\b.{0,70}\\b(?:funcionou|encaixou|ficou (?:otim[oa]|bo[ma])|foi (?:otim[oa]|bo[ma])|apareceu)\\b`).test(positiveEvidence) ||
      new RegExp(`\\b(?:gostei|curti|otim[oa]|excelente|perfeit[oa])\\b.{0,70}\\b${dimension}\\b`).test(positiveEvidence)
    ) positive.push(positiveCode)
    if (
      new RegExp(`\\b(?:faltou|falta|sumiu|cade|quero mais|precisa de mais|preciso de mais|pouco|pouca|sem)\\b.{0,100}\\b${dimension}\\b`).test(negativeEvidence) ||
      new RegExp(`\\b${dimension}\\b.{0,70}\\b(?:faltou|falta|sumiu|nao apareceu|nao funcionou|fraco|fraca)\\b`).test(negativeEvidence)
    ) negative.push(negativeCode)
  }

  const positiveReasons = [...new Set(positive)].filter((code) => REASON_CODES.has(code))
  const negativeReasons = [...new Set(negative)].filter((code) => REASON_CODES.has(code))
  if (!positiveReasons.length && !negativeReasons.length) return null
  const polarity = positiveReasons.length && negativeReasons.length
    ? 'mixed'
    : positiveReasons.length ? 'positive' : 'negative'
  const reasonCodes = [...new Set([...positiveReasons, ...negativeReasons])].sort()
  const dimensions = [...new Set(reasonCodes.map((reason) => REASON_DIMENSIONS[reason]))].sort()
  return { polarity, dimensions, reasonCodes }
}

function candidateKey(vote, reasonCode) {
  const polarity = reasonCode.endsWith('-approved') ||
    reasonCode.endsWith('-effective') ||
    reasonCode.endsWith('-present') ||
    reasonCode.endsWith('-perceived') ||
    reasonCode === 'voice-distinct'
    ? 'positive'
    : 'negative'
  return {
    key: [vote.personaId, polarity, REASON_DIMENSIONS[reasonCode], reasonCode].join(':'),
    polarity,
    dimension: REASON_DIMENSIONS[reasonCode]
  }
}

function rebuildCandidates(store) {
  const groups = new Map()
  for (const vote of store.votes) {
    for (const reasonCode of vote.reasonCodes) {
      const descriptor = candidateKey(vote, reasonCode)
      const existing = groups.get(descriptor.key) ?? {
        personaId: vote.personaId,
        polarity: descriptor.polarity,
        dimension: descriptor.dimension,
        reasonCode,
        votesByTurn: new Map()
      }
      existing.votesByTurn.set(vote.turnFingerprint, vote)
      groups.set(descriptor.key, existing)
    }
  }
  store.candidates = [...groups.entries()]
    .map(([key, group]) => [key, group, [...group.votesByTurn.values()]])
    .filter(([, , votes]) => votes.length >= 2)
    .map(([key, group, votes]) => ({
      id: `personality-candidate-${hash(key).slice(0, 24)}`,
      personaId: group.personaId,
      polarity: group.polarity,
      dimension: group.dimension,
      reasonCode: group.reasonCode,
      status: 'reviewable',
      occurrences: votes.length,
      releaseFingerprints: [...new Set(votes.map((vote) => vote.releaseFingerprint))],
      voteFingerprints: votes.map((vote) => hash(vote.id)),
      createdAt: votes[0].recordedAt,
      updatedAt: votes.at(-1).recordedAt
    }))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(-MAX_CANDIDATES)
}

function summarize(store) {
  const byPolarity = { positive: 0, negative: 0, mixed: 0 }
  const byDimension = Object.fromEntries([...DIMENSIONS].map((dimension) => [dimension, 0]))
  const byReasonCode = Object.fromEntries([...REASON_CODES].map((reason) => [reason, 0]))
  for (const vote of store.votes) {
    byPolarity[vote.polarity] += 1
    for (const dimension of vote.dimensions) byDimension[dimension] += 1
    for (const reason of vote.reasonCodes) byReasonCode[reason] += 1
  }
  return {
    totalVotes: store.votes.length,
    evictedVotes: store.retention.evictedVotes,
    evictedLastResponses: store.retention.evictedLastResponses,
    byPolarity,
    byDimension,
    byReasonCode,
    reviewableCandidates: store.candidates.length
  }
}

function immediateAdjustment(vote) {
  const directives = new Set()
  const directiveByReason = {
    'overall-approved': 'preserve-overall-voice',
    'overall-rejected': 'change-overall-voice',
    'tone-approved': 'preserve-tone',
    'tone-too-dry': 'increase-tone-presence',
    'presence-effective': 'preserve-presence',
    'presence-too-cold': 'increase-human-presence',
    'voice-distinct': 'preserve-distinctive-voice',
    'voice-generic': 'increase-distinctive-voice',
    'personality-present': 'preserve-personality-intensity',
    'personality-absent': 'increase-personality-intensity',
    'humor-effective': 'preserve-humor-level',
    'humor-missing': 'increase-contextual-humor',
    'sarcasm-effective': 'preserve-sarcasm-level',
    'sarcasm-missing': 'increase-contextual-sarcasm',
    'analogy-effective': 'preserve-analogy-level',
    'analogy-missing': 'increase-useful-analogies',
    'intelligence-perceived': 'preserve-reasoning-density',
    'intelligence-flat': 'increase-reasoning-density'
  }
  for (const reason of vote.reasonCodes) directives.add(directiveByReason[reason])
  return {
    scope: 'next-response',
    reversible: true,
    expiresAfterTurns: 1,
    sourceVoteId: vote.id,
    turnFingerprint: vote.turnFingerprint,
    answerFingerprint: vote.answerFingerprint,
    directives: [...directives]
  }
}

export async function lerFeedbackPersonalidade(casa) {
  return load(casa)
}

export async function resumirFeedbackPersonalidade(casa) {
  const store = await load(casa)
  return { counts: summarize(store), candidates: store.candidates }
}

export async function registrarUltimaRespostaPersonalidade(casa, input, options = {}) {
  const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
  const answer = typeof input?.answer === 'string' ? input.answer : ''
  if (!nonEmptyText(sessionId, 10_000) || !nonEmptyText(answer, 1_000_000)) {
    return { result: 'ignored', response: null }
  }
  const at = now(options.at)
  const identity = input.personaId || input.releaseFingerprint
    ? { personaId: input.personaId, releaseFingerprint: input.releaseFingerprint }
    : await activeIdentity(options.pluginRoot)
  if (!validIdentity(identity.personaId, identity.releaseFingerprint)) {
    throw new Error('Identidade informada para o feedback de personalidade e invalida.')
  }
  const response = {
    sessionFingerprint: hash(sessionId),
    turnFingerprint: hash(`${hash(sessionId)}:${hash(answer)}:${at}:${randomUUID()}`),
    answerFingerprint: hash(answer),
    personaId: identity.personaId,
    releaseFingerprint: identity.releaseFingerprint,
    recordedAt: at
  }
  const release = await acquireLock(casa)
  try {
    const store = await load(casa)
    store.lastResponses = store.lastResponses.filter(
      (item) => item.sessionFingerprint !== response.sessionFingerprint
    )
    store.lastResponses.push(response)
    const overflow = Math.max(0, store.lastResponses.length - MAX_LAST_RESPONSES)
    store.retention.evictedLastResponses += overflow
    store.lastResponses = store.lastResponses.slice(-MAX_LAST_RESPONSES)
    await save(casa, store, at)
    return { result: 'recorded', response }
  } finally {
    await release()
  }
}

export async function observarVotoPersonalidade(casa, input, options = {}) {
  const origin = input?.origin ?? 'owner-live'
  if (!OWNER_ORIGINS.has(origin)) {
    const summary = await resumirFeedbackPersonalidade(casa)
    return { result: 'ignored-origin', vote: null, adjustment: null, ...summary }
  }
  const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : ''
  const feedback = typeof input?.feedback === 'string' ? input.feedback : ''
  if (!nonEmptyText(sessionId, 10_000) || !nonEmptyText(feedback, 100_000)) {
    const summary = await resumirFeedbackPersonalidade(casa)
    return { result: 'neutral', vote: null, adjustment: null, ...summary }
  }
  const classification = classificarFeedbackPersonalidade(feedback)
  if (!classification) {
    const summary = await resumirFeedbackPersonalidade(casa)
    return { result: 'neutral', vote: null, adjustment: null, ...summary }
  }

  const release = await acquireLock(casa)
  try {
    const store = await load(casa)
    const sessionFingerprint = hash(sessionId)
    const response = store.lastResponses.find((item) => item.sessionFingerprint === sessionFingerprint)
    if (!response) {
      return {
        result: 'unbound',
        vote: null,
        adjustment: null,
        counts: summarize(store),
        candidates: store.candidates
      }
    }
    const feedbackFingerprint = hash(normalize(feedback))
    const duplicate = store.votes.find((vote) =>
      vote.sessionFingerprint === sessionFingerprint &&
      vote.turnFingerprint === response.turnFingerprint &&
      vote.feedbackFingerprint === feedbackFingerprint
    )
    if (duplicate) {
      return {
        result: 'duplicate',
        vote: duplicate,
        adjustment: immediateAdjustment(duplicate),
        counts: summarize(store),
        candidates: store.candidates
      }
    }
    const at = now(options.at)
    const vote = {
      id: `personality-vote-${randomUUID()}`,
      sessionFingerprint,
      turnFingerprint: response.turnFingerprint,
      answerFingerprint: response.answerFingerprint,
      feedbackFingerprint,
      personaId: response.personaId,
      releaseFingerprint: response.releaseFingerprint,
      polarity: classification.polarity,
      dimensions: classification.dimensions,
      reasonCodes: classification.reasonCodes,
      recordedAt: at
    }
    store.votes.push(vote)
    const overflow = Math.max(0, store.votes.length - MAX_VOTES)
    store.retention.evictedVotes += overflow
    store.votes = store.votes.slice(-MAX_VOTES)
    rebuildCandidates(store)
    await save(casa, store, at)
    return {
      result: 'recorded',
      vote,
      adjustment: immediateAdjustment(vote),
      counts: summarize(store),
      candidates: store.candidates
    }
  } finally {
    await release()
  }
}
