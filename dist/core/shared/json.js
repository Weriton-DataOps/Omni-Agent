function normalize(value) {
    if (value === undefined)
        return null;
    if (Array.isArray(value))
        return value.map(normalize);
    if (value !== null && typeof value === 'object') {
        const source = value;
        const normalized = {};
        for (const key of Object.keys(source).sort()) {
            const item = source[key];
            if (item !== undefined)
                normalized[key] = normalize(item);
        }
        return normalized;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    throw new TypeError(`Valor não serializável como JSON: ${typeof value}.`);
}
export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}
