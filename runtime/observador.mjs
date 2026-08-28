import { createHash } from 'node:crypto'

import {
  observarDelegacao,
  observarEvento,
  proporMelhoriaOperacional
} from './ciclo-operacional.mjs'
import { registrarFalha } from './falhas.mjs'
import { pareceConterSegredo } from './memoria.mjs'
import { materializarMelhoriaConfigurada } from './evolucao.mjs'

function feedbackNegativoPersonalidade(value) {
  const prompt = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  const dry = '(?:seco|seca|frio|fria|sem vida|generico|generica|robotico|robotica)'
  const evidence = prompt.replace(
    new RegExp(`\\bnao\\s+(?:esta|ta|ficou|continua|segue|soa|parece)\\s+(?:muito\\s+)?${dry}\\b`, 'g'),
    ''
  )
  return [
    new RegExp(`\\b(?:voce|vc|tu|omni|dialogo|conversa|resposta|tom|jeito|personalidade)\\b.{0,90}\\b(?:esta|ta|ficou|continua|segue|soa|parece|veio|respondeu)\\b.{0,35}\\b(?:muito\\s+|ainda\\s+)?${dry}\\b`),
    new RegExp(`\\b(?:muito|demais|ainda)\\s+${dry}\\b.{0,60}\\b(?:resposta|dialogo|conversa|tom|omni|voce|vc)\\b`),
    /\b(?:seco|seca|frio|fria|generico|generica|robotico|robotica)\b.{0,30}\b(?:e\s+)?sem vida\b/,
    /\b(?:faltou|falta|sumiu|cade|quero mais|precisa de mais|preciso de mais|insisto na)\b.{0,70}\b(?:personalidade|humor|sarcasmo|analogia|analogias|inteligencia)\b/,
    /\b(?:nao|nunca)\s+(?:esta\s+|ta\s+)?(?:usou|usa|usando|aplicou|aplica|aplicando|trouxe|mostrou)\b.{0,60}\b(?:a\s+)?(?:personalidade|humor|sarcasmo|analogia|analogias)\b/,
    /\b(?:personalidade|humor|sarcasmo|analogia|analogias)\b.{0,60}\b(?:nao apareceu|nao entrou|nao pegou|nao funciona|nao funcionou|nao esta funcionando|nao esta sendo usada|nao esta usando)\b/,
    /\b(?:nada da|sem sinal de|cade a)\s+personalidade\b/
  ].some((pattern) => pattern.test(evidence))
}

