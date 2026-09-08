export function normalizeWorkspaceAlias(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLowerCase();
}
