import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { processarExperiencia } from '../runtime/pipeline-memoria.mjs'
import { lembrarExplicitamente, lerMemoria } from '../runtime/memoria.mjs'
import { durableScopeId, sincronizarMemoriaDuravel } from '../runtime/sincronizacao-memoria-duravel.mjs'
import { ranquearMemorias } from '../runtime/recuperacao.mjs'

test('preferência importante percorre captura, persistência, releitura e recuperação', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-durable-memory-'))
  try {
    const text = 'Prefiro respostas curtas e direcionadas à resolução, com textos longos quando necessários, importantes ou solicitados.'
    assert.equal((await processarExperiencia(casa, text)).result, 'confirmed')
    const imports = []
    const broker = { importMemoryBatch: async value => { imports.push(value); return 'applied' } }
    const first = await sincronizarMemoriaDuravel(casa, { broker })
    assert.equal(first.result, 'synced'); assert.equal(first.batches, 1)
    assert.equal(imports[0].entries[0].payload.text, text)
    const second = await sincronizarMemoriaDuravel(casa, { broker })
    assert.equal(second.skipped, 1); assert.equal(imports.length, 1)
    const memory = await lerMemoria(casa)
    const retrieval = await ranquearMemorias(memory.confirmed, { intent: 'Como devo responder? Prefiro resumo da causa e solução.' })
    assert.match(JSON.stringify(retrieval), new RegExp(memory.confirmed[0].id))
    await sincronizarMemoriaDuravel(casa, { broker, force: true })
    assert.equal(imports.length, 2)
  } finally { await rm(casa, { recursive: true, force: true }) }
})
test('escopo com pasta não bloqueia gravação e permanece no payload', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-durable-scope-'))
  try {
    const path = 'C:\\Projetos\\Tracking'
    await lembrarExplicitamente(casa, 'O ambiente de teste é o projeto Tracking.', 'semantic', { type: 'project', id: path })
    let captured
    assert.equal((await sincronizarMemoriaDuravel(casa, { broker: { importMemoryBatch: async input => { captured = input.entries[0]; return 'applied' } } })).result, 'synced')
    assert.match(captured.scopeId, /^scope-[a-f0-9]+$/)
    assert.equal(captured.payload.scope.id, path)
    assert.equal(durableScopeId(path), durableScopeId('c:/projetos/tracking'))
  } finally { await rm(casa, { recursive: true, force: true }) }
})
test('falha individual não impede as demais memórias e volta à fila', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-durable-retry-'))
  try {
    await lembrarExplicitamente(casa, 'Prefiro resultados com evidências verificáveis.', 'preference')
    await lembrarExplicitamente(casa, 'Prefiro decisões objetivas e solução recomendada.', 'preference')
    let calls = 0
    const first = await sincronizarMemoriaDuravel(casa, { broker: { importMemoryBatch: async () => { if (++calls === 1) throw new Error('offline'); return 'applied' } } })
    assert.equal(first.result, 'partial'); assert.equal(first.failed, 1); assert.equal(first.batches, 1)
    const recovered = await sincronizarMemoriaDuravel(casa, { broker: { importMemoryBatch: async () => 'duplicate' } })
    assert.equal(recovered.result, 'synced'); assert.equal(recovered.skipped, 1); assert.equal(recovered.batches, 1)
  } finally { await rm(casa, { recursive: true, force: true }) }
})
