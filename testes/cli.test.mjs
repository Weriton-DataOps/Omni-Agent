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
