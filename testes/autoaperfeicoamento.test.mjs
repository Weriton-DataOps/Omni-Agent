import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  avaliarMelhoria,
  caminhoDoAutoaperfeicoamento,
  classificarAprendizado,
  classificarDestinoFalha,
  decidirMelhoria,
  lerAutoaperfeicoamento,
  promoverMelhoria,
  proporMelhoriaDeAtalho,
  registrarReadbackInstalado
} from '../runtime/autoaperfeicoamento.mjs'
import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import {
  registrarObservacaoAtalho as registrarObservacaoAtalhoReal,
  validarAtalho as validarAtalhoReal,
  vinculoVerificacaoAtalho
} from '../runtime/atalhos.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'

const execution = {
  goal: 'diagnosticar conexoes do Postgres',
  baselineSteps: ['CPU', 'RAM', 'Processos', 'Postgres', 'Conexoes'],
  shortcutSteps: ['Postgres', 'Conexoes'],
  outcome: 'gargalo de conexoes confirmado',
  success: true,
  scope: { type: 'user' }
}

async function temporaryHome(prefix = 'omni-improvement-') {
  return mkdtemp(join(tmpdir(), prefix))
}

let shortcutExecutionSequence = 0

async function shortcutEvidence(home, input) {
  shortcutExecutionSequence += 1
  const sessionId = `improvement-shortcut-session-${shortcutExecutionSequence}`
  const executionId = `improvement-shortcut-tool-${shortcutExecutionSequence}`
  const at = new Date(Date.UTC(2031, 0, 1, 10, 0, shortcutExecutionSequence)).toISOString()
  const stable = input.outcome === execution.outcome && input.success !== false
  const binding = vinculoVerificacaoAtalho(input)
  const verificationCommand = stable
    ? 'node --test testes/autoaperfeicoamento.test.mjs'
    : `node --test testes/autoaperfeicoamento.test.mjs --test-name-pattern variante-${shortcutExecutionSequence}`
  await abrirTurnoAuditoria(home, {
    session_id: sessionId,
    prompt: 'Verifique o resultado real do procedimento antes de aprender o atalho.'
  }, { at: new Date(Date.parse(at) - 1_000).toISOString() })
  await registrarAcaoAuditoria(home, {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: executionId,
    tool_name: 'Bash',
    tool_input: {
      command: `${verificationCommand} # omni-shortcut-binding:${binding}`
    },
    cwd: 'C:\\projetos\\teste'
  }, { at })
  return { sessionId, executionId }
}

async function registrarObservacaoAtalho(home, input) {
  const evidence = await shortcutEvidence(home, input)
  const { outcome: _outcome, success: _success, ...safe } = input
  return registrarObservacaoAtalhoReal(home, { ...safe, ...evidence })
}

async function validarAtalho(home, id, input) {
  const evidence = await shortcutEvidence(home, { ...execution, ...input })
  const { outcome: _outcome, success: _success, ...safe } = input
  return validarAtalhoReal(home, id, { ...safe, ...evidence })
}

async function validatedShortcut(home) {
  await registrarObservacaoAtalho(home, execution)
  await registrarObservacaoAtalho(home, execution)
  const candidate = await registrarObservacaoAtalho(home, execution)
  const validation = await validarAtalho(home, candidate.shortcut.id, {
    outcome: execution.outcome,
    success: true
  })
  return validation.shortcut
}

function git(repo, args) {
  const run = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 0, run.stderr)
  return run.stdout.trim()
}

async function sourceRepository() {
  const repo = await mkdtemp(join(tmpdir(), 'omni-promotion-repo-'))
  await mkdir(join(repo, '.claude-plugin'), { recursive: true })
  await mkdir(join(repo, 'contratos', 'capacidades'), { recursive: true })
  await mkdir(join(repo, 'contratos', 'aprendizado'), { recursive: true })
  await mkdir(join(repo, 'skills'), { recursive: true })
  await writeFile(
    join(repo, '.claude-plugin', 'plugin.json'),
    '{"name":"omni","version":"9.9.9"}\n',
    'utf8'
  )
  await writeFile(
    join(repo, 'contratos', 'capacidades', 'catalogo.json'),
    '{"schemaVersion":1,"capabilities":[]}\n',
    'utf8'
  )
  git(repo, ['init'])
  git(repo, ['config', 'user.email', 'test@example.invalid'])
  git(repo, ['config', 'user.name', 'Omni Test'])
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'baseline'])
  return repo
}

