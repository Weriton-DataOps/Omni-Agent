import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  abrirTurnoAuditoria,
  registrarAcaoAuditoria,
  registrarDelegacaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import {
  prepararDelegacao,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import { materializarMelhoriaOperacional } from '../runtime/evolucao.mjs'
import { vinculoVerificacaoAtalho } from '../runtime/atalhos.mjs'
import {
  confirmarInicioAutomacaoFalha,
  prepararDespachoAutomaticoFalha
} from '../runtime/automacao-falhas.mjs'

const cli = fileURLToPath(new URL('../runtime/cli.mjs', import.meta.url))

function executar(args, env) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

async function registrarVerificacaoCli(casa, suffix, at, command = 'node --test testes/falhas.test.mjs') {
  const sessionId = `cli-failure-verification-${suffix}`
  const executionId = `cli-tool-${suffix}`
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Verifique a correção com o teste focal.'
  }, { at: new Date(Date.parse(at) - 1_000).toISOString() })
  const recorded = await registrarAcaoAuditoria(casa, {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: executionId,
    tool_name: 'Bash',
    tool_input: { command },
    cwd: 'C:\\projetos\\teste'
  }, { at })
  return { ...recorded, sessionId, executionId }
}

test('operador confirma declaração estável criada pelo pipeline', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  try {
    const experience = executar(
      ['experiencia', 'Prefiro', 'mapas', 'antes', 'de', 'textos', 'longos.'],
      env
    )
    assert.equal(experience.pipeline.result, 'confirmed')

    const candidates = executar(['candidatas'], env)
    assert.equal(candidates.candidates.length, 0)
    assert.equal(executar(['estado'], env).memory.confirmed, 1)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador registra implementação operacional somente com recibo auditado do mesmo artefato', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-source-implementation-'))
  const home = join(raiz, 'home')
  const repo = join(raiz, 'repo')
  const env = { ...process.env, OMNI_HOME: home }
  try {
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await mkdir(join(repo, 'runtime'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1,
      rules: []
    }), 'utf8')
    const artifact = join(repo, 'runtime', 'roteamento.mjs')
    await writeFile(artifact, 'export const route = "learned"\n', 'utf8')
    const input = {
      category: 'cli-test',
      destination: 'routing',
      statement: 'Vincular a implementação auditada pela rota pública.'
    }
    await proporMelhoriaOperacional(home, input)
    const ready = await proporMelhoriaOperacional(home, input)
    const required = await materializarMelhoriaOperacional(home, ready.candidate.id, repo)
    const after = (seconds) => new Date(Date.parse(required.candidate.updatedAt) + seconds * 1_000).toISOString()
    const session = 'cli-source-implementation-session'
    await abrirTurnoAuditoria(home, {
      session_id: session,
      prompt: 'Implemente e verifique o artefato de roteamento.'
    }, { at: after(1) })
    const mutation = await registrarAcaoAuditoria(home, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'cli-source-mutation',
      tool_name: 'Write',
      tool_input: { file_path: artifact, content: 'não persistir no recibo' }
    }, { at: after(2) })
    const readback = await registrarAcaoAuditoria(home, {
      hook_event_name: 'PostToolUse',
      session_id: session,
      tool_use_id: 'cli-source-readback',
      tool_name: 'Read',
      tool_input: { file_path: artifact }
    }, { at: after(3) })

    const result = executar([
      'melhoria-operacional-registrar-implementacao', ready.candidate.id,
      '--repo', repo,
      '--artefato', 'runtime/roteamento.mjs',
      '--acao-mutacao', mutation.action.id,
      '--evidencia-mutacao', mutation.evidence.id,
      '--acao-readback', readback.action.id,
      '--evidencia-readback', readback.evidence.id
    ], env)
    assert.equal(result.improvement.result, 'materialized-pending-release')
    assert.match(result.improvement.artifactRef.implementationReceipt.targetFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(result).includes(repo), false)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador entrega a personalidade escolhida pelo manifesto', () => {
  const result = executar(['personalidade'], process.env)
  assert.equal(result.personality.id, 'omni-persona-v3-candidate')
  assert.match(result.personality.nucleus, /Inventor Cúmplice/)
  assert.match(result.personality.nucleus, /INDEPENDÊNCIA INTELECTUAL/)
  assert.match(result.personality.textAdapter, /conversa escrita/i)
  assert.match(result.personality.continuityAnchor, /Inventor Cúmplice/)
  assert.equal(result.personality.feedback.counts.totalVotes >= 0, true)
  assert.equal(result.personality.feedback.candidates.length >= 0, true)
})

