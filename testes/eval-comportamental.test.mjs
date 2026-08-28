import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  avaliarRodadaComportamental,
  caminhoDoHistoricoComportamental,
  inspecionarTranscritoClaude,
  lerHistoricoComportamental,
  registrarRodadaComportamental
} from '../runtime/eval-comportamental.mjs'

const ids = [
  '0f302356-df48-4f71-94bd-cd802ad4d976.jsonl',
  '13aa4215-7f60-4101-ae3a-d2a14791c6a4.jsonl'
]

function row(type, content, sessionId) {
  return JSON.stringify({ type, sessionId, message: { content } })
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'omni-real-eval-'))
  const plugin = join(home, 'plugin')
  await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
  await writeFile(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'omni', version: '9.9.9'
  }), 'utf8')
  await mkdir(join(plugin, 'contratos', 'atualizacao'), { recursive: true })
  await writeFile(
    join(plugin, 'contratos', 'atualizacao', 'integridade.json'),
    JSON.stringify({
      schemaVersion: 1,
      contract: 'omni-release-integrity-v1',
      identity: { version: '9.9.9', releaseFingerprint: 'a'.repeat(64) }
    }),
    'utf8'
  )
  const paths = []
  for (let index = 0; index < ids.length; index += 1) {
    const path = join(home, ids[index])
    const sessionId = ids[index].replace(/\.jsonl$/, '')
    const lines = [row('user', '<command-name>/omni:omni</command-name>', sessionId)]
    for (let turn = 0; turn < 4; turn += 1) {
      const correction = index === 0 && turn === 1
        ? 'Eu não pedi isso; corrija e seja fiel ao que eu disse.'
        : `Pedido real ${index}-${turn}`
      lines.push(row('user', correction, sessionId))
      const content = [{ type: 'text', text: `Resposta viva ${index}-${turn}: evidência-ultravioleta.` }]
      if (index === 0 && turn === 2) content.push({ type: 'tool_use', name: 'Agent', input: {} })
      if (index === 1 && turn === 2) content.push({ type: 'tool_use', name: 'Bash', input: {} })
      lines.push(row('assistant', content, sessionId))
    }
    await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
    paths.push(path)
  }
  return { home, plugin, paths }
}

function review() {
  const dimensions = [
    'voice-from-first-line',
    'voice-through-long-conversation',
    'intelligence-and-causal-reading',
    'contextual-humor-or-sarcasm',
    'useful-analogy',
    'order-fidelity',
    'natural-conversation'
  ]
  return {
    reviewer: 'owner',
    approved: true,
    crossSessionMemory: true,
    scores: Object.fromEntries(dimensions.map((item) => [item, 4]))
  }
}

const verified = async () => ({
  fingerprint: 'a'.repeat(64), declaredFingerprint: 'a'.repeat(64), status: 'verified'
})

const claimedReceipt = async (binding) => ({
  verified: true,
  method: 'caller-supplied-claim',
  receiptFingerprint: createHash('sha256').update(JSON.stringify(binding)).digest('hex')
})

const repeatedClaimedReceipt = async () => ({
  verified: true,
  method: 'caller-supplied-claim',
  receiptFingerprint: 'b'.repeat(64)
})

test('inspeciona sessão Claude real sem devolver conversa bruta', async () => {
  const data = await fixture()
  try {
    const result = await inspecionarTranscritoClaude(data.paths[0], { trustedRoots: [data.home] })
    assert.equal(result.activated, true)
    assert.equal(result.ownerTurns, 4)
    assert.equal(result.ownerCorrections, 1)
    assert.equal(result.delegations, 1)
    assert.doesNotMatch(JSON.stringify(result), /ultravioleta/)
  } finally {
    await rm(data.home, { recursive: true, force: true })
  }
})

test('callback do chamador registra alegacoes distintas, mas nunca produz passed', async () => {
  const data = await fixture()
  try {
    const result = await avaliarRodadaComportamental({
      pluginRoot: data.plugin,
      transcriptPaths: data.paths,
      humanReview: review(),
      trustedTranscriptRoots: [data.home],
      verifySessionReceipt: claimedReceipt,
      verifyOwnerReview: claimedReceipt,
      verifyIntegrity: verified
    })
    assert.equal(result.status, 'unverified-claim')
    assert.equal(result.gates.find((item) => item.id === 'receipt-claims-distinct-and-explicitly-bound').passed, true)
    assert.equal(result.gates.find((item) => item.id === 'session-receipts-cryptographically-verified-internally').passed, false)
    assert.equal(result.gates.find((item) => item.id === 'owner-identity-cryptographically-verified-internally').passed, false)
    assert.equal(result.trust.callerSuppliedCallbackIsProof, false)
    assert.equal(result.trust.promotable, false)
    assert.ok(result.trust.sessionReceiptClaims.every((item) => item.internallyVerified === false))
    assert.equal(result.metrics.ownerTurns, 8)
    assert.equal(result.provenance.length, 2)
    assert.doesNotMatch(JSON.stringify(result), /ultravioleta/)
  } finally {
    await rm(data.home, { recursive: true, force: true })
  }
})

