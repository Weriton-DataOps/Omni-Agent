import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { caminhoDaMemoria, decidirCandidata, lerMemoria } from '../runtime/memoria.mjs'
import { analisarExperiencia, processarExperiencia } from '../runtime/pipeline-memoria.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-memory-pipeline-'))
}

test('conversa comum não vira memória', () => {
  const result = analisarExperiencia('Como funciona um buraco negro?')
  assert.equal(result.result, 'discarded')
  assert.equal(result.reason, 'no-memory-signal')
})

test('extração guarda somente a frase persistente, não o pedido inteiro', () => {
  const result = analisarExperiencia(
    'Tenho duas observações sobre o teste. Prefiro mapas antes de explicações longas. Pode continuar?'
  )
  assert.equal(result.result, 'validated')
  assert.equal(result.text, 'Prefiro mapas antes de explicações longas.')
})

test('instrução temporária é classificada como transitória', () => {
  const result = analisarExperiencia('Só nesta sessão, prefiro respostas sem analogias.')
  assert.equal(result.result, 'transient')
  assert.equal(result.reason, 'explicitly-transient')
})

test('preferência persistente percorre o pipeline e nasce candidata', async () => {
  const casa = await home()
  try {
    const result = await processarExperiencia(
      casa,
      'Prefiro explicações curtas com uma analogia concreta.'
    )
    assert.equal(result.result, 'candidate')
    assert.equal(result.classification, 'preference')
    assert.ok(result.score >= 0.6)
    assert.equal(result.memory.validation.status, 'validated')
    assert.equal(result.memory.occurrences, 1)

    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 0)
    assert.equal(memory.candidates.length, 1)
    assert.equal(memory.candidates[0].importance, 0.75)

    await decidirCandidata(casa, result.memory.id, 'confirm')
    const confirmed = await lerMemoria(casa)
    assert.equal(confirmed.confirmed[0].validation.status, 'confirmed')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('repetição consolida evidência em vez de criar outra candidata', async () => {
  const casa = await home()
  const text = 'Quando eu disser comando, responda com uma instrução curta.'
  try {
    const first = await processarExperiencia(casa, text)
    const second = await processarExperiencia(casa, text)
    assert.equal(first.result, 'candidate')
    assert.equal(second.result, 'reinforced')
    assert.equal(second.memory.occurrences, 2)
    const memory = await lerMemoria(casa)
    assert.equal(memory.candidates.length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('segredo é recusado antes de criar o store', async () => {
  const casa = await home()
  try {
    const synthetic = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_')
    const result = await processarExperiencia(casa, `Lembre que meu token é ${synthetic}`)
    assert.equal(result.result, 'refused')
    await assert.rejects(readFile(caminhoDaMemoria(casa), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
