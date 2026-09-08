function sameIdentity(readback, identity) {
    return readback.version === identity.version && readback.fingerprint === identity.fingerprint;
}
function sameRoot(left, right, comparison) {
    const normalizedLeft = left.replaceAll('\\', '/').replace(/\/+$/, '');
    const normalizedRight = right.replaceAll('\\', '/').replace(/\/+$/, '');
    return comparison === 'windows-insensitive'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}
function illegal(state, event) {
    throw new Error(`Transicao de release invalida: ${state.stage} + ${event.type}`);
}
export function reduceRelease(state, event) {
    switch (event.type) {
        case 'commit-confirmed':
            if (state.stage !== 'precommit-retry')
                return illegal(state, event);
            return { stage: 'committed', identity: event.identity };
        case 'push-confirmed':
            if (state.stage !== 'committed' || event.remoteCommitSha !== state.identity.commitSha) {
                return illegal(state, event);
            }
            return { stage: 'pushed', identity: state.identity, remoteCommitSha: event.remoteCommitSha };
        case 'install-confirmed':
            if (state.stage !== 'pushed' || !sameIdentity(event.readback, state.identity)) {
                return illegal(state, event);
            }
            return { stage: 'installed-verified', identity: state.identity, installed: event.readback };
        case 'reload-required':
            if (state.stage !== 'installed-verified')
                return illegal(state, event);
            return { stage: 'awaiting-reload', identity: state.identity, installed: state.installed };
        case 'runtime-loaded':
            if (state.stage !== 'awaiting-reload' ||
                !sameIdentity(event.readback, state.identity) ||
                !sameRoot(event.readback.root, state.installed.root, event.rootComparison))
                return illegal(state, event);
            return {
                stage: 'loaded-verified',
                identity: state.identity,
                installed: state.installed,
                loaded: event.readback
            };
    }
}
export function isEffectiveRelease(state) {
    return state.stage === 'loaded-verified';
}
export function deriveOperationalArtifacts(sourcePath) {
    const normalized = sourcePath.replaceAll('\\', '/').replace(/^\.\//, '');
    const artifacts = [normalized];
    if (normalized.startsWith('src/')) {
        if (/\.ts$/i.test(normalized) && !/\.d\.ts$/i.test(normalized)) {
            artifacts.push(`dist/${normalized.slice(4).replace(/\.ts$/i, '.js')}`);
        }
        else if (/\.json$/i.test(normalized)) {
            artifacts.push(`dist/${normalized.slice(4)}`);
        }
    }
    return [...new Set(artifacts)].sort();
}
