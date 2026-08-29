import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  adaptarFimSubagenteClaude,
  adaptarInicioSubagenteClaude,
  contextoAutomacaoFalhasClaude,
  contextoAutomacaoMelhoriasClaude,
  contextoProximaAutomacaoClaude
} from '../runtime/adaptador-claude-delegacao.mjs'
import {
  caminhoDaAutomacaoMelhorias,
  exigirInicioDespachoMelhoriaAntesDaParada,
  lerAutomacaoMelhorias,
  materializarMelhoriaComBaselineConfigurada,
  processarReleasePendenteMelhoria,
  sincronizarAutomacaoMelhorias
} from '../runtime/automacao-melhorias.mjs'
import {
  abrirTurnoAuditoria,
  registrarAcaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import {
  lerCicloOperacional,
  marcarMelhoriaOperacional,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import {
  configurarRepositorioCanonico,
  materializarMelhoriaConfigurada
} from '../runtime/evolucao.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'

async function fixture() {
  const casa = await mkdtemp(join(tmpdir(), 'omni-improvement-automation-home-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-improvement-automation-repo-'))
  await mkdir(join(repo, 'runtime'), { recursive: true })
  await writeFile(join(repo, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version: '1.0.0' })}\n`, 'utf8')
  await writeFile(join(repo, 'runtime', 'fix.mjs'), 'export const value = 1\n', 'utf8')
  inicializarGit(repo)
  await configurarRepositorioCanonico(casa, repo)
  const input = {
    category: 'runtime-self-correction',
    destination: 'runtime-fix',
    statement: 'Evitar repetir uma estrategia que ja falhou no runtime.'
  }
  await proporMelhoriaOperacional(casa, input, { at: '2026-08-29T10:00:00.000Z' })
  const ready = await proporMelhoriaOperacional(casa, input, { at: '2026-08-29T10:01:00.000Z' })
  const required = await materializarMelhoriaConfigurada(casa, ready.candidate.id)
  assert.equal(required.result, 'implementation-required')
  return { casa, repo, candidateId: ready.candidate.id }
}

function inicializarGit(repo) {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'omni-tests@example.invalid'],
    ['config', 'user.name', 'Omni Tests'],
    ['config', 'core.autocrlf', 'false'],
    ['add', '.'],
    ['commit', '-m', 'fixture baseline']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
}

function commitGit(repo, message) {
  for (const args of [['add', '.'], ['commit', '-m', message]]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
}

function tool(sessionId, id, name, filePath) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: id,
    tool_name: name,
    tool_input: { file_path: filePath },
    cwd: filePath.replace(/[\\/][^\\/]+$/, '')
  }
}

test('candidata implementation-required vira despacho neutro com autoridade limitada e store hash-only', async () => {
  const { casa, repo, candidateId } = await fixture()
  const sessionId = 'improvement-dispatch-session'
  try {
    await sincronizarAutomacaoMelhorias(casa)
    const queued = await lerAutomacaoMelhorias(casa)
    assert.equal(queued.jobs.length, 1)
    assert.equal(queued.jobs[0].state, 'queued')

    const context = await contextoAutomacaoMelhoriasClaude(casa, { sessionId })
    assert.match(context, /implementation-dispatch-required/i)
    assert.match(context, new RegExp(candidateId))
    assert.match(context, /OMNI_IMPLEMENTATION_RECEIPT/)

    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations.length, 1)
    assert.equal(cycle.delegations[0].state, 'visible')
    assert.equal(cycle.delegations[0].target, 'omni-self-correction')
    assert.equal(cycle.delegations[0].authorityEnvelope.source, 'standing-authority')
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(job.state, 'dispatch-required')
    assert.equal(job.attempts, 0)
    assert.match(job.baselineRepositoryFingerprint, /^[a-f0-9]{64}$/)
    assert.match(job.baselineCommitSha, /^[a-f0-9]{40,64}$/)
    assert.match(job.baselineBranchFingerprint, /^[a-f0-9]{64}$/)
    assert.match(job.baselineStatusFingerprint, /^[a-f0-9]{64}$/)

    const gate = await exigirInicioDespachoMelhoriaAntesDaParada(casa, { sessionId })
    assert.equal(gate.decision, 'block')
    assert.match(gate.reason, new RegExp(job.delegationId))

    const raw = await readFile(caminhoDaAutomacaoMelhorias(casa), 'utf8')
    assert.doesNotMatch(raw, /Evitar repetir|runtime\/fix\.mjs/)
    assert.doesNotMatch(raw, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('repositorio sujo impede o despacho antes de qualquer executor', async () => {
  const { casa, repo } = await fixture()
  const sessionId = 'dirty-baseline-session'
  try {
    await writeFile(join(repo, 'runtime', 'fix.mjs'), 'export const value = 99\n', 'utf8')
    const context = await contextoAutomacaoMelhoriasClaude(casa, { sessionId })
    assert.equal(context, null)
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations.length, 0)
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(job.state, 'queued')
    assert.equal(job.baselineCommitSha, null)
    assert.match(job.reasonFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('regra portatil captura baseline antes de materializar e conclui pela mesma release', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-portable-improvement-home-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-portable-improvement-repo-'))
  try {
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version: '1.0.0' })}\n`, 'utf8')
    await writeFile(
      join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'),
      `${JSON.stringify({ schemaVersion: 1, rules: [] })}\n`,
      'utf8'
    )
    inicializarGit(repo)
    await configurarRepositorioCanonico(casa, repo)
    const input = {
      category: 'operational-learning',
      destination: 'operational-rule',
      statement: 'Retomar automaticamente a correcao reversivel quando a causa concreta desaparecer.'
    }
    await proporMelhoriaOperacional(casa, input, { at: '2031-01-01T00:00:00.000Z' })
    const ready = await proporMelhoriaOperacional(casa, input, { at: '2031-01-01T00:01:00.000Z' })

    const materialized = await materializarMelhoriaComBaselineConfigurada(casa, ready.candidate.id, {
      at: '2031-01-01T00:02:00.000Z'
    })
    assert.equal(materialized.result, 'materialized-pending-release')
    const pending = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(pending.state, 'awaiting-release')
    assert.match(pending.baselineCommitSha, /^[a-f0-9]{40,64}$/)
    const candidate = (await lerCicloOperacional(casa)).improvementCandidates.find((item) =>
      item.id === ready.candidate.id
    )
    assert.equal(candidate.artifactRef.path, 'contratos/operacao/regras-aprendidas.json')

    const released = await processarReleasePendenteMelhoria(casa, {
      at: '2031-01-01T00:03:00.000Z',
      releaseOperational: async ({ baseline, allowedArtifacts }) => {
        assert.equal(baseline.commitSha, pending.baselineCommitSha)
        assert.deepEqual(allowedArtifacts, [candidate.artifactRef])
        await marcarMelhoriaOperacional(casa, candidate.id, {
          status: 'installed-verified',
          installedReadback: {
            verified: true,
            version: '1.0.1',
            payloadFingerprint: 'd'.repeat(64),
            artifactFingerprint: 'e'.repeat(64),
            verifiedAt: '2031-01-01T00:03:00.000Z'
          }
        }, { at: '2031-01-01T00:03:00.000Z' })
        return { result: 'published-installed-verified' }
      }
    })
    assert.equal(released.result, 'completed', JSON.stringify(released))
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].state, 'completed')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('pipeline serializa duas regras prontas ate a primeira release ficar instalada', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-serialized-improvement-home-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-serialized-improvement-repo-'))
  try {
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version: '1.0.0' })}\n`, 'utf8')
    await writeFile(
      join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'),
      `${JSON.stringify({ schemaVersion: 1, rules: [] })}\n`,
      'utf8'
    )
    inicializarGit(repo)
    await configurarRepositorioCanonico(casa, repo)
    const ready = []
    for (const statement of [
      'Serializar a primeira correcao ate o readback instalado.',
      'Iniciar a segunda correcao somente com o repositorio novamente limpo.'
    ]) {
      const input = { category: 'pipeline-serialization', destination: 'operational-rule', statement }
      await proporMelhoriaOperacional(casa, input)
      ready.push((await proporMelhoriaOperacional(casa, input)).candidate)
    }

    const first = await materializarMelhoriaComBaselineConfigurada(casa, ready[0].id)
    assert.equal(first.result, 'materialized-pending-release')
    const secondBlocked = await materializarMelhoriaComBaselineConfigurada(casa, ready[1].id)
    assert.equal(secondBlocked.result, 'pipeline-busy')
    assert.match(secondBlocked.ownerJobFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(
      (await lerCicloOperacional(casa)).improvementCandidates.find((item) => item.id === ready[1].id).status,
      'ready'
    )

    const released = await processarReleasePendenteMelhoria(casa, {
      releaseOperational: async () => {
        commitGit(repo, 'release first learned rule')
        await marcarMelhoriaOperacional(casa, ready[0].id, {
          status: 'installed-verified',
          installedReadback: {
            verified: true,
            version: '1.0.1',
            payloadFingerprint: '1'.repeat(64),
            artifactFingerprint: first.candidate.artifactRef.semanticFingerprint,
            verifiedAt: '2031-01-01T00:03:00.000Z'
          }
        })
        return { result: 'published-installed-verified' }
      }
    })
    assert.equal(released.result, 'completed')
    const second = await materializarMelhoriaComBaselineConfigurada(casa, ready[1].id)
    assert.equal(second.result, 'materialized-pending-release')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('job legado sem baseline recupera somente o artefato auditado e conclui release', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-legacy-baseline-home-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-legacy-baseline-repo-'))
  try {
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version: '1.0.0' })}\n`, 'utf8')
    await writeFile(
      join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'),
      `${JSON.stringify({ schemaVersion: 1, rules: [] })}\n`,
      'utf8'
    )
    inicializarGit(repo)
    await configurarRepositorioCanonico(casa, repo)
    const input = {
      category: 'legacy-recovery',
      destination: 'operational-rule',
      statement: 'Recuperar candidata antiga sem inventar um baseline anterior.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    const materialized = await materializarMelhoriaConfigurada(casa, ready.candidate.id)
    assert.equal(materialized.result, 'materialized-pending-release')
    await sincronizarAutomacaoMelhorias(casa)
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].baselineCommitSha, null)

    const released = await processarReleasePendenteMelhoria(casa, {
      recoverInstalled: async () => ({
        result: 'artifact-not-in-loaded-release',
        observationFingerprint: '2'.repeat(64)
      }),
      releaseOperational: async ({ baseline, allowedArtifacts }) => {
        assert.match(baseline.commitSha, /^[a-f0-9]{40,64}$/)
        assert.deepEqual(allowedArtifacts, [materialized.candidate.artifactRef])
        await marcarMelhoriaOperacional(casa, ready.candidate.id, {
          status: 'installed-verified',
          installedReadback: {
            verified: true,
            version: '1.0.1',
            payloadFingerprint: '3'.repeat(64),
            artifactFingerprint: materialized.candidate.artifactRef.semanticFingerprint,
            verifiedAt: '2031-01-01T00:03:00.000Z'
          }
        })
        return { result: 'published-installed-verified' }
      }
    })
    assert.equal(released.result, 'completed', JSON.stringify(released))
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(job.state, 'completed')
    assert.match(job.baselineCommitSha, /^[a-f0-9]{40,64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('job legado sem prova de prebaseline fica classificado sem retry cego', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-unrecoverable-baseline-home-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-unrecoverable-baseline-repo-'))
  try {
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version: '1.0.0' })}\n`, 'utf8')
    await writeFile(
      join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'),
      `${JSON.stringify({ schemaVersion: 1, rules: [] })}\n`,
      'utf8'
    )
    await writeFile(join(repo, 'README.md'), 'baseline\n', 'utf8')
    inicializarGit(repo)
    await configurarRepositorioCanonico(casa, repo)
    const input = {
      category: 'legacy-unrecoverable',
      destination: 'operational-rule',
      statement: 'Nao alegar baseline quando ha mudanca alheia no repositorio.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    await materializarMelhoriaConfigurada(casa, ready.candidate.id)
    await writeFile(join(repo, 'README.md'), 'mudanca alheia\n', 'utf8')
    await sincronizarAutomacaoMelhorias(casa)
    let releaseCalls = 0
    const inputProcess = {
      recoverInstalled: async () => ({
        result: 'artifact-not-in-loaded-release',
        observationFingerprint: '4'.repeat(64)
      }),
      releaseOperational: async () => { releaseCalls += 1; throw new Error('nao deve publicar') }
    }
    const first = await processarReleasePendenteMelhoria(casa, inputProcess)
    const second = await processarReleasePendenteMelhoria(casa, inputProcess)
    assert.equal(first.result, 'legacy-unrecoverable')
    assert.equal(first.baselineRecoveryResult, 'legacy-baseline-unprovable')
    assert.equal(second.result, 'legacy-unrecoverable')
    assert.equal(releaseCalls, 0)
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(job.releaseAttempts, 0)
    assert.equal(job.releaseRetryAt, null)
    assert.match(job.reasonFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('baseline divergente recaptura o novo HEAD quando resta somente o artefato auditado', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-recapture-baseline-home-'))
  const repo = await mkdtemp(join(tmpdir(), 'omni-recapture-baseline-repo-'))
  try {
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), `${JSON.stringify({ name: 'omni-agent', version: '1.0.0' })}\n`, 'utf8')
    await writeFile(
      join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'),
      `${JSON.stringify({ schemaVersion: 1, rules: [] })}\n`,
      'utf8'
    )
    inicializarGit(repo)
    await configurarRepositorioCanonico(casa, repo)
    const input = {
      category: 'baseline-forward-recovery',
      destination: 'operational-rule',
      statement: 'Recapturar o baseline quando outro commit seguro avancou o HEAD.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    await materializarMelhoriaComBaselineConfigurada(casa, ready.candidate.id)
    const oldBaseline = (await lerAutomacaoMelhorias(casa)).jobs[0].baselineCommitSha

    await writeFile(join(repo, 'history.txt'), 'commit concorrente controlado\n', 'utf8')
    for (const args of [['add', 'history.txt'], ['commit', '-m', 'advance unrelated baseline']]) {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
      assert.equal(result.status, 0, result.stderr || result.stdout)
    }
    const newHead = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true
    }).stdout.trim()
    assert.notEqual(newHead, oldBaseline)

    const recaptured = await processarReleasePendenteMelhoria(casa, {
      releaseOperational: async () => ({ result: 'baseline-diverged' })
    })
    assert.equal(recaptured.result, 'baseline-recaptured')
    assert.equal(recaptured.recoveryResult, 'recovered-single-audited-artifact')
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].baselineCommitSha, newHead)

    const candidate = (await lerCicloOperacional(casa)).improvementCandidates.find((item) =>
      item.id === ready.candidate.id
    )
    const completed = await processarReleasePendenteMelhoria(casa, {
      releaseOperational: async ({ baseline }) => {
        assert.equal(baseline.commitSha, newHead)
        await marcarMelhoriaOperacional(casa, candidate.id, {
          status: 'installed-verified',
          installedReadback: {
            verified: true,
            version: '1.0.1',
            payloadFingerprint: '5'.repeat(64),
            artifactFingerprint: candidate.artifactRef.semanticFingerprint,
            verifiedAt: '2031-01-01T00:03:00.000Z'
          }
        })
        return { result: 'published-installed-verified' }
      }
    })
    assert.equal(completed.result, 'completed')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('arbitro expoe uma unica fila por hook e deixa a melhoria para o ciclo seguinte', async () => {
  const { casa, repo } = await fixture()
  const sessionId = 'automation-arbiter-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'corrija as falhas e melhorias pendentes sem misturar os executores'
    })
    const failure = {
      agent: 'omni',
      action: 'executar Bash',
      failureClass: 'permission',
      signature: 'permission denied no gate local'
    }
    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(casa, { ...failure, evidenceId: `arbiter-failure-${index}` })
    }

    const first = await contextoProximaAutomacaoClaude(casa, { sessionId })
    assert.equal(first.kind, 'failure')
    assert.match(first.context, /failure-dispatch-required/i)
    assert.doesNotMatch(first.context, /implementation-dispatch-required/i)
    assert.equal((await lerCicloOperacional(casa)).delegations.length, 1)
    const waitingImprovement = (await lerAutomacaoMelhorias(casa)).jobs
    assert.equal(waitingImprovement.length, 1)
    assert.equal(waitingImprovement[0].state, 'queued')
    assert.equal(waitingImprovement[0].delegationId, null)

    const delegationId = (await lerCicloOperacional(casa)).delegations[0].id
    const started = await adaptarInicioSubagenteClaude(casa, {
      hook_event_name: 'SubagentStart',
      session_id: sessionId,
      delegation_id: delegationId,
      agent_id: 'failure-arbiter-executor',
      agent_type: 'general-purpose',
      cwd: repo
    })
    assert.equal(started.result, 'running')

    const second = await contextoProximaAutomacaoClaude(casa, { sessionId })
    assert.equal(second.kind, 'improvement')
    assert.match(second.context, /implementation-dispatch-required/i)
    assert.equal((await lerCicloOperacional(casa)).delegations.length, 2)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('segundo job de fonte nao abre enquanto o primeiro executor ainda esta ativo', async () => {
  const { casa, repo } = await fixture()
  const sessionId = 'serialized-source-dispatch-session'
  try {
    const secondInput = {
      category: 'runtime-self-correction-second',
      destination: 'runtime-fix',
      statement: 'Corrigir uma segunda falha somente depois da primeira release instalada.'
    }
    await proporMelhoriaOperacional(casa, secondInput)
    const secondReady = await proporMelhoriaOperacional(casa, secondInput)
    await materializarMelhoriaConfigurada(casa, secondReady.candidate.id)
    await sincronizarAutomacaoMelhorias(casa)
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs.length, 2)

    const firstContext = await contextoAutomacaoMelhoriasClaude(casa, { sessionId })
    assert.match(firstContext, /implementation-dispatch-required/i)
    const firstJob = (await lerAutomacaoMelhorias(casa)).jobs.find((item) => item.state === 'dispatch-required')
    await adaptarInicioSubagenteClaude(casa, {
      hook_event_name: 'SubagentStart',
      session_id: sessionId,
      delegation_id: firstJob.delegationId,
      agent_id: 'serialized-first-executor',
      agent_type: 'general-purpose',
      cwd: repo
    })

    const secondContext = await contextoProximaAutomacaoClaude(casa, { sessionId })
    assert.equal(secondContext.context, null)
    assert.equal((await lerCicloOperacional(casa)).delegations.length, 1)
    const jobs = await lerAutomacaoMelhorias(casa)
    assert.equal(jobs.jobs.filter((item) => item.state === 'running').length, 1)
    assert.equal(jobs.jobs.filter((item) => item.state === 'queued').length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('falha nova nao atropela melhoria ja exposta no PostToolUseFailure', async () => {
  const { casa, repo } = await fixture()
  const sessionId = 'automation-existing-improvement-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'execute a autocorrecao operacional e preserve a fila unica'
    })
    const visible = await contextoAutomacaoMelhoriasClaude(casa, { sessionId })
    assert.match(visible, /implementation-dispatch-required/i)
    const improvementDelegation = (await lerCicloOperacional(casa)).delegations[0]

    const failure = {
      agent: 'omni',
      action: 'executar Bash',
      failureClass: 'permission',
      signature: 'permission denied durante o gate focal'
    }
    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(casa, { ...failure, evidenceId: `existing-improvement-failure-${index}` })
    }
    const arbitration = await contextoProximaAutomacaoClaude(casa, {
      sessionId,
      hookEventName: 'PostToolUseFailure'
    })
    assert.equal(arbitration.kind, 'improvement-pending')
    assert.equal(arbitration.context, null)
    assert.equal((await lerCicloOperacional(casa)).delegations.length, 1)

    await adaptarInicioSubagenteClaude(casa, {
      hook_event_name: 'SubagentStart',
      session_id: sessionId,
      delegation_id: improvementDelegation.id,
      agent_id: 'improvement-first-executor',
      agent_type: 'general-purpose',
      cwd: repo
    })
    const next = await contextoProximaAutomacaoClaude(casa, { sessionId })
    assert.equal(next.kind, 'failure')
    assert.match(next.context, /failure-dispatch-required/i)
    assert.equal((await lerCicloOperacional(casa)).delegations.length, 2)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('arbitro recupera dois despachos legados simultaneos e adia a melhoria com trilha auditavel', async () => {
  const { casa, repo } = await fixture()
  const sessionId = 'automation-legacy-double-dispatch-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'recupere os dois despachos antigos sem vincular o executor ao briefing errado'
    })
    const improvementContext = await contextoAutomacaoMelhoriasClaude(casa, { sessionId })
    assert.match(improvementContext, /implementation-dispatch-required/i)
    const improvementJobBefore = (await lerAutomacaoMelhorias(casa)).jobs[0]

    const failure = {
      agent: 'omni',
      action: 'executar Bash',
      failureClass: 'permission',
      signature: 'permission denied em despacho legado concorrente'
    }
    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(casa, { ...failure, evidenceId: `legacy-double-${index}` })
    }
    const failureContext = await contextoAutomacaoFalhasClaude(casa, { sessionId })
    assert.match(failureContext, /failure-dispatch-required/i)
    assert.equal((await lerCicloOperacional(casa)).delegations.filter((item) => item.state === 'visible').length, 2)

    const arbitration = await contextoProximaAutomacaoClaude(casa, { sessionId })
    assert.equal(arbitration.kind, 'failure')
    assert.match(arbitration.context, /failure-dispatch-required/i)
    assert.equal(arbitration.deferredImprovementJobId, improvementJobBefore.id)

    const improvementJobAfter = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(improvementJobAfter.state, 'queued')
    assert.equal(improvementJobAfter.generation, improvementJobBefore.generation + 1)
    assert.equal(improvementJobAfter.delegationId, null)
    assert.match(improvementJobAfter.reasonFingerprint, /^[a-f0-9]{64}$/)
    const cycle = await lerCicloOperacional(casa)
    const deferred = cycle.delegations.find((item) => item.id === improvementJobBefore.delegationId)
    assert.equal(deferred.state, 'cancelled')
    assert.equal(deferred.finalOutcome, 'cancelled')
    assert.match(deferred.reasonFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(cycle.delegations.filter((item) => item.state === 'visible').length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('inicio real, mutacao, readback e recibo avancam para release sem alegar conclusao instalada', async () => {
  const { casa, repo, candidateId } = await fixture()
  const sessionId = 'improvement-execution-session'
  const agentId = 'improvement-executor-1'
  const artifact = join(repo, 'runtime', 'fix.mjs')
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'execute a autocorrecao pendente do Omni e verifique o resultado'
    }, { at: '2030-01-01T00:00:00.000Z' })
    await contextoAutomacaoMelhoriasClaude(casa, { sessionId, at: '2030-01-01T00:00:01.000Z' })
    const dispatched = (await lerAutomacaoMelhorias(casa)).jobs[0]
    const started = await adaptarInicioSubagenteClaude(casa, {
      hook_event_name: 'SubagentStart',
      session_id: sessionId,
      delegation_id: dispatched.delegationId,
      agent_id: agentId,
      agent_type: 'general-purpose',
      cwd: repo
    }, { at: '2030-01-01T00:00:02.000Z' })
    assert.equal(started.result, 'running')
    assert.equal(started.automation.result, 'running')
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].attempts, 1)

    await writeFile(artifact, 'export const value = 2\n', 'utf8')
    await registrarAcaoAuditoria(
      casa,
      tool(sessionId, 'implementation-write', 'Write', artifact),
      { at: '2030-01-01T00:00:03.000Z' }
    )
    await registrarAcaoAuditoria(
      casa,
      tool(sessionId, 'implementation-readback', 'Read', artifact),
      { at: '2030-01-01T00:00:04.000Z' }
    )

    const reported = await adaptarFimSubagenteClaude(casa, {
      hook_event_name: 'SubagentStop',
      session_id: sessionId,
      delegation_id: dispatched.delegationId,
      agent_id: agentId,
      agent_type: 'general-purpose',
      agent_transcript_path: join(casa, 'agent-transcript.jsonl'),
      cwd: repo,
      last_assistant_message: [
        'Patch e readback realizados; gates retornaram verdes.',
        `OMNI_IMPLEMENTATION_RECEIPT {"candidateId":"${candidateId}","artifact":"runtime/fix.mjs"}`
      ].join('\n')
    }, { at: '2030-01-01T00:00:05.000Z' })
    assert.equal(reported.result, 'reported')
    assert.equal(reported.automation.result, 'materialized-pending-release')

    const cycle = await lerCicloOperacional(casa)
    const candidate = cycle.improvementCandidates.find((item) => item.id === candidateId)
    assert.equal(candidate.status, 'materialized-pending-release')
    assert.equal(candidate.artifactRef.path, 'runtime/fix.mjs')
    assert.match(candidate.artifactRef.contentFingerprint, /^[a-f0-9]{64}$/)
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(job.state, 'awaiting-release')
    assert.notEqual(job.state, 'completed')
    const delegation = cycle.delegations.find((item) => item.id === job.delegationId)
    assert.equal(delegation.state, 'closed')
    assert.equal(delegation.finalOutcome, 'verified')
    assert.match(delegation.verificationAuditActionId, /^audit-action-/)
    assert.match(delegation.verificationAuditEvidenceId, /^audit-evidence-/)

    const deferredRelease = await processarReleasePendenteMelhoria(casa, {
      at: '2030-01-01T00:00:06.000Z',
      releaseOperational: async (input) => {
        assert.equal(input.candidateId, candidateId)
        assert.equal(input.baseline.contract, 'omni-operational-release-baseline-v1')
        assert.deepEqual(input.allowedArtifacts, [candidate.artifactRef])
        return { result: 'release-retryable', errorFingerprint: 'b'.repeat(64) }
      }
    })
    assert.equal(deferredRelease.result, 'release-retryable')
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].state, 'awaiting-release')
    assert.ok((await lerAutomacaoMelhorias(casa)).jobs[0].releaseRetryAt)

    const released = await processarReleasePendenteMelhoria(casa, {
      at: '2030-01-01T00:11:00.000Z',
      releaseOperational: async (input) => {
        assert.equal(input.candidateId, candidateId)
        await marcarMelhoriaOperacional(casa, candidateId, {
          status: 'installed-verified',
          installedReadback: {
            verified: true,
            version: '1.0.1',
            payloadFingerprint: 'a'.repeat(64),
            artifactFingerprint: candidate.artifactRef.contentFingerprint,
            verifiedAt: '2030-01-01T00:11:00.000Z'
          }
        }, { at: '2030-01-01T00:11:00.000Z' })
        return { result: 'published-installed-verified' }
      }
    })
    assert.equal(released.result, 'completed')
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].state, 'completed')
    assert.equal(
      (await lerCicloOperacional(casa)).improvementCandidates.find((item) => item.id === candidateId).status,
      'installed-verified'
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('relato sem recibo nao morre: agenda nova geracao para reteste', async () => {
  const { casa, repo } = await fixture()
  const sessionId = 'improvement-retry-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'corrija a melhoria operacional pendente'
    }, { at: '2030-01-01T00:00:00.000Z' })
    await contextoAutomacaoMelhoriasClaude(casa, { sessionId, at: '2030-01-01T00:00:01.000Z' })
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    await adaptarInicioSubagenteClaude(casa, {
      session_id: sessionId,
      delegation_id: job.delegationId,
      agent_id: 'executor-sem-recibo',
      agent_type: 'general-purpose',
      cwd: repo
    }, { at: '2030-01-01T00:00:02.000Z' })
    const result = await adaptarFimSubagenteClaude(casa, {
      session_id: sessionId,
      delegation_id: job.delegationId,
      agent_id: 'executor-sem-recibo',
      agent_type: 'general-purpose',
      agent_transcript_path: join(casa, 'sem-recibo.jsonl'),
      cwd: repo,
      last_assistant_message: 'Fiz algo, mas nao devolvi o recibo estruturado.'
    }, { at: '2030-01-01T00:00:03.000Z' })
    assert.equal(result.automation.result, 'receipt-required')
    const deferred = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(deferred.state, 'reported-unverified')
    assert.ok(Number.isFinite(Date.parse(deferred.retryAt)))

    await sincronizarAutomacaoMelhorias(casa, { at: '2030-01-01T01:01:00.000Z' })
    const retried = (await lerAutomacaoMelhorias(casa)).jobs[0]
    assert.equal(retried.state, 'queued')
    assert.equal(retried.generation, 2)
    assert.equal(retried.delegationId, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('recibo forjado sem mutacao e readback auditados nao promove a candidata', async () => {
  const { casa, repo, candidateId } = await fixture()
  const sessionId = 'improvement-forged-receipt-session'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'corrija e verifique a melhoria operacional pendente'
    }, { at: '2030-01-02T00:00:00.000Z' })
    await contextoAutomacaoMelhoriasClaude(casa, { sessionId, at: '2030-01-02T00:00:01.000Z' })
    const job = (await lerAutomacaoMelhorias(casa)).jobs[0]
    await adaptarInicioSubagenteClaude(casa, {
      session_id: sessionId,
      delegation_id: job.delegationId,
      agent_id: 'executor-recibo-forjado',
      agent_type: 'general-purpose',
      cwd: repo
    }, { at: '2030-01-02T00:00:02.000Z' })
    const result = await adaptarFimSubagenteClaude(casa, {
      session_id: sessionId,
      delegation_id: job.delegationId,
      agent_id: 'executor-recibo-forjado',
      agent_type: 'general-purpose',
      agent_transcript_path: join(casa, 'recibo-forjado.jsonl'),
      cwd: repo,
      last_assistant_message: `OMNI_IMPLEMENTATION_RECEIPT {"candidateId":"${candidateId}","artifact":"runtime/fix.mjs"}`
    }, { at: '2030-01-02T00:00:03.000Z' })
    assert.equal(result.automation.result, 'implementation-unverified')
    const cycle = await lerCicloOperacional(casa)
    assert.equal(
      cycle.improvementCandidates.find((item) => item.id === candidateId).status,
      'implementation-required'
    )
    assert.equal((await lerAutomacaoMelhorias(casa)).jobs[0].state, 'reported-unverified')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})
