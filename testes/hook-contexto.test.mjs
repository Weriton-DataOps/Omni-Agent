import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { tratarHook } from '../runtime/hook-contexto.mjs'
import { lembrarExplicitamente, lerMemoria } from '../runtime/memoria.mjs'

const hookCli = fileURLToPath(new URL('../runtime/hook-contexto.mjs', import.meta.url))

function executarCli(input, env) {
  const execucao = spawnSync(process.execPath, [hookCli], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env
  })
  assert.equal(execucao.status, 0, execucao.stderr)
  return JSON.parse(execucao.stdout)
}

async function ambiente() {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-hook-'))
  return {
    raiz,
    env: {
      ...process.env,
      OMNI_HOME: join(raiz, 'omni-home'),
      CLAUDE_PLUGIN_DATA: join(raiz, 'plugin-data')
    }
  }
}

test('sessao Omni recebe personalidade e memoria relevante em cada novo turno', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-ativa'
  try {
    await lembrarExplicitamente(
      env.OMNI_HOME,
      'Ao explicar buracos negros, prefiro poucas palavras e uma analogia concreta.',
      'preference'
    )

    const ativacao = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    assert.equal(ativacao.hookSpecificOutput, undefined)

    const turno = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Como funciona um buraco negro?' },
      env
    )
    const contexto = turno.hookSpecificOutput?.additionalContext
    assert.match(contexto, /PERSONALIDADE CANÔNICA/)
    assert.match(contexto, /Inventor Cúmplice/)
    assert.match(contexto, /prefiro poucas palavras e uma analogia concreta/i)
    assert.match(contexto, /RELEVANT CONFIRMED MEMORY/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('hook não afeta sessão sem ativação e encerra o estado ao fechar', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-controlada'
  try {
    const inativa = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'mensagem comum' },
      env
    )
    assert.equal(inativa.hookSpecificOutput, undefined)

    await tratarHook(
      { hook_event_name: 'UserPromptExpansion', session_id, command_name: 'omni:omni' },
      env
    )
    const ativa = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'mensagem do Omni' },
      env
    )
    assert.equal(ativa.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')

    await tratarHook({ hook_event_name: 'SessionEnd', session_id }, env)
    const encerrada = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'mensagem posterior' },
      env
    )
    assert.equal(encerrada.hookSpecificOutput, undefined)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('entrada executável usada pelo Claude Code entrega JSON limpo', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-cli'
  try {
    const ativacao = executarCli(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    assert.equal(ativacao.suppressOutput, true)

    await lembrarExplicitamente(
      env.OMNI_HOME,
      'Prefiro analogias concretas ao estudar gravidade.',
      'preference'
    )
    const turno = executarCli(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Explique a gravidade.' },
      env
    )
    assert.equal(turno.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
    assert.match(turno.hookSpecificOutput.additionalContext, /analogias concretas/i)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('hook extrai sinal persistente como candidata sem promovê-lo', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-aprendizado'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await tratarHook(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id,
        prompt: 'Prefiro mapas antes de explicações longas.'
      },
      env
    )
    const memory = await lerMemoria(env.OMNI_HOME)
    assert.equal(memory.confirmed.length, 0)
    assert.equal(memory.candidates.length, 1)
    assert.equal(memory.candidates[0].type, 'preference')
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('hook aplica a rota fast ou deep escolhida pelo contexto', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-roteamento'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    const direta = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'bom dia' },
      env
    )
    assert.match(direta.hookSpecificOutput.additionalContext, /OMNI CONTEXT V1 - FAST/)

    const profunda = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'analise os riscos desta arquitetura' },
      env
    )
    assert.match(profunda.hookSpecificOutput.additionalContext, /OMNI CONTEXT V1 - DEEP/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})
