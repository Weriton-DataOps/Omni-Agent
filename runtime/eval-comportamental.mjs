import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  lerIdentidadeRelease,
  verificarIntegridadeRelease
} from './integridade-release.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const CONTRACT_PATH = new URL('../contratos/eval/comportamento-real.json', import.meta.url)
const UUID_JSONL = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jsonl$/i
const GENERIC_OPENING = /^(claro|com certeza|certamente|entendo(?: sua| o| a)?|olá|oi[,!]|sem problemas)[,!.:\s]/i
const OWNER_CORRECTION = /(?:\beu n[aã]o (?:pedi|disse|falei) (?:isso|assim)\b|\bn[aã]o foi isso que (?:eu )?(?:pedi|disse)\b|\b(?:voc[eê]|vc)\b.{0,100}\b(?:errou|fez errado|ignorou)\b|\bseja mais fiel ao que eu (?:pedi|disse)\b)/i
const ACTIVATION = /(?:<command-name>\s*\/?(?:omni:)?omni\s*<\/command-name>|^\s*\/(?:omni:)?omni(?:\s|$))/im
const DELEGATION_TOOLS = new Set(['agent', 'task', 'sendmessage', 'spawn_agent'])

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function contentBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

function textFrom(content) {
  return contentBlocks(content)
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim()
}

function isOwnerTurn(record) {
  if (
    record?.type !== 'user' ||
    record?.isMeta === true ||
    record?.isSidechain === true ||
    record?.is_sidechain === true ||
    record?.agentId ||
    record?.agent_id
  ) return false
  const blocks = contentBlocks(record?.message?.content)
  if (blocks.some((item) => item?.type === 'tool_result')) return false
  return Boolean(textFrom(record?.message?.content))
}

function toolNames(record) {
  if (record?.type !== 'assistant') return []
  return contentBlocks(record?.message?.content)
    .filter((item) => item?.type === 'tool_use' && typeof item.name === 'string')
    .map((item) => item.name)
}

async function lerContrato() {
  const contract = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  if (
    contract?.schemaVersion !== 2 ||
    contract.suite !== 'omni-real-behavior-v1' ||
    !Array.isArray(contract.humanDimensions) ||
    !Number.isInteger(contract.minimumSessions) ||
    !Number.isInteger(contract.minimumOwnerTurns) ||
    contract.provenance?.trustedRootsOnly !== true ||
    contract.provenance?.requireSessionIdMatchesFilename !== true ||
    contract.provenance?.requireTrustedSessionReleaseReceipt !== true ||
    contract.provenance?.requireDistinctReceiptFingerprints !== true ||
    contract.provenance?.requireExplicitReceiptBindings !== true ||
    contract.provenance?.internalSessionVerification !== 'trusted-root-session-binding-v1' ||
    contract.provenance?.callerSuppliedVerifierIsProof !== false ||
    contract.promotion?.ownerReviewAuthority !== 'owner-live-local-review-v1' ||
    contract.promotion?.externalIdentityRequired !== false ||
    contract.promotion?.selfReportedApprovalIsProof !== false
  ) throw new Error('Contrato do eval comportamental fora da versão 2.')
  return contract
}

async function caminhoConfiavel(path, trustedRoots) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('O transcrito precisa ser um arquivo regular, sem link simbolico.')
  }
  const target = await realpath(path)
  const roots = await Promise.all(trustedRoots.map(async (root) => realpath(resolve(root))))
  const inside = roots.some((root) => {
    const trecho = relative(root, target)
    return trecho === '' || (trecho !== '..' && !trecho.startsWith(`..${sep}`) && !isAbsolute(trecho))
  })
  if (!inside) throw new Error('O transcrito esta fora das raizes confiaveis do Claude.')
  return target
}

