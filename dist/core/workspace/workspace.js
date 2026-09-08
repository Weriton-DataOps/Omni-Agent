function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function parseOpenWorkspaceRequest(value) {
    const input = asRecord(value);
    if (!input)
        return { ok: false, issues: ['workspace-request:not-object'] };
    const issues = [];
    const literalTarget = input.literalTarget;
    if (typeof literalTarget !== 'string' || !literalTarget.trim()) {
        issues.push('literalTarget:required-string');
    }
    const expectedRepository = input.expectedRepository;
    if (expectedRepository !== undefined && expectedRepository !== null &&
        typeof expectedRepository !== 'string') {
        issues.push('expectedRepository:expected-string-or-null');
    }
    for (const field of ['reuseWindow', 'startClaudeSession']) {
        if (input[field] !== undefined && typeof input[field] !== 'boolean') {
            issues.push(`${field}:expected-boolean`);
        }
    }
    if (issues.length > 0 || typeof literalTarget !== 'string')
        return { ok: false, issues };
    return {
        ok: true,
        value: {
            literalTarget: literalTarget.trim(),
            expectedRepository: typeof expectedRepository === 'string' ? expectedRepository : null,
            reuseWindow: input.reuseWindow === true,
            startClaudeSession: input.startClaudeSession === true
        }
    };
}
export class WorkspaceInputValidationError extends Error {
    issues;
    name = 'WorkspaceInputValidationError';
    constructor(issues) {
        super(`Entrada de workspace invalida: ${issues.join(', ')}.`);
        this.issues = issues;
    }
}
