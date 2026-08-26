import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  atualizarDelegacao,
  lerCicloOperacional,
  prepararDelegacao,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import {
  configurarRepositorioCanonico,
  lerRepositorioCanonico,
  materializarMelhoriaConfigurada
} from '../runtime/evolucao.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-cycle-'))
}

test('delegação percorre prompt visível, execução, evidência e fechamento', async () => {
  const casa = await home()
  try {
    const prepared = await prepararDelegacao(casa, {
      target: 'sessao do projeto X',
      prompt: 'Implemente a correção, rode os testes e mostre a evidência.',
      sessionId: 'main-1'
    })
    const id = prepared.delegation.id
    await atualizarDelegacao(casa, id, 'visible')
    await atualizarDelegacao(casa, id, 'running')
    const completed = await atualizarDelegacao(casa, id, 'completed', {
      summary: 'Correção aplicada e testes verdes.',
      evidence: 'run-123'
    })
    assert.equal(completed.delegation.visiblePromptConfirmed, true)
    assert.match(completed.delegation.evidenceFingerprint, /^[a-f0-9]{64}$/)
    await atualizarDelegacao(casa, id, 'closed')
    const store = await lerCicloOperacional(casa)
    assert.equal(store.delegations[0].state, 'closed')
    assert.equal(JSON.stringify(store).includes('Implemente a correção, rode os testes'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('melhoria repetida escolhe artefato coerente em vez de criar skill para tudo', async () => {
  const casa = await home()
  const repo = await mkdtemp(join(tmpdir(), 'omni-source-'))
  try {
    await mkdir(join(repo, '.git'))
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'eval'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }))
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({ schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: [] }))
    await writeFile(join(repo, 'contratos', 'operacao', 'procedimentos-aprendidos.json'), JSON.stringify({ schemaVersion: 1, contract: 'omni-learned-procedures-v1', procedures: [] }))
    await writeFile(join(repo, 'contratos', 'eval', 'casos-aprendidos.json'), JSON.stringify({ schemaVersion: 1, contract: 'omni-learned-eval-cases-v1', cases: [] }))

    const input = {
      category: 'owner-correction',
      destination: 'operational-rule',
      statement: 'Exibir o prompt completo na sessão de destino.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    assert.equal(ready.candidate.status, 'ready')
    await configurarRepositorioCanonico(casa, repo)
    assert.equal((await lerRepositorioCanonico(casa)).sourceRepository, repo)
    const result = await materializarMelhoriaConfigurada(casa, ready.candidate.id)
    assert.equal(result.result, 'materialized')
    const rules = JSON.parse(await readFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), 'utf8'))
    assert.equal(rules.rules.length, 1)
    assert.equal(rules.rules[0].destination, 'operational-rule')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})
