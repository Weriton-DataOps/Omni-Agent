export function credentialExecutionOperation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid private operation.');
    const item = value;
    if (item.kind === 'postgres.catalog' && Object.keys(item).every(key => ['kind', 'page'].includes(key)) && Number.isInteger(item.page) && Number(item.page) >= 0 && Number(item.page) < 50)
        return { kind: item.kind, page: Number(item.page) };
    if (item.kind === 'postgres.freshness' && Object.keys(item).length === 4 && ['schema', 'table', 'column'].every(key => typeof item[key] === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u.test(String(item[key])))) {
        return { kind: item.kind, schema: String(item.schema), table: String(item.table), column: String(item.column) };
    }
    throw new Error('Invalid private operation.');
}