async function prepararReleaseIntegra(repo, version = '9.9.9') {
  for (const area of ['contratos', 'hooks', 'runtime', 'scripts', 'skills']) {
    await mkdir(join(repo, area), { recursive: true })
  }
  await mkdir(join(repo, 'contratos', 'atualizacao'), { recursive: true })
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

test('classifica descarte, memoria e capacidade sem jogar tudo no mesmo destino', () => {
  assert.equal(classificarAprendizado({ useful: false, reusable: false }), 'discard')
  assert.equal(classificarAprendizado({ useful: true, reusable: false }), 'memory')
  assert.equal(classificarAprendizado({ useful: true, reusable: true }), 'capability')
})

test('falha do sensor de runtime nunca é promovida como skill genérica', () => {
  const destination = classificarDestinoFalha({
    action: 'executar fielmente o pedido atual',
    failureClass: 'logic',
    analysis: {
      rootCause: 'A regex do detector no observador casa mensagens de outra origem.',
      hypothesis: 'Corrigir o sensor no runtime e cobrir o corpus de regressão.'
    }
  })
  assert.equal(destination, 'runtime-fix')
})

test('atalho validado vira proposta, passa por eval e exige portabilidade explicita', async () => {
  const home = await temporaryHome()
  try {
    const shortcut = await validatedShortcut(home)
    const draft = await proporMelhoriaDeAtalho(home, shortcut.id)
    assert.equal(draft.result, 'draft')
    assert.equal(draft.proposal.destination, 'capability')
    assert.equal(draft.proposal.status, 'draft')
    assert.equal(draft.proposal.source.successCount, 4)

    const evaluation = await avaliarMelhoria(home, draft.proposal.id)
    assert.equal(evaluation.result, 'passed')
    assert.ok(evaluation.proposal.evaluation.gates.every((gate) => gate.passed))

    const refused = await decidirMelhoria(home, draft.proposal.id, 'approve')
    assert.equal(refused.result, 'portable-confirmation-required')
    const roleRefused = await decidirMelhoria(home, draft.proposal.id, 'approve', { portable: true })
    assert.equal(roleRefused.result, 'role-fit-confirmation-required')
    assert.equal(roleRefused.questions.length, 5)
    const approved = await decidirMelhoria(home, draft.proposal.id, 'approve', { portable: true, roleFit: true })
    assert.equal(approved.result, 'approved')
    assert.equal(approved.proposal.approval.portable, true)
    assert.equal(approved.proposal.approval.roleFit, true)

    const raw = await readFile(caminhoDoAutoaperfeicoamento(home), 'utf8')
    assert.equal(raw.includes(execution.outcome), false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('propostas concorrentes da mesma evidência são deduplicadas', async () => {
  const home = await temporaryHome('omni-improvement-concurrent-')
  try {
    const shortcut = await validatedShortcut(home)
    await Promise.all(Array.from({ length: 5 }, () => proporMelhoriaDeAtalho(home, shortcut.id)))
    const store = await lerAutoaperfeicoamento(home)
    assert.equal(store.proposals.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('regressão da fonte cancela aprovação antes de tocar o repositório', async () => {
  const home = await temporaryHome('omni-improvement-regression-')
  const repo = await sourceRepository()
  try {
    const shortcut = await validatedShortcut(home)
    const draft = await proporMelhoriaDeAtalho(home, shortcut.id)
    await avaliarMelhoria(home, draft.proposal.id)
    await decidirMelhoria(home, draft.proposal.id, 'approve', { portable: true, roleFit: true })
    await registrarObservacaoAtalho(home, { ...execution, outcome: 'resultado divergente' })

    const result = await promoverMelhoria(home, draft.proposal.id, repo)
    assert.equal(result.result, 'source-regressed')
    assert.equal(result.proposal.status, 'draft')
    assert.equal(git(repo, ['status', '--porcelain']), '')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('promoção materializa skill, catálogo e auditoria sem commit ou push', async () => {
  const home = await temporaryHome('omni-improvement-promote-')
  const repo = await sourceRepository()
  try {
    const shortcut = await validatedShortcut(home)
    const draft = await proporMelhoriaDeAtalho(home, shortcut.id)
    await avaliarMelhoria(home, draft.proposal.id)
    await decidirMelhoria(home, draft.proposal.id, 'approve', { portable: true, roleFit: true })
    const headBefore = git(repo, ['rev-parse', 'HEAD'])

    const result = await promoverMelhoria(home, draft.proposal.id, repo)
    assert.equal(result.result, 'materialized-pending-version')
    assert.equal(result.proposal.promotion.automaticCommit, false)
    assert.equal(result.proposal.promotion.automaticPush, false)

    const name = result.proposal.draft.capability.name
    const skill = await readFile(join(repo, 'skills', name, 'SKILL.md'), 'utf8')
    const audit = JSON.parse(
      await readFile(join(repo, 'contratos', 'aprendizado', 'promocoes', `${name}.json`), 'utf8')
    )
    const catalog = JSON.parse(
      await readFile(join(repo, 'contratos', 'capacidades', 'catalogo.json'), 'utf8')
    )
    assert.match(skill, /Verifique o resultado antes de declarar sucesso/)
    assert.equal(skill.includes(execution.outcome), false)
    assert.equal(audit.status, 'materialized-pending-version')
    assert.equal(catalog.capabilities[0].name, name)
    assert.equal(git(repo, ['rev-parse', 'HEAD']), headBefore)
    assert.match(git(repo, ['status', '--porcelain']), /catalogo\.json/)
    await assert.rejects(
      registrarReadbackInstalado(home, {
        pluginRoot: repo,
        version: '9.9.9',
        payloadFingerprint: 'a'.repeat(64)
      }),
      /release instalada integra/
    )
    const payloadFingerprint = await prepararReleaseIntegra(repo)
    await assert.rejects(
      registrarReadbackInstalado(home, {
        pluginRoot: repo,
        version: '9.9.8',
        payloadFingerprint
      }),
      /release instalada integra/
    )
    const storePath = caminhoDoAutoaperfeicoamento(home)
    const tampered = JSON.parse(await readFile(storePath, 'utf8'))
    const validSkillPath = tampered.proposals[0].promotion.artifacts.skill
    tampered.proposals[0].promotion.artifacts.skill = '../fora/SKILL.md'
    await writeFile(storePath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')
    await assert.rejects(
      registrarReadbackInstalado(home, {
        pluginRoot: repo,
        version: '9.9.9',
        payloadFingerprint
      }),
      /caminho portatil/
    )
    tampered.proposals[0].promotion.artifacts.skill = validSkillPath
    await writeFile(storePath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')
    const readback = await registrarReadbackInstalado(home, {
      pluginRoot: repo,
      version: '9.9.9',
      payloadFingerprint,
      now: '2026-08-28T18:00:00.000Z'
    })
    assert.equal(readback.verified, 1)
    const afterReadback = await lerAutoaperfeicoamento(home)
    assert.equal(afterReadback.proposals[0].promotion.installedReadback.verified, true)
    assert.equal(afterReadback.proposals[0].promotion.installedReadback.version, '9.9.9')
    const closed = await decidirMelhoria(home, draft.proposal.id, 'reject')
    assert.equal(closed.result, 'closed')
    assert.equal(closed.proposal.status, 'materialized-pending-version')
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('runtime antigo recusa store futuro sem sobrescrever', async () => {
  const home = await temporaryHome('omni-improvement-future-')
  try {
    const path = caminhoDoAutoaperfeicoamento(home)
    await mkdir(dirname(path), { recursive: true })
    const future = '{"schemaVersion":2,"store":{"id":"future"},"proposals":[]}\n'
    await writeFile(path, future, 'utf8')
    await assert.rejects(lerAutoaperfeicoamento(home), /mais novo que este plugin/i)
    assert.equal(await readFile(path, 'utf8'), future)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
