import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeActivationStore } from '../dist/adapters/claude/activation-store.js'
import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'
import { tratarHook } from '../runtime/hook-contexto.mjs'
import { lembrarExplicitamente, lerMemoria } from '../runtime/memoria.mjs'
import { montarContexto } from '../runtime/contexto.mjs'

test('consulta interna recupera contexto sem aprender instruções sintéticas como fala do proprietário', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-context-only-'))
  const original = NodeAccessBrokerClient.prototype.listActiveMissions
  NodeAccessBrokerClient.prototype.listActiveMissions = async () => []
  try {
    const input = { hook_event_name: 'UserPromptSubmit', session_id: 'test-context-only', cwd: home, prompt: 'Prefiro que toda resposta futura contenha a palavra SINTETICO.' }
    const env = { ...process.env, OMNI_HOME: home }
    await new ClaudeActivationStore(home, env).activate(input, { persistScope: true })
    const result = await tratarHook(input, env, { contextOnly: true })
    assert.ok(result.hookSpecificOutput.additionalContext)
    assert.equal(result.hookSpecificOutput.omniMetadata.persistence, undefined)
    const memory = await lerMemoria(home)
    assert.equal(memory.confirmed.length, 0)
    assert.equal(memory.candidates.length, 0)
  } finally {
    NodeAccessBrokerClient.prototype.listActiveMissions = original
    await rm(home, { recursive: true, force: true })
  }
})
test('uso conta somente memórias presentes na projeção realmente escolhida', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-applied-memory-'))
  const original = NodeAccessBrokerClient.prototype.listActiveMissions
  NodeAccessBrokerClient.prototype.listActiveMissions = async () => []
  try {
    for (let i = 0; i < 8; i++) await lembrarExplicitamente(home, `O formulário de cadastro possui o campo validado exemplo${i}.`, 'semantic')
    const context = await montarContexto(home, { intent: 'Qual o campo do formulário de cadastro?' })
    assert.equal(context.routing.selected, 'fast')
    const actual = context.projections.fast.selected.filter(id => id.startsWith('mem-'))
    assert.ok(actual.length > 0 && actual.length < 8)
    const memory = await lerMemoria(home)
    for (const item of memory.confirmed) assert.equal(item.usageCount, actual.includes(item.id) ? 1 : 0)
    assert.deepEqual(context.retrieval.applied.fast.map(item => item.id), actual)
  } finally {
    NodeAccessBrokerClient.prototype.listActiveMissions = original
    await rm(home, { recursive: true, force: true })
  }
})
