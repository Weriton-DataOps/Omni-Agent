import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  lerPersonalidadeAtiva,
  validarEvidenciaPromocao,
  validarPromocao
} from '../runtime/personalidade.mjs'

const manifestUrl = new URL('../contratos/personalidade/manifest.json', import.meta.url)
const suiteUrl = new URL('../contratos/eval/personalidade.json', import.meta.url)
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const callerSuppliedVerifier = async () => ({
  verified: true,
  method: 'test-trusted-host',
  receiptFingerprint: HASH_B
})

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function promotion(evidenceSha256 = HASH_A) {
  return {
    roundId: 'rodada-2026-08',
    decidedAt: '2026-08-25T00:00:00.000Z',
    decidedBy: 'omni-controlled-local-judge-v1',
    evidence: {
      path: 'contratos/eval/resultados/rodada-2026-08.json',
      sha256: evidenceSha256
    }
  }
}

function promotedManifest(extras = {}) {
  return {
    schemaVersion: 1,
    id: 'omni-persona-v3-candidate',
    status: 'approved',
    contract: './contrato.md',
    supersedes: null,
    promotion: promotion(),
    ...extras
  }
}

async function pluginWithEvidence({ editEvidence, editManifest, tamperSuite = false } = {}) {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'omni-promocao-'))
  const personalityDir = join(pluginRoot, 'contratos', 'personalidade')
  const evalDir = join(pluginRoot, 'contratos', 'eval')
  const resultsDir = join(evalDir, 'resultados')
  await mkdir(personalityDir, { recursive: true })
  await mkdir(resultsDir, { recursive: true })

  const sourceSuite = JSON.parse(await readFile(suiteUrl, 'utf8'))
  const suiteRaw = `${JSON.stringify(sourceSuite, null, 2)}\n`
  const evidence = {
    schemaVersion: 1,
    roundId: 'rodada-2026-08',
    decidedAt: '2026-08-25T00:00:00.000Z',
    decidedBy: 'omni-controlled-local-judge-v1',
    suiteSha256: sha256(suiteRaw),
    baseline: sourceSuite.baseline,
    candidate: sourceSuite.candidate,
    responseSets: { baselineSha256: HASH_A, candidateSha256: HASH_B },
    caseResults: sourceSuite.cases.map((item) => ({
      id: item.id,
      weight: item.peso,
      baselineAutomaticPassed: true,
      candidateAutomaticPassed: true,
      humanApproved: true
    }))
  }
  editEvidence?.(evidence, sourceSuite)
  const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`
  const manifest = promotedManifest({ promotion: promotion(sha256(evidenceRaw)) })
  editManifest?.(manifest)

  await writeFile(join(personalityDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(
    join(personalityDir, 'contrato.md'),
    `## Núcleo textual\n\n\`\`\`text\nPERSONALIDADE ${manifest.id}.\nCorpo do contrato.\n\`\`\`\n`,
    'utf8'
  )
  await writeFile(join(evalDir, 'personalidade.json'), tamperSuite ? `${suiteRaw} ` : suiteRaw, 'utf8')
  await writeFile(join(resultsDir, 'rodada-2026-08.json'), evidenceRaw, 'utf8')
  return { pluginRoot, manifest }
}

test('a personalidade ativa declara promoção nula enquanto for candidata', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.equal(manifest.status, 'active-candidate-pending-evals')
  assert.equal(manifest.promotion, null)
  const active = await lerPersonalidadeAtiva({ useCache: false })
  assert.equal(active.manifest.id, manifest.id)
  assert.equal(active.promotionEvidence, null)
})

test('promoção preserva o identificador versionado da personalidade', () => {
  const manifest = promotedManifest()
  assert.equal(validarPromocao(manifest), manifest)
  assert.equal(manifest.id, 'omni-persona-v3-candidate')
})

test('status approved exige rodada e referência criptográfica', () => {
  assert.throws(
    () => validarPromocao({ schemaVersion: 1, id: 'omni-persona-v3-candidate', status: 'approved' }),
    /exige registro da rodada/
  )
  assert.throws(
    () => validarPromocao(promotedManifest({ promotion: { ...promotion(), evidence: null } })),
    /referência e SHA-256/
  )
})