export async function inspecionarTranscritoClaude(path, {
  trustedRoots = [join(homedir(), '.claude', 'projects')]
} = {}) {
  if (!isAbsolute(path ?? '')) throw new Error('O transcrito precisa usar caminho absoluto.')
  if (!UUID_JSONL.test(basename(path))) throw new Error('O transcrito real precisa ter nome UUID .jsonl.')
  if (/(?:^|[\\/])(?:scratchpad|tool-results)(?:[\\/]|$)/i.test(path)) {
    throw new Error('Scratchpad e resultado de ferramenta não são evidência de conversa real.')
  }

  if (!Array.isArray(trustedRoots) || trustedRoots.length === 0) {
    throw new Error('O eval exige ao menos uma raiz confiavel de transcritos.')
  }
  const trustedPath = await caminhoConfiavel(path, trustedRoots)
  const expectedSessionId = basename(trustedPath, '.jsonl').toLowerCase()
  const digest = createHash('sha256')
  const stream = createReadStream(trustedPath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let activated = false
  let ownerTurns = 0
  let assistantTurns = 0
  let genericOpenings = 0
  let ownerCorrections = 0
  let toolUses = 0
  let delegations = 0
  let invalidLines = 0
  let boundSessionRecords = 0
  let mismatchedSessionRecords = 0

  for await (const line of lines) {
    digest.update(line, 'utf8')
    digest.update('\n')
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      invalidLines += 1
      continue
    }
    const recordSessionId = record?.sessionId ?? record?.session_id
    if (typeof recordSessionId === 'string' && recordSessionId) {
      boundSessionRecords += 1
      if (recordSessionId.toLowerCase() !== expectedSessionId) mismatchedSessionRecords += 1
    }
    const text = textFrom(record?.message?.content)
    if (!activated && isOwnerTurn(record) && ACTIVATION.test(text)) {
      activated = true
      continue
    }
    if (!activated) continue

    if (isOwnerTurn(record)) {
      ownerTurns += 1
      if (OWNER_CORRECTION.test(text)) ownerCorrections += 1
    }
    if (record?.type === 'assistant') {
      if (text) {
        assistantTurns += 1
        if (GENERIC_OPENING.test(text)) genericOpenings += 1
      }
      const tools = toolNames(record)
      toolUses += tools.length
      delegations += tools.filter((name) => DELEGATION_TOOLS.has(name.toLowerCase())).length
    }
  }

  if (invalidLines > 0) throw new Error('O transcrito contem linhas invalidas e nao pode provar uma rodada real.')
  if (boundSessionRecords === 0 || mismatchedSessionRecords > 0) {
    throw new Error('O sessionId do transcrito nao corresponde ao UUID do arquivo.')
  }

  return {
    source: 'claude-session-jsonl',
    transcriptFingerprint: digest.digest('hex'),
    sessionFingerprint: hash(basename(path).toLowerCase()),
    activated,
    ownerTurns,
    assistantTurns,
    genericOpenings,
    ownerCorrections,
    toolUses,
    delegations,
    invalidLines,
    sessionBound: true,
    trustedRoot: true
  }
}

function validarRevisaoHumana(review, contract) {
  const scores = review?.scores
  const minimum = contract.thresholds.minimumHumanScore
  const maximum = contract.thresholds.maximumHumanScore
  const valid = review?.reviewer === 'owner' && review?.approved === true &&
    review?.crossSessionMemory === true && scores &&
    contract.humanDimensions.every((dimension) =>
      Number.isInteger(scores[dimension]) && scores[dimension] >= minimum && scores[dimension] <= maximum
    )
  const average = valid
    ? contract.humanDimensions.reduce((sum, dimension) => sum + scores[dimension], 0) / contract.humanDimensions.length
    : 0
  const locallyVerified = Boolean(valid) && review?.source === 'owner-live-local-review-v1' && review?.verified === true
  return {
    valid: Boolean(valid),
    locallyVerified,
    average,
    reviewClaimFingerprint: valid ? hash(JSON.stringify({ scores, approved: true, crossSessionMemory: true })) : null
  }
}

function reciboInternoSessao(binding) {
  const bindingFingerprint = hash(JSON.stringify(binding))
  return {
    status: 'verified-local-session',
    source: 'trusted-root-session-binding-v1',
    methodClaim: 'trusted-root-session-binding-v1',
    receiptFingerprint: hash(`session-receipt:${bindingFingerprint}`),
    binding,
    bindingFingerprint,
    claimedVerified: true,
    internallyVerified: true,
    verificationAuthority: 'trusted-root-session-binding-v1'
  }
}

