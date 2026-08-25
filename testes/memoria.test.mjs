import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  caminhoDaMemoria,
  decidirCandidata,
  lembrarExplicitamente,
  lerMemoria,
  proporLicao
} from '../runtime/memoria.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-plugin-memory-'))
}

test('pedido explícito vira memória confirmada no runtime, não no plugin', async () => {
  const casa = await home()
  try {
    const result = await lembrarExplicitamente(casa, 'prefiro mapas antes de textos longos', 'preference')
    assert.equal(result.result, 'confirmed')
    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 1)
    assert.equal(memory.candidates.length, 0)
    assert.equal(memory.confirmed[0].scope.type, 'user')
    assert.equal(memory.confirmed[0].confidence, 1)
    assert.match(caminhoDaMemoria(casa), /memory[\\/]memory\.json$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('lição nasce candidata e só entra confirmada após decisão humana', async () => {
  const casa = await home()
  try {
    const proposal = await proporLicao(casa, 'não promover uma falha isolada como regra')
    assert.equal(proposal.result, 'candidate')
    let memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 0)
    assert.equal(memory.candidates.length, 1)
    const decision = await decidirCandidata(casa, proposal.memory.id, 'confirm')
    assert.equal(decision.result, 'confirmed')
    memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 1)
    assert.equal(memory.candidates.length, 0)
    assert.equal(memory.confirmed[0].evidence.at(-1).kind, 'human-confirmation')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('segredo aparente é recusado antes de criar arquivo', async () => {
  const casa = await home()
  try {
    const segredoSintetico = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-')
    const result = await lembrarExplicitamente(casa, `minha api key é ${segredoSintetico}`)
    assert.equal(result.result, 'refused')
    await assert.rejects(readFile(caminhoDaMemoria(casa), 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('escritas concorrentes preservam JSON válido e não perdem registros', async () => {
  const casa = await home()
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        lembrarExplicitamente(casa, `fato concorrente número ${index}`)
      )
    )
    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 12)
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(memory)))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
