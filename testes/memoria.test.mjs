import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  MEMORY_SCHEMA_VERSION,
  caminhoDaMemoria,
  decidirCandidata,
  lembrarExplicitamente,
  lerMemoria,
  prepararMemoria,
  proporLicao
} from '../runtime/memoria.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-plugin-memory-'))
}

test('primeira ativacao cria a memoria local atual e as seguintes preservam a casa', async () => {
  const casa = await home()
  try {
    const primeira = await prepararMemoria(casa)
    assert.equal(primeira.result, 'initialized')
    assert.equal(primeira.schemaVersion, MEMORY_SCHEMA_VERSION)
    assert.equal(primeira.memory.store.id, 'omni-local-memory')

    const criada = JSON.parse(await readFile(caminhoDaMemoria(casa), 'utf8'))
    const segunda = await prepararMemoria(casa)
    assert.equal(segunda.result, 'ready')
    assert.equal(segunda.memory.store.createdAt, criada.store.createdAt)
    assert.equal(segunda.memory.store.lastMigrationAt, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('atualizacao migra memoria v1 ate a versao atual sem perder registros', async () => {
  const casa = await home()
  const arquivo = caminhoDaMemoria(casa)
  const instante = '2026-08-25T12:00:00.000Z'
  const registro = {
    id: 'mem-v1-test',
    type: 'preference',
    scope: { type: 'user' },
    text: 'prefiro mapas antes de textos longos',
    source: 'legacy-test',
    status: 'confirmed',
    confidence: 1,
    evidence: [{ kind: 'explicit-request', recordedAt: instante }],
    createdAt: instante,
    updatedAt: instante,
    lastValidatedAt: instante,
    usageCount: 2,
    expiresAt: null
  }
  try {
    await mkdir(dirname(arquivo), { recursive: true })
    await writeFile(
      arquivo,
      `${JSON.stringify({ schemaVersion: 1, confirmed: [registro], candidates: [] }, null, 2)}\n`,
      'utf8'
    )

    const resultado = await prepararMemoria(casa)
    assert.equal(resultado.result, 'migrated')
    assert.equal(resultado.migratedFrom, 1)
    assert.equal(resultado.schemaVersion, MEMORY_SCHEMA_VERSION)
    assert.equal(resultado.memory.confirmed[0].id, registro.id)
    assert.equal(resultado.memory.confirmed[0].text, registro.text)
    assert.deepEqual(resultado.memory.confirmed[0].evidence, registro.evidence)
    assert.equal(resultado.memory.confirmed[0].occurrences, 1)
    assert.equal(resultado.memory.confirmed[0].validation.status, 'confirmed')
    assert.equal(resultado.memory.confirmed[0].projectId, null)
    assert.equal(resultado.memory.store.createdAt, instante)
    assert.ok(resultado.memory.store.lastMigrationAt)
    assert.equal(resultado.migrationBackupCreated, true)

    const backups = (await readdir(dirname(arquivo))).filter((name) => name.endsWith('.backup'))
    assert.equal(backups.length, 1)
    assert.equal(await readFile(join(dirname(arquivo), backups[0]), 'utf8'), `${JSON.stringify({ schemaVersion: 1, confirmed: [registro], candidates: [] }, null, 2)}\n`)

    const persistida = JSON.parse(await readFile(arquivo, 'utf8'))
    assert.equal(persistida.schemaVersion, MEMORY_SCHEMA_VERSION)
    assert.equal(persistida.confirmed.length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('plugin antigo recusa memoria de versao futura sem sobrescreve-la', async () => {
  const casa = await home()
  const arquivo = caminhoDaMemoria(casa)
  const futura = '{"schemaVersion":99,"sentinel":"preservar"}\n'
  try {
    await mkdir(dirname(arquivo), { recursive: true })
    await writeFile(arquivo, futura, 'utf8')
    await assert.rejects(prepararMemoria(casa), /mais nova que este plugin/)
    assert.equal(await readFile(arquivo, 'utf8'), futura)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

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
    assert.equal(memory.confirmed[0].validation.status, 'confirmed')
    assert.equal(memory.confirmed[0].occurrences, 1)
    assert.match(caminhoDaMemoria(casa), /memory[\\/]memory\.json$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('evidencia repetida reforca o registro sem criar duplicata', async () => {
  const casa = await home()
  try {
    const primeira = await proporLicao(casa, 'sempre validar o resultado antes de publicar')
    const segunda = await proporLicao(casa, 'sempre validar o resultado antes de publicar')
    assert.equal(primeira.result, 'candidate')
    assert.equal(segunda.result, 'reinforced')
    const memory = await lerMemoria(casa)
    assert.equal(memory.candidates.length, 1)
    assert.equal(memory.candidates[0].occurrences, 2)
    assert.equal(memory.candidates[0].evidence.length, 2)
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