function reciboInternoRevisao(binding, human) {
  const bindingFingerprint = hash(JSON.stringify(binding))
  if (!human.locallyVerified) {
    return {
      status: 'unverified-owner-claim',
      source: 'owner-review-claim',
      methodClaim: null,
      receiptFingerprint: null,
      binding,
      bindingFingerprint,
      claimedVerified: human.valid,
      internallyVerified: false,
      verificationAuthority: null
    }
  }
  return {
    status: 'verified-local-owner-review',
    source: 'owner-live-local-review-v1',
    methodClaim: 'owner-live-local-review-v1',
    receiptFingerprint: hash(`owner-review:${bindingFingerprint}`),
    binding,
    bindingFingerprint,
    claimedVerified: true,
    internallyVerified: true,
    verificationAuthority: 'owner-live-local-review-v1'
  }
}

export async function avaliarRodadaComportamental({
  pluginRoot = raiz,
  transcriptPaths,
  humanReview,
  trustedTranscriptRoots = [join(homedir(), '.claude', 'projects')],
  readReleaseIdentity = lerIdentidadeRelease,
  verifyIntegrity = verificarIntegridadeRelease,
  at
} = {}) {
  const contract = await lerContrato()
  if (!Array.isArray(transcriptPaths) || transcriptPaths.length < contract.minimumSessions) {
    throw new Error(`O eval real exige ao menos ${contract.minimumSessions} sessões.`)
  }
  const release = await readReleaseIdentity(pluginRoot)
  const integrity = await verifyIntegrity(pluginRoot)
  const sessions = await Promise.all(
    [...new Set(transcriptPaths)].map((path) => inspecionarTranscritoClaude(path, {
      trustedRoots: trustedTranscriptRoots
    }))
  )
  const uniqueSessions = new Set(sessions.map((item) => item.sessionFingerprint)).size
  const totals = sessions.reduce((sum, item) => ({
    ownerTurns: sum.ownerTurns + item.ownerTurns,
    assistantTurns: sum.assistantTurns + item.assistantTurns,
    genericOpenings: sum.genericOpenings + item.genericOpenings,
    ownerCorrections: sum.ownerCorrections + item.ownerCorrections,
    toolUses: sum.toolUses + item.toolUses,
    delegations: sum.delegations + item.delegations
  }), { ownerTurns: 0, assistantTurns: 0, genericOpenings: 0, ownerCorrections: 0, toolUses: 0, delegations: 0 })
  const genericOpeningRate = totals.assistantTurns === 0 ? 1 : totals.genericOpenings / totals.assistantTurns
  const human = validarRevisaoHumana(humanReview, contract)
  const sessionReceiptClaims = sessions.map((session) => reciboInternoSessao({
      suite: contract.suite,
      releaseVersion: release.version,
      releaseFingerprint: release.releaseFingerprint,
      payloadFingerprint: integrity.fingerprint,
      sessionFingerprint: session.sessionFingerprint,
      transcriptFingerprint: session.transcriptFingerprint
    }))
  const ownerReviewBinding = {
      suite: contract.suite,
      releaseVersion: release.version,
      releaseFingerprint: release.releaseFingerprint,
      payloadFingerprint: integrity.fingerprint,
      reviewClaimFingerprint: human.reviewClaimFingerprint,
      transcriptSetFingerprint: hash(sessions.map((item) => item.transcriptFingerprint).sort().join('\0'))
    }
  const ownerReviewClaim = reciboInternoRevisao(ownerReviewBinding, human)
  const receiptClaims = [...sessionReceiptClaims, ownerReviewClaim]
  const receiptClaimsComplete = receiptClaims.every((item) =>
    /^[a-f0-9]{64}$/.test(item.receiptFingerprint ?? '') &&
    /^[a-f0-9]{64}$/.test(item.bindingFingerprint ?? '')
  )
  const receiptClaimsDistinct = receiptClaimsComplete &&
    new Set(receiptClaims.map((item) => item.receiptFingerprint)).size === receiptClaims.length &&
    new Set(receiptClaims.map((item) => item.bindingFingerprint)).size === receiptClaims.length
  const gates = [
    { id: 'installed-release-verified', passed: integrity.status === 'verified' },
    { id: 'distinct-real-sessions', passed: uniqueSessions >= contract.minimumSessions },
    { id: 'omni-activated', passed: sessions.every((item) => item.activated) },
    { id: 'minimum-owner-turns', passed: totals.ownerTurns >= contract.minimumOwnerTurns },
    { id: 'assistant-responses', passed: totals.assistantTurns >= contract.minimumOwnerTurns },
    { id: 'owner-correction-observed', passed: totals.ownerCorrections >= 1 },
    { id: 'tool-use-observed', passed: totals.toolUses >= 1 },
    { id: 'delegation-observed', passed: totals.delegations >= 1 },
    { id: 'generic-opening-rate', passed: genericOpeningRate <= contract.thresholds.maximumGenericOpeningRate },
    { id: 'receipt-claims-distinct-and-explicitly-bound', passed: receiptClaimsDistinct },
    { id: 'owner-review-claim-complete', passed: human.valid && human.average >= contract.thresholds.minimumAverageHumanScore },
    { id: 'session-receipts-verified-from-trusted-roots', passed: sessionReceiptClaims.every((item) => item.internallyVerified) },
    { id: 'owner-review-verified-by-local-command', passed: ownerReviewClaim.internallyVerified }
  ]
  const passed = gates.every((item) => item.passed)
  return {
    id: `behavior-run-${randomUUID()}`,
    suite: contract.suite,
    executedAt: now(at),
    plugin: {
      version: release.version,
      releaseFingerprint: release.releaseFingerprint,
      payloadFingerprint: integrity.fingerprint,
      integrity: integrity.status
    },
    provenance: sessions.map((item) => ({
      source: item.source,
      transcriptFingerprint: item.transcriptFingerprint,
      sessionFingerprint: item.sessionFingerprint,
      activated: item.activated
    })),
    metrics: { ...totals, uniqueSessions, genericOpeningRate, humanAverageScore: human.average },
    gates,
    humanReviewClaimFingerprint: human.reviewClaimFingerprint,
    trust: {
      sessionReceiptClaims,
      ownerReviewClaim,
      verification: passed ? 'local-controlled-evidence-v1' : 'incomplete',
      scope: 'single-owner-local-machine',
      selfReportedApprovalIsProof: false,
      callerSuppliedCallbackIsProof: false,
      promotable: passed
    },
    status: passed ? 'passed' : human.valid ? 'unverified-claim' : 'pending-unverified'
  }
}

