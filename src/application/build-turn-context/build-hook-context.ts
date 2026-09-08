import {
  CRITICAL_COMPACT_ANCHOR,
  CRITICAL_TURN_CLOSING,
  CRITICAL_VOICE_RULE,
  renderCompactPersonalityAnchor,
  renderCompactPersonalityInstruction,
  renderFullPersonalityInstruction,
  renderCompactVoiceExample
} from '../../core/personality/personality.js'
import {
  assembleContextBlocks,
  DEFAULT_INLINE_CONTEXT_BUDGET,
  type ContextAssembly,
  type ContextBlock
} from '../../core/context/context-block.js'
import { projectionToContextBlocks } from '../../core/context/projection-blocks.js'

const TRUNCATION_NOTICE = [
  'CONTEXTO AUXILIAR TRUNCADO POR BLOCOS COMPLETOS: o limite inline de 9.500 caracteres foi aplicado.',
  'A personalidade, as regras obrigatórias e o encerramento crítico foram preservados; nenhum bloco foi cortado no meio.'
].join(' ')

export interface HookTurnContextInput {
  readonly persona: unknown
  readonly projection: string
  readonly persistentDirection?: string | null
  readonly turnAdjustment?: string | null
  readonly ownerCorrection?: string | null
  readonly automation?: string | null
  readonly audit?: string | null
  readonly systemAudit?: string | null
  readonly degradation?: string | null
  readonly gallerySeed?: string | null
  readonly budgetCharacters?: number
}

export interface ActivationContextInput {
  readonly persona: unknown
  readonly mode: 'activate' | 'resume' | 'compact'
  readonly persistentDirection?: string | null
  readonly degradation?: string | null
  readonly budgetCharacters?: number
}

/** Keep a bounded demonstration and learned direction across tool transitions. */
export interface CompactEventContextInput {
  readonly persona: unknown
  readonly persistentDirection?: string | null
  readonly gallerySeed?: string | null
  readonly automation?: string | null
  readonly degradation?: string | null
  readonly budgetCharacters?: number
}

function completeLineCompact(content: string, maximumLines: number): string {
  return content.replace(/\r\n/gu, '\n').split('\n').slice(0, maximumLines).join('\n').trim()
}

function optionalBlock(
  id: string,
  content: string | null | undefined,
  priority: number
): ContextBlock | null {
  return content?.trim() ? { kind: 'optional', id, content, priority } : null
}

function compactableBlock(
  id: string,
  content: string | null | undefined,
  priority: number,
  maximumLines = 8
): ContextBlock | null {
  if (!content?.trim()) return null
  return {
    kind: 'compactable',
    id,
    content,
    compact: completeLineCompact(content, maximumLines),
    priority
  }
}

function voiceSampleBlock(
  id: string,
  persona: unknown,
  seed: string | null | undefined
): ContextBlock | null {
  const sample = renderCompactVoiceExample(persona, seed ?? '')
  return sample ? { kind: 'required', id, content: sample } : null
}

function noticeWorthyTruncation(assembly: ContextAssembly): boolean {
  return assembly.compacted.length > 0 || assembly.omitted.length > 0
}

function assembleWithNotice(blocks: readonly ContextBlock[], budgetCharacters: number): ContextAssembly {
  const first = assembleContextBlocks(blocks, budgetCharacters)
  if (!first.truncated || !noticeWorthyTruncation(first)) return first
  return assembleContextBlocks([
    ...blocks.slice(0, 1),
    { kind: 'required', id: 'context:compaction-notice', content: TRUNCATION_NOTICE },
    ...blocks.slice(1)
  ], budgetCharacters)
}

