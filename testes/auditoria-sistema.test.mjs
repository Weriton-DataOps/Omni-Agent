import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  CLASSIFICACOES_AUDITORIA,
  auditarSaudeSistema,
  caminhoDaAuditoriaSistema,
  classificarAchadoTurnoAuditoria,
  classificarDelegacaoAuditoria,
  classificarMelhoriaOperacionalAuditoria,
  consumirContextoAuditoriaSistema,
  lerAuditoriaSistema,
  resumirClassificacoesAuditoria
} from '../runtime/auditoria-sistema.mjs'
import {
  caminhoDaAutomacaoFalhas,
  sincronizarAutomacaoFalhas
} from '../runtime/automacao-falhas.mjs'
import {
  abrirTurnoAuditoria,
  auditarParada,
  encerrarSessaoAuditoria,
  lerAuditoriaAutocorrecao,
  registrarAcaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import {
  fingerprintSemanticoMelhoria,
  lerCicloOperacional,
  marcarMelhoriaOperacional,
  observarDelegacao,
  prepararDelegacao,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'
import {
  auditarAntesDaRelease,
  classificarAchadosRelease
} from '../runtime/release-gate.mjs'
import { configurarRepositorioCanonico } from '../runtime/evolucao.mjs'
import { registrarTelemetriaAutocorrecao } from '../runtime/telemetria-autocorrecao.mjs'

async function temporary(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

async function pluginFixture({
  version = '1.2.3',
  rules = [],
  releaseAuditScopeStartedAt = '2026-08-28T12:00:00.000Z'
} = {}) {
  const root = await temporary('omni-system-audit-plugin-')
  for (const area of ['contratos', 'dist', 'hooks', 'runtime', 'scripts', 'skills']) {
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
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version })}\n`, 'utf8')
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
  for (const args of [
    ['init'],
    ['config', 'user.email', 'omni-tests@example.invalid'],
    ['config', 'user.name', 'Omni Tests'],
    ['config', 'core.autocrlf', 'false'],
    ['add', '.'],
    ['commit', '-m', 'fixture baseline']
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
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

async function operationalCandidate(casa, suffix, status, {
  version = '1.2.3',
  payloadFingerprint = 'a'.repeat(64)
} = {}) {
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
        version,
        payloadFingerprint,
        verifiedAt: `2026-08-28T08:3${suffix}:00.000Z`
      }
    }, { at: `2026-08-28T08:3${suffix}:00.000Z` })).candidate
  }
  const installed = await marcarMelhoriaOperacional(casa, ready.candidate.id, {
    status: 'installed-verified',
    installedReadback: {
      verified: true,
      version,
      payloadFingerprint,
      artifactFingerprint: 'b'.repeat(64),
      verifiedAt: `2026-08-28T08:3${suffix}:00.000Z`
    }
  }, { at: `2026-08-28T08:3${suffix}:00.000Z` })
  if (status !== 'loaded-verified') return installed.candidate
  return (await marcarMelhoriaOperacional(casa, ready.candidate.id, {
    status: 'loaded-verified',
    loadedReadback: {
      verified: true,
      root: casa,
      version,
      payloadFingerprint,
      artifactFingerprint: 'b'.repeat(64),
      verificationFingerprint: 'e'.repeat(64),
      verifiedAt: `2026-08-28T08:4${suffix}:00.000Z`
    }
  }, { at: `2026-08-28T08:4${suffix}:00.000Z` })).candidate
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

test('classificação separa dívida ativa, prova pendente e histórico terminal sem reabrir trabalho', () => {
  const classificationByState = new Map([
    ['prepared', CLASSIFICACOES_AUDITORIA.actionableDebt],
    ['visible', CLASSIFICACOES_AUDITORIA.actionableDebt],
    ['running', CLASSIFICACOES_AUDITORIA.actionableDebt],
    ['blocked', CLASSIFICACOES_AUDITORIA.actionableDebt],
    ['reported', CLASSIFICACOES_AUDITORIA.awaitingProof],
    ['failed', CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess],
    ['cancelled', CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess],
    ['verified', CLASSIFICACOES_AUDITORIA.verified],
    ['closed', CLASSIFICACOES_AUDITORIA.verified],
    ['archived', CLASSIFICACOES_AUDITORIA.historicalUnverifiable]
  ])
  for (const [state, expected] of classificationByState) {
    assert.equal(classificarDelegacaoAuditoria({ state }), expected)
  }
  assert.equal(
    classificarDelegacaoAuditoria({ state: 'closed', finalOutcome: 'legacy-unverified', legacyUnverified: true }),
    CLASSIFICACOES_AUDITORIA.historicalUnverifiable
  )
  assert.equal(
    classificarDelegacaoAuditoria({ state: 'failed', finalOutcome: 'failed', legacyUnverified: true }),
    CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess
  )

  const delegationSummary = resumirClassificacoesAuditoria(
    [...classificationByState.keys()].map((state) => ({ state })),
    classificarDelegacaoAuditoria
  )
  assert.equal(Object.values(delegationSummary).reduce((sum, amount) => sum + amount, 0), 10)
  assert.equal(delegationSummary[CLASSIFICACOES_AUDITORIA.actionableDebt], 4)
  assert.equal(delegationSummary[CLASSIFICACOES_AUDITORIA.awaitingProof], 1)
  assert.equal(delegationSummary[CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess], 2)
  assert.equal(delegationSummary[CLASSIFICACOES_AUDITORIA.verified], 2)
  assert.equal(delegationSummary[CLASSIFICACOES_AUDITORIA.historicalUnverifiable], 1)

  assert.equal(
    classificarAchadoTurnoAuditoria({ state: 'open' }, { state: 'repairing' }),
    CLASSIFICACOES_AUDITORIA.actionableDebt
  )
  for (const turnState of ['verified', 'closed', 'failed', 'cancelled', 'archived']) {
    assert.equal(
      classificarAchadoTurnoAuditoria({ state: 'unresolved' }, { state: turnState }),
      CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess
    )
  }
  assert.equal(
    classificarAchadoTurnoAuditoria({ state: 'owner-reconfirmation-required' }),
    CLASSIFICACOES_AUDITORIA.terminalWithoutSuccess
  )
  assert.equal(
    classificarAchadoTurnoAuditoria({ state: 'historical-unverifiable' }),
    CLASSIFICACOES_AUDITORIA.historicalUnverifiable
  )
  assert.equal(
    classificarAchadoTurnoAuditoria({ state: 'superseded' }),
    CLASSIFICACOES_AUDITORIA.superseded
  )
  assert.equal(
    classificarAchadoTurnoAuditoria({ state: 'corrected' }),
    CLASSIFICACOES_AUDITORIA.verified
  )

  const currentRelease = { version: '1.2.3', payloadFingerprint: 'a'.repeat(64) }
  const installed = {
    status: 'installed-verified',
    installedReadback: { version: '1.2.3', payloadFingerprint: 'a'.repeat(64) }
  }
  assert.equal(
    classificarMelhoriaOperacionalAuditoria(installed, currentRelease),
    CLASSIFICACOES_AUDITORIA.awaitingProof
  )
  assert.equal(
    classificarMelhoriaOperacionalAuditoria(installed, {
      version: '1.2.4',
      payloadFingerprint: 'b'.repeat(64)
    }),
    CLASSIFICACOES_AUDITORIA.historicalUnverifiable
  )
  assert.equal(
    classificarMelhoriaOperacionalAuditoria({ status: 'superseded' }, currentRelease),
    CLASSIFICACOES_AUDITORIA.superseded
  )
})

test('achados entram uma vez como obrigação interna sem virar checklist para o proprietário', async () => {
  const casa = await temporary('omni-system-audit-surface-home-')
  const pluginRoot = await pluginFixture()
  try {
    await prepararDelegacao(casa, {
      prompt: 'Execute a rota auditada e retorne evidência independente.',
      target: 'executor-sem-rota-automatica',
      sessionId: 'sessao-auditoria-surface'
    })
    await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T09:30:00.000Z'
    })

    const first = await consumirContextoAuditoriaSistema(casa, {
      at: '2026-08-28T09:31:00.000Z'
    })
    assert.match(first, /ESTADO INTERNO DE AUTOCORREÇÃO/)
    assert.match(first, /unverified-delegations/)
    assert.match(first, /não o repita nem o transforme em checklist para o proprietário/i)
    assert.match(first, /Mantenha a personalidade ativa/i)
    assert.match(first, /O Omni é responsável por executar silenciosamente/i)
    assert.match(first, /O pedido atual mantém prioridade/i)
    assert.match(first, /permanece no worker ou na fila/i)
    assert.match(first, /uma única pergunta contextual/i)
    assert.doesNotMatch(first, /\brode\b|\bexecute\b|\bcorrija\b|\breivindique\b/i)
    assert.equal(await consumirContextoAuditoriaSistema(casa, {
      at: '2026-08-28T09:32:00.000Z'
    }), null)
    const retried = await consumirContextoAuditoriaSistema(casa, {
      at: '2026-08-28T09:42:00.000Z'
    })
    assert.match(retried, /ESTADO INTERNO DE AUTOCORREÇÃO/)
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
    assert.deepEqual(observing.blockingErrors, [])
    assert.deepEqual(observing.recoverableErrors, [])
    assert.ok(observing.warnings.length >= 1)

    await writeFile(join(pluginRoot, 'runtime', 'fixture.txt'), 'drift depois da identidade\n', 'utf8')
    const blocked = await auditarAntesDaRelease({ casa, pluginRoot })
    assert.equal(blocked.ok, false)
    assert.ok(blocked.errors.some((item) => item.code === 'release-integrity-drift'))
    assert.ok(blocked.blockingErrors.some((item) =>
      item.code === 'release-integrity-drift' && item.releaseBlocking === true
    ))
    assert.deepEqual(blocked.recoverableErrors, [])
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('gate respeita releaseBlocking para qualquer código sem reclassificar erro recuperável', () => {
  const blocking = { code: 'future-blocking-error', severity: 'error', releaseBlocking: true }
  const recoverable = { code: 'future-recoverable-error', severity: 'error', releaseBlocking: false }
  const failClosed = { code: 'legacy-error-without-flag', severity: 'error' }
  const warning = { code: 'warning-only', severity: 'warning', releaseBlocking: false }
  const result = classificarAchadosRelease([blocking, recoverable, failClosed, warning])
  assert.deepEqual(result.errors, [blocking, recoverable, failClosed])
  assert.deepEqual(result.blockingErrors, [blocking, failClosed])
  assert.deepEqual(result.recoverableErrors, [recoverable])
  assert.deepEqual(result.warnings, [warning])
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
    await prepararDelegacao(casa, {
      prompt: 'Execute a pendência ativa e produza readback independente.',
      target: 'executor-preparado-pendente',
      sessionId: session
    })

    const result = await auditarSaudeSistema(casa, { pluginRoot, repair: false })
    const codes = new Set(result.run.findings.map((item) => item.code))
    assert.ok(codes.has('release-integrity-drift'))
    assert.ok(codes.has('real-behavior-eval-missing'))
    assert.ok(codes.has('trusted-personality-eval-missing'))
    assert.ok(codes.has('unverified-delegations'))
    assert.ok(codes.has('unresolved-turn-findings'))
    assert.ok(codes.has('duplicate-portable-rules'))
    assert.equal(result.run.metrics.delegationHistoricalTotal, 2)
    assert.equal(result.run.metrics.delegationActionableDebt, 1)
    assert.equal(result.run.metrics.delegationTerminalWithoutSuccess, 1)
    assert.equal(result.run.status, 'repair-required')
    const raw = await readFile(caminhoDaAuditoriaSistema(casa), 'utf8')
    assert.equal(raw.includes(marker), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('achado não corrigido atravessa release como trabalho recuperavel', async () => {
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
    assert.equal(terminalTurn.state, 'repairing')
    assert.equal(terminalTurn.closedAt, null)
    assert.ok(terminalTurn.findings.some((item) => item.state === 'open'))

    const historicalAudit = await auditarSaudeSistema(casa, { pluginRoot, repair: false })
    assert.ok(historicalAudit.run.findings.some((item) =>
      item.code === 'unresolved-turn-findings' &&
      item.severity === 'error' &&
      item.releaseBlocking === false
    ))
    assert.equal(historicalAudit.run.findings.some((item) =>
      item.code === 'historical-unresolved-turn-findings'
    ), false)
    assert.equal(historicalAudit.run.status, 'repair-required')
    const releaseGate = await auditarAntesDaRelease({ casa, pluginRoot })
    assert.equal(releaseGate.ok, true)
    assert.ok(releaseGate.errors.some((item) => item.code === 'unresolved-turn-findings'))
    assert.ok(releaseGate.recoverableErrors.some((item) =>
      item.code === 'unresolved-turn-findings' && item.releaseBlocking === false
    ))
    assert.deepEqual(releaseGate.blockingErrors, [])
    const storeAfter = await lerAuditoriaAutocorrecao(casa)
    assert.ok(storeAfter.turns.at(-1).findings.some((item) => item.state === 'open'))

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

test('reparo reconcilia somente trabalho inativo e mantém terminais no total histórico', async () => {
  const casa = await temporary('omni-system-audit-reconcile-home-')
  const pluginRoot = await pluginFixture()
  const session = 'sessao-inativa-para-reconciliacao'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: session,
      prompt: 'corrija a pendência operacional e verifique o resultado'
    }, { at: '2026-08-28T08:00:00.000Z' })
    const stop = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Ainda não executei a correção.'
    }, { at: '2026-08-28T08:01:00.000Z' })
    assert.equal(stop.decision, 'block')
    await encerrarSessaoAuditoria(casa, {
      session_id: session
    }, { at: '2026-08-28T08:02:00.000Z' })
    await prepararDelegacao(casa, {
      prompt: 'Execute a correção operacional e produza evidência independente.',
      target: 'executor-orfao',
      sessionId: session
    }, { at: '2026-08-28T08:03:00.000Z' })

    const before = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T08:04:00.000Z'
    })
    assert.ok(before.run.findings.some((item) => item.code === 'unresolved-turn-findings'))
    assert.ok(before.run.findings.some((item) => item.code === 'unverified-delegations'))

    const after = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: true,
      at: '2026-08-28T11:04:00.000Z'
    })
    assert.equal(after.run.findings.some((item) => item.code === 'unresolved-turn-findings'), false)
    assert.equal(after.run.findings.some((item) => item.code === 'unverified-delegations'), false)
    assert.equal(after.run.metrics.delegationHistoricalTotal, 1)
    assert.equal(after.run.metrics.delegationActionableDebt, 0)
    assert.equal(after.run.metrics.delegationTerminalWithoutSuccess, 1)
    assert.ok(after.run.metrics.turnFindingHistoricalTotal >= 1)
    assert.equal(after.run.metrics.turnFindingActionableDebt, 0)
    assert.equal(
      after.run.metrics.turnFindingTerminalWithoutSuccess +
        after.run.metrics.turnFindingHistoricalUnverifiable +
        after.run.metrics.turnFindingSuperseded +
        after.run.metrics.turnFindingVerified,
      after.run.metrics.turnFindingHistoricalTotal
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('audita cada fronteira operacional e conta efeito somente após loaded-verified', async () => {
  const casa = await temporary('omni-system-audit-operational-home-')
  const pluginRoot = await pluginFixture()
  try {
    const currentPayloadFingerprint = (await calcularFingerprintPayload(pluginRoot)).fingerprint
    await operationalCandidate(casa, 1, 'ready')
    await operationalCandidate(casa, 2, 'implementation-required')
    await operationalCandidate(casa, 3, 'materialized-pending-release')
    await operationalCandidate(casa, 4, 'installed-verified', {
      payloadFingerprint: currentPayloadFingerprint
    })
    await operationalCandidate(casa, 5, 'superseded')
    await operationalCandidate(casa, 6, 'loaded-verified')

    const result = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T11:00:00.000Z'
    })
    const codes = new Set(result.run.findings.map((item) => item.code))
    assert.ok(codes.has('operational-improvement-ready-without-materialization'))
    assert.ok(codes.has('operational-implementation-required'))
    assert.ok(codes.has('operational-materialized-without-installed-readback'))
    assert.ok(codes.has('operational-installed-without-loaded-readback'))
    assert.equal(result.run.metrics.operationalImprovementReady, 1)
    assert.equal(result.run.metrics.operationalImplementationRequired, 1)
    assert.equal(result.run.metrics.operationalMaterializedPendingRelease, 1)
    assert.equal(result.run.metrics.operationalInstalledVerified, 1)
    assert.equal(result.run.metrics.operationalLoadedVerified, 1)
    assert.equal(result.run.metrics.operationalSuperseded, 1)
    assert.equal(result.run.metrics.operationalImprovementHistoricalTotal, 6)
    assert.equal(result.run.metrics.operationalImprovementActionableDebt, 3)
    assert.equal(result.run.metrics.operationalImprovementAwaitingProof, 1)
    assert.equal(result.run.metrics.operationalImprovementHistoricalUnverifiable, 0)
    assert.equal(result.run.metrics.operationalLearningEffectRate, 0.1667)
    assert.equal(result.run.metrics.learningEffectRate, 0.1667)
    assert.equal(
      result.run.findings.find((item) => item.code === 'operational-materialized-without-installed-readback').amount,
      1
    )

    const context = await consumirContextoAuditoriaSistema(casa)
    assert.match(context, /sem configuração, ela permanece pronta/i)
    assert.match(context, /o despachante interno reivindica um executor pela porta neutra/i)
    assert.match(context, /antes disso não há efeito comprovado/i)
    assert.doesNotMatch(context, /\brode\b|\bexecute\b|\bcorrija\b/i)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('installed-verified de outra identidade fica histórico sem fabricar supersessão ou pendência ativa', async () => {
  const casa = await temporary('omni-system-audit-stale-installed-home-')
  const pluginRoot = await pluginFixture()
  try {
    const candidate = await operationalCandidate(casa, 1, 'installed-verified', {
      version: '1.2.2',
      payloadFingerprint: 'f'.repeat(64)
    })
    const result = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T11:00:00.000Z'
    })
    assert.equal(result.run.metrics.operationalInstalledVerified, 1)
    assert.equal(result.run.metrics.operationalImprovementHistoricalTotal, 1)
    assert.equal(result.run.metrics.operationalImprovementAwaitingProof, 0)
    assert.equal(result.run.metrics.operationalImprovementHistoricalUnverifiable, 1)
    assert.equal(
      result.run.findings.some((item) => item.code === 'operational-installed-without-loaded-readback'),
      false
    )
    const cycle = await lerCicloOperacional(casa)
    const unchanged = cycle.improvementCandidates.find((item) => item.id === candidate.id)
    assert.equal(unchanged.status, 'installed-verified')
    assert.equal(unchanged.supersededBy, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('auditoria materializa candidatas deterministicas e encaminha mudanca de fonte sem pedir nova aprovacao', async () => {
  const casa = await temporary('omni-system-audit-auto-repair-home-')
  const pluginRoot = await pluginFixture()
  try {
    await configurarRepositorioCanonico(casa, pluginRoot)
    await operationalCandidate(casa, 1, 'ready')
    const sourceInput = {
      category: 'system-audit-source-change',
      destination: 'runtime-fix',
      statement: 'Corrigir automaticamente uma falha reversivel no runtime do Omni.'
    }
    await proporMelhoriaOperacional(casa, sourceInput)
    await proporMelhoriaOperacional(casa, sourceInput)

    const result = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: true,
      at: '2026-08-28T13:00:00.000Z'
    })
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.improvementCandidates.filter((item) => item.status === 'ready').length, 1)
    assert.equal(cycle.improvementCandidates.filter((item) => item.status === 'materialized-pending-release').length, 0)
    assert.equal(cycle.improvementCandidates.filter((item) => item.status === 'implementation-required').length, 1)
    assert.ok(result.run.repairs.some((item) =>
      item.code === 'advanced-ready-operational-improvements' && item.amount === 1 && item.verified === true
    ))
    assert.equal(result.run.metrics.operationalImprovementReady, 1)
    assert.equal(result.run.metrics.operationalImplementationRequired, 1)
    assert.equal(result.run.metrics.operationalMaterializedPendingRelease, 0)
    const rules = JSON.parse(await readFile(
      join(pluginRoot, 'contratos', 'operacao', 'regras-aprendidas.json'),
      'utf8'
    ))
    assert.equal(rules.rules.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})

test('falha de manutenção não é mascarada por reconciliação saudável e não vaza erro bruto', async () => {
  const casa = await temporary('omni-system-audit-self-repair-home-')
  const pluginRoot = await pluginFixture()
  try {
    await registrarTelemetriaAutocorrecao(casa, {
      profile: 'maintenance',
      event: 'SessionStart',
      at: '2026-08-28T10:00:00.000Z',
      stages: [
        { stage: 'daily-scan', status: 'rejected', errorFingerprint: 'a'.repeat(64) },
        { stage: 'system-audit', status: 'fulfilled', resultFingerprint: 'b'.repeat(64) },
        { stage: 'personality-eval', status: 'fulfilled', resultFingerprint: 'c'.repeat(64) },
        { stage: 'operational-release', status: 'fulfilled', resultFingerprint: 'd'.repeat(64) }
      ]
    })
    await registrarTelemetriaAutocorrecao(casa, {
      profile: 'reconciliation',
      event: 'SessionStart',
      at: '2026-08-28T10:00:30.000Z',
      stages: [
        { stage: 'failure-automation', status: 'fulfilled', resultFingerprint: 'e'.repeat(64) },
        { stage: 'delegation-reconciliation', status: 'fulfilled', resultFingerprint: 'f'.repeat(64) },
        { stage: 'historical-turn-reconciliation', status: 'fulfilled', resultFingerprint: '1'.repeat(64) }
      ]
    })
    const result = await auditarSaudeSistema(casa, {
      pluginRoot,
      repair: false,
      at: '2026-08-28T10:01:00.000Z'
    })
    const finding = result.run.findings.find((item) => item.code === 'self-repair-stages-degraded')
    assert.equal(finding.amount, 1)
    assert.equal(finding.releaseBlocking, false)
    assert.equal(result.run.metrics.selfRepairRunsObserved, 2)
    assert.equal(result.run.metrics.selfRepairConsecutiveDegradedRuns, 1)
    assert.equal(result.run.metrics.selfRepairFailedStagesLatest, 1)
    assert.equal(JSON.stringify(result).includes('erro bruto privado'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(pluginRoot, { recursive: true, force: true })
  }
})
