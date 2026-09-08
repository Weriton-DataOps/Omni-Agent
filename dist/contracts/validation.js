export class ContractValidationError extends Error {
    path;
    constructor(path, message) {
        super(`${path}: ${message}`);
        this.path = path;
        this.name = 'ContractValidationError';
    }
}
export function record(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ContractValidationError(path, 'objeto esperado');
    }
    return value;
}
export function closedRecord(value, path, allowedKeys) {
    const result = record(value, path);
    const allowed = new Set(allowedKeys);
    const unknownKey = Object.keys(result).find((key) => !allowed.has(key));
    if (unknownKey)
        throw new ContractValidationError(`${path}.${unknownKey}`, 'campo desconhecido');
    return result;
}
export function nonEmptyString(value, path) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new ContractValidationError(path, 'texto não vazio esperado');
    }
    return value;
}
export function matchingString(value, path, pattern) {
    const result = nonEmptyString(value, path);
    if (!pattern.test(result))
        throw new ContractValidationError(path, 'formato inválido');
    return result;
}
export function array(value, path, bounds = {}) {
    if (!Array.isArray(value))
        throw new ContractValidationError(path, 'lista esperada');
    if (bounds.min !== undefined && value.length < bounds.min) {
        throw new ContractValidationError(path, `mínimo de ${bounds.min} itens`);
    }
    if (bounds.max !== undefined && value.length > bounds.max) {
        throw new ContractValidationError(path, `máximo de ${bounds.max} itens`);
    }
    return value;
}
export function integer(value, path, bounds = {}) {
    if (!Number.isInteger(value))
        throw new ContractValidationError(path, 'inteiro esperado');
    const result = value;
    if (bounds.min !== undefined && result < bounds.min)
        throw new ContractValidationError(path, `mínimo ${bounds.min}`);
    if (bounds.max !== undefined && result > bounds.max)
        throw new ContractValidationError(path, `máximo ${bounds.max}`);
    return result;
}
export function oneOf(value, path, allowed) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new ContractValidationError(path, `valor esperado: ${allowed.join(', ')}`);
    }
    return value;
}
export function uniqueStrings(value, path, options = {}) {
    const values = array(value, path, options).map((item, index) => {
        const itemPath = `${path}[${index}]`;
        const result = options.pattern
            ? matchingString(item, itemPath, options.pattern)
            : nonEmptyString(item, itemPath);
        if (options.allowed && !options.allowed.includes(result)) {
            throw new ContractValidationError(itemPath, `valor esperado: ${options.allowed.join(', ')}`);
        }
        return result;
    });
    if (new Set(values).size !== values.length)
        throw new ContractValidationError(path, 'itens duplicados');
    return values;
}
export function dateTime(value, path) {
    const result = nonEmptyString(value, path);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) {
        throw new ContractValidationError(path, 'data ISO 8601 inválida');
    }
    return result;
}