test('candidata não pode carregar registro de promoção', () => {
  assert.throws(
    () =>
      validarPromocao({
        schemaVersion: 1,
        id: 'omni-persona-v3-candidate',
        status: 'active-candidate-pending-evals',
        promotion: promotion()
      }),
    /não pode declarar promoção/
  )
})

test('status e identificador desconhecidos não passam', () => {
  assert.throws(
    () => validarPromocao({ schemaVersion: 1, id: 'omni-persona-v3-candidate', status: 'quase-la' }),
    /não é reconhecido/
  )
  assert.throws(
    () => validarPromocao({ ...promotedManifest(), id: 'omni-persona-v2' }),
    /identificador versionado/i
  )
})

test('verificador adicional precisa aceitar explicitamente a promocao', async () => {
  const { pluginRoot } = await pluginWithEvidence()
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({
        pluginRoot,
        useCache: false,
        verificarEvidenciaConfiavel: callerSuppliedVerifier
      }),
      /Verificador adicional recusou/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('evidencia integra do executor local reconhecido autentica a promocao', async () => {
  const { pluginRoot } = await pluginWithEvidence()
  try {
    const personality = await lerPersonalidadeAtiva({ pluginRoot, useCache: false })
    assert.equal(personality.promotionEvidence.verified, true)
    assert.equal(personality.promotionEvidence.verificationAuthority, 'omni-controlled-local-judge-v1')
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('autoridade arbitraria nao consegue promover a personalidade', async () => {
  const { pluginRoot } = await pluginWithEvidence({
    editEvidence: (evidence) => { evidence.decidedBy = 'caller-arbitrario' },
    editManifest: (manifest) => { manifest.promotion.decidedBy = 'caller-arbitrario' }
  })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /autoridade local reconhecida/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('caminho externo e SHA adulterado são recusados', async () => {
  await assert.rejects(
    validarEvidenciaPromocao(
      promotedManifest({ promotion: { ...promotion(), evidence: { ...promotion().evidence, path: '../fora.json' } } }),
      join(tmpdir(), 'omni-sem-evidencia')
    ),
    /saiu do diretório permitido/
  )

  const { pluginRoot } = await pluginWithEvidence({
    editManifest: (manifest) => {
      manifest.promotion.evidence.sha256 = HASH_A
    }
  })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /SHA-256 da evidência/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('arquivo de evidência ausente impede o carregamento', async () => {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'omni-promocao-ausente-'))
  try {
    await assert.rejects(
      validarEvidenciaPromocao(promotedManifest(), pluginRoot),
      /não foi encontrado/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('mudança posterior na suíte invalida a promoção', async () => {
  const { pluginRoot } = await pluginWithEvidence({ tamperSuite: true })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /não corresponde ao manifesto ou à suíte/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('evidência incompleta ou sem aprovação humana é recusada', async () => {
  const { pluginRoot } = await pluginWithEvidence({
    editEvidence: (evidence) => {
      evidence.caseResults[0].humanApproved = false
    }
  })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /sem aprovação humana/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('artefato não aceita campos extras nem respostas brutas', async () => {
  const { pluginRoot } = await pluginWithEvidence({
    editEvidence: (evidence) => {
      evidence.rawResponses = ['conteúdo que não pertence ao Git']
    }
  })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /campos não permitidos: rawResponses/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('falha de peso máximo bloqueia a promoção', async () => {
  const { pluginRoot } = await pluginWithEvidence({
    editEvidence: (evidence, suite) => {
      const blocking = suite.cases.find((item) => item.peso === 5)
      evidence.caseResults.find((item) => item.id === blocking.id).candidateAutomaticPassed = false
    }
  })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /falha de peso máximo/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('score recalculado da candidata não pode ficar abaixo da baseline', async () => {
  const { pluginRoot } = await pluginWithEvidence({
    editEvidence: (evidence, suite) => {
      const nonBlocking = suite.cases.find((item) => item.peso < 5)
      evidence.caseResults.find((item) => item.id === nonBlocking.id).candidateAutomaticPassed = false
    }
  })
  try {
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /abaixo da linha de base/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})