export function caminhoDoHistoricoComportamental(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'evals', 'behavior-history.json')
}

function historicoVazio(at = now()) {
  return {
    schemaVersion: 2,
    store: { id: 'omni-local-real-behavior', createdAt: at, updatedAt: at },
    runs: []
  }
}

function validarHistorico(store) {
  if (store?.schemaVersion === 1 && Array.isArray(store?.runs)) {
    store.runs = store.runs.map((run) => {
      if (run?.status !== 'passed') return run
      return {
        ...run,
        status: 'unverified-legacy-claim',
        trust: {
          ...(run?.trust && typeof run.trust === 'object' ? run.trust : {}),
          internallyRevalidated: false,
          promotable: false,
          migratedAsTrusted: false
        }
      }
    })
    store.schemaVersion = 2
  }
  if (
    store?.schemaVersion !== 2 ||
    store.store?.id !== 'omni-local-real-behavior' ||
    !Array.isArray(store.runs)
  ) throw new Error('Histórico comportamental fora da versão 1.')
  return store
}

export async function lerHistoricoComportamental(casa) {
  const path = caminhoDoHistoricoComportamental(casa)
  try {
    return validarHistorico(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return historicoVazio()
  }
}

async function acquireLock(casa) {
  const directory = join(casa, 'evals')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'behavior-history.lock')
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
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('O histórico comportamental está ocupado por outra escrita.')
}

export async function registrarRodadaComportamental(casa, input) {
  const run = await avaliarRodadaComportamental(input)
  const path = caminhoDoHistoricoComportamental(casa)
  const release = await acquireLock(casa)
  try {
    let store = await lerHistoricoComportamental(casa)
    if (store.runs.length === 0 && store.store.createdAt !== run.executedAt) {
      store = historicoVazio(run.executedAt)
    }
    store.runs.push(run)
    store.runs = store.runs.slice(-100)
    store.store.updatedAt = run.executedAt
    const temporary = `${path}.${process.pid}.novo`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
    return { result: 'recorded', run }
  } finally {
    await release()
  }
}