const CORRECOES = [
  {
    id: 'prompt-not-visible',
    pattern: /(?:\b(prompt|instru[cç][aã]o).{0,80}\b(n[aã]o apareceu|n[aã]o ficou vis[ií]vel|sem deixar|mais uma vez)\b|\b(?:sem deixar|n[aã]o deixou).{0,80}\b(?:prompt|instru[cç][aã]o).{0,40}\bvis[ií]vel\b)/i,
    action: 'entregar prompt visivel na sessao de destino',
    destination: 'operational-rule',
    statement: 'Ao delegar, exibir a instrucao completa na sessao de destino e confirmar visualmente seu recebimento.'
  },
  {
    id: 'task-not-started',
    pattern: /\b(n[aã]o (?:mandou|colocou|fez).{0,50}(?:executar|trabalhar)|tive que insistir|n[aã]o rodou)\b/i,
    action: 'iniciar e acompanhar trabalho delegado',
    destination: 'procedure',
    statement: 'Depois de preparar uma tarefa, iniciar o executor, observar o estado e retornar a evidencia da conclusao.'
  },
  {
    id: 'wrong-role',
    pattern: /\b(fun[cç][aã]o que n[aã]o era.{0,30}dele|deveria ter passado|devolvido para a sess[aã]o)\b/i,
    action: 'encaminhar trabalho para o executor adequado',
    destination: 'routing',
    statement: 'Manter a conversa central livre e encaminhar execucao especializada para a sessao ou agente responsavel.'
  },
  {
    id: 'dry-personality',
    matches: feedbackNegativoPersonalidade,
    action: 'aplicar personalidade canonica na conversa',
    destination: 'personality',
    statement: 'Manter personalidade em alta intensidade desde a primeira frase, com inteligência perceptível, humor, sarcasmo e analogias integrados ao raciocínio, sem voltar ao assistente genérico.'
  },
  {
    id: 'premature-refusal',
    pattern: /\b(j[aá] deu como n[aã]o consegue|me mandando fazer|recusou|nem deu bola)\b/i,
    action: 'tentar caminhos executaveis antes de devolver trabalho',
    destination: 'operational-rule',
    statement: 'Diante de uma ordem executavel, investigar capacidades disponiveis, agir e somente pedir ajuda quando faltar autoridade real.'
  },
  {
    id: 'request-unfaithful',
    pattern: /(?:\b(?:eu\s+)?n[aã]o\s+(?:falei|pedi|disse)\s+(?:isso|isto|essa|esse|assim|desse\s+jeito)\b|\b(?:isso\s+)?n[aã]o\s+(?:foi|era|[eé])\s+(?:isso\s+)?(?:o\s+)?que\s+(?:eu\s+)?(?:pedi|falei|disse|quis)\b|\b(?:voc[eê]|vc|tu)(?=\s|[,:;.!?]|$).{0,80}\b(?:fez|entendeu|respondeu|executou|interpretou)\b.{0,60}\b(?:errad[oa]|diferente|outra\s+coisa)\b|\bseja\s+mais\s+fiel(?:\s+ao\s+que\s+eu\s+(?:pedi|disse|falei))?\b|\b(?:fez|respondeu|executou)\s+errad[oa]\b)/i,
    action: 'executar fielmente o pedido atual',
    destination: 'eval',
    statement: 'Comparar pedido, acao e resultado antes de concluir, corrigindo divergencias enquanto o turno ainda esta ativo.'
  },
  {
    id: 'learning-not-recorded',
    pattern: /\b(n[aã]o est[aá] registrando|por que n[aã]o registr|n[aã]o memoriz|n[aã]o aprendeu)\b/i,
    action: 'registrar aprendizado observado',
    destination: 'hook',
    statement: 'Transformar correcoes, sucessos repetidos e preferencias estaveis em eventos de aprendizado automaticamente.'
  }
]

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function texto(value, maximum = 240) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!normalized || pareceConterSegredo(normalized)) return null
  return normalized.slice(0, maximum)
}

function classeDeErro(input) {
  const value = `${input?.error ?? ''} ${input?.tool_name ?? ''}`.toLowerCase()
  if (/permission|denied|forbidden|unauthorized/.test(value)) return 'permission'
  if (/timeout|timed out/.test(value)) return 'timeout'
  if (/module|dependency|package|not found/.test(value)) return 'dependency'
  if (/validation|invalid|schema|syntax/.test(value)) return 'validation-error'
  if (/environment|enoent|path|executable/.test(value)) return 'environment'
  return 'tool-error'
}

function codigoErro(input) {
  return String(input?.error ?? '').match(/(?:exit code|code)\s*[:=]?\s*(-?\d+)/i)?.[1] ?? 'unknown'
}

function comandoDaEntrada(input) {
  if (typeof input?.tool_input === 'string') return input.tool_input
  const toolInput = input?.tool_input
  if (!toolInput || typeof toolInput !== 'object') return null
  for (const field of ['command', 'cmd', 'script', 'code']) {
    if (typeof toolInput[field] === 'string' && toolInput[field].trim()) return toolInput[field]
  }
  return null
}

function nomeExecutavel(value) {
  return String(value ?? '')
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .at(-1)
    .replace(/\.(?:exe|cmd|bat)$/i, '')
    .toLowerCase()
}

function tokensDoComando(command) {
  return String(command ?? '').match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []
}

function segmentoExecutavel(command) {
  const segments = String(command ?? '').split(/&&|\|\||[;\n]/)
  return segments.find((segment) => {
    const executable = nomeExecutavel(tokensDoComando(segment)[0])
    return executable && !['cd', 'chdir', 'set-location', 'pushd', 'popd'].includes(executable)
  }) ?? segments[0] ?? ''
}

