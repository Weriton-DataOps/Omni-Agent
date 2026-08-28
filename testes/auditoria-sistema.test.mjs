import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  auditarSaudeSistema,
  caminhoDaAuditoriaSistema,
  consumirContextoAuditoriaSistema,
  lerAuditoriaSistema
} from '../runtime/auditoria-sistema.mjs'
import {
  caminhoDaAutomacaoFalhas,
  sincronizarAutomacaoFalhas
} from '../runtime/automacao-falhas.mjs'
import {
  abrirTurnoAuditoria,
  auditarParada,
  lerAuditoriaAutocorrecao,
  registrarAcaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import {
  fingerprintSemanticoMelhoria,
  marcarMelhoriaOperacional,
  observarDelegacao,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'
import { auditarAntesDaRelease } from '../runtime/release-gate.mjs'

async function temporary(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

async function pluginFixture({
  version = '1.2.3',
  rules = [],
  releaseAuditScopeStartedAt = '2026-08-28T12:00:00.000Z'
} = {}) {
  const root = await temporary('omni-system-audit-plugin-')
  for (const area of ['contratos', 'hooks', 'runtime', 'scripts', 'skills']) {
    await mkdir(join(root, area), { recursive: true })
    await writeFile(join(root, area, 'fixture.txt'), `${area}\n`, 'utf8')
  }
  await mkdir(join(root, 'contratos', 'operacao'), { recursive: true })
  await writeFile(
    join(root, 'contratos', 'operacao', 'regras-aprendidas.json'),
    `${JSON.stringify({ schemaVersion: 1, rules }, null, 2)}\n`,
    'utf8'
  )
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  const integrity = await calcularFingerprintPayload(root)
  await writeFile(
    join(root, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'omni', version }, null, 2)}\n`,
    'utf8'
  )
  await mkdir(join(root, 'contratos', 'atualizacao'), { recursive: true })
  await writeFile(
    join(root, 'contratos', 'atualizacao', 'integridade.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      contract: 'omni-release-integrity-v1',
      identity: {
        version: '1.2.3',
        releaseFingerprint: integrity.fingerprint,
        releaseAuditScopeStartedAt
      }
    }, null, 2)}\n`,
    'utf8'
  )
  return root
}

async function behaviorPassed(casa, extra = {}) {
  await mkdir(join(casa, 'evals'), { recursive: true })
  const at = '2026-08-28T09:00:00.000Z'
  await writeFile(
    join(casa, 'evals', 'behavior-history.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      store: { id: 'omni-local-real-behavior', createdAt: at, updatedAt: at },
      runs: [{ status: 'passed', ...extra }]
    }, null, 2)}\n`,
    'utf8'
  )
}

async function failureCandidate(casa) {
  const base = {
    agent: 'omni',
    action: 'executar Bash',
    failureClass: 'permission',
    signature: 'permissao negada durante auditoria sistemica'
  }
  for (let index = 1; index <= 3; index += 1) {
    await registrarFalha(casa, { ...base, evidenceId: `system-audit-run-${index}` })
  }
}

async function operationalCandidate(casa, suffix, status) {
  const input = {
    category: 'system-audit-test',
    destination: 'operational-rule',
    statement: `Regra operacional auditável ${suffix}.`
  }
  await proporMelhoriaOperacional(casa, input, { at: `2026-08-28T08:0${suffix}:00.000Z` })
  const ready = await proporMelhoriaOperacional(casa, input, { at: `2026-08-28T08:1${suffix}:00.000Z` })
  if (status === 'ready') return ready.candidate
  if (status === 'implementation-required') {
    return (await marcarMelhoriaOperacional(casa, ready.candidate.id, {
      status,
      artifact: 'runtime'
    }, { at: `2026-08-28T08:2${suffix}:00.000Z` })).candidate
  }
  const artifactRef = {
    kind: 'portable-entry',
    path: 'contratos/operacao/regras-aprendidas.json',
    collection: 'rules',
    entryId: ready.candidate.id,
    semanticFingerprint: fingerprintSemanticoMelhoria(ready.candidate),
    contentFingerprint: null
  }
  const pending = await marcarMelhoriaOperacional(casa, ready.candidate.id, {
    status: 'materialized-pending-release',
    artifactRef
  }, { at: `2026-08-28T08:2${suffix}:00.000Z` })
  if (status === 'materialized-pending-release') return pending.candidate
  if (status === 'superseded') {
    return (await marcarMelhoriaOperacional(casa, ready.candidate.id, {
      status: 'superseded',
      supersededBy: {
        proof: 'explicit-merged-candidate',
        replacementCandidateId: `improvement-replacement-${suffix}`,
        canonicalEntryId: ready.candidate.id,
        path: artifactRef.path,
        collection: artifactRef.collection,
        semanticFingerprint: 'c'.repeat(64),
        artifactFingerprint: 'd'.repeat(64),
        version: '1.2.3',
        payloadFingerprint: 'a'.repeat(64),
        verifiedAt: `2026-08-28T08:3${suffix}:00.000Z`
      }
    }, { at: `2026-08-28T08:3${suffix}:00.000Z` })).candidate
  }
  return (await marcarMelhoriaOperacional(casa, ready.candidate.id, {
    status: 'installed-verified',
    installedReadback: {
      verified: true,
      version: '1.2.3',
      payloadFingerprint: 'a'.repeat(64),
      artifactFingerprint: 'b'.repeat(64),
      verifiedAt: `2026-08-28T08:3${suffix}:00.000Z`
    }
  }, { at: `2026-08-28T08:3${suffix}:00.000Z` })).candidate
}

test('leitura do histórico vazio é neutra e não cria aprovação', async () => {
  const casa = await temporary('omni-system-audit-empty-')
  try {
    const history = await lerAuditoriaSistema(casa)
    assert.equal(history.runs.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('achados entram uma vez no contexto e não fabricam rota de reparo', async () => {
  const casa = await temporary('omni-system-audit-surface-home-')
  const pluginRoot = await pluginFixture()
  try {
    await observarDelegacao(casa, {
      state: 'running',
      agentId: 'executor-sem-rota-automatica',
      sessionId: 'sessao-auditoria-surface',
      agentType: 'general-purpose'
    })
    await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T09:30:00.000Z'
    })

    const first = await consumirContextoAuditoriaSistema(casa, {
      at: '2026-08-28T09:31:00.000Z'
    })
    assert.match(first, /AUDITORIA SISTÊMICA/)
    assert.match(first, /unverified-delegations/)
    assert.match(first, /sem rota executável automática registrada/i)
    assert.match(first, /não declare correção/i)
    assert.equal(await consumirContextoAuditoriaSistema(casa), null)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('reparo e histórico são idempotentes para o mesmo estado real', async () => {
  const casa = await temporary('omni-system-audit-home-')
  const pluginRoot = await pluginFixture()
  try {
    await behaviorPassed(casa)
    await failureCandidate(casa)
    const automation = await sincronizarAutomacaoFalhas(casa)
    assert.equal(automation.jobs.length, 1)
    const duplicated = structuredClone(automation.jobs[0])
    duplicated.id = 'failure-job-duplicate-for-system-audit'
    automation.jobs.push(duplicated)
    await writeFile(
      caminhoDaAutomacaoFalhas(casa),
      `${JSON.stringify(automation, null, 2)}\n`,
      'utf8'
    )

    const first = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: true,
      at: '2026-08-28T10:00:00.000Z'
    })
    const [second, concurrent] = await Promise.all([
      auditarSaudeSistema(casa, {
        pluginRoot,
        repair: true,
        at: '2026-08-28T10:01:00.000Z'
      }),
      auditarSaudeSistema(casa, {
        pluginRoot,
        repair: true,
        at: '2026-08-28T10:01:01.000Z'
      })
    ])

    assert.equal(first.unchanged, false)
    assert.deepEqual(first.run.repairs, [{
      code: 'coalesced-duplicate-failure-jobs',
      amount: 1,
      verified: true
    }])
    assert.equal(second.unchanged, true)
    assert.equal(concurrent.unchanged, true)
    assert.equal(second.run.id, first.run.id)
    assert.equal(concurrent.run.id, first.run.id)
    const after = JSON.parse(await readFile(caminhoDaAutomacaoFalhas(casa), 'utf8'))
    assert.equal(after.jobs.filter((item) => ['queued', 'running'].includes(item.state)).length, 1)
    const history = JSON.parse(await readFile(caminhoDaAuditoriaSistema(casa), 'utf8'))
    assert.equal(history.runs.length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('gate before-release bloqueia erro e permite somente avisos', async () => {
  const casa = await temporary('omni-release-gate-home-')
  const pluginRoot = await pluginFixture()
  try {
    const observing = await auditarAntesDaRelease({ casa, pluginRoot })
    assert.equal(observing.ok, true)
    assert.equal(observing.trigger, 'before-release')
    assert.ok(observing.warnings.length >= 1)

    await writeFile(join(pluginRoot, 'runtime', 'fixture.txt'), 'drift depois da identidade\n', 'utf8')
    const blocked = await auditarAntesDaRelease({ casa, pluginRoot })
    assert.equal(blocked.ok, false)
    assert.ok(blocked.errors.some((item) => item.code === 'release-integrity-drift'))
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('histórico não persiste conversa, dados de ferramenta, caminhos ou versão não permitida', async () => {
  const marker = 'SEGREDO-PRIVADO-AUDITORIA-9381'
  const casa = await temporary('omni-system-audit-private-home-')
  const pluginRoot = await pluginFixture({ version: marker })
  try {
    await behaviorPassed(casa, {
      transcript: `conversa ${marker}`,
      toolInput: { command: `comando ${marker}` }
    })
    const result = await auditarSaudeSistema(casa, { pluginRoot, repair: true })
    assert.equal(result.run.plugin.version, '1.2.3')
    const raw = await readFile(caminhoDaAuditoriaSistema(casa), 'utf8')
    assert.equal(raw.includes(marker), false)
    assert.equal(raw.includes(casa), false)
    assert.equal(raw.includes(pluginRoot), false)
    assert.deepEqual(result.run.privacy, {
      rawConversationStored: false,
      rawToolDataStored: false,
      rawPathsStored: false
    })
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('detecta lacunas a partir dos stores e do payload reais, sem flags sintéticas', async () => {
  const marker = 'PEDIDO-NAO-PERSISTIR-4827'
  const casa = await temporary('omni-system-audit-gaps-home-')
  const duplicateFingerprint = 'a'.repeat(64)
  const pluginRoot = await pluginFixture({
    rules: [
      { destination: 'personality', text: 'regra um', evidence: { fingerprint: duplicateFingerprint } },
      { destination: 'personality', text: 'regra dois', evidence: { fingerprint: duplicateFingerprint } }
    ]
  })
  try {
    await writeFile(join(pluginRoot, 'runtime', 'fixture.txt'), 'payload alterado\n', 'utf8')
    const session = 'sessao-lacuna-real'
    await abrirTurnoAuditoria(casa, {
      session_id: session,
      prompt: `corrija o contrato ${marker}`
    })
    await registrarAcaoAuditoria(casa, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'write-gap-1',
      tool_name: 'Write',
      tool_input: { file_path: `arquivo-${marker}.json`, content: '{}' }
    })
    await auditarParada(casa, {
      session_id: session,
      last_assistant_message: `Corrigi ${marker}.`
    })
    await observarDelegacao(casa, {
      state: 'running',
      agentId: 'executor-nao-preparado',
      sessionId: session,
      agentType: 'general-purpose'
    })

    const result = await auditarSaudeSistema(casa, { pluginRoot, repair: false })
    const codes = new Set(result.run.findings.map((item) => item.code))
    assert.ok(codes.has('release-integrity-drift'))
    assert.ok(codes.has('real-behavior-eval-missing'))
    assert.ok(codes.has('trusted-personality-eval-missing'))
    assert.ok(codes.has('unverified-delegations'))
    assert.ok(codes.has('unresolved-turn-findings'))
    assert.ok(codes.has('duplicate-portable-rules'))
    assert.equal(result.run.status, 'repair-required')
    const raw = await readFile(caminhoDaAuditoriaSistema(casa), 'utf8')
    assert.equal(raw.includes(marker), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('somente achado comprovadamente anterior ao marco da release vira histórico', async () => {
  const casa = await temporary('omni-system-audit-historical-home-')
  const pluginRoot = await pluginFixture()
  const historicalSession = 'sessao-achado-historico'
  const currentSession = 'sessao-achado-atual'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: historicalSession,
      prompt: 'corrija o contrato pendente'
    }, { at: '2026-08-28T10:00:00.000Z' })
    const historicalFirstStop = await auditarParada(casa, {
      session_id: historicalSession,
      last_assistant_message: 'Ainda não executei.'
    }, { at: '2026-08-28T10:01:00.000Z' })
    assert.equal(historicalFirstStop.decision, 'block')

    await auditarParada(casa, {
      session_id: historicalSession,
      stop_hook_active: true,
      last_assistant_message: 'Bloqueio real permaneceu sem execução.'
    }, { at: '2026-08-28T10:02:00.000Z' })
    const storeBefore = await lerAuditoriaAutocorrecao(casa)
    const terminalTurn = storeBefore.turns.at(-1)
    assert.equal(terminalTurn.state, 'blocked')
    assert.ok(Number.isFinite(Date.parse(terminalTurn.closedAt)))
    assert.ok(terminalTurn.findings.some((item) => item.state === 'unresolved'))

    const historicalAudit = await auditarSaudeSistema(casa, { pluginRoot, repair: false })
    assert.equal(
      historicalAudit.run.findings.some((item) => item.code === 'unresolved-turn-findings'),
      false
    )
    assert.ok(historicalAudit.run.findings.some((item) =>
      item.code === 'historical-unresolved-turn-findings' && item.severity === 'warning'
    ))
    assert.notEqual(historicalAudit.run.status, 'repair-required')
    const storeAfter = await lerAuditoriaAutocorrecao(casa)
    assert.ok(storeAfter.turns.at(-1).findings.some((item) => item.state === 'unresolved'))

    await abrirTurnoAuditoria(casa, {
      session_id: currentSession,
      prompt: 'corrija a falha encontrada nesta release'
    }, { at: '2026-08-28T12:10:00.000Z' })
    const currentFirstStop = await auditarParada(casa, {
      session_id: currentSession,
      last_assistant_message: 'Ainda não executei.'
    }, { at: '2026-08-28T12:11:00.000Z' })
    assert.equal(currentFirstStop.decision, 'block')
    await auditarParada(casa, {
      session_id: currentSession,
      stop_hook_active: true,
      last_assistant_message: 'A falha nova continuou sem correção.'
    }, { at: '2026-08-28T12:12:00.000Z' })

    const currentAudit = await auditarSaudeSistema(casa, { pluginRoot, repair: false })
    assert.ok(currentAudit.run.findings.some((item) =>
      item.code === 'unresolved-turn-findings' && item.severity === 'error'
    ))
    assert.equal(currentAudit.run.status, 'repair-required')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('audita cada fronteira operacional e conta efeito somente após installed-verified', async () => {
  const casa = await temporary('omni-system-audit-operational-home-')
  const pluginRoot = await pluginFixture()
  try {
    await operationalCandidate(casa, 1, 'ready')
    await operationalCandidate(casa, 2, 'implementation-required')
    await operationalCandidate(casa, 3, 'materialized-pending-release')
    await operationalCandidate(casa, 4, 'installed-verified')
    await operationalCandidate(casa, 5, 'superseded')

    const result = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T11:00:00.000Z'
    })
    const codes = new Set(result.run.findings.map((item) => item.code))
    assert.ok(codes.has('operational-improvement-ready-without-materialization'))
    assert.ok(codes.has('operational-implementation-required'))
    assert.ok(codes.has('operational-materialized-without-installed-readback'))
    assert.equal(result.run.metrics.operationalImprovementReady, 1)
    assert.equal(result.run.metrics.operationalImplementationRequired, 1)
    assert.equal(result.run.metrics.operationalMaterializedPendingRelease, 1)
    assert.equal(result.run.metrics.operationalInstalledVerified, 1)
    assert.equal(result.run.metrics.operationalSuperseded, 1)
    assert.equal(result.run.metrics.operationalLearningEffectRate, 0.2)
    assert.equal(result.run.metrics.learningEffectRate, 0.2)
    assert.equal(
      result.run.findings.find((item) => item.code === 'operational-materialized-without-installed-readback').amount,
      1
    )

    const context = await consumirContextoAuditoriaSistema(casa)
    assert.match(context, /sem configuração ela continua pronta/i)
    assert.match(context, /runtime não fabrica esse patch/i)
    assert.match(context, /antes do readback íntegro não há efeito comprovado/i)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})
