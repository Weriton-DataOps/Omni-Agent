import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  caminhoDoCiclo,
  fingerprintSemanticoMelhoria,
  lerCicloOperacional,
  marcarMelhoriaOperacional,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import {
  materializarMelhoriaOperacional,
  registrarImplementacaoOperacional,
  registrarReadbackOperacionalInstalado
} from '../runtime/evolucao.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'
import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'

async function prepararReleaseIntegra(repo, version = '9.9.9') {
  for (const area of ['contratos', 'hooks', 'runtime', 'scripts', 'skills']) {
    await mkdir(join(repo, area), { recursive: true })
  }
  await mkdir(join(repo, '.claude-plugin'), { recursive: true })
  await mkdir(join(repo, 'contratos', 'atualizacao'), { recursive: true })
  await writeFile(
    join(repo, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'omni', version }, null, 2)}\n`,
    'utf8'
  )
  const payload = await calcularFingerprintPayload(repo)
  await writeFile(
    join(repo, 'contratos', 'atualizacao', 'integridade.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      contract: 'omni-release-integrity-v1',
      identity: { version, releaseFingerprint: payload.fingerprint }
    }, null, 2)}\n`,
    'utf8'
  )
  return payload.fingerprint
}

test('dois candidatos semanticamente iguais materializam uma única regra', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')

    const first = await proporMelhoriaOperacional(casa, {
      category: 'owner-correction', destination: 'operational-rule', statement: 'Verificar o estado real antes de concluir.'
    })
    const ready = await proporMelhoriaOperacional(casa, {
      category: 'owner-correction', destination: 'operational-rule', statement: 'Verificar o estado real antes de concluir.'
    })
    assert.equal(first.candidate.id, ready.candidate.id)
    await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)

    const cyclePath = caminhoDoCiclo(casa)
    const cycle = JSON.parse(await readFile(cyclePath, 'utf8'))
    const duplicate = {
      ...cycle.improvementCandidates[0],
      id: 'improvement-duplicate-semantic',
      status: 'ready',
      artifact: null,
      artifactRef: null,
      materializedAt: null,
      installedReadback: null,
      transitionHistory: [{
        from: null,
        to: 'ready',
        kind: 'test-fixture',
        recordedAt: cycle.improvementCandidates[0].updatedAt
      }]
    }
    cycle.improvementCandidates.push(duplicate)
    await writeFile(cyclePath, `${JSON.stringify(cycle, null, 2)}\n`, 'utf8')

    const result = await materializarMelhoriaOperacional(casa, duplicate.id, repo)
    assert.equal(result.deduplicated, true)
    const rules = JSON.parse(
      await readFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), 'utf8')
    ).rules
    assert.equal(rules.length, 1)
    assert.deepEqual(rules[0].evidence.mergedCandidateIds, [duplicate.id])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('melhoria de personalidade vira caso de eval pendente, nunca regra injetada', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-personality-evolution-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'eval'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')
    await writeFile(join(repo, 'contratos', 'eval', 'casos-aprendidos.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-eval-cases-v1', cases: []
    }), 'utf8')

    await proporMelhoriaOperacional(casa, {
      category: 'owner-correction', destination: 'personality', statement: 'A voz precisa sobreviver a carga tecnica.'
    })
    const ready = await proporMelhoriaOperacional(casa, {
      category: 'owner-correction', destination: 'personality', statement: 'A voz precisa sobreviver a carga tecnica.'
    })
    const result = await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
    assert.equal(result.destination, 'personality')

    const rules = JSON.parse(await readFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), 'utf8'))
    const learned = JSON.parse(await readFile(join(repo, 'contratos', 'eval', 'casos-aprendidos.json'), 'utf8'))
    assert.deepEqual(rules.rules, [])
    assert.equal(learned.cases.length, 1)
    assert.equal(learned.cases[0].destination, 'personality')
    assert.equal(learned.cases[0].readiness, 'pending-scenario')
    assert.equal(learned.cases[0].scenario, null)
    assert.equal(learned.cases[0].evidence.occurrences, 2)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('feedback recorrente materializa caso aprendido coberto e preserva sourceRefs hash-only', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-personality-sourced-evolution-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  const sourceRef = (turn, vote) => ({
    kind: 'personality-feedback',
    candidateId: `personality-candidate-${'a'.repeat(24)}`,
    voteFingerprint: vote.repeat(64),
    turnFingerprint: turn.repeat(64),
    answerFingerprint: 'b'.repeat(64),
    personaId: 'omni-persona-v3-candidate',
    releaseFingerprint: 'c'.repeat(64),
    reasonCode: 'tone-too-dry',
    canonicalCaseId: 'voz-perceptivel-sem-piada'
  })
  const input = {
    category: 'owner-personality-feedback',
    destination: 'personality',
    statement: 'Dar mais calor e presenca ao tom seco sem aumentar cerimonia.'
  }
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'eval'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'eval', 'casos-aprendidos.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-eval-cases-v1', cases: []
    }), 'utf8')
    await writeFile(join(repo, 'contratos', 'eval', 'personalidade.json'), JSON.stringify({
      schemaVersion: 1,
      suite: 'personalidade',
      expectedFormat: 'example-response-v1',
      baseline: 'controle',
      candidate: 'omni-persona-v3-candidate',
      cases: [{
        id: 'voz-perceptivel-sem-piada',
        dimensao: 'identidade',
        entrada: 'entrada de teste',
        esperado: 'resposta de teste',
        criterios: { automatico: {}, humano: ['voz reconhecivel'] },
        peso: 1
      }]
    }), 'utf8')

    await proporMelhoriaOperacional(casa, { ...input, sourceRef: sourceRef('1', 'd') })
    const ready = await proporMelhoriaOperacional(casa, { ...input, sourceRef: sourceRef('2', 'e') })
    const result = await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
    assert.equal(result.result, 'materialized-pending-release')

    const learned = JSON.parse(
      await readFile(join(repo, 'contratos', 'eval', 'casos-aprendidos.json'), 'utf8')
    ).cases[0]
    assert.equal(learned.readiness, 'covered-by-canonical-case')
    assert.equal(learned.scenario.caseId, 'voz-perceptivel-sem-piada')
    assert.equal(learned.evidence.sourceRefs.length, 2)
    assert.equal(learned.evidence.sourceRefs.every((item) => /^[a-f0-9]{64}$/.test(item.turnFingerprint)), true)
    assert.equal(JSON.stringify(learned).includes('Resposta anterior'), false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('hook, routing, runtime-fix e capability exigem implementacao real', async () => {
  for (const destination of ['hook', 'routing', 'runtime-fix', 'capability']) {
    const base = await mkdtemp(join(tmpdir(), `omni-source-change-${destination}-`))
    const casa = join(base, 'home')
    const repo = join(base, 'repo')
    try {
      await mkdir(join(repo, '.git'), { recursive: true })
      await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
      await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
      await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
        schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
      }), 'utf8')

      const input = {
        category: 'owner-correction',
        destination,
        statement: `Aplicar mudanca executavel em ${destination}.`
      }
      await proporMelhoriaOperacional(casa, input)
      const ready = await proporMelhoriaOperacional(casa, input)
      const result = await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)

      assert.equal(result.result, 'implementation-required')
      assert.equal(result.route.kind, 'source-change')
      assert.equal(result.candidate.status, 'implementation-required')
      const reinforced = await proporMelhoriaOperacional(casa, input)
      assert.equal(reinforced.candidate.status, 'implementation-required')
      const rules = JSON.parse(
        await readFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), 'utf8')
      )
      assert.deepEqual(rules.rules, [])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }
})

