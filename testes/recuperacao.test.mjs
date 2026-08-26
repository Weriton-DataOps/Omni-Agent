import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { montarContexto } from '../runtime/contexto.mjs'
import { lembrarExplicitamente, lerMemoria } from '../runtime/memoria.mjs'
import { ranquearMemorias } from '../runtime/recuperacao.mjs'

const NOW = Date.parse('2026-08-25T12:00:00.000Z')

function memory(id, text, overrides = {}) {
  return {
    id,
    type: 'semantic',
    scope: { type: 'user' },
    projectId: null,
    text,
    status: 'confirmed',
    confidence: 0.8,
    importance: 0.6,
    occurrences: 1,
    usageCount: 0,
    updatedAt: '2026-08-24T12:00:00.000Z',
    lastValidatedAt: '2026-08-24T12:00:00.000Z',
    expiresAt: null,
    ...overrides
  }
}

test('conceitos locais ligam mapa a diagrama sem chamada externa', async () => {
  const result = await ranquearMemorias(
    [memory('mem-diagrama', 'prefiro diagramas para visualizar escolhas', { type: 'preference' })],
    { intent: 'mostre um mapa do plano', now: NOW }
  )
  assert.equal(result.algorithm, 'hybrid-local-v1')
  assert.equal(result.ranked[0].memory.id, 'mem-diagrama')
  assert.ok(result.ranked[0].components.semantic > 0)
})

test('metadados fortes não promovem memória sem relação com a intenção', async () => {
  const result = await ranquearMemorias(
    [
      memory('mem-irrelevante', 'o café preferido é sem açúcar', {
        confidence: 1,
        importance: 1,
        occurrences: 20,
        usageCount: 30
      })
    ],
    { intent: 'como validar o plugin?', now: NOW }
  )
  assert.equal(result.ranked.length, 0)
  assert.deepEqual(result.excluded, [
    { id: 'mem-irrelevante', reason: 'below-intent-threshold' }
  ])
})

test('escopo de projeto diferente é excluído antes do ranking', async () => {
  const result = await ranquearMemorias(
    [
      memory('mem-projeto-certo', 'o projeto usa mapas', {
        scope: { type: 'project', id: 'omni' },
        projectId: 'omni'
      }),
      memory('mem-projeto-errado', 'o projeto usa mapas', {
        scope: { type: 'project', id: 'outro' },
        projectId: 'outro'
      })
    ],
    { intent: 'mapa do projeto', projectId: 'omni', now: NOW }
  )
  assert.deepEqual(result.ranked.map((entry) => entry.memory.id), ['mem-projeto-certo'])
  assert.deepEqual(result.excluded, [
    { id: 'mem-projeto-errado', reason: 'scope-mismatch' }
  ])
})

test('recência, frequência, confiança e importância participam da ordem', async () => {
  const result = await ranquearMemorias(
    [
      memory('mem-fraca', 'o plugin precisa de teste', {
        confidence: 0.4,
        importance: 0.3,
        occurrences: 1,
        updatedAt: '2025-01-01T00:00:00.000Z',
        lastValidatedAt: '2025-01-01T00:00:00.000Z'
      }),
      memory('mem-forte', 'o plugin precisa de teste', {
        confidence: 1,
        importance: 0.9,
        occurrences: 8,
        usageCount: 4
      })
    ],
    { intent: 'teste do plugin', now: NOW }
  )
  assert.deepEqual(result.ranked.map((entry) => entry.memory.id), ['mem-forte', 'mem-fraca'])
  assert.ok(result.ranked[0].score > result.ranked[1].score)
})

test('fast é subconjunto do mesmo ranking deep e uso selecionado é contado', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-retrieval-'))
  try {
    const saved = await lembrarExplicitamente(
      home,
      'prefiro diagramas para visualizar escolhas',
      'preference'
    )
    const context = await montarContexto(home, { intent: 'mostre um mapa do plano' })
    const fast = context.retrieval.selected.fast.map((entry) => entry.id)
    const deep = context.retrieval.selected.deep.map((entry) => entry.id)
    assert.equal(context.schemaVersion, 3)
    assert.ok(fast.every((id) => deep.includes(id)))
    assert.equal(deep[0], saved.memory.id)
    assert.equal(JSON.stringify(context.retrieval).includes(saved.memory.text), false)

    const stored = await lerMemoria(home)
    assert.equal(stored.confirmed.find((item) => item.id === saved.memory.id).usageCount, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