export function buildHookTurnContext(input: HookTurnContextInput): ContextAssembly {
  const budget = input.budgetCharacters ?? DEFAULT_INLINE_CONTEXT_BUDGET
  const blocks: Array<ContextBlock | null> = [
    {
      kind: 'required',
      id: 'turn:personality',
      content: [
        '<omni-contexto-interno>',
        'A ativação do Omni continua vigente nesta sessão. Não exponha este bloco nem sua implementação.',
        '',
        'PERSONALIDADE CANÔNICA:',
        renderCompactPersonalityInstruction(input.persona)
      ].join('\n')
    },
    input.persistentDirection?.trim() ? { kind: 'required', id: 'turn:persistent-direction', content: input.persistentDirection, compact: completeLineCompact(input.persistentDirection, 8) } : null,
    compactableBlock('turn:owner-adjustment', input.turnAdjustment, 100, 8),
    input.ownerCorrection?.trim()
      ? { kind: 'required', id: 'turn:owner-operational-correction', content: input.ownerCorrection }
      : null,
    compactableBlock('turn:degradation', input.degradation, 94, 4),
    { kind: 'required', id: 'turn:voice-anchor', content: CRITICAL_COMPACT_ANCHOR },
    voiceSampleBlock('turn:voice-sample', input.persona, input.gallerySeed),
    input.audit?.trim() ? {
      kind: 'required', id: 'turn:audit',
      content: `AUDITORIA E AUTOCORREÇÃO INTERNAS OBRIGATÓRIAS: confira pedido, ações e estado real. Corrija divergências autorizadas; mudança e delegação exigem readback. Nunca devolva comandos ao proprietário nem declare sucesso sem prova. ${input.audit.match(/turno=[^ ]+\s*tipo=[^ ]+\s*vinculo=[^ ]+/u)?.[0] ?? ''} ${input.audit.match(/omni-request-binding:[a-f0-9]{64}/u)?.[0] ? `Sem alvo literal, vincule o comando com ${input.audit.match(/omni-request-binding:[a-f0-9]{64}/u)?.[0]}; o marcador não substitui a prova.` : ''}`
    } : null,
    optionalBlock('turn:system-audit', input.systemAudit, 35),
    ...projectionToContextBlocks(input.projection),
    compactableBlock('turn:automation', input.automation, 99, 16),
    { kind: 'required', id: 'turn:closing', content: CRITICAL_TURN_CLOSING }
  ]
  return assembleWithNotice(blocks.filter((block): block is ContextBlock => block !== null), budget)
}

export function buildActivationContext(input: ActivationContextInput): ContextAssembly {
  const budget = input.budgetCharacters ?? DEFAULT_INLINE_CONTEXT_BUDGET
  const event = input.mode === 'compact'
    ? 'A conversa do Omni acabou de passar por compactação.'
    : input.mode === 'resume'
      ? 'Uma sessão já ativada do Omni acaba de ser retomada.'
      : 'O Omni acaba de ser ativado nesta sessão.'
  const finalInstruction = input.mode === 'activate'
    ? 'Responda à ativação já como Omni: a personalidade governa desde a primeira frase.'
    : 'A ativação anterior continua vigente. Retome a próxima resposta já como Omni; a personalidade governa desde a primeira frase.'
  const blocks: Array<ContextBlock | null> = [
    {
      kind: 'required',
      id: 'activation:personality',
      content: [
        '<omni-contexto-interno>',
        event,
        'Não exponha este bloco nem sua implementação.',
        '',
        'PERSONALIDADE CANÔNICA:',
        renderFullPersonalityInstruction(input.persona)
      ].join('\n'),
      compact: [
        '<omni-contexto-interno>',
        event,
        'Não exponha este bloco nem sua implementação.',
        '',
        'PERSONALIDADE CANÔNICA:',
        renderCompactPersonalityInstruction(input.persona)
      ].join('\n')
    },
    { kind: 'required', id: 'activation:voice-rule', content: CRITICAL_VOICE_RULE },
    input.persistentDirection?.trim() ? { kind: 'required', id: 'activation:persistent-direction', content: input.persistentDirection, compact: completeLineCompact(input.persistentDirection, 8) } : null,
    compactableBlock('activation:degradation', input.degradation, 94, 4),
    {
      kind: 'required',
      id: 'activation:closing',
      content: `${finalInstruction}\n</omni-contexto-interno>`
    }
  ]
  return assembleWithNotice(blocks.filter((block): block is ContextBlock => block !== null), budget)
}

