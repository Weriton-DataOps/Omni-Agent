import { openWorkspace } from '../../application/open-workspace/open-workspace.js';
import { resolveWorkspaceTarget } from '../../application/open-workspace/resolve-workspace-target.js';
import { NodeWorkspaceEvidenceFingerprinter } from './node-workspace-evidence-fingerprinter.js';
import { NodeWorkspaceFileSystem } from './node-workspace-filesystem.js';
import { NodeWorkspaceProcess } from './node-workspace-process.js';
import { NodeWorkspacePathPolicy } from './node-workspace-path-policy.js';
import { VscodeCliLocator } from './vscode-cli-locator.js';
function dependencies(options) {
    const environment = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const fileSystem = new NodeWorkspaceFileSystem(options.stat, options.exists, options.readText);
    const pathPolicy = new NodeWorkspacePathPolicy(platform);
    return {
        environment,
        defaultHubRoot: platform === 'win32' ? 'C:\\hub-wp' : null,
        fileSystem,
        process: new NodeWorkspaceProcess(options.run, environment),
        cliLocator: new VscodeCliLocator(fileSystem, environment, platform),
        pathPolicy,
        evidenceFingerprinter: new NodeWorkspaceEvidenceFingerprinter()
    };
}
export function resolverAlvoProjetoVscode(literalTarget, options = {}) {
    const resolved = dependencies(options);
    return resolveWorkspaceTarget(literalTarget, resolved);
}
export function resolverCodeCmd(options = {}) {
    return dependencies(options).cliLocator.resolve().executable;
}
export function resolverPlanoCliVscode(options = {}) {
    return dependencies(options).cliLocator.resolve();
}
export function statusConfirmaWorkspace(statusOutput, canonicalPath, platform = process.platform) {
    return new NodeWorkspacePathPolicy(platform).statusContainsExactPath(statusOutput, canonicalPath);
}
export function abrirProjetoNoVscode(request, options = {}) {
    return openWorkspace(request, dependencies(options));
}
