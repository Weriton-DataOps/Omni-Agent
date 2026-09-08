import { normalizeWorkspaceAlias } from '../../core/workspace/workspace-alias.js';
const PROJECT_ALIASES = Object.freeze({
    hub: 'OMNI_PROJECT_HUB_ROOT',
    'hub-wp': 'OMNI_PROJECT_HUB_ROOT',
    'projeto hub': 'OMNI_PROJECT_HUB_ROOT'
});
function errorCode(error) {
    return error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
}
export function resolveWorkspaceTarget(literalTarget, dependencies) {
    if (typeof literalTarget !== 'string' || !literalTarget.trim()) {
        throw new Error('A abertura do VS Code exige alvo literal ou alias de projeto explicito.');
    }
    const requested = literalTarget.trim();
    const aliasVariable = PROJECT_ALIASES[normalizeWorkspaceAlias(requested)];
    const configured = aliasVariable ? dependencies.environment[aliasVariable] : null;
    const selected = dependencies.pathPolicy.isAbsolute(requested)
        ? requested
        : aliasVariable
            ? configured || dependencies.defaultHubRoot
            : null;
    if (!selected || !dependencies.pathPolicy.isAbsolute(selected)) {
        throw new Error(`Projeto desconhecido: ${requested}. Informe um caminho absoluto; o cwd nunca e usado como fallback.`);
    }
    const canonicalPath = dependencies.pathPolicy.resolve(selected);
    let info;
    try {
        info = dependencies.fileSystem.stat(canonicalPath);
    }
    catch (error) {
        if (errorCode(error) === 'ENOENT')
            throw new Error(`Projeto inexistente: ${canonicalPath}.`);
        throw error;
    }
    if (!info.isDirectory())
        throw new Error(`Alvo do projeto nao e um diretorio: ${canonicalPath}.`);
    return {
        literalTarget: requested,
        alias: aliasVariable ? 'hub' : null,
        canonicalPath,
        resolution: dependencies.pathPolicy.isAbsolute(requested) ? 'literal-path' : 'explicit-alias',
        cwdFallbackUsed: false
    };
}
