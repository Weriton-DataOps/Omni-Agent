import { parseOpenWorkspaceRequest, WorkspaceInputValidationError } from '../../core/workspace/workspace.js';
import { resolveWorkspaceTarget } from './resolve-workspace-target.js';
function outputOf(result) {
    return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}
export function openWorkspace(request, dependencies) {
    const parsed = parseOpenWorkspaceRequest(request);
    if (!parsed.ok)
        throw new WorkspaceInputValidationError(parsed.issues);
    const input = parsed.value;
    const target = resolveWorkspaceTarget(input.literalTarget, dependencies);
    let expectedRepository = null;
    if (input.expectedRepository !== null) {
        if (!dependencies.pathPolicy.isAbsolute(input.expectedRepository)) {
            return {
                state: 'blocked',
                success: false,
                reason: 'expected-repository-must-be-absolute',
                lastVerifiedState: 'target-resolved',
                ...target
            };
        }
        expectedRepository = dependencies.pathPolicy.resolve(input.expectedRepository);
        if (!dependencies.pathPolicy.equals(expectedRepository, target.canonicalPath)) {
            return {
                state: 'blocked',
                success: false,
                reason: 'target-does-not-match-expected-repository',
                lastVerifiedState: 'target-resolved',
                expectedRepository,
                expectedRepositoryVerified: false,
                ...target
            };
        }
    }
    if (input.startClaudeSession) {
        return {
            state: 'blocked',
            success: false,
            reason: 'claude-session-requires-supported-vscode-integration',
            lastVerifiedState: 'target-resolved',
            expectedRepository,
            expectedRepositoryVerified: expectedRepository !== null,
            claudePanelOpened: false,
            sessionVisible: false,
            briefingDelivered: false,
            ...target
        };
    }
    const launch = dependencies.cliLocator.resolve();
    const executable = launch.executable;
    const prefixArgs = [...launch.prefixArgs];
    const args = [input.reuseWindow ? '--reuse-window' : '--new-window', target.canonicalPath];
    const opened = dependencies.process.run(executable, [...prefixArgs, ...args], launch.environment);
    if (opened.status !== 0) {
        return {
            state: 'blocked',
            success: false,
            reason: 'vscode-open-command-failed',
            lastVerifiedState: 'target-resolved',
            executable,
            args,
            prefixArgs,
            evidenceFingerprint: dependencies.evidenceFingerprinter.fingerprint(outputOf(opened)),
            expectedRepository,
            expectedRepositoryVerified: expectedRepository !== null,
            claudePanelOpened: false,
            sessionVisible: false,
            briefingDelivered: false,
            ...target
        };
    }
    const status = dependencies.process.run(executable, [...prefixArgs, '--status'], launch.environment);
    const statusOutput = outputOf(status);
    const verified = status.status === 0 && dependencies.pathPolicy.statusContainsExactPath(statusOutput, target.canonicalPath);
    return {
        state: verified ? 'workspace-opened' : 'workspace-open-requested',
        success: verified,
        expectedRepository,
        expectedRepositoryVerified: expectedRepository !== null,
        executable,
        args,
        prefixArgs,
        verification: verified ? 'code-status-exact-path' : 'code-status-without-exact-path',
        evidenceFingerprint: dependencies.evidenceFingerprinter.fingerprint(statusOutput),
        claudePanelOpened: false,
        sessionVisible: false,
        briefingDelivered: false,
        ...target
    };
}
