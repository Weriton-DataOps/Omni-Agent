export const DEFAULT_INLINE_CONTEXT_BUDGET = 9_500;
export class RequiredContextExceedsBudgetError extends Error {
    budgetCharacters;
    requiredCharacters;
    requiredBlockIds;
    constructor(budgetCharacters, requiredCharacters, requiredBlockIds) {
        super(`Blocos obrigatórios de contexto exigem ${requiredCharacters} caracteres para um orçamento de ${budgetCharacters}.`);
        this.budgetCharacters = budgetCharacters;
        this.requiredCharacters = requiredCharacters;
        this.requiredBlockIds = requiredBlockIds;
        this.name = 'RequiredContextExceedsBudgetError';
    }
}
function normalizedContent(value) {
    return value.replace(/\r\n/gu, '\n').trim();
}
function rendered(selected) {
    return selected
        .filter((item) => !item.omitted)
        .map((item) => item.content)
        .filter(Boolean)
        .join('\n\n');
}
function validateBlocks(blocks) {
    const ids = new Set();
    return blocks.map((block) => {
        if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(block.id)) {
            throw new TypeError(`ContextBlock possui id inválido: ${block.id}.`);
        }
        if (ids.has(block.id))
            throw new TypeError(`ContextBlock duplicado: ${block.id}.`);
        ids.add(block.id);
        const content = normalizedContent(block.content);
        if (block.kind === 'required' && !content) {
            throw new TypeError(`ContextBlock obrigatório está vazio: ${block.id}.`);
        }
        if (block.kind === 'required' && block.compact !== undefined && !normalizedContent(block.compact)) {
            throw new TypeError(`ContextBlock obrigatório possui forma compacta vazia: ${block.id}.`);
        }
        if (block.kind === 'compactable' && !normalizedContent(block.compact)) {
            throw new TypeError(`ContextBlock compactável não possui forma compacta: ${block.id}.`);
        }
        if (block.kind !== 'required' && (!Number.isFinite(block.priority) || block.priority < 0)) {
            throw new TypeError(`ContextBlock possui prioridade inválida: ${block.id}.`);
        }
        return { block, content, compacted: false, omitted: !content };
    });
}
function compact(selected) {
    if (selected.block.kind === 'optional')
        return;
    const compactContent = normalizedContent(selected.block.compact ?? selected.block.content);
    if (compactContent.length >= selected.content.length)
        return;
    selected.content = compactContent;
    selected.compacted = true;
}
export function assembleContextBlocks(blocks, budgetCharacters = DEFAULT_INLINE_CONTEXT_BUDGET) {
    if (!Number.isSafeInteger(budgetCharacters) || budgetCharacters <= 0) {
        throw new TypeError('O orçamento de contexto precisa ser um inteiro positivo.');
    }
    const selected = validateBlocks(blocks);
    const degradable = selected
        .filter((item) => !item.omitted && item.block.kind !== 'required')
        .sort((left, right) => left.block.priority - right.block.priority || left.block.id.localeCompare(right.block.id));
    for (const item of degradable) {
        if (rendered(selected).length <= budgetCharacters)
            break;
        if (item.block.kind === 'optional')
            item.omitted = true;
        else
            compact(item);
    }
    // A forma compacta continua sendo um bloco degradavel. Se todas as
    // compactacoes ainda excederem o orcamento, remova blocos inteiros em
    // ordem de prioridade em vez de atribuir o excesso aos obrigatorios.
    for (const item of degradable) {
        if (rendered(selected).length <= budgetCharacters)
            break;
        if (item.block.kind === 'compactable' && !item.omitted)
            item.omitted = true;
    }
    const requiredWithCompact = selected
        .filter((item) => !item.omitted && item.block.kind === 'required' && typeof item.block.compact === 'string')
        .sort((left, right) => left.block.id.localeCompare(right.block.id));
    for (const item of requiredWithCompact) {
        if (rendered(selected).length <= budgetCharacters)
            break;
        compact(item);
    }
    const text = rendered(selected);
    if (text.length > budgetCharacters) {
        const required = selected.filter((item) => !item.omitted && item.block.kind === 'required');
        const requiredText = required.map((item) => item.content).join('\n\n');
        throw new RequiredContextExceedsBudgetError(budgetCharacters, requiredText.length, required.map((item) => item.block.id));
    }
    return {
        text,
        budgetCharacters,
        characters: text.length,
        included: selected.filter((item) => !item.omitted).map((item) => item.block.id),
        compacted: selected.filter((item) => item.compacted && !item.omitted).map((item) => item.block.id),
        omitted: selected.filter((item) => item.omitted).map((item) => item.block.id),
        truncated: selected.some((item) => item.compacted || item.omitted)
    };
}
