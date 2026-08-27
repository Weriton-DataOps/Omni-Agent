import { createHash } from 'node:crypto'

import { registrarObservacaoAtalho } from './atalhos.mjs'
import {
  observarDelegacao,
  observarEvento,
  proporMelhoriaOperacional
} from './ciclo-operacional.mjs'
import { registrarFalha } from './falhas.mjs'
import { pareceConterSegredo } from './memoria.mjs'
import { materializarMelhoriaConfigurada } from './evolucao.mjs'

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
    pattern: /\b(seco|frio|sem vida|personalidade|poucas analogias|sem analogia)\b/i,
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
    pattern: /\b(n[aã]o (?:foi|era|falei|pedi).{0,60}|seja mais fiel|fez errado|respondeu errado)\b/i,
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
  for (const correction of CORRECOES.filter((item) => item.pattern.test(prompt))) {
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
    if (improvement.candidate?.status === 'ready') {
      await materializarMelhoriaConfigurada(casa, improvement.candidate.id)
    }
    corrections.push({ id: correction.id, failure: failure.result, improvement: improvement.result })
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
  if (!failed) return { event, failure: null }
  const failure = await registrarFalha(casa, {
    agent: 'omni',
    action: `executar ${texto(input.tool_name, 80) ?? 'ferramenta'}`,
    failureClass: classeDeErro(input),
    signature: assinaturaDiagnosticaFalha(input),
    evidenceId: input.tool_use_id ?? `${input.session_id}:${hash(input.error)}`
  })
  if (failure.result === 'candidate') {
    const toolName = texto(input.tool_name, 80) ?? 'a ferramenta'
    const failureClass = failure.pattern?.failureClass ?? classeDeErro(input)
    const improvement = await proporMelhoriaOperacional(casa, {
      category: 'repeated-tool-failure',
      destination: 'procedure',
      statement: `Quando ${toolName} falhar por ${failureClass}, ${recuperacaoParaClasse(failureClass)}.`
    })
    if (improvement.candidate?.status === 'ready') {
      await materializarMelhoriaConfigurada(casa, improvement.candidate.id)
    }
  }
  return { event, failure }
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
    status: 'running',
    summary: `Executor ${texto(input.agent_type, 80) ?? 'agent'} iniciado`
  })
  return delegation
}

export async function observarFimSubagente(casa, input) {
  const rawSummary = texto(input.last_assistant_message, 1000)
  const summary = `Execucao concluida (${rawSummary?.length ?? 0} caracteres)`
  const delegation = await observarDelegacao(casa, {
    state: 'completed',
    sessionId: input.session_id,
    agentId: input.agent_id,
    agentType: input.agent_type,
    evidence: input.agent_transcript_path ?? input.agent_id,
    summary
  })
  await observarEvento(casa, {
    eventType: 'delegation-complete',
    sessionId: input.session_id,
    evidenceId: `agent-stop:${input.agent_id}:${hash(summary)}`,
    cwd: input.cwd,
    status: 'completed',
    summary
  })
  await registrarObservacaoAtalho(casa, {
    goal: `delegar para ${texto(input.agent_type, 80) ?? 'executor'}`,
    baselineSteps: ['preparar tarefa', 'executar na conversa central', 'verificar', 'reportar'],
    shortcutSteps: ['delegar com contexto', 'receber evidencia', 'reportar'],
    outcome: 'delegacao concluida com evidencia',
    success: true,
    scope: { type: 'user' }
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
