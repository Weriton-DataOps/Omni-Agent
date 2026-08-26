import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const cli = fileURLToPath(new URL('../runtime/cli.mjs', import.meta.url))

function executar(args, env) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

test('operador lista e decide candidata criada pelo pipeline', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-cli-'))
  const env = { ...process.env, OMNI_HOME: join(raiz, 'home') }
  try {
    const experience = executar(
      ['experiencia', 'Prefiro', 'mapas', 'antes', 'de', 'textos', 'longos.'],
      env
    )
    assert.equal(experience.pipeline.result, 'candidate')

    const candidates = executar(['candidatas'], env)
    assert.equal(candidates.candidates.length, 1)
    assert.equal(candidates.candidates[0].type, 'preference')

    const decision = executar(['confirmar', candidates.candidates[0].id], env)
    assert.equal(decision.memory.result, 'confirmed')
    assert.equal(executar(['candidatas'], env).candidates.length, 0)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('operador entrega a personalidade escolhida pelo manifesto', () => {
  const result = executar(['personalidade'], process.env)
  assert.equal(result.personality.id, 'omni-persona-v2-candidate')
  assert.match(result.personality.nucleus, /NÃO ANUNCIE/)
  assert.doesNotMatch(result.personality.nucleus, /deixe claro onde a analogia termina/)
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
    '--atalho', 'Postgres > Conexoes',
    '--resultado', 'gargalo de conexoes confirmado'
  ]
  try {
    executar(observe, env)
    executar(observe, env)
    const candidate = executar(observe, env)
    assert.equal(candidate.learning.result, 'candidate')
    assert.equal(candidate.learning.promotion, 'not-performed')

    const listed = executar(['atalhos'], env)
    assert.equal(listed.shortcuts.length, 1)
    assert.equal(listed.shortcuts[0].status, 'candidate')
    assert.equal(listed.automaticPromotion, false)

    const validated = executar([
      'atalho-validar', listed.shortcuts[0].id,
      '--resultado', 'gargalo de conexoes confirmado'
    ], env)
    assert.equal(validated.learning.result, 'validated')
    assert.equal(validated.learning.promotion, 'not-performed')
    assert.equal(validated.selfImprovement.status, 'evaluated')
    assert.equal(validated.selfImprovement.evaluationPassed, true)

    const improvements = executar(['melhorias'], env)
    assert.equal(improvements.proposals.length, 1)
    const approval = executar(
      ['melhoria-aprovar', improvements.proposals[0].id, '--portavel'],
      env
    )
    assert.equal(approval.improvement.status, 'approved')
    assert.equal(approval.improvement.portable, true)

    const state = executar(['estado'], env)
    assert.equal(state.learning.validated, 1)
    assert.equal(state.learning.automaticPromotion, false)
    assert.equal(state.selfImprovement.approved, 1)
    assert.equal(state.selfImprovement.automaticGitPush, false)
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

    const fixTest = (execution) => [
      'falha-testar', candidate.failure.id,
      '--execucao', execution,
      '--resultado', 'healthcheck passou e a consulta respondeu'
    ]
    assert.equal(executar(fixTest('teste-1'), env).failure.status, 'testing')
    assert.equal(executar(fixTest('teste-2'), env).failure.status, 'ready-for-eval')

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
    assert.equal(backlog.automaticImplementation, false)

    const state = executar(['estado'], env)
    assert.equal(state.evaluation.automaticExecution, false)
    assert.equal(state.structuredContext.rawConversationStored, false)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})
