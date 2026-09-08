import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ClaudeActivationStore } from '../dist/adapters/claude/activation-store.js'
import {
  isOmniActivationCommand,
  parseClaudeHookInput
} from '../dist/adapters/claude/host-input.js'
import {
  buildActivationContext,
  buildCompactEventContext,
  buildHookTurnContext,
  limitLegacyAdditionalContext,
  renderLegacyAdditionalContext
} from '../dist/application/build-turn-context/build-hook-context.js'
import {
  renderCompactPersonalityAnchor,
  renderPersistentPersonalityDirection,
  renderTurnPersonalityAdjustment
} from '../dist/core/personality/personality.js'
import { montarContexto } from './contexto.mjs'
import { casaDoOmni } from './memoria.mjs'
import { processarExperiencia } from './pipeline-memoria.mjs'
import { sincronizarMemoriaDuravel } from './sincronizacao-memoria-duravel.mjs'
import { sincronizarMissoesDuraveis } from './sincronizacao-missoes-duraveis.mjs'
import { lerPersonalidadeAtiva } from './personalidade.mjs'
import { resumirFeedbackPersonalidade } from './feedback-personalidade.mjs'
import {
  observarFerramenta,
  observarParada,
  observarPrompt
} from './observador.mjs'
import { observarEvento } from './ciclo-operacional.mjs'
import { registrarCoberturaAoVivo } from './varredura-diaria.mjs'
import {
  exigirInicioDespachoAntesDaParada
} from './automacao-falhas.mjs'
import { exigirInicioDespachoMelhoriaAntesDaParada } from './automacao-melhorias.mjs'
import {
  adaptarFimSubagenteClaude,
  adaptarInicioSubagenteClaude,
  contextoProximaAutomacaoClaude,
  enriquecerEventoFerramentaClaude
} from './adaptador-claude-delegacao.mjs'
import { consumirContextoAuditoriaSistema } from './auditoria-sistema.mjs'
import {
  abrirTurnoAuditoria,
  auditarParada,
  encerrarSessaoAuditoria,
  registrarAcaoAuditoria,
  registrarConclusaoTarefaAuditoria,
} from './auditoria-autocorrecao.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))

export {
  limitLegacyAdditionalContext as limitarContextoAdicional,
  renderLegacyAdditionalContext as contextoAdicional
}

function saidaVazia() {
  return { suppressOutput: true }
}

/**
 * Gira a janela de exemplos de voz por evento. Determinística para o mesmo
 * evento (o hook pode repetir) e diferente entre turnos, para que a amostra não
 * vire um bloco fixo que o modelo passa a ignorar.
 */
function sementeDaGaleria(input) {
  return [
    input?.session_id ?? '',
    input?.tool_use_id ?? '',
    typeof input?.prompt === 'string' ? input.prompt.slice(0, 120) : ''
  ].join('|')
}

function mensagemDoErro(erro) {
  const nome = typeof erro?.name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(erro.name)
    ? erro.name
    : 'Error'
  const codigo = typeof erro?.code === 'string' && /^[A-Z0-9_-]{1,40}$/.test(erro.code)
    ? erro.code
    : null
  return codigo ? `${nome}/${codigo}` : nome
}

async function tentarComponente(nome, executar, falhas) {
  try {
    return await executar()
  } catch (erro) {
    falhas.push({ nome, mensagem: mensagemDoErro(erro) || 'falha sem mensagem' })
    return null
  }
}

function avisoDegradacao(falhas) {
  if (falhas.length === 0) return null
  const detalhes = [...falhas]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map(({ nome, mensagem }) => `${nome}: ${mensagem}`)
    .join(' | ')
  return [
    'ESTADO DE CONTEXTO: DEGRADADO.',
    'A personalidade do Omni permanece ativa; não volte ao assistente genérico.',
    `Componentes que falharam neste evento: ${detalhes}`,
    'Não invente o contexto ausente. Tente a recuperação segura dentro da autoridade atual e não transfira manutenção ao proprietário.',
    'Só exponha uma limitação se ela bloquear o pedido por falta de nova autoridade, dado indispensável ou decisão material; nesse caso, faça uma única pergunta contextual.'
  ].join(' ')
}

