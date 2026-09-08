export const DEFAULT_INLINE_CONTEXT_BUDGET = 9_500

interface ContextBlockBase {
  readonly id: string
  readonly content: string
}

export interface RequiredContextBlock extends ContextBlockBase {
  readonly kind: 'required'
  readonly compact?: string
}

export interface CompactableContextBlock extends ContextBlockBase {
  readonly kind: 'compactable'
  readonly compact: string
  readonly priority: number
}

export interface OptionalContextBlock extends ContextBlockBase {
  readonly kind: 'optional'
  readonly priority: number
}

export type ContextBlock =
  | RequiredContextBlock
  | CompactableContextBlock
  | OptionalContextBlock

export interface ContextAssembly {
  readonly text: string
  readonly budgetCharacters: number
  readonly characters: number
  readonly included: readonly string[]
  readonly compacted: readonly string[]
  readonly omitted: readonly string[]
  readonly truncated: boolean
}

interface SelectedBlock {
  readonly block: ContextBlock
  content: string
  compacted: boolean
  omitted: boolean
}

export class RequiredContextExceedsBudgetError extends Error {
  constructor(
    readonly budgetCharacters: number,
    readonly requiredCharacters: number,
    readonly requiredBlockIds: readonly string[]
  ) {
    super(`Blocos obrigatórios de contexto exigem ${requiredCharacters} caracteres para um orçamento de ${budgetCharacters}.`)
    this.name = 'RequiredContextExceedsBudgetError'
  }
}

function normalizedContent(value: string): string {
  return value.replace(/\r\n/gu, '\n').trim()
}

function rendered(selected: readonly SelectedBlock[]): string {
  return selected
    .filter((item) => !item.omitted)
    .map((item) => item.content)
    .filter(Boolean)
    .join('\n\n')
}

function validateBlocks(blocks: readonly ContextBlock[]): SelectedBlock[] {
  const ids = new Set<string>()
  return blocks.map((block) => {
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(block.id)) {
      throw new TypeError(`ContextBlock possui id inválido: ${block.id}.`)
    }
    if (ids.has(block.id)) throw new TypeError(`ContextBlock duplicado: ${block.id}.`)
    ids.add(block.id)
    const content = normalizedContent(block.content)
    if (block.kind === 'required' && !content) {
      throw new TypeError(`ContextBlock obrigatório está vazio: ${block.id}.`)
    }
    if (block.kind === 'required' && block.compact !== undefined && !normalizedContent(block.compact)) {
      throw new TypeError(`ContextBlock obrigatório possui forma compacta vazia: ${block.id}.`)
    }
    if (block.kind === 'compactable' && !normalizedContent(block.compact)) {
      throw new TypeError(`ContextBlock compactável não possui forma compacta: ${block.id}.`)
    }
    if (block.kind !== 'required' && (!Number.isFinite(block.priority) || block.priority < 0)) {
      throw new TypeError(`ContextBlock possui prioridade inválida: ${block.id}.`)
    }
    return { block, content, compacted: false, omitted: !content }
  })
}

function compact(selected: SelectedBlock): void {
  if (selected.block.kind === 'optional') return
  const compactContent = normalizedContent(selected.block.compact ?? selected.block.content)
  if (compactContent.length >= selected.content.length) return
  selected.content = compactContent
  selected.compacted = true
}

export function assembleContextBlocks(
  blocks: readonly ContextBlock[],
  budgetCharacters = DEFAULT_INLINE_CONTEXT_BUDGET
): ContextAssembly {
  if (!Number.isSafeInteger(budgetCharacters) || budgetCharacters <= 0) {
    throw new TypeError('O orçamento de contexto precisa ser um inteiro positivo.')
  }
  const selected = validateBlocks(blocks)

  const degradable = selected
    .filter((item): item is SelectedBlock & { block: CompactableContextBlock | OptionalContextBlock } =>
      !item.omitted && item.block.kind !== 'required'
    )
    .sort((left, right) =>
      left.block.priority - right.block.priority || left.block.id.localeCompare(right.block.id)
    )
  for (const item of degradable) {
    if (rendered(selected).length <= budgetCharacters) break
    if (item.block.kind === 'optional') item.omitted = true
    else compact(item)
  }

  // A forma compacta continua sendo um bloco degradavel. Se todas as
  // compactacoes ainda excederem o orcamento, remova blocos inteiros em
  // ordem de prioridade em vez de atribuir o excesso aos obrigatorios.
  for (const item of degradable) {
    if (rendered(selected).length <= budgetCharacters) break
    if (item.block.kind === 'compactable' && !item.omitted) item.omitted = true
  }

  const requiredWithCompact = selected
    .filter((item): item is SelectedBlock & { block: RequiredContextBlock } =>
      !item.omitted && item.block.kind === 'required' && typeof item.block.compact === 'string'
    )
    .sort((left, right) => left.block.id.localeCompare(right.block.id))
  for (const item of requiredWithCompact) {
    if (rendered(selected).length <= budgetCharacters) break
    compact(item)
  }

  const text = rendered(selected)
  if (text.length > budgetCharacters) {
    const required = selected.filter((item) => !item.omitted && item.block.kind === 'required')
    const requiredText = required.map((item) => item.content).join('\n\n')
    throw new RequiredContextExceedsBudgetError(
      budgetCharacters,
      requiredText.length,
      required.map((item) => item.block.id)
    )
  }

  return {
    text,
    budgetCharacters,
    characters: text.length,
    included: selected.filter((item) => !item.omitted).map((item) => item.block.id),
    compacted: selected.filter((item) => item.compacted && !item.omitted).map((item) => item.block.id),
    omitted: selected.filter((item) => item.omitted).map((item) => item.block.id),
    truncated: selected.some((item) => item.compacted || item.omitted)
  }
}
