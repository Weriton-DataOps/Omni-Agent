import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { tratarHook } from '../runtime/hook-contexto.mjs'
import { lerAuditoriaAutocorrecao } from '../runtime/auditoria-autocorrecao.mjs'
import { lerAutomacaoFalhas, sincronizarAutomacaoFalhas } from '../runtime/automacao-falhas.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'

// Regressao do caminho real (25/09/2026): o Claude Code nao manda delegation_id
// no SubagentStart. A correlacao vem do vinculo do job de falha despachado na
// sessao, e as ferramentas do executor precisam entrar no ledger por esse
// vinculo. No 0.24.5 o ramo nao existia: 0 de 56 chamadas foram gravadas.

async function padraoCandidato(casa) {
  const falha = { agent: 'omni', action: 'executar Bash', failureClass: 'tool-error', signature: 'hook recusou cd encadeado' }
  for (const run of [1, 2, 3]) await registrarFalha(casa, { ...falha, evidenceId: `hook-real-run-${run}` })
  await sincronizarAutomacaoFalhas(casa)
}

const ferramenta = (sessionId, agentId, id, command) => ({
  hook_event_name: 'PostToolUse',
  session_id: sessionId,
  agent_id: agentId,
  agent_type: 'general-purpose',
  tool_use_id: id,
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: { stdout: 'ok', stderr: '', interrupted: false },
  cwd: 'C:\\repo'
})

async function acoesDeFerramenta(casa) {
  const store = await lerAuditoriaAutocorrecao(casa)
  return store.turns.flatMap((turn) => turn.actions ?? []).filter((action) => action.effect !== 'delegation')
}

test('executor despachado pelo job de falha grava suas ferramentas no ledger pelo hook real', async () => {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-subagente-hook-real-'))
  const env = { OMNI_HOME: join(raiz, 'omni-home'), CLAUDE_PLUGIN_DATA: join(raiz, 'plugin-data') }
  const casa = env.OMNI_HOME
  const session_id = 'sessao-primaria-hook-real'
  try {
    await padraoCandidato(casa)
    await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni', cwd: raiz }, env)
    const turno = await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Teste o token antes de substituir.', cwd: raiz }, env)
    assert.match(JSON.stringify(turno), /failure-dispatch-required/)
    const antes = (await acoesDeFerramenta(casa)).length

    // SubagentStart como o Claude Code manda: sem delegation_id.
    await tratarHook({ hook_event_name: 'SubagentStart', session_id, agent_id: 'agente-real-1', agent_type: 'general-purpose', cwd: raiz }, env)
    const job = (await lerAutomacaoFalhas(casa)).jobs.at(-1)
    assert.equal(job.state, 'running')

    await tratarHook(ferramenta(session_id, 'agente-real-1', 'sub-tool-1', 'node --test verificacao.test.mjs'), env)
    await tratarHook(ferramenta(session_id, 'agente-real-1', 'sub-tool-2', 'node --test verificacao.test.mjs'), env)
    // Controle: executor sem delegacao viva continua fora do ledger.
    await tratarHook(ferramenta(session_id, 'agente-intruso', 'sub-tool-x', 'node --test verificacao.test.mjs'), env)

    const depois = await acoesDeFerramenta(casa)
    assert.equal(depois.length - antes, 2)
    assert.deepEqual(depois.slice(antes).map((action) => action.toolName), ['Bash', 'Bash'])
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})