function saidaComContexto(hookEventName, additionalContext) {
  const text = String(additionalContext ?? '')
  if (text.length > 9_500) throw new Error('Contexto do hook excedeu o orçamento block-aware de 9.500 caracteres.')
  return {
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: text
    }
  }
}

const IMMEDIATE_OWNER_CORRECTIONS = Object.freeze({
  'prompt-not-visible': 'O Omni torna o briefing visível no destino e confirma o recebimento sem pedir ao proprietário que faça essa ponte.',
  'task-not-started': 'O Omni inicia e acompanha o trabalho já autorizado, em vez de devolver a execução ao proprietário.',
  'wrong-role': 'O Omni encaminha a execução ao worker adequado e mantém a conversa central responsável pelo resultado.',
  'premature-refusal': 'O Omni investiga as capacidades disponíveis, age e só faz uma pergunta se faltar nova autoridade, dado indispensável ou decisão material.',
  'request-unfaithful': 'O Omni compara o pedido atual com a ação e corrige a divergência neste mesmo turno.',
  'learning-not-recorded': 'O Omni registra a correção observada e aplica o ajuste seguro imediatamente, sem aguardar uma nova reclamação.'
})

function contextoCorrecaoImediata(correctionIds) {
  const routes = [...new Set((correctionIds ?? [])
    .map((id) => IMMEDIATE_OWNER_CORRECTIONS[id])
    .filter(Boolean))]
  if (routes.length === 0) return null
  return [
    'CORREÇÃO OPERACIONAL EXPLÍCITA DO PROPRIETÁRIO PARA ESTE TURNO:',
    ...routes.map((route) => `- ${route}`),
    'Aplique agora sem anunciar o mecanismo e sem transformar a correção em instruções para o proprietário.'
  ].join('\n')
}

async function motivoDeBloqueioComPersonalidade(casa, motivo) {
  const falhas = []
  const persona = await tentarComponente(
    'personalidade',
    () => lerPersonalidadeAtiva({ pluginRoot: raiz }),
    falhas
  )
  return [
    '<omni-autocorrecao-interna>',
    'BLOQUEIO OPERACIONAL INTERNO: este motivo orienta a próxima ação do Omni e nunca deve ser repetido como ordem ou checklist para o proprietário.',
    motivo,
    '',
    'O Omni deve assumir a correção coberta pela autoridade existente, usar as ferramentas e verificar o resultado antes de encerrar.',
    'Só faça uma pergunta se faltar nova autoridade, dado indispensável ou decisão material; nunca mande o proprietário executar comandos, abrir ferramentas ou cumprir etapas operacionais.',
    'Ao corrigir antes de parar, preserve a voz do Omni; autocorreção não vira memorando corporativo.',
    renderCompactPersonalityAnchor(persona, avisoDegradacao(falhas)),
    '</omni-autocorrecao-interna>'
  ].join('\n')
}

