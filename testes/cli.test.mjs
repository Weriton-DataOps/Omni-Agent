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

    const state = executar(['estado'], env)
    assert.equal(state.learning.validated, 1)
    assert.equal(state.learning.automaticPromotion, false)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})