test('operador expoe plano e historico da rodada de personalidade', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-personality-eval-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  try {
    const plan = executar(['eval-personalidade-plano'], env)
    assert.equal(plan.evaluation.candidate, 'omni-persona-v3-candidate')
    assert.equal(plan.evaluation.cases.length, 26)
    assert.deepEqual(plan.evaluation.pendingLearnedCandidates, [])

    const history = executar(['eval-personalidade-historico'], env)
    assert.deepEqual(history.runs, [])
    assert.equal(history.rawResponsesStored, false)

    const state = executar(['estado'], env)
    assert.equal(state.evaluation.personality.recordedRuns, 0)
    assert.equal(state.evaluation.personality.trustedPassedRuns, 0)
    assert.equal(state.evaluation.personality.unverifiedClaims, 0)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador expõe manutenção, consolidação e arquivo sem apagar histórico', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-gc-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  try {
    const first = executar(['lembrar', 'validar', 'o', 'build', 'antes', 'de', 'publicar'], env)
    const second = executar(['lembrar', 'validar', 'os', 'testes', 'antes', 'de', 'publicar'], env)
    const simulated = executar(['manutencao', 'simular'], env)
    assert.equal(simulated.maintenance.result, 'simulated')
    assert.equal(simulated.maintenance.permanentDeletions, 0)

    const consolidated = executar(
      [
        'consolidar',
        `${first.memory.memory.id},${second.memory.memory.id}`,
        'antes',
        'de',
        'publicar,',
        'validar',
        'build',
        'e',
        'testes'
      ],
      env
    )
    assert.equal(consolidated.memory.result, 'consolidated')
    const archive = executar(['arquivo'], env)
    assert.equal(archive.archived.length, 2)
    assert.ok(archive.archived.every((item) => item.action === 'consolidated'))
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador observa, lista e valida atalho sem promove-lo', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-shortcut-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  const observe = [
    'atalho-observar',
    '--objetivo', 'diagnosticar conexoes do Postgres',
    '--base', 'CPU > RAM > Processos > Postgres > Conexoes',
    '--atalho', 'Postgres > Conexoes'
  ]
  const shortcut = {
    goal: 'diagnosticar conexoes do Postgres',
    baselineSteps: ['CPU', 'RAM', 'Processos', 'Postgres', 'Conexoes'],
    shortcutSteps: ['Postgres', 'Conexoes'],
    scope: { type: 'user' }
  }
  const binding = vinculoVerificacaoAtalho(shortcut)
  const verificationCommand = `node --test testes/atalhos.test.mjs # omni-shortcut-binding:${binding}`
  try {
    const observations = []
    for (let index = 1; index <= 3; index += 1) {
      const evidence = await registrarVerificacaoCli(
        env.OMNI_HOME,
        `shortcut-${index}`,
        `2099-01-01T00:0${index}:00.000Z`,
        verificationCommand
      )
      observations.push(executar([
        ...observe,
        '--sessao', evidence.sessionId,
        '--execucao', evidence.executionId
      ], env))
    }
    const validatedAutomatically = observations.at(-1)
    assert.equal(validatedAutomatically.learning.result, 'validated')
    assert.equal(validatedAutomatically.learning.promotion, 'not-performed')

    const listed = executar(['atalhos'], env)
    assert.equal(listed.shortcuts.length, 1)
    assert.equal(listed.shortcuts[0].status, 'validated')
    assert.equal(listed.effectiveAfterFirstSuccess, true)
    assert.equal(listed.automaticPortablePromotion, false)

    const validationEvidence = await registrarVerificacaoCli(
      env.OMNI_HOME,
      'shortcut-validation',
      '2099-01-01T00:04:00.000Z',
      verificationCommand
    )
    const validated = executar([
      'atalho-validar', listed.shortcuts[0].id,
      '--sessao', validationEvidence.sessionId,
      '--execucao', validationEvidence.executionId
    ], env)
    assert.equal(validated.learning.result, 'validated')
    assert.equal(validated.learning.promotion, 'not-performed')
    assert.equal(validated.selfImprovement.status, 'evaluated')
    assert.equal(validated.selfImprovement.evaluationPassed, true)

    const improvements = executar(['melhorias'], env)
    assert.equal(improvements.proposals.length, 1)
    const approval = executar(
      ['melhoria-aprovar', improvements.proposals[0].id, '--portavel', '--aderente'],
      env
    )
    assert.equal(approval.improvement.status, 'approved')
    assert.equal(approval.improvement.portable, true)
    assert.equal(approval.improvement.roleFit, true)

    const state = executar(['estado'], env)
    assert.equal(state.learning.validated, 1)
    assert.equal(state.learning.effectiveAfterFirstSuccess, true)
    assert.equal(state.learning.automaticPortablePromotion, false)
    assert.equal(state.selfImprovement.approved, 1)
    assert.equal(state.selfImprovement.retracted, 0)
    assert.equal(state.selfImprovement.scope, 'new-capability-admission-only')
    assert.equal(state.selfImprovement.automaticCapabilityPromotion, false)
    assert.equal(state.selfImprovement.automaticOperationalCorrection, true)
    assert.equal(state.selfImprovement.automaticGitPushForCapability, false)
    assert.equal(state.operationalCycle.improvements.superseded, 0)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador aprende padrão de falha sem transformar ocorrência isolada em regra', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-failure-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  const failureArgs = (execution) => [
    'falha-registrar',
    '--agente', 'omni',
    '--acao', 'consultar disponibilidade do banco',
    '--classe', 'dependency',
    '--assinatura', 'ECONNREFUSED ao abrir conexao do Postgres',
    '--execucao', execution
  ]
  try {
    assert.equal(executar(failureArgs('execucao-1'), env).failure.status, 'observing')
    assert.equal(executar(failureArgs('execucao-2'), env).failure.status, 'observing')
    const candidate = executar(failureArgs('execucao-3'), env)
    assert.equal(candidate.failure.status, 'candidate')
    assert.equal(candidate.failure.occurrences, 3)

    const analyzed = executar([
      'falha-analisar', candidate.failure.id,
      '--causa', 'servico de banco ainda nao estava pronto',
      '--hipotese', 'aguardar healthcheck antes de abrir conexoes'
    ], env)
    assert.equal(analyzed.failure.status, 'analyzed')

    executar(['falhas'], env)
    const legacy = executar([
      'falha-automacao-reivindicar', '--executor', 'cli-test-failure-executor'
    ], env)
    assert.equal(legacy.automation.result, 'start-event-required')
    const dispatchSession = 'cli-real-failure-worker'
    await abrirTurnoAuditoria(env.OMNI_HOME, {
      session_id: dispatchSession,
      prompt: 'Inicie o subagente real para validar a falha.'
    })
    const dispatch = await prepararDespachoAutomaticoFalha(env.OMNI_HOME, {
      sessionId: dispatchSession,
      executorId: 'cli-host-model'
    })
    const started = await confirmarInicioAutomacaoFalha(env.OMNI_HOME, {
      sessionId: dispatchSession,
      delegationId: dispatch.delegation.id,
      agentId: 'cli-real-failure-agent'
    })
    assert.equal(started.result, 'started')
    const jobId = started.job.id

    const binding = executar(['falha-evidencias', candidate.failure.id, '--job', jobId], env)
    assert.match(binding.bindingMarker, /^omni-failure-binding:[a-f0-9]{64}$/)

    const verificationCommand = `node --test testes/falhas.test.mjs # ${binding.bindingMarker}`
    await registrarVerificacaoCli(env.OMNI_HOME, 'one', '2099-01-01T00:01:00.000Z', verificationCommand)
    await registrarVerificacaoCli(env.OMNI_HOME, 'two', '2099-01-01T00:02:00.000Z', verificationCommand)
    const available = executar(['falha-evidencias', candidate.failure.id, '--job', jobId], env)
    assert.equal(available.evidence.length, 2)
    assert.equal(JSON.stringify(available).includes('node --test'), false)

    const fixTest = (evidence) => [
      'falha-testar', candidate.failure.id,
      '--job', jobId,
      '--acao-auditoria', evidence.actionId,
      '--evidencia-auditoria', evidence.evidenceId,
      '--criterio', 'healthcheck passa e a consulta responde'
    ]
    assert.equal(executar(fixTest(available.evidence[0]), env).failure.status, 'testing')
    assert.equal(executar(fixTest(available.evidence[1]), env).failure.status, 'ready-for-eval')

    const evaluated = executar(['falha-avaliar', candidate.failure.id], env)
    assert.equal(evaluated.failure.status, 'evaluated')
    assert.equal(evaluated.selfImprovement.status, 'evaluated')
    assert.equal(evaluated.selfImprovement.category, 'failure-pattern')

    const state = executar(['estado'], env)
    assert.equal(state.failureLearning.evaluated, 1)
    assert.equal(state.failureLearning.automaticGlobalRule, false)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador expõe evals, checkpoints e backlog sem executar melhoria sozinho', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-governance-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  try {
    const suite = executar(['eval-suite'], env)
    assert.equal(suite.suite.id, 'omni-core-v1')
    assert.equal(suite.suite.target, 'omni')

    const discovery = executar([
      'descoberta-registrar',
      '--titulo', 'interface futura',
      '--motivo', 'fora do objetivo atual',
      '--origem', 'conversa'
    ], env)
    assert.equal(discovery.persistence.result, 'backlog')
    assert.equal(discovery.persistence.discovery.implemented, false)

    const backlog = executar(['backlog'], env)
    assert.equal(backlog.discoveries.length, 1)
    assert.equal(backlog.resolvedDiscoveries.length, 0)
    assert.equal(backlog.automaticImplementation, false)

    const resolved = executar([
      'descoberta-resolver', discovery.persistence.discovery.id,
      '--resolucao', 'implementada e verificada por teste automatizado'
    ], env)
    assert.equal(resolved.persistence.result, 'resolved')
    const after = executar(['backlog'], env)
    assert.equal(after.discoveries.length, 0)
    assert.equal(after.resolvedDiscoveries.length, 1)

    const state = executar(['estado'], env)
    assert.equal(state.evaluation.automaticExecution, true)
    assert.equal(state.evaluation.realBehavior.recordedRuns, 0)
    assert.equal(state.evaluation.realBehavior.passedRuns, 0)
    assert.equal(state.evaluation.personality.feedback.totalVotes, 0)
    assert.equal(state.evaluation.personality.feedback.rawConversationStored, false)
    assert.equal(state.systemAudit.recordedRuns, 0)
    assert.equal(state.structuredContext.rawConversationStored, false)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador publica briefing visivel com autoridade herdada sem persistir o prompt bruto', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-delegation-'))
  const home = join(raiz, 'home')
  const env = { ...process.env, OMNI_HOME: home }
  const prompt = 'Corrija o componente publico, rode os testes e devolva evidencia.'
  try {
    await abrirTurnoAuditoria(home, {
      session_id: 'sessao-publica-1',
      prompt: 'Delegue a correção do componente público.'
    })
    const prepared = executar([
      'delegacao-preparar',
      '--destino', 'executor-publico',
      '--prompt', prompt,
      '--sessao', 'sessao-publica-1',
      '--efeitos', 'editar|testar',
      '--risco', 'compensable',
      '--alcance', 'single-scoped-target',
      '--dados', 'project',
      '--modo', 'prepare-and-proceed'
    ], env)

    assert.equal(prepared.delegation.state, 'visible')
    assert.equal(prepared.delegation.visiblePromptConfirmed, true)
    assert.equal(prepared.delegation.authorityEnvelope.source, 'owner-intent')
    assert.equal(prepared.delegation.authorityEnvelope.inherited, true)
    assert.match(prepared.delegation.authorityEnvelope.turnFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(prepared.delegation.authorityEnvelope.effectFingerprints.length, 2)
    assert.equal(prepared.delegation.authorityEnvelope.risk.reversibility, 'compensable')
    assert.equal(prepared.dispatch.prompt, prompt)
    assert.equal(prepared.promptVisible, true)
    assert.equal(prepared.rawPromptPersistedInOmniState, false)

    const raw = await readFile(join(home, 'runs', 'operational-cycle.json'), 'utf8')
    assert.doesNotMatch(raw, /Corrija o componente publico|editar|testar/)

    const started = executar([
      'delegacao-estado', prepared.delegation.id, 'running',
      '--executor', 'executor-publico-1',
      '--evidencia', 'inicio-publico-1',
      '--checkpoint', 'checkpoint-publico-1',
      '--rollback', 'rollback-publico-1'
    ], env)
    assert.equal(started.delegation.id, prepared.delegation.id)
    assert.equal(started.delegation.state, 'running')

    const report = await registrarDelegacaoAuditoria(home, {
      session_id: 'sessao-publica-1',
      agent_id: 'executor-publico-1',
      agent_type: 'executor',
      agent_transcript_path: 'artefato-publico-1',
      cwd: home
    }, 'reported')
    executar([
      'delegacao-estado', prepared.delegation.id, 'reported',
      '--executor', 'executor-publico-1',
      '--evidencia', 'relato-publico-1',
      '--resumo', 'O executor entregou o relato.',
      '--acao-auditoria', report.action.id,
      '--evidencia-auditoria', report.evidence.id
    ], env)
    const readback = await registrarAcaoAuditoria(home, {
      hook_event_name: 'PostToolUse',
      session_id: 'sessao-publica-1',
      tool_use_id: 'readback-publico-1',
      tool_name: 'Read',
      tool_input: { file_path: 'artefato-publico-1' },
      cwd: home
    })
    const verified = executar([
      'delegacao-estado', prepared.delegation.id, 'verified',
      '--resumo', 'Artefato conferido depois do relato.',
      '--acao-auditoria', readback.action.id,
      '--evidencia-auditoria', readback.evidence.id
    ], env)
    assert.equal(verified.delegation.state, 'verified')
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador recusa owner-intent sem turno ativo da sessao informada', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-delegation-unbound-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  try {
    const run = spawnSync(process.execPath, [
      cli,
      'delegacao-preparar',
      '--destino', 'executor',
      '--prompt', 'Execute a tarefa.',
      '--sessao', 'sessao-inventada'
    ], { encoding: 'utf8', env })
    assert.notEqual(run.status, 0)
    assert.match(JSON.parse(run.stdout).error, /turno auditado ativo/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador encaminha fonte, pai, checkpoint e rollback pelo caminho publico', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-delegation-state-'))
  const home = join(raiz, 'home')
  const env = { ...process.env, OMNI_HOME: home }
  try {
    await abrirTurnoAuditoria(home, {
      session_id: 'sessao-publica-2',
      prompt: 'Continue a tarefa por uma delegação subordinada.'
    })
    const parent = await prepararDelegacao(home, {
      target: 'executor-pai',
      prompt: 'Execute o objetivo principal autorizado.',
      sessionId: 'sessao-publica-2',
      authority: { source: 'owner-intent', inherited: true }
    })
    const parentFingerprint = parent.delegation.authorityFingerprint
    const prepared = executar([
      'delegacao-preparar',
      '--destino', 'executor-herdado',
      '--prompt', 'Continue a tarefa subordinada dentro do escopo herdado.',
      '--sessao', 'sessao-publica-2',
      '--fonte', 'inherited-authority',
      '--pai', parentFingerprint
    ], env)
    assert.equal(prepared.delegation.authorityEnvelope.source, 'inherited-authority')
    assert.equal(prepared.delegation.authorityEnvelope.parentFingerprint, parentFingerprint)
    assert.equal(prepared.delegation.authorityEnvelope.inherited, true)

    const running = executar([
      'delegacao-estado', prepared.delegation.id, 'running',
      '--executor', 'executor-herdado-1',
      '--evidencia', 'subagent-start-public-2',
      '--checkpoint', 'snapshot-public-2',
      '--rollback', 'restore-snapshot-public-2'
    ], env)
    assert.equal(running.result, 'running')
    assert.equal(running.delegation.state, 'running')
    assert.match(running.delegation.checkpointFingerprint, /^[a-f0-9]{64}$/)
    assert.match(running.delegation.rollbackFingerprint, /^[a-f0-9]{64}$/)

    const raw = await readFile(join(home, 'runs', 'operational-cycle.json'), 'utf8')
    assert.doesNotMatch(raw, /snapshot-public-2|restore-snapshot-public-2|Continue a tarefa subordinada/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador reage a falha tecnica sem muro e reserva needs-owner para expansao concreta', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-proactive-failure-'))
  const home = join(raiz, 'home')
  const env = { ...process.env, OMNI_HOME: home }
  try {
    for (let index = 1; index <= 3; index += 1) {
      executar([
        'falha-registrar',
        '--agente', 'omni',
        '--acao', 'executar Bash',
        '--classe', 'permission',
        '--assinatura', 'permission denied na validacao local',
        '--execucao', `cli-proactive-${index}`
      ], env)
    }
    executar(['falhas'], env)
    const sessionId = 'cli-proactive-session'
    await abrirTurnoAuditoria(home, {
      session_id: sessionId,
      prompt: 'Valide e corrija a falha local.'
    })
    const firstDispatch = await prepararDespachoAutomaticoFalha(home, {
      sessionId,
      executorId: 'cli-proactive-host'
    })
    const firstStart = await confirmarInicioAutomacaoFalha(home, {
      sessionId,
      delegationId: firstDispatch.delegation.id,
      agentId: 'cli-proactive-agent-1'
    })

    const retry = executar([
      'falha-automacao-bloquear', firstStart.job.id,
      '--tipo', 'retryable',
      '--motivo', 'a busca inicial nao localizou a evidencia',
      '--evidencia', 'cli-audit-evidence-1',
      '--estrategia', 'buscar apenas pelo caminho antigo'
    ], env)
    assert.equal(retry.automation.result, 'retry-scheduled')

    const secondDispatch = await prepararDespachoAutomaticoFalha(home, {
      sessionId,
      executorId: 'cli-proactive-host'
    })
    const secondStart = await confirmarInicioAutomacaoFalha(home, {
      sessionId,
      delegationId: secondDispatch.delegation.id,
      agentId: 'cli-proactive-agent-2'
    })
    const owner = executar([
      'falha-automacao-bloquear', secondStart.job.id,
      '--tipo', 'owner-authority',
      '--motivo', 'a proxima etapa escreve fora do escopo local',
      '--efeito', 'remote-write',
      '--alvo', 'servico remoto fora do envelope atual'
    ], env)
    assert.equal(owner.automation.result, 'needs-owner')
    assert.equal(executar(['falhas'], env).automation.needsOwner, 1)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})