function formaDoComando(command) {
  return String(command ?? '')
    .toLowerCase()
    .replace(/(?:[a-z]:[\\/]|\.{0,2}[\\/]|~[\\/])[^\s"']+/gi, '<path>')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/"[^"]*"|'[^']*'/g, '<quoted>')
    .replace(/\b[0-9a-f]{20,}\b/gi, '<opaque>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
}

function familiaDoComando(command) {
  if (!command) return 'command-unavailable'
  const segment = segmentoExecutavel(command)
  const tokens = tokensDoComando(segment)
  const executable = nomeExecutavel(tokens[0]) || 'shell'
  const semantic = tokens.slice(1).filter((token) => !token.startsWith('-'))

  if (executable === 'git') {
    const first = nomeExecutavel(semantic[0]) || 'command'
    const second = first === 'worktree' ? nomeExecutavel(semantic[1]) : ''
    return `git:${first}${second ? `:${second}` : ''}`
  }
  if (['npm', 'npm.cmd', 'pnpm', 'yarn'].includes(executable)) {
    const first = nomeExecutavel(semantic[0]) || 'command'
    const second = first === 'run' ? nomeExecutavel(semantic[1]) : ''
    return `${executable.replace('.cmd', '')}:${first}${second ? `:${second}` : ''}`
  }
  if (['node', 'python', 'python3', 'py'].includes(executable)) {
    return `${executable}:script:${nomeExecutavel(semantic[0]) || 'inline'}`
  }
  if (['powershell', 'pwsh'].includes(executable)) {
    const fileIndex = tokens.findIndex((token) => /^-(?:file|f)$/i.test(token))
    if (fileIndex >= 0) return `powershell:file:${nomeExecutavel(tokens[fileIndex + 1]) || 'script'}`
    const commandIndex = tokens.findIndex((token) => /^-(?:command|c)$/i.test(token))
    if (commandIndex >= 0) {
      const nested = nomeExecutavel(tokens[commandIndex + 1])
      return `powershell:command:${nested || 'inline'}`
    }
  }
  if (/^[a-z]+-[a-z]+$/i.test(executable)) return `powershell-cmdlet:${executable}`
  return `${executable}:shape-${hash(formaDoComando(segment)).slice(0, 12)}`
}

function familiaDaFerramenta(input) {
  if (typeof input?.tool_input_family === 'string' && input.tool_input_family.trim()) {
    return input.tool_input_family.trim().slice(0, 120)
  }
  const tool = nomeExecutavel(input?.tool_name) || 'tool'
  if (/sendmessage|send-message/.test(tool)) return 'message:dispatch'
  const command = comandoDaEntrada(input)
  if (command) return familiaDoComando(command)
  const keys = input?.tool_input && typeof input.tool_input === 'object'
    ? Object.keys(input.tool_input).filter((key) => !/message|content|prompt|text/i.test(key)).sort()
    : []
  return keys.length ? `${tool}:fields-${hash(keys.join(':')).slice(0, 12)}` : `${tool}:input-unavailable`
}

function familiaDoErro(input) {
  const firstLine = String(input?.error ?? '').split(/\r?\n/)[0].trim().toLowerCase()
  if (!firstLine) return 'execution-failed'
  if (/^exit code\s*[:=]?\s*-?\d+\s*$/i.test(firstLine)) return 'exit-code-only'
  if (/permission|denied|forbidden|unauthorized/.test(firstLine)) return 'permission'
  if (/timeout|timed out/.test(firstLine)) return 'timeout'
  if (/not found|enoent/.test(firstLine)) return 'not-found'
  if (/syntax|parse/.test(firstLine)) return 'syntax'
  return `detail-${hash(formaDoComando(firstLine)).slice(0, 12)}`
}

export function assinaturaDiagnosticaFalha(input) {
  const cwdFingerprint = input?.cwd ? hash(String(input.cwd).toLowerCase()).slice(0, 12) : 'unknown'
  return [
    'failure-signature-v2',
    `tool=${nomeExecutavel(input?.tool_name) || 'tool'}`,
    `class=${classeDeErro(input)}`,
    `code=${codigoErro(input)}`,
    `family=${familiaDaFerramenta(input)}`,
    `context=${cwdFingerprint}`,
    `error=${familiaDoErro(input)}`
  ].join('|')
}

function recuperacaoParaClasse(failureClass) {
  return {
    permission: 'verificar identidade, proprietario e permissao necessaria antes de repetir',
    timeout: 'distinguir processo em andamento de bloqueio real e ajustar o limite com evidencia',
    dependency: 'verificar dependencia e versao disponiveis antes de executar novamente',
    'validation-error': 'validar sintaxe e contrato da entrada antes de reenviar',
    environment: 'confirmar executavel, caminho e diretorio de trabalho antes de repetir',
    'tool-error': 'preservar codigo de saida, diagnosticar a causa e escolher uma alternativa verificavel'
  }[failureClass] ?? 'diagnosticar a causa antes de repetir a mesma acao'
}

function objetivoDeclarado(prompt) {
  const sentence = prompt
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .find((item) => /\b(?:meu objetivo|minha meta|quero construir|quero chegar|preciso entregar)\b/i.test(item))
  return texto(sentence, 240)
}

export async function observarPrompt(casa, input) {
  const prompt = texto(input?.prompt, 1000)
  if (!prompt) return { event: null, corrections: [] }
  const event = await observarEvento(casa, {
    eventType: 'user-prompt',
    sessionId: input.session_id,
    evidenceId: `prompt:${input.session_id}:${hash(prompt)}`,
    cwd: input.cwd,
    summary: `Pedido recebido (${prompt.length} caracteres)`,
    objective: objetivoDeclarado(prompt)
  })
  const corrections = []
  const origin = input?.origin ?? 'owner-live'
  const ownerOrigin = origin === 'owner-live' || origin === 'owner-transcript'
  for (const correction of ownerOrigin
    ? CORRECOES.filter((item) => item.matches ? item.matches(prompt) : item.pattern.test(prompt))
    : []) {
    const evidenceId = `correction:${input.session_id}:${correction.id}:${hash(prompt)}`
    const failure = await registrarFalha(casa, {
      agent: 'omni',
      action: correction.action,
      failureClass: 'logic',
      signature: correction.id,
      evidenceId
    })
    const improvement = await proporMelhoriaOperacional(casa, {
      category: 'owner-correction',
      destination: correction.destination,
      statement: correction.statement
    })
    let materialization = null
    if (improvement.candidate?.status === 'ready') {
      materialization = await materializarMelhoriaConfigurada(casa, improvement.candidate.id)
    }
    corrections.push({
      id: correction.id,
      failure: failure.result,
      improvement: improvement.result,
      candidateId: improvement.candidate?.id ?? null,
      destination: improvement.candidate?.destination ?? null,
      candidateStatus: materialization?.candidate?.status ?? improvement.candidate?.status ?? null,
      materialization
    })
  }
  return { event, corrections }
}

export async function observarFerramenta(casa, input) {
  const failed = input?.hook_event_name === 'PostToolUseFailure'
  const event = await observarEvento(casa, {
    eventType: failed ? 'tool-failure' : 'tool-success',
    sessionId: input.session_id,
    evidenceId: input.tool_use_id ?? `${input.session_id}:${input.tool_name}:${Date.now()}`,
    cwd: input.cwd,
    toolName: input.tool_name,
    status: failed ? 'failed' : 'succeeded',
    summary: failed
      ? `${input.tool_name ?? 'tool'} falhou: classe=${classeDeErro(input)}; codigo=${codigoErro(input)}`
      : `${input.tool_name ?? 'tool'} concluida`,
    durationMs: input.duration_ms
  })
  if (!failed) return { event, failure: null, improvement: null, materialization: null }
  const failure = await registrarFalha(casa, {
    agent: 'omni',
    action: `executar ${texto(input.tool_name, 80) ?? 'ferramenta'}`,
    failureClass: classeDeErro(input),
    signature: assinaturaDiagnosticaFalha(input),
    evidenceId: input.tool_use_id ?? `${input.session_id}:${hash(input.error)}`
  })
  let improvement = null
  let materialization = null
  if (failure.result === 'candidate') {
    const toolName = texto(input.tool_name, 80) ?? 'a ferramenta'
    const failureClass = failure.pattern?.failureClass ?? classeDeErro(input)
    improvement = await proporMelhoriaOperacional(casa, {
      category: 'repeated-tool-failure',
      destination: 'procedure',
      statement: `Quando ${toolName} falhar por ${failureClass}, ${recuperacaoParaClasse(failureClass)}.`
    })
    if (improvement.candidate?.status === 'ready') {
      materialization = await materializarMelhoriaConfigurada(casa, improvement.candidate.id)
    }
  }
  return {
    event,
    failure,
    improvement,
    candidateId: improvement?.candidate?.id ?? null,
    destination: improvement?.candidate?.destination ?? null,
    candidateStatus: materialization?.candidate?.status ?? improvement?.candidate?.status ?? null,
    materialization
  }
}

export async function observarInicioSubagente(casa, input) {
  const delegation = await observarDelegacao(casa, {
    state: 'running',
    sessionId: input.session_id,
    agentId: input.agent_id,
    agentType: input.agent_type
  })
  await observarEvento(casa, {
    eventType: 'delegation-start',
    sessionId: input.session_id,
    evidenceId: `agent-start:${input.agent_id}`,
    cwd: input.cwd,
    status: delegation.result,
    summary: `Executor ${texto(input.agent_type, 80) ?? 'agent'} iniciado`
  })
  return delegation
}

export async function observarFimSubagente(casa, input) {
  const rawSummary = texto(input.last_assistant_message, 1000)
  const summary = `Relato do executor recebido (${rawSummary?.length ?? 0} caracteres)`
  const delegation = await observarDelegacao(casa, {
    state: 'reported',
    sessionId: input.session_id,
    agentId: input.agent_id,
    agentType: input.agent_type,
    evidence: input.agent_transcript_path,
    summary,
    auditActionId: input.audit_action_id,
    auditEvidenceId: input.audit_evidence_id
  })
  await observarEvento(casa, {
    eventType: 'delegation-report',
    sessionId: input.session_id,
    evidenceId: `agent-stop:${input.agent_id}:${hash(summary)}`,
    cwd: input.cwd,
    status: delegation.result,
    summary
  })
  return delegation
}

export async function observarParada(casa, input) {
  const answer = texto(input?.last_assistant_message, 1000)
  const event = await observarEvento(casa, {
    eventType: input?.hook_event_name === 'StopFailure' ? 'stop-failure' : 'stop',
    sessionId: input.session_id,
    evidenceId: `stop:${input.session_id}:${hash(answer ?? input.error ?? Date.now())}`,
    cwd: input.cwd,
    status: input?.hook_event_name === 'StopFailure' ? 'failed' : 'completed',
    summary: input?.hook_event_name === 'StopFailure'
      ? `Resposta falhou: ${texto(input?.error, 80) ?? 'unknown'}`
      : `Resposta concluida (${answer?.length ?? 0} caracteres)`
  })
  const signals = []
  if (answer && /\b(?:quer que eu|se quiser|posso fazer|me diga se)\b/i.test(answer)) {
    signals.push(await proporMelhoriaOperacional(casa, {
      category: 'conversation-eval',
      destination: 'personality',
      statement: 'Quando a proxima acao for segura e evidente, execute-a e apresente o resultado em vez de encerrar com oferta generica.'
    }))
  }
  if (answer && answer.length < 90 && !/[.!?].*[.!?]/s.test(answer)) {
    signals.push(await proporMelhoriaOperacional(casa, {
      category: 'conversation-eval',
      destination: 'personality',
      statement: 'Dar respostas concisas com presenca, contexto e uma imagem mental natural quando isso ajudar.'
    }))
  }
  return { event, signals }
}
