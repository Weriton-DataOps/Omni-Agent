import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  adaptarInicioSubagenteClaude,
  registrarAcaoSubagenteClaude,
  registrarEntregaClaude
} from '../runtime/adaptador-claude-delegacao.mjs'
import { abrirTurnoAuditoria, lerAuditoriaAutocorrecao } from '../runtime/auditoria-autocorrecao.mjs'
import { criarSolicitacaoDelegacao } from '../runtime/porta-delegacao.mjs'

const home = () => mkdtemp(join(tmpdir(), 'omni-acao-subagente-'))

function request(sessionId, suffix) {
  return {
    sessionId,
    idempotencyKey: `sub-action-${suffix}`,
    destinationCapability: `capability-${suffix}`,
    brief: { objective: `Executar ${suffix}`, scope: [`scope-${suffix}`], constraints: ['preservar privacidade'], successCriteria: ['devolver evidencia'] },
    effectClasses: ['read', 'execute'],
    risk: { reversibility: 'reversible', reach: 'local-isolated', data: 'project', mode: 'proceed' }
  }
}

async function startedDelegation(casa, sessionId, suffix, agentId) {
  const created = await criarSolicitacaoDelegacao(casa, request(sessionId, suffix))
  await registrarEntregaClaude(casa, created.request, { source: `sub-action-${suffix}` })
  await adaptarInicioSubagenteClaude(casa, {
    session_id: sessionId,
    delegation_id: created.request.delegationId,
    agent_id: agentId,
    agent_type: 'general-purpose',
    cwd: 'C:\\repo'
  })
  return created.request.delegationId
}

const toolEvent = (sessionId, agentId, id) => ({
  hook_event_name: 'PostToolUse',
  session_id: sessionId,
  agent_id: agentId,
  agent_type: 'general-purpose',
  tool_use_id: id,
  tool_name: 'Bash',
  tool_input: { command: 'node --test verificacao.test.mjs', cwd: 'C:\\repo' }
})

// Conta apenas acoes de ferramenta; o proprio inicio da delegacao grava uma acao de efeito 'delegation'.
async function toolActionCount(casa) {
  const store = await lerAuditoriaAutocorrecao(casa)
  const turn = store.turns.at(-1)
  return (turn?.actions ?? []).filter((action) => action.effect !== 'delegation').length
}

test('acao de executor delegado correlacionado entra no ledger', async () => {
  const casa = await home()
  const sessionId = 'sub-action-session'
  try {
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'Delegue a validacao e acompanhe.' })
    assert.equal(await toolActionCount(casa), 0)

    const delegationId = await startedDelegation(casa, sessionId, 'ok', 'claude-agent-ok')
    const registered = await registrarAcaoSubagenteClaude(casa, toolEvent(sessionId, 'claude-agent-ok', 'sub-tool-1'))

    assert.notEqual(registered.result, 'uncorrelated')
    assert.notEqual(registered.result, 'ignored')
    assert.equal(registered.delegationId, delegationId)
    assert.equal(await toolActionCount(casa), 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('executor sem delegacao viva nao deixa rastro no ledger', async () => {
  const casa = await home()
  const sessionId = 'sub-action-uncorrelated'
  try {
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'Delegue a validacao e acompanhe.' })
    await startedDelegation(casa, sessionId, 'ok', 'claude-agent-ok')
    const before = await toolActionCount(casa)

    const stray = await registrarAcaoSubagenteClaude(casa, toolEvent(sessionId, 'claude-agent-desconhecido', 'sub-tool-stray'))
    assert.equal(stray.result, 'uncorrelated')
    assert.equal(stray.action, null)
    assert.equal(stray.delegationId, null)
    assert.equal(await toolActionCount(casa), before)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('executor sem agent_id e ignorado sem erro', async () => {
  const casa = await home()
  const sessionId = 'sub-action-noagent'
  try {
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'Trabalho local do proprietario.' })
    const result = await registrarAcaoSubagenteClaude(casa, { hook_event_name: 'PostToolUse', session_id: sessionId, tool_use_id: 'x', tool_name: 'Read', tool_input: { file_path: 'a.md' } })
    assert.equal(result.result, 'ignored')
    assert.equal(await toolActionCount(casa), 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
