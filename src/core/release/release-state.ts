export interface ReleaseIdentity {
  version: string
  fingerprint: string
  commitSha: string
}

export interface InstalledReadback {
  root: string
  version: string
  fingerprint: string
  verificationFingerprint: string
}

export interface LoadedReadback extends InstalledReadback {
  verifiedAt: string
}

interface WithIdentity {
  identity: ReleaseIdentity
}

export type ReleaseState =
  | { stage: 'precommit-retry' }
  | ({ stage: 'committed' } & WithIdentity)
  | ({ stage: 'pushed'; remoteCommitSha: string } & WithIdentity)
  | ({ stage: 'installed-verified'; installed: InstalledReadback } & WithIdentity)
  | ({ stage: 'awaiting-reload'; installed: InstalledReadback } & WithIdentity)
  | ({ stage: 'loaded-verified'; installed: InstalledReadback; loaded: LoadedReadback } & WithIdentity)

export type ReleaseEvent =
  | { type: 'commit-confirmed'; identity: ReleaseIdentity }
  | { type: 'push-confirmed'; remoteCommitSha: string }
  | { type: 'install-confirmed'; readback: InstalledReadback }
  | { type: 'reload-required' }
  | {
      type: 'runtime-loaded'
      readback: LoadedReadback
      rootComparison: 'case-sensitive' | 'windows-insensitive'
    }

function sameIdentity(readback: InstalledReadback, identity: ReleaseIdentity): boolean {
  return readback.version === identity.version && readback.fingerprint === identity.fingerprint
}

function sameRoot(
  left: string,
  right: string,
  comparison: 'case-sensitive' | 'windows-insensitive'
): boolean {
  const normalizedLeft = left.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedRight = right.replaceAll('\\', '/').replace(/\/+$/, '')
  return comparison === 'windows-insensitive'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function illegal(state: ReleaseState, event: ReleaseEvent): never {
  throw new Error(`Transicao de release invalida: ${state.stage} + ${event.type}`)
}

export function reduceRelease(state: ReleaseState, event: ReleaseEvent): ReleaseState {
  switch (event.type) {
    case 'commit-confirmed':
      if (state.stage !== 'precommit-retry') return illegal(state, event)
      return { stage: 'committed', identity: event.identity }
    case 'push-confirmed':
      if (state.stage !== 'committed' || event.remoteCommitSha !== state.identity.commitSha) {
        return illegal(state, event)
      }
      return { stage: 'pushed', identity: state.identity, remoteCommitSha: event.remoteCommitSha }
    case 'install-confirmed':
      if (state.stage !== 'pushed' || !sameIdentity(event.readback, state.identity)) {
        return illegal(state, event)
      }
      return { stage: 'installed-verified', identity: state.identity, installed: event.readback }
    case 'reload-required':
      if (state.stage !== 'installed-verified') return illegal(state, event)
      return { stage: 'awaiting-reload', identity: state.identity, installed: state.installed }
    case 'runtime-loaded':
      if (
        state.stage !== 'awaiting-reload' ||
        !sameIdentity(event.readback, state.identity) ||
        !sameRoot(event.readback.root, state.installed.root, event.rootComparison)
      ) return illegal(state, event)
      return {
        stage: 'loaded-verified',
        identity: state.identity,
        installed: state.installed,
        loaded: event.readback
      }
  }
}

export function isEffectiveRelease(state: ReleaseState): state is Extract<ReleaseState, { stage: 'loaded-verified' }> {
  return state.stage === 'loaded-verified'
}

export function deriveOperationalArtifacts(sourcePath: string): string[] {
  const normalized = sourcePath.replaceAll('\\', '/').replace(/^\.\//, '')
  const artifacts = [normalized]
  if (normalized.startsWith('src/')) {
    if (/\.ts$/i.test(normalized) && !/\.d\.ts$/i.test(normalized)) {
      artifacts.push(`dist/${normalized.slice(4).replace(/\.ts$/i, '.js')}`)
    } else if (/\.json$/i.test(normalized)) {
      artifacts.push(`dist/${normalized.slice(4)}`)
    }
  }
  return [...new Set(artifacts)].sort()
}
