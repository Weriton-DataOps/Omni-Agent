import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveOperationalArtifacts,
  isEffectiveRelease,
  reduceRelease,
  type ReleaseState
} from '../src/core/release/release-state.js'

const identity = { version: '1.2.3', fingerprint: 'a'.repeat(64), commitSha: 'b'.repeat(40) }
const installed = {
  root: 'C:\\cache\\omni',
  version: identity.version,
  fingerprint: identity.fingerprint,
  verificationFingerprint: 'c'.repeat(64)
}

test('FSM TypeScript só considera efetiva a release carregada da mesma raiz', () => {
  let state: ReleaseState = { stage: 'precommit-retry' }
  state = reduceRelease(state, { type: 'commit-confirmed', identity })
  state = reduceRelease(state, { type: 'push-confirmed', remoteCommitSha: identity.commitSha })
  state = reduceRelease(state, { type: 'install-confirmed', readback: installed })
  assert.equal(state.stage, 'installed-verified')
  assert.equal(isEffectiveRelease(state), false)
  state = reduceRelease(state, { type: 'reload-required' })
  assert.equal(state.stage, 'awaiting-reload')
  assert.equal(isEffectiveRelease(state), false)
  state = reduceRelease(state, {
    type: 'runtime-loaded',
    rootComparison: 'windows-insensitive',
    readback: { ...installed, verifiedAt: '2032-01-01T00:00:00.000Z' }
  })
  assert.equal(isEffectiveRelease(state), true)
})

test('FSM TypeScript recusa raiz ou fingerprint carregado divergente', () => {
  const waiting: ReleaseState = { stage: 'awaiting-reload', identity, installed }
  assert.throws(() => reduceRelease(waiting, {
    type: 'runtime-loaded',
    rootComparison: 'windows-insensitive',
    readback: { ...installed, root: 'C:\\fonte\\omni', verifiedAt: '2032-01-01T00:00:00.000Z' }
  }), /Transicao de release invalida/)
  assert.throws(() => reduceRelease(waiting, {
    type: 'runtime-loaded',
    rootComparison: 'windows-insensitive',
    readback: { ...installed, fingerprint: 'd'.repeat(64), verifiedAt: '2032-01-01T00:00:00.000Z' }
  }), /Transicao de release invalida/)
})

test('FSM preserva sensibilidade de caixa em raizes POSIX', () => {
  const posixInstalled = { ...installed, root: '/opt/Omni' }
  const waiting: ReleaseState = { stage: 'awaiting-reload', identity, installed: posixInstalled }
  assert.throws(() => reduceRelease(waiting, {
    type: 'runtime-loaded',
    rootComparison: 'case-sensitive',
    readback: { ...posixInstalled, root: '/opt/omni', verifiedAt: '2032-01-01T00:00:00.000Z' }
  }), /Transicao de release invalida/)
})

test('deriva conjunto operacional exato de fonte TypeScript e emit ESM', () => {
  assert.deepEqual(
    deriveOperationalArtifacts('src/core/release/release-state.ts'),
    ['dist/core/release/release-state.js', 'src/core/release/release-state.ts']
  )
  assert.deepEqual(deriveOperationalArtifacts('runtime/cli.mjs'), ['runtime/cli.mjs'])
})
