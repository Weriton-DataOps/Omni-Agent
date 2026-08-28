import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { caminhoDaAutomacaoFalhas, reivindicarAutomacaoFalha } from '../runtime/automacao-falhas.mjs'
import { tratarHook } from '../runtime/hook-contexto.mjs'
import { lembrarExplicitamente, lerMemoria } from '../runtime/memoria.mjs'
import { caminhoDaCoberturaAoVivo } from '../runtime/varredura-diaria.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'
import { registrarUltimaRespostaPersonalidade } from '../runtime/feedback-personalidade.mjs'
import {
  atualizarDelegacao,
  lerCicloOperacional,
  prepararDelegacao
} from '../runtime/ciclo-operacional.mjs'

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
    assert.equal(ativacao.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /PERSONALIDADE CANÔNICA/)
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /ADAPTADOR DO CANAL ESCRITO/)
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /conversa escrita/i)

    const turno = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Como funciona um buraco negro?' },
      env
    )
    const contexto = turno.hookSpecificOutput?.additionalContext
    assert.match(contexto, /PERSONALIDADE CANÔNICA/)
    assert.match(contexto, /Inventor Cúmplice/)
    assert.match(contexto, /ADAPTADOR DO CANAL ESCRITO/)
    assert.match(contexto, /prefiro poucas palavras e uma analogia concreta/i)
    assert.match(contexto, /RELEVANT CONFIRMED MEMORY/)
    const liveCoverage = JSON.parse(await readFile(caminhoDaCoberturaAoVivo(env.OMNI_HOME), 'utf8'))
    assert.equal(liveCoverage.fingerprints.length, 1)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('hook não afeta sessão nunca ativada e preserva o estado da sessão ao fechar', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-controlada'
  try {
    const inativa = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'mensagem comum' },
      env
    )
    assert.equal(inativa.hookSpecificOutput, undefined)

    const ferramentaInativa = await tratarHook(
      {
        hook_event_name: 'PostToolUse',
        session_id,
        tool_use_id: 'tool-sessao-inativa',
        tool_name: 'Read'
      },
      env
    )
    assert.equal(ferramentaInativa.hookSpecificOutput, undefined)

    const expansao = await tratarHook(
      { hook_event_name: 'UserPromptExpansion', session_id, command_name: 'omni:omni' },
      env
    )
    assert.equal(expansao.hookSpecificOutput?.hookEventName, 'UserPromptExpansion')
    assert.match(expansao.hookSpecificOutput?.additionalContext, /PERSONALIDADE CANÔNICA/)
    assert.match(expansao.hookSpecificOutput?.additionalContext, /ADAPTADOR DO CANAL ESCRITO/)
    const ativa = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'mensagem do Omni' },
      env
    )
    assert.equal(ativa.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')

    await tratarHook({ hook_event_name: 'SessionEnd', session_id, reason: 'other' }, env)
    const mesmaSessao = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'mensagem posterior' },
      env
    )
    assert.equal(mesmaSessao.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')

    const retomada = await tratarHook(
      { hook_event_name: 'SessionStart', session_id, source: 'resume' },
      env
    )
    assert.match(retomada.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)

    const sessaoNova = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 'sessao-nova', prompt: 'mensagem comum' },
      env
    )
    assert.equal(sessaoNova.hookSpecificOutput, undefined)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('sessão ativada preserva a personalidade ao sair para resume e ao retomar', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-retomada'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await tratarHook(
      { hook_event_name: 'SessionEnd', session_id, reason: 'resume' },
      env
    )

    const retomada = await tratarHook(
      { hook_event_name: 'SessionStart', session_id, source: 'resume' },
      env
    )
    assert.equal(retomada.hookSpecificOutput?.hookEventName, 'SessionStart')
    assert.match(retomada.hookSpecificOutput?.additionalContext, /sessão já ativada do Omni acaba de ser retomada/i)
    assert.match(retomada.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)

    const turno = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Continue de onde parou.' },
      env
    )
    assert.match(turno.hookSpecificOutput?.additionalContext, /PERSONALIDADE CANÔNICA/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('fechamento da interface preserva ativação para retomada posterior', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-fechada-retomavel'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await tratarHook(
      { hook_event_name: 'SessionEnd', session_id, reason: 'prompt_input_exit' },
      env
    )

    const retomada = await tratarHook(
      { hook_event_name: 'SessionStart', session_id, source: 'resume' },
      env
    )
    assert.match(retomada.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('compactação reinjeta a personalidade somente em sessão ativada', async () => {
  const { raiz, env } = await ambiente()
  const ativa = 'sessao-compactada-ativa'
  const inativa = 'sessao-compactada-inativa'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id: ativa, prompt: '/omni:omni' },
      env
    )

    const compactada = await tratarHook(
      { hook_event_name: 'SessionStart', session_id: ativa, source: 'compact' },
      env
    )
    assert.equal(compactada.hookSpecificOutput?.hookEventName, 'SessionStart')
    assert.match(compactada.hookSpecificOutput?.additionalContext, /passar por compactação/i)
    assert.match(compactada.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)

    const nuncaAtivadaResume = await tratarHook(
      { hook_event_name: 'SessionStart', session_id: inativa, source: 'resume' },
      env
    )
    const nuncaAtivadaCompact = await tratarHook(
      { hook_event_name: 'SessionStart', session_id: inativa, source: 'compact' },
      env
    )
    assert.equal(nuncaAtivadaResume.hookSpecificOutput, undefined)
    assert.equal(nuncaAtivadaCompact.hookSpecificOutput, undefined)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('chamada implícita da Skill Omni ativa a sessão sem autoaprovar a ferramenta', async () => {
  const { raiz, env } = await ambiente()
  try {
    for (const [index, tool_input] of [
      { skill: 'omni' },
      { name: 'omni:omni' },
      { command: ' omni ' },
      { skill: 'omni', name: 'omni:omni' }
    ].entries()) {
      const session_id = `sessao-skill-implicita-${index}`
      const ativacao = await tratarHook({
        hook_event_name: 'PreToolUse',
        session_id,
        tool_name: 'Skill',
        tool_input
      }, env)
      assert.equal(ativacao.hookSpecificOutput?.hookEventName, 'PreToolUse')
      assert.match(ativacao.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)
      assert.equal(ativacao.hookSpecificOutput?.permissionDecision, undefined)
      assert.equal(ativacao.permissionDecision, undefined)

      const turno = await tratarHook({
        hook_event_name: 'UserPromptSubmit',
        session_id,
        prompt: 'Continue como Omni.'
      }, env)
      assert.match(turno.hookSpecificOutput?.additionalContext, /PERSONALIDADE CANÔNICA/)
    }

    for (const [index, tool_input] of [
      { skill: 'outra-skill' },
      { skill: 'outra-skill', name: 'omni' },
      { command: 'omni:omni atualizar' }
    ].entries()) {
      const inativa = await tratarHook({
        hook_event_name: 'PreToolUse',
        session_id: `sessao-skill-estranha-${index}`,
        tool_name: 'Skill',
        tool_input
      }, env)
      assert.equal(inativa.hookSpecificOutput, undefined)
    }
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('contexto deep permanece inline e preserva personalidade e ajuste explícito', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-contexto-inline'
  try {
    for (let index = 0; index < 14; index += 1) {
      await lembrarExplicitamente(
        env.OMNI_HOME,
        [
          `Ao analisar arquitetura e riscos, prefiro a evidência detalhada ${index}.`,
          'Inclua impacto, alternativa, verificação, dependências e contexto operacional relevante',
          'para que a decisão técnica seja rastreável sem perder o objetivo atual.'
        ].join(' '),
        'preference'
      )
    }
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await registrarUltimaRespostaPersonalidade(env.OMNI_HOME, {
      sessionId: session_id,
      answer: 'Resposta anterior neutra usada para ligar o voto ao turno.'
    })

    const turno = await tratarHook({
      hook_event_name: 'UserPromptSubmit',
      session_id,
      origin: 'owner-live',
      cwd: raiz,
      prompt: 'Essa resposta sobre a analise dos riscos da arquitetura ficou seca e genérica; faltou humor e analogia.'
    }, env)
    const contexto = turno.hookSpecificOutput.additionalContext
    assert.ok(contexto.length <= 9_500)
    assert.match(contexto, /PERSONALIDADE omni-persona-v3-candidate/)
    assert.match(contexto, /Entregue evidência e resultado\./)
    assert.match(contexto, /AJUSTE EXPLÍCITO DO PROPRIETÁRIO PARA ESTA RESPOSTA/)
    assert.match(contexto, /mais humor nascido deste contexto/)
    assert.match(contexto, /analogia forte que ajude a entender/)
    assert.match(contexto, /CONTEXTO AUXILIAR TRUNCADO/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('ferramenta reforça âncora compacta sem reinjetar o núcleo inteiro', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-ancora-pos-ferramenta'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    const result = await tratarHook({
      hook_event_name: 'PostToolUse',
      session_id,
      tool_use_id: 'tool-ancora-1',
      tool_name: 'Read',
      tool_input: { file_path: join(raiz, 'exemplo.txt') },
      tool_response: 'conteúdo lido',
      cwd: raiz
    }, env)
    const contexto = result.hookSpecificOutput?.additionalContext
    assert.equal(result.hookSpecificOutput?.hookEventName, 'PostToolUse')
    assert.match(contexto, /<omni-ancora-compacta>/)
    assert.match(contexto, /Inventor Cúmplice/)
    assert.match(contexto, /(?:analogia|imagem) científica (?:\/|ou )geek/i)
    assert.doesNotMatch(contexto, /PERSONALIDADE CANÔNICA:/)
    assert.ok(contexto.length < 1_200)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('feedback explícito do proprietário ajusta a resposta seguinte sem reescrever o contrato', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-ajuste-personalidade'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await registrarUltimaRespostaPersonalidade(env.OMNI_HOME, {
      sessionId: session_id,
      answer: 'Resposta anterior propositalmente neutra para o teste.'
    })

    const turno = await tratarHook({
      hook_event_name: 'UserPromptSubmit',
      session_id,
      origin: 'owner-live',
      prompt: 'Essa resposta ficou seca e genérica; faltou humor e analogia.'
    }, env)
    const contexto = turno.hookSpecificOutput?.additionalContext
    assert.match(contexto, /AJUSTE EXPLÍCITO DO PROPRIETÁRIO PARA ESTA RESPOSTA/)
    assert.match(contexto, /mais humor nascido deste contexto/)
    assert.match(contexto, /analogia forte que ajude a entender/)
    assert.match(contexto, /afaste-se do assistente genérico/)
    assert.match(contexto, /vale para esta resposta/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('falha de contexto mantém a personalidade com fallback explícito e observável', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-contexto-degradado'
  const caminhoBloqueado = join(raiz, 'omni-home-bloqueado')
  try {
    await writeFile(caminhoBloqueado, 'isto é um arquivo, não um diretório', 'utf8')
    env.OMNI_HOME = caminhoBloqueado

    const ativacao = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)

    const turno = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Continue sem inventar contexto.' },
      env
    )
    const contextoTurno = turno.hookSpecificOutput?.additionalContext
    assert.match(contextoTurno, /PERSONALIDADE CANÔNICA:/)
    assert.match(contextoTurno, /Inventor Cúmplice/)
    assert.match(contextoTurno, /ESTADO DE CONTEXTO: DEGRADADO/)
    assert.match(contextoTurno, /contexto-memoria/i)
    assert.match(contextoTurno, /não invente o contexto ausente/i)

    const ferramenta = await tratarHook({
      hook_event_name: 'PostToolUse',
      session_id,
      tool_use_id: 'tool-contexto-degradado',
      tool_name: 'Read',
      cwd: raiz
    }, env)
    assert.match(ferramenta.hookSpecificOutput?.additionalContext, /<omni-ancora-compacta>/)
    assert.match(ferramenta.hookSpecificOutput?.additionalContext, /ESTADO DE CONTEXTO: DEGRADADO/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('falha no marcador primário usa estado alternativo sem cortar a personalidade', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-estado-alternativo'
  const pluginDataBloqueado = join(raiz, 'plugin-data-bloqueado')
  try {
    await writeFile(pluginDataBloqueado, 'arquivo no lugar do diretorio', 'utf8')
    env.CLAUDE_PLUGIN_DATA = pluginDataBloqueado

    const ativacao = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /ESTADO DE CONTEXTO: DEGRADADO/)
    assert.match(ativacao.hookSpecificOutput?.additionalContext, /estado-sessao-primario/)

    const turno = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'Continue com a mesma voz.' },
      env
    )
    assert.equal(turno.hookSpecificOutput?.hookEventName, 'UserPromptSubmit')
    assert.match(turno.hookSpecificOutput?.additionalContext, /Inventor Cúmplice/)
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

test('hook confirma declaração persistente clara do proprietário', async () => {
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
    assert.equal(memory.confirmed.length, 1)
    assert.equal(memory.candidates.length, 0)
    assert.equal(memory.confirmed[0].type, 'preference')
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

test('candidata de falha entra no turno como despacho solicitado e nao como spawn alegado', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-automacao-falhas'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    const failure = {
      agent: 'omni',
      action: 'executar Bash',
      failureClass: 'permission',
      signature: 'permissao negada ao executar teste local'
    }
    for (let index = 1; index <= 3; index += 1) {
      await registrarFalha(env.OMNI_HOME, { ...failure, evidenceId: `hook-failure-${index}` })
    }
    const turn = await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'continue o trabalho' },
      env
    )
    const context = turn.hookSpecificOutput.additionalContext
    assert.match(context, /AUTOMAÇÃO DE FALHAS/)
    assert.match(context, /subagente.*segundo plano/i)
    assert.match(context, /dispatch-requested/i)
    assert.match(context, /preparada e marcada como `visible`/i)
    assert.match(context, /não prova que o host iniciou o subagente/i)
    assert.match(context, /não peça nova autorização ao proprietário/i)
    const automation = JSON.parse(await readFile(caminhoDaAutomacaoFalhas(env.OMNI_HOME), 'utf8'))
    assert.equal(automation.jobs.length, 1)
    assert.equal(automation.jobs[0].state, 'queued')
    assert.equal(automation.jobs[0].dispatchState, 'requested')
    assert.equal(automation.jobs[0].attempts, 0)
    assert.equal(automation.jobs[0].executorFingerprint, null)
    const cycle = await lerCicloOperacional(env.OMNI_HOME)
    assert.equal(cycle.delegations.length, 1)
    assert.equal(cycle.delegations[0].state, 'visible')
    assert.equal(cycle.delegations[0].visiblePromptConfirmed, true)
    assert.equal(cycle.delegations[0].agentFingerprint, null)
    assert.match(context, new RegExp(cycle.delegations[0].id))
    assert.deepEqual(
      cycle.delegations[0].transitionHistory.map((item) => item.to),
      ['prepared', 'visible']
    )
    assert.doesNotMatch(JSON.stringify(cycle), /Objetivo obrigatório|permissao negada ao executar teste local/i)

    const workerClaim = await reivindicarAutomacaoFalha(env.OMNI_HOME, {
      executorId: 'subagent-hook-test',
      jobId: automation.jobs[0].id
    })
    assert.equal(workerClaim.result, 'claimed')
    assert.equal(workerClaim.job.state, 'running')
    assert.equal(workerClaim.job.attempts, 1)
    assert.ok(workerClaim.job.executorFingerprint)

    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'agora trate outro assunto' },
      env
    )
    assert.equal((await lerCicloOperacional(env.OMNI_HOME)).delegations.length, 1)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('terceira falha de ferramenta dispara o despacho sem esperar outro pedido', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-falha-imediata'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'execute o teste local e trate a falha' },
      env
    )
    let result
    for (let index = 1; index <= 3; index += 1) {
      result = await tratarHook({
        hook_event_name: 'PostToolUseFailure',
        session_id,
        tool_use_id: `tool-failure-${index}`,
        tool_name: 'Bash',
        error: 'permission denied ao criar artefato local',
        cwd: raiz
      }, env)
    }
    assert.equal(result.hookSpecificOutput.hookEventName, 'PostToolUseFailure')
    assert.match(result.hookSpecificOutput.additionalContext, /<omni-ancora-compacta>/)
    assert.match(result.hookSpecificOutput.additionalContext, /Inventor Cúmplice/)
    assert.match(result.hookSpecificOutput.additionalContext, /AUTOMAÇÃO DE FALHAS/)
    assert.match(result.hookSpecificOutput.additionalContext, /dispatch-requested/i)
    assert.match(result.hookSpecificOutput.additionalContext, /preparada e marcada como `visible`/i)
    assert.match(result.hookSpecificOutput.additionalContext, /não prova que o host iniciou o subagente/i)
    const cycle = await lerCicloOperacional(env.OMNI_HOME)
    assert.equal(cycle.delegations.length, 1)
    assert.equal(cycle.delegations[0].state, 'visible')
    assert.equal(cycle.delegations[0].agentFingerprint, null)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('StopFailure executa o mesmo gate de auditoria antes de encerrar', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-stop-failure-auditado'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'corrija o arquivo quebrado' },
      env
    )
    const result = await tratarHook({
      hook_event_name: 'StopFailure',
      session_id,
      error: 'a resposta falhou antes de executar a correcao'
    }, env)
    assert.equal(result.decision, 'block')
    assert.match(result.reason, /requested-action-not-executed/)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('SubagentStop liga o relato do ciclo à ação e evidência da auditoria', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-delegacao-auditada'
  try {
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' },
      env
    )
    await tratarHook(
      { hook_event_name: 'UserPromptSubmit', session_id, prompt: 'delegue e verifique a tarefa' },
      env
    )
    const prepared = await prepararDelegacao(env.OMNI_HOME, {
      target: 'executor',
      prompt: 'Execute a tarefa e devolva o artefato.',
      sessionId: session_id
    })
    await atualizarDelegacao(env.OMNI_HOME, prepared.delegation.id, 'visible', {
      evidence: 'prompt-visivel-hook'
    })
    await tratarHook({
      hook_event_name: 'SubagentStart',
      session_id,
      agent_id: 'agent-hook-auditado',
      agent_type: 'executor',
      cwd: raiz
    }, env)
    await tratarHook({
      hook_event_name: 'SubagentStop',
      session_id,
      agent_id: 'agent-hook-auditado',
      agent_type: 'executor',
      agent_transcript_path: join(raiz, 'agent-hook-auditado.jsonl'),
      last_assistant_message: 'Tarefa executada e artefato entregue.',
      cwd: raiz
    }, env)
    const cycle = await lerCicloOperacional(env.OMNI_HOME)
    const delegation = cycle.delegations.find((item) => item.id === prepared.delegation.id)
    assert.equal(delegation.state, 'reported')
    assert.match(delegation.reportAuditActionId, /^audit-action-/)
    assert.match(delegation.reportAuditEvidenceId, /^audit-evidence-/)
    assert.equal(delegation.verificationAuditActionId, null)
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})