test('histórico persiste somente proveniência, métricas e fingerprints', async () => {
  const data = await fixture()
  try {
    const result = await registrarRodadaComportamental(data.home, {
      pluginRoot: data.plugin,
      transcriptPaths: data.paths,
      humanReview: review(),
      trustedTranscriptRoots: [data.home],
      verifySessionReceipt: claimedReceipt,
      verifyOwnerReview: claimedReceipt,
      verifyIntegrity: verified
    })
    assert.equal(result.run.status, 'unverified-claim')
    const raw = await readFile(caminhoDoHistoricoComportamental(data.home), 'utf8')
    assert.doesNotMatch(raw, /ultravioleta|Pedido real/)
    assert.match(raw, /transcriptFingerprint/)
    assert.match(raw, /bindingFingerprint/)
  } finally {
    await rm(data.home, { recursive: true, force: true })
  }
})

test('uma única sessão não pode fingir memória entre sessões', async () => {
  const data = await fixture()
  try {
    await assert.rejects(
      avaliarRodadaComportamental({
        pluginRoot: data.plugin,
        transcriptPaths: [data.paths[0]],
        humanReview: review(),
        trustedTranscriptRoots: [data.home],
        verifySessionReceipt: claimedReceipt,
        verifyOwnerReview: claimedReceipt,
        verifyIntegrity: verified
      }),
      /ao menos 2 sessões/
    )
  } finally {
    await rm(data.home, { recursive: true, force: true })
  }
})

test('JSONL e revisao autodeclarados permanecem alegacao sem prova criptografica', async () => {
  const data = await fixture()
  try {
    const result = await avaliarRodadaComportamental({
      pluginRoot: data.plugin,
      transcriptPaths: data.paths,
      humanReview: review(),
      trustedTranscriptRoots: [data.home],
      verifyIntegrity: verified
    })
    assert.equal(result.status, 'unverified-claim')
    assert.equal(result.gates.find((item) => item.id === 'receipt-claims-distinct-and-explicitly-bound').passed, false)
    assert.equal(result.gates.find((item) => item.id === 'session-receipts-cryptographically-verified-internally').passed, false)
    assert.equal(result.gates.find((item) => item.id === 'owner-identity-cryptographically-verified-internally').passed, false)
  } finally {
    await rm(data.home, { recursive: true, force: true })
  }
})

test('recibos alegados repetidos nao satisfazem diversidade nem binding', async () => {
  const data = await fixture()
  try {
    const result = await avaliarRodadaComportamental({
      pluginRoot: data.plugin,
      transcriptPaths: data.paths,
      humanReview: review(),
      trustedTranscriptRoots: [data.home],
      verifySessionReceipt: repeatedClaimedReceipt,
      verifyOwnerReview: repeatedClaimedReceipt,
      verifyIntegrity: verified
    })
    assert.equal(result.status, 'unverified-claim')
    assert.equal(result.gates.find((item) => item.id === 'receipt-claims-distinct-and-explicitly-bound').passed, false)
    assert.equal(result.trust.promotable, false)
  } finally {
    await rm(data.home, { recursive: true, force: true })
  }
})

test('historico passed e sempre rebaixado quando o runtime nao pode revalidar', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-real-eval-history-'))
  try {
    const path = caminhoDoHistoricoComportamental(casa)
    await mkdir(join(casa, 'evals'), { recursive: true })
    await writeFile(path, `${JSON.stringify({
      schemaVersion: 1,
      store: {
        id: 'omni-local-real-behavior',
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z'
      },
      runs: [{ id: 'legacy-self-asserted', status: 'passed', trust: { promotable: true } }]
    })}\n`, 'utf8')
    const history = await lerHistoricoComportamental(casa)
    assert.equal(history.runs[0].status, 'unverified-legacy-claim')
    assert.equal(history.runs[0].trust.internallyRevalidated, false)
    assert.equal(history.runs[0].trust.promotable, false)
    assert.equal(history.runs[0].trust.migratedAsTrusted, false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('arquivo UUID fora da raiz confiavel e sessionId divergente sao recusados', async () => {
  const data = await fixture()
  const otherRoot = await mkdtemp(join(tmpdir(), 'omni-other-trusted-root-'))
  try {
    await assert.rejects(
      inspecionarTranscritoClaude(data.paths[0], { trustedRoots: [otherRoot] }),
      /fora das raizes confiaveis/
    )
    const raw = await readFile(data.paths[0], 'utf8')
    await writeFile(data.paths[0], raw.replace(ids[0].replace(/\.jsonl$/, ''), ids[1].replace(/\.jsonl$/, '')), 'utf8')
    await assert.rejects(
      inspecionarTranscritoClaude(data.paths[0], { trustedRoots: [data.home] }),
      /sessionId.*UUID/
    )
  } finally {
    await rm(data.home, { recursive: true, force: true })
    await rm(otherRoot, { recursive: true, force: true })
  }
})