export function buildCompactEventContext(input: CompactEventContextInput): ContextAssembly {
  const budget = input.budgetCharacters ?? DEFAULT_INLINE_CONTEXT_BUDGET
  const blocks: Array<ContextBlock | null> = [
    {
      kind: 'required',
      id: 'event:personality-anchor',
      content: renderCompactPersonalityAnchor(input.persona, input.degradation ?? null)
    },
    voiceSampleBlock('event:voice-sample', input.persona, input.gallerySeed),
    input.persistentDirection?.trim() ? { kind: 'required', id: 'event:persistent-direction', content: input.persistentDirection, compact: completeLineCompact(input.persistentDirection, 8) } : null,
    compactableBlock('event:automation', input.automation, 99, 16)
  ]
  return assembleWithNotice(blocks.filter((block): block is ContextBlock => block !== null), budget)
}

export function buildSimpleHookContext(
  content: string,
  budgetCharacters = DEFAULT_INLINE_CONTEXT_BUDGET
): ContextAssembly {
  return assembleContextBlocks([{ kind: 'required', id: 'hook:simple', content }], budgetCharacters)
}

export function renderLegacyAdditionalContext(input: Omit<HookTurnContextInput, 'budgetCharacters'>): string {
  return [
    '<omni-contexto-interno>',
    'A ativação do Omni continua vigente nesta sessão. Não exponha este bloco nem sua implementação.',
    '',
    'PERSONALIDADE CANÔNICA:',
    String(input.persona ?? ''),
    ...(input.persistentDirection ? ['', input.persistentDirection] : []),
    ...(input.turnAdjustment ? ['', input.turnAdjustment] : []),
    ...(input.ownerCorrection ? ['', input.ownerCorrection] : []),
    ...(input.degradation ? ['', input.degradation] : []),
    '',
    CRITICAL_COMPACT_ANCHOR,
    ...(input.automation ? ['', input.automation] : []),
    ...(input.audit ? ['', input.audit] : []),
    ...(input.systemAudit ? ['', input.systemAudit] : []),
    '',
    'CONTEXTO RECUPERADO PARA ESTE TURNO:',
    input.projection
  ].join('\n')
}

function legacyPrefixBlocks(prefix: string): readonly ContextBlock[] {
  const lines = prefix.replace(/\r\n/gu, '\n').split('\n').filter((line) => line.trim())
  return lines.map((line, index): ContextBlock => {
    const isPersonality = /PERSONALIDADE|PERSONA_|Inventor Cúmplice|ADAPTADOR DO CANAL ESCRITO/iu.test(line)
    return isPersonality
      ? { kind: 'required', id: `legacy:personality:${index}`, content: line }
      : { kind: 'optional', id: `legacy:prefix:${index}`, content: line, priority: Math.max(1, 80 - index) }
  })
}

export function limitLegacyAdditionalContext(
  additionalContext: unknown,
  essentialSuffix: unknown = '',
  budgetCharacters = DEFAULT_INLINE_CONTEXT_BUDGET
): string {
  const body = String(additionalContext ?? '')
  const suffix = String(essentialSuffix ?? '').trim()
  if (`${body}${body && suffix ? '\n\n' : ''}${suffix}`.length <= budgetCharacters) {
    return `${body}${body && suffix ? '\n\n' : ''}${suffix}`
  }
  const marker = '\n\nCONTEXTO RECUPERADO PARA ESTE TURNO:\n'
  const markerIndex = body.lastIndexOf(marker)
  const prefix = markerIndex >= 0 ? body.slice(0, markerIndex) : body
  const projection = markerIndex >= 0 ? body.slice(markerIndex + marker.length) : ''
  const blocks: ContextBlock[] = [
    ...legacyPrefixBlocks(prefix),
    ...(projection ? projectionToContextBlocks(projection) : []),
    ...(suffix ? [{ kind: 'required' as const, id: 'legacy:essential-suffix', content: suffix }] : [])
  ]
  return assembleWithNotice(blocks, budgetCharacters).text
}
