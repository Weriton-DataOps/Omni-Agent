import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  atualizarMemoria,
  caminhoDaMemoria,
  consolidarMemorias,
  decidirCandidata,
  executarManutencaoMemoria,
  lembrarExplicitamente,
  lerMemoria,
  marcarMemoriaObsoleta,
  proporLicao
} from '../runtime/memoria.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-memory-gc-'))
}

async function editarStore(casa, edit) {
  const path = caminhoDaMemoria(casa)
  const memory = JSON.parse(await readFile(path, 'utf8'))
  edit(memory)
  await writeFile(path, `${JSON.stringify(memory, null, 2)}\n`, 'utf8')
}

test('manutenção arquiva expiradas e candidatas fracas sem tocar confirmada permanente', async () => {
  const casa = await home()
  try {
    const permanent = await lembrarExplicitamente(casa, 'prefiro mapas antes de textos longos', 'preference')
    const expiring = await lembrarExplicitamente(casa, 'esta regra vale somente até o prazo definido')
    const stale = await proporLicao(casa, 'validar este caso episódico antes de repetir')
    await editarStore(casa, (memory) => {
      memory.store.lastMaintenanceAt = '2029-12-31T00:00:00.000Z'
      memory.confirmed.find((item) => item.id === expiring.memory.id).expiresAt = '2029-12-31T23:00:00.000Z'
      const candidate = memory.candidates.find((item) => item.id === stale.memory.id)
      candidate.updatedAt = '2029-01-01T00:00:00.000Z'
      candidate.importance = 0.5
    })

    const result = await executarManutencaoMemoria(casa, { now: '2030-01-01T00:00:00.000Z' })
    assert.equal(result.permanentDeletions, 0)
    assert.deepEqual(result.actions.map((item) => item.action).sort(), ['expired', 'stale-candidate'])
    const memory = await lerMemoria(casa)
    assert.deepEqual(memory.confirmed.map((item) => item.id), [permanent.memory.id])
    assert.equal(memory.candidates.length, 0)
    assert.equal(memory.archive.length, 2)
    assert.ok(memory.archive.every((item) => item.snapshot.text.length > 0))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('descarte explícito de candidata fica auditável no arquivo', async () => {
  const casa = await home()
  try {
    const candidate = await proporLicao(casa, 'não transformar falha isolada em procedimento')
    const result = await decidirCandidata(casa, candidate.memory.id, 'discard')
    assert.equal(result.archived, true)
    const memory = await lerMemoria(casa)
    assert.equal(memory.candidates.length, 0)
    assert.equal(memory.archive[0].action, 'discarded')
    assert.equal(memory.archive[0].snapshot.id, candidate.memory.id)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('atualização cria substituto e obsolescência retira somente a versão ativa', async () => {
  const casa = await home()
  try {
    const original = await lembrarExplicitamente(casa, 'prefiro texto antes de mapas', 'preference')
    const updated = await atualizarMemoria(casa, original.memory.id, 'prefiro mapas antes de textos longos')
    assert.equal(updated.result, 'updated')
    assert.notEqual(updated.memory.id, original.memory.id)
    let memory = await lerMemoria(casa)
    assert.equal(memory.archive[0].action, 'updated')
    assert.equal(memory.archive[0].replacementId, updated.memory.id)

    const obsolete = await marcarMemoriaObsoleta(casa, updated.memory.id, 'preferência substituída pelo proprietário')
    assert.equal(obsolete.result, 'obsolete')
    memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 0)
    assert.deepEqual(memory.archive.map((item) => item.action), ['updated', 'obsolete'])
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('duplicata exata é consolidada automaticamente sem perder evidência', async () => {
  const casa = await home()
  try {
    const original = await lembrarExplicitamente(casa, 'sempre validar antes de publicar', 'procedural')
    await editarStore(casa, (memory) => {
      const duplicate = structuredClone(memory.confirmed[0])
      duplicate.id = 'mem-duplicate-test'
      duplicate.occurrences = 3
      duplicate.usageCount = 2
      memory.confirmed.push(duplicate)
      memory.store.lastMaintenanceAt = '2029-12-31T00:00:00.000Z'
    })
    const result = await executarManutencaoMemoria(casa, { now: '2030-01-01T00:00:00.000Z' })
    assert.equal(result.actions[0].action, 'consolidated')
    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 1)
    assert.equal(memory.confirmed[0].id, original.memory.id)
    assert.equal(memory.confirmed[0].occurrences, 4)
    assert.equal(memory.confirmed[0].usageCount, 2)
    assert.equal(memory.archive[0].replacementId, original.memory.id)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('semelhança aproximada gera proposta mas não funde memórias sozinha', async () => {
  const casa = await home()
  try {
    const first = await lembrarExplicitamente(casa, 'sempre validar o resultado antes de publicar', 'procedural')
    const second = await lembrarExplicitamente(casa, 'sempre validar o resultado final antes de publicar', 'procedural')
    const result = await executarManutencaoMemoria(casa, { now: '2030-01-01T00:00:00.000Z' })
    assert.equal(result.actions.length, 0)
    assert.equal(result.consolidationProposals.length, 1)
    assert.deepEqual(new Set(result.consolidationProposals[0].memoryIds), new Set([first.memory.id, second.memory.id]))
    assert.equal((await lerMemoria(casa)).confirmed.length, 2)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('consolidação explícita cria padrão confirmado e arquiva as fontes', async () => {
  const casa = await home()
  try {
    const first = await lembrarExplicitamente(casa, 'validar o build antes da publicação', 'procedural')
    const second = await lembrarExplicitamente(casa, 'validar os testes antes da publicação', 'procedural')
    const result = await consolidarMemorias(
      casa,
      [first.memory.id, second.memory.id],
      'antes de publicar, validar build e testes',
      'procedural'
    )
    assert.equal(result.result, 'consolidated')
    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 1)
    assert.equal(memory.confirmed[0].id, result.memory.id)
    assert.equal(memory.confirmed[0].occurrences, 2)
    assert.equal(memory.archive.length, 2)
    assert.ok(memory.archive.every((item) => item.replacementId === result.memory.id))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