export async function tratarHook(input, env = process.env) {
  const parsedInput = parseClaudeHookInput(input)
  if (!parsedInput.ok) return saidaVazia()
  input = parsedInput.value

  const casa = casaDoOmni(env)
  const activationStore = new ClaudeActivationStore(casa, env)

  if (input.hook_event_name === 'SessionEnd') {
    if ((await activationStore.isSessionActive(input)).ativa) {
      await Promise.all([
        observarEvento(casa, {
          eventType: 'session-end',
          sessionId: input.session_id,
          evidenceId: `session-end:${input.session_id}:${input.reason ?? 'other'}`,
          cwd: input.cwd,
          status: 'closed',
          summary: `Sessao encerrada: ${input.reason ?? 'other'}`
        }),
        encerrarSessaoAuditoria(casa, input)
      ])
    }
    return saidaVazia()
  }

  if (input.hook_event_name === 'SessionStart') {
    let estadoSessao = await activationStore.isSessionActive(input)
    let ativadaPeloEscopo = false
    if (
      !estadoSessao.ativa &&
      (input.source === 'resume' || input.source === 'compact') &&
      await activationStore.transcriptConfirmsActivation(input)
    ) {
      const recuperacao = await activationStore.activate(input, { persistScope: true })
      estadoSessao = {
        ativa: true,
        falhas: [...estadoSessao.falhas, ...recuperacao.falhas]
      }
    }
    if (!estadoSessao.ativa) {
      const escopo = await activationStore.isScopeActive(input)
      if (escopo.ativa) {
        const recuperacao = await activationStore.activate(input)
        estadoSessao = {
          ativa: true,
          falhas: [...estadoSessao.falhas, ...escopo.falhas, ...recuperacao.falhas]
        }
        ativadaPeloEscopo = true
      }
    }
    if (!estadoSessao.ativa) return saidaVazia()
    if (!ativadaPeloEscopo) {
      estadoSessao.falhas.push(...await activationStore.persistActiveSessionScope(input))
    }
    const falhas = [...estadoSessao.falhas]
    const [persona, feedback] = await Promise.all([
      tentarComponente(
        'personalidade',
        () => lerPersonalidadeAtiva({ pluginRoot: raiz }),
        falhas
      ),
      tentarComponente(
        'feedback-personalidade',
        () => resumirFeedbackPersonalidade(casa),
        falhas
      )
    ])
    return saidaComContexto(
      'SessionStart',
      buildActivationContext({
        persona,
        mode: ativadaPeloEscopo
          ? 'activate'
          : input.source === 'compact' ? 'compact' : 'resume',
        degradation: avisoDegradacao(falhas),
        persistentDirection: renderPersistentPersonalityDirection(feedback)
      }).text
    )
  }

  if (isOmniActivationCommand(input)) {
    const persistirEscopo = ['UserPromptSubmit', 'UserPromptExpansion'].includes(input.hook_event_name)
    const ativacao = await activationStore.activate(input, { persistScope: persistirEscopo })
    const falhas = [...ativacao.falhas]
    const [persona, feedback] = await Promise.all([
      tentarComponente(
        'personalidade',
        () => lerPersonalidadeAtiva({ pluginRoot: raiz }),
        falhas
      ),
      tentarComponente(
        'feedback-personalidade',
        () => resumirFeedbackPersonalidade(casa),
        falhas
      )
    ])
    return saidaComContexto(
      input.hook_event_name,
      buildActivationContext({
        persona,
        mode: 'activate',
        degradation: avisoDegradacao(falhas),
        persistentDirection: renderPersistentPersonalityDirection(feedback)
      }).text
    )
  }

  // O ciclo do executor e autenticado pela delegacao correlacionada ao
  // fingerprint da sessao. Ele deve ser tratado sem consultar o marcador de
  // ativacao, pois eventos de subagente nunca herdam a personalidade do pai.
  if (input.hook_event_name === 'SubagentStart') {
    const falhas = []
    await tentarComponente(
      'adaptador-claude-delegacao-inicio',
      () => adaptarInicioSubagenteClaude(casa, input),
      falhas
    )
    return saidaComContexto(
      'SubagentStart',
      [
        'Execute a tarefa recebida com autonomia e evidencias verificaveis.',
        'Mantenha o pedido completo visivel nesta sessao e devolva resultado, verificacao e pendencias reais.'
      ].join(' ')
    )
  }

  if (input.hook_event_name === 'SubagentStop') {
    const falhas = []
    await tentarComponente(
      'adaptador-claude-delegacao-relato',
      () => adaptarFimSubagenteClaude(casa, input),
      falhas
    )
    return saidaVazia()
  }

  let estadoSessao = await activationStore.isSessionActive(input)
  if (!estadoSessao.ativa && input.hook_event_name === 'UserPromptSubmit') {
    const escopo = await activationStore.isScopeActive(input)
    if (escopo.ativa) {
      const recuperacao = await activationStore.activate(input)
      estadoSessao = {
        ativa: true,
        falhas: [...estadoSessao.falhas, ...escopo.falhas, ...recuperacao.falhas]
      }
    }
  }
  if (!estadoSessao.ativa) {
    return saidaVazia()
  }
  if (input.hook_event_name === 'UserPromptSubmit') {
    estadoSessao.falhas.push(...await activationStore.persistActiveSessionScope(input))
  }

  if (input.hook_event_name === 'PostToolUse' || input.hook_event_name === 'PostToolUseFailure') {
    const falhas = [...estadoSessao.falhas]
    const eventoFerramenta = enriquecerEventoFerramentaClaude(input)
    const [observacao, , , persona, feedback] = await Promise.all([
      tentarComponente('observador-ferramenta', () => observarFerramenta(casa, eventoFerramenta), falhas),
      tentarComponente('auditoria-acao', () => registrarAcaoAuditoria(casa, input), falhas),
      tentarComponente(
        'cobertura-ao-vivo',
        () => registrarCoberturaAoVivo(casa, { toolUseId: input.tool_use_id }),
        falhas
      ),
      tentarComponente(
        'personalidade',
        () => lerPersonalidadeAtiva({ pluginRoot: raiz }),
        falhas
      ),
      tentarComponente('feedback-personalidade', () => resumirFeedbackPersonalidade(casa), falhas)
    ])
    let automacao = null
    if (input.hook_event_name === 'PostToolUseFailure' && observacao?.failure?.result === 'candidate') {
      const arbitration = await tentarComponente(
        'arbitro-automacoes',
        () => contextoProximaAutomacaoClaude(casa, {
          sessionId: input.session_id,
          hookEventName: input.hook_event_name
        }),
        falhas
      )
      automacao = arbitration?.context ?? null
    }
    return saidaComContexto(
      input.hook_event_name,
      buildCompactEventContext({
        persona,
        persistentDirection: renderPersistentPersonalityDirection(feedback),
        gallerySeed: input.tool_use_id ?? input.session_id,
        degradation: avisoDegradacao(falhas),
        automation: automacao
      }).text
    )
  }

  if (input.hook_event_name === 'Stop') {
    const [inicioFalha, inicioMelhoria] = await Promise.all([
      exigirInicioDespachoAntesDaParada(casa, {
        sessionId: input.session_id,
        stopHookActive: input.stop_hook_active === true
      }),
      exigirInicioDespachoMelhoriaAntesDaParada(casa, {
        sessionId: input.session_id,
        stopHookActive: input.stop_hook_active === true
      })
    ])
    const bloqueiosInicio = [inicioFalha, inicioMelhoria].filter((item) => item.decision === 'block')
    if (bloqueiosInicio.length > 0) {
      return {
        decision: 'block',
        reason: await motivoDeBloqueioComPersonalidade(
          casa,
          bloqueiosInicio.map((item) => item.reason).join('\n')
        )
      }
    }
    if ([inicioFalha, inicioMelhoria].some((item) => item.result === 'pending-recursion')) {
      await auditarParada(casa, { ...input, stop_hook_active: true })
      await observarParada(casa, input)
      return saidaVazia()
    }
    const auditoria = await auditarParada(casa, input)
    if (auditoria.decision === 'block') {
      return {
        decision: 'block',
        reason: await motivoDeBloqueioComPersonalidade(casa, auditoria.reason)
      }
    }
    await observarParada(casa, input)
    return saidaVazia()
  }

  if (input.hook_event_name === 'StopFailure') {
    const [inicioFalha, inicioMelhoria] = await Promise.all([
      exigirInicioDespachoAntesDaParada(casa, {
        sessionId: input.session_id,
        stopHookActive: input.stop_hook_active === true
      }),
      exigirInicioDespachoMelhoriaAntesDaParada(casa, {
        sessionId: input.session_id,
        stopHookActive: input.stop_hook_active === true
      })
    ])
    const bloqueiosInicio = [inicioFalha, inicioMelhoria].filter((item) => item.decision === 'block')
    if (bloqueiosInicio.length > 0) {
      return {
        decision: 'block',
        reason: await motivoDeBloqueioComPersonalidade(
          casa,
          bloqueiosInicio.map((item) => item.reason).join('\n')
        )
      }
    }
    if ([inicioFalha, inicioMelhoria].some((item) => item.result === 'pending-recursion')) {
      await auditarParada(casa, { ...input, stop_hook_active: true })
      await observarParada(casa, input)
      return saidaVazia()
    }
    const [auditoria] = await Promise.all([auditarParada(casa, input), observarParada(casa, input)])
    if (auditoria.decision === 'block') {
      return {
        decision: 'block',
        reason: await motivoDeBloqueioComPersonalidade(casa, auditoria.reason)
      }
    }
    return saidaVazia()
  }

  if (input.hook_event_name === 'TaskCompleted') {
    await Promise.all([
      observarEvento(casa, {
        eventType: 'task-complete',
        sessionId: input.session_id,
        evidenceId: input.task_id ?? `${input.session_id}:${input.task_subject ?? 'task'}`,
        cwd: input.cwd,
        status: 'completed',
        summary: input.task_subject ?? input.task_description ?? 'Tarefa concluida'
      }),
      registrarConclusaoTarefaAuditoria(casa, input)
    ])
    return saidaVazia()
  }

  if (input.hook_event_name !== 'UserPromptSubmit') return saidaVazia()

  const intencao = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!intencao) return saidaVazia()

  const falhas = [...estadoSessao.falhas]
  const [, observacaoPrompt, auditoria] = await Promise.all([
    tentarComponente('memoria-experiencia', () => processarExperiencia(casa, intencao), falhas),
    tentarComponente('observador-prompt', () => observarPrompt(casa, input), falhas),
    tentarComponente('auditoria-turno', () => abrirTurnoAuditoria(casa, input), falhas)
  ])
  await tentarComponente('sincronizacao-memoria-duravel', () => sincronizarMemoriaDuravel(casa), falhas)
  await tentarComponente('sincronizacao-missoes-duraveis', () => sincronizarMissoesDuraveis(casa), falhas)
  if (observacaoPrompt?.observationFailure?.result === 'failed') {
    falhas.push({
      nome: 'observador-prompt-operacional',
      mensagem: observacaoPrompt.observationFailure.error ?? 'Error'
    })
  }
  await tentarComponente(
    'cobertura-ao-vivo',
    () => registrarCoberturaAoVivo(casa, {
      sessionId: input.session_id,
      prompt: intencao
    }),
    falhas
  )
  const [contexto, persona, automacao, auditoriaSistema] = await Promise.all([
    tentarComponente(
      'contexto-memoria',
      () => montarContexto(casa, {
        intent: intencao,
        projectId: typeof input.cwd === 'string' ? input.cwd : undefined,
        environmentId: typeof input.cwd === 'string' ? input.cwd : undefined
      }),
      falhas
    ),
    tentarComponente(
      'personalidade',
      () => lerPersonalidadeAtiva({ pluginRoot: raiz }),
      falhas
    ),
    tentarComponente(
      'arbitro-automacoes',
      () => contextoProximaAutomacaoClaude(casa, {
        sessionId: input.session_id,
        hookEventName: input.hook_event_name
      }),
      falhas
    ),
    tentarComponente(
      'auditoria-sistema',
      () => consumirContextoAuditoriaSistema(casa),
      falhas
    )
  ])
  let projecao = null
  const rota = contexto?.routing?.selected
  const rotaDaProjecao = automacao?.context ? 'fast' : rota
  if (rotaDaProjecao && typeof contexto?.projections?.[rotaDaProjecao]?.text === 'string') {
    projecao = contexto.projections[rotaDaProjecao].text
  } else {
    if (!falhas.some(({ nome }) => nome === 'contexto-memoria')) {
      falhas.push({
        nome: 'contexto-memoria',
        mensagem: 'projeção de contexto indisponível; nenhuma memória adicional foi carregada'
      })
    }
    projecao = avisoDegradacao(falhas) ?? [
      'ESTADO DE CONTEXTO: DEGRADADO.',
      'Responda à intenção literal deste turno sem inventar memória, preferência ou estado ausente.'
    ].join('\n')
  }
  return saidaComContexto(
    'UserPromptSubmit',
    buildHookTurnContext({
      persona,
      projection: projecao,
      persistentDirection: renderPersistentPersonalityDirection(observacaoPrompt?.personalityFeedback),
      turnAdjustment: renderTurnPersonalityAdjustment(observacaoPrompt?.personalityFeedback),
      ownerCorrection: contextoCorrecaoImediata(observacaoPrompt?.immediateCorrectionIds),
      automation: automacao?.context,
      audit: auditoria?.context,
      systemAudit: auditoriaSistema,
      degradation: avisoDegradacao(falhas),
      gallerySeed: sementeDaGaleria(input)
    }).text
  )
}

async function entradaPadrao() {
  let conteudo = ''
  for await (const parte of process.stdin) conteudo += parte
  return JSON.parse(conteudo)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${JSON.stringify(await tratarHook(await entradaPadrao()))}\n`)
  } catch (erro) {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  }
}