test('materializacoes concorrentes preservam todos os artefatos confirmados', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-concurrent-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')

    const readyIds = []
    for (let index = 0; index < 12; index += 1) {
      const input = {
        category: 'owner-correction',
        destination: 'operational-rule',
        statement: `Regra concorrente confirmada numero ${index}.`
      }
      await proporMelhoriaOperacional(casa, input)
      readyIds.push((await proporMelhoriaOperacional(casa, input)).candidate.id)
    }
    const results = await Promise.all(
      readyIds.map((id) => materializarMelhoriaOperacional(casa, id, repo))
    )
    assert.ok(results.every((item) => item.result === 'materialized-pending-release'))
    const rules = JSON.parse(
      await readFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), 'utf8')
    ).rules
    assert.equal(rules.length, readyIds.length)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('reforco posterior nao regride melhoria materializada para ready', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-monotonic-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  const input = {
    category: 'owner-correction',
    destination: 'operational-rule',
    statement: 'Preservar o estado terminal quando chegar nova evidencia.'
  }
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
    const reinforced = await proporMelhoriaOperacional(casa, input)
    assert.equal(reinforced.candidate.status, 'materialized-pending-release')
    assert.equal(reinforced.candidate.occurrences, 3)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('readback operacional so torna efetiva uma entrada presente em release instalada integra', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-readback-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')
    const input = {
      category: 'owner-correction',
      destination: 'operational-rule',
      statement: 'Confirmar a release instalada antes de contar aprendizado como efetivo.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    const materialized = await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
    assert.equal(materialized.candidate.status, 'materialized-pending-release')
    assert.equal(materialized.artifact, 'contratos/operacao/regras-aprendidas.json')
    const fingerprint = await prepararReleaseIntegra(repo)
    const readback = await registrarReadbackOperacionalInstalado(casa, {
      pluginRoot: repo,
      version: '9.9.9',
      payloadFingerprint: fingerprint
    })
    assert.equal(readback.verified, 1)
    const installed = (await lerCicloOperacional(casa)).improvementCandidates[0]
    assert.equal(installed.status, 'installed-verified')
    assert.equal(installed.installedReadback.payloadFingerprint, fingerprint)

    const reinforced = await proporMelhoriaOperacional(casa, input)
    assert.equal(reinforced.candidate.status, 'installed-verified')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('readback encerra como superseded a semantica antiga substituida explicitamente por candidata instalada', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-superseded-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'eval'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    const learnedPath = join(repo, 'contratos', 'eval', 'casos-aprendidos.json')
    await writeFile(learnedPath, JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-eval-cases-v1', cases: []
    }), 'utf8')

    const oldInput = {
      category: 'owner-correction',
      destination: 'personality',
      statement: 'Responder com calor e analogias naturais na medida da conversa.'
    }
    await proporMelhoriaOperacional(casa, oldInput)
    const oldReady = await proporMelhoriaOperacional(casa, oldInput)
    await materializarMelhoriaOperacional(casa, oldReady.candidate.id, repo)

    const replacementInput = {
      category: 'owner-correction',
      destination: 'personality',
      statement: 'Manter personalidade intensa com inteligencia, humor, sarcasmo e analogias.'
    }
    await proporMelhoriaOperacional(casa, replacementInput)
    const replacementReady = await proporMelhoriaOperacional(casa, replacementInput)
    const learned = JSON.parse(await readFile(learnedPath, 'utf8'))
    const canonical = learned.cases[0]
    canonical.text = replacementReady.candidate.statement
    canonical.evidence = {
      occurrences: replacementReady.candidate.occurrences,
      fingerprint: replacementReady.candidate.fingerprint,
      mergedCandidateIds: [replacementReady.candidate.id]
    }
    await writeFile(learnedPath, `${JSON.stringify(learned, null, 2)}\n`, 'utf8')
    await marcarMelhoriaOperacional(casa, replacementReady.candidate.id, {
      status: 'materialized-pending-release',
      artifactRef: {
        kind: 'portable-entry',
        path: 'contratos/eval/casos-aprendidos.json',
        collection: 'cases',
        entryId: replacementReady.candidate.id,
        semanticFingerprint: fingerprintSemanticoMelhoria(replacementReady.candidate),
        contentFingerprint: null
      }
    })

    const fingerprint = await prepararReleaseIntegra(repo)
    const readback = await registrarReadbackOperacionalInstalado(casa, {
      pluginRoot: repo,
      version: '9.9.9',
      payloadFingerprint: fingerprint,
      now: '2026-08-28T18:00:00.000Z'
    })
    assert.equal(readback.verified, 1)
    assert.equal(readback.superseded, 1)
    const cycle = await lerCicloOperacional(casa)
    const old = cycle.improvementCandidates.find((item) => item.id === oldReady.candidate.id)
    const replacement = cycle.improvementCandidates.find((item) => item.id === replacementReady.candidate.id)
    assert.equal(old.status, 'superseded')
    assert.equal(old.installedReadback, null)
    assert.equal(old.supersededBy.proof, 'explicit-merged-candidate')
    assert.equal(old.supersededBy.replacementCandidateId, replacement.id)
    assert.equal(old.supersededBy.canonicalEntryId, old.id)
    assert.equal(old.supersededBy.payloadFingerprint, fingerprint)
    assert.equal(old.transitionHistory.at(-1).kind, 'installed-semantic-supersession')
    assert.equal(replacement.status, 'installed-verified')

    const reinforced = await proporMelhoriaOperacional(casa, oldInput)
    assert.equal(reinforced.candidate.status, 'superseded')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('readback nao adivinha supersessao por mudanca de texto sem vinculo explicito', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-not-superseded-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    const learnedPath = join(repo, 'contratos', 'operacao', 'regras-aprendidas.json')
    await writeFile(learnedPath, JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')
    const input = {
      category: 'owner-correction',
      destination: 'operational-rule',
      statement: 'Preservar o sentido antigo.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
    const learned = JSON.parse(await readFile(learnedPath, 'utf8'))
    learned.rules[0].text = 'Texto novo sem prova de substituicao.'
    await writeFile(learnedPath, `${JSON.stringify(learned, null, 2)}\n`, 'utf8')

    const fingerprint = await prepararReleaseIntegra(repo)
    const readback = await registrarReadbackOperacionalInstalado(casa, {
      pluginRoot: repo,
      version: '9.9.9',
      payloadFingerprint: fingerprint
    })
    assert.equal(readback.verified, 0)
    assert.equal(readback.superseded, 0)
    const candidate = (await lerCicloOperacional(casa)).improvementCandidates[0]
    assert.equal(candidate.status, 'materialized-pending-release')
    assert.equal(candidate.supersededBy, null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('readback operacional recusa drift, legado e versao divergente', async () => {
  for (const mode of ['drift', 'legacy', 'version']) {
    const base = await mkdtemp(join(tmpdir(), `omni-evolution-readback-${mode}-`))
    const casa = join(base, 'home')
    const repo = join(base, 'repo')
    try {
      await mkdir(join(repo, '.git'), { recursive: true })
      await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
      await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
      await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
        schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
      }), 'utf8')
      const input = {
        category: 'owner-correction', destination: 'operational-rule', statement: `Readback seguro ${mode}.`
      }
      await proporMelhoriaOperacional(casa, input)
      const ready = await proporMelhoriaOperacional(casa, input)
      await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
      let fingerprint = await prepararReleaseIntegra(repo)
      if (mode === 'legacy') {
        await rm(join(repo, 'contratos', 'atualizacao', 'integridade.json'))
      }
      if (mode === 'drift') {
        await writeFile(join(repo, 'runtime', 'drift.txt'), 'mudou\n', 'utf8')
      }
      await assert.rejects(
        registrarReadbackOperacionalInstalado(casa, {
          pluginRoot: repo,
          version: mode === 'version' ? '9.9.8' : '9.9.9',
          payloadFingerprint: fingerprint
        }),
        /release instalada integra/
      )
      assert.equal((await lerCicloOperacional(casa)).improvementCandidates[0].status, 'materialized-pending-release')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }
})

test('implementacao real pode ser vinculada ao candidato e verificada na release instalada', async () => {
  const base = await mkdtemp(join(tmpdir(), 'omni-evolution-source-readback-'))
  const casa = join(base, 'home')
  const repo = join(base, 'repo')
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await mkdir(join(repo, 'runtime'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: []
    }), 'utf8')
    await writeFile(join(repo, 'runtime', 'roteamento.mjs'), 'export const route = true\n', 'utf8')
    await writeFile(join(repo, 'runtime', 'outro.mjs'), 'export const unrelated = true\n', 'utf8')
    const input = {
      category: 'owner-correction', destination: 'routing', statement: 'Corrigir o roteamento executavel.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    const required = await materializarMelhoriaOperacional(casa, ready.candidate.id, repo)
    await assert.rejects(
      registrarImplementacaoOperacional(casa, ready.candidate.id, repo, 'runtime/roteamento.mjs'),
      /mutacao auditada/
    )

    const session = 'sessao-implementacao-operacional'
    const afterRequired = (seconds) => new Date(
      Date.parse(required.candidate.updatedAt) + seconds * 1_000
    ).toISOString()
    await abrirTurnoAuditoria(casa, {
      session_id: session,
      prompt: 'Implemente e verifique o roteamento.'
    }, { at: afterRequired(1) })
    const wrongMutation = await registrarAcaoAuditoria(casa, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'mutation-wrong-target',
      tool_name: 'Write',
      tool_input: { file_path: join(repo, 'runtime', 'outro.mjs'), content: 'alterado' }
    }, { at: afterRequired(2) })
    const wrongReadback = await registrarAcaoAuditoria(casa, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'readback-wrong-target',
      tool_name: 'Read',
      tool_input: { file_path: join(repo, 'runtime', 'outro.mjs') }
    }, { at: afterRequired(3) })
    await assert.rejects(
      registrarImplementacaoOperacional(casa, ready.candidate.id, repo, 'runtime/roteamento.mjs', {
        mutationActionId: wrongMutation.action.id,
        mutationEvidenceId: wrongMutation.evidence.id,
        verificationActionId: wrongReadback.action.id,
        verificationEvidenceId: wrongReadback.evidence.id
      }),
      /proprio artefato/
    )

    await writeFile(join(repo, 'runtime', 'roteamento.mjs'), 'export const route = "learned"\n', 'utf8')
    const mutation = await registrarAcaoAuditoria(casa, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'mutation-right-target',
      tool_name: 'Write',
      tool_input: { file_path: join(repo, 'runtime', 'roteamento.mjs'), content: 'hash-only-no-raw-storage' }
    }, { at: afterRequired(4) })
    const readback = await registrarAcaoAuditoria(casa, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'readback-right-target',
      tool_name: 'Read',
      tool_input: { file_path: join(repo, 'runtime', 'roteamento.mjs') }
    }, { at: afterRequired(5) })
    const bound = await registrarImplementacaoOperacional(
      casa,
      ready.candidate.id,
      repo,
      'runtime/roteamento.mjs',
      {
        mutationActionId: mutation.action.id,
        mutationEvidenceId: mutation.evidence.id,
        verificationActionId: readback.action.id,
        verificationEvidenceId: readback.evidence.id
      }
    )
    assert.equal(bound.result, 'materialized-pending-release')
    assert.match(bound.artifactRef.implementationReceipt.targetFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(bound.artifactRef).includes(repo), false)
    const fingerprint = await prepararReleaseIntegra(repo)
    assert.equal((await registrarReadbackOperacionalInstalado(casa, {
      pluginRoot: repo,
      version: '9.9.9',
      payloadFingerprint: fingerprint
    })).verified, 1)
    assert.equal((await lerCicloOperacional(casa)).improvementCandidates[0].status, 'installed-verified')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
