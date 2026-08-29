import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  caminhoDoEstadoReleaseAutonoma,
  instalarEConfirmarPadrao,
  prepararReleaseAutonomaPersonalidade
} from '../runtime/release-autonoma.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'

const COMMIT = 'a'.repeat(40)
const BRANCH = createHash('sha256').update('main').digest('hex')
const REMOTE_REF = createHash('sha256').update('refs/heads/main').digest('hex')

test('readback padrão usa a raiz carregada e confere o fingerprint instalado', async () => {
  const expectedFingerprint = 'f'.repeat(64)
  let received = null
  const result = await instalarEConfirmarPadrao({
    casa: 'C:\\omni-test',
    version: '0.22.0',
    releaseFingerprint: expectedFingerprint,
    sourceRepository: 'C:\\fonte-nao-instalada',
    updatePlugin: async (input) => {
      received = input
      return {
        installedVersion: '0.22.0',
        installedFingerprint: expectedFingerprint,
        latestVersion: '0.22.0',
        reloadRequired: true,
        verifiedBy: [
          'installed-root-integrity',
          'github-release-contract',
          'payload-fingerprint'
        ]
      }
    }
  })

  assert.deepEqual(received, { casa: 'C:\\omni-test' })
  assert.equal(result.verified, true)
  assert.equal(result.installedFingerprint, expectedFingerprint)

  await assert.rejects(
    instalarEConfirmarPadrao({
      casa: 'C:\\omni-test',
      version: '0.22.0',
      releaseFingerprint: expectedFingerprint,
      updatePlugin: async () => ({
        installedVersion: '0.22.0',
        installedFingerprint: 'e'.repeat(64),
        verifiedBy: [
          'installed-root-integrity',
          'github-release-contract',
          'payload-fingerprint'
        ]
      })
    }),
    /nao comprovou a release publicada/
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omni-autonomous-release-'))
  const casa = await mkdtemp(join(tmpdir(), 'omni-autonomous-release-home-'))
  for (const directory of [
    '.git', '.claude-plugin', 'contratos/atualizacao', 'contratos/personalidade',
    'contratos/eval/resultados', 'hooks', 'runtime', 'scripts', 'skills'
  ]) await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'omni-agent', version: '0.21.2' }))
  await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'omni', version: '0.21.2' }))
  await writeFile(join(root, 'contratos', 'atualizacao', 'integridade.json'), JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-release-integrity-v1',
    identity: {
      version: '0.21.2',
      releaseFingerprint: 'a'.repeat(64),
      releaseAuditScopeStartedAt: '2026-08-28T00:00:00.000Z'
    }
  }))
  await writeFile(join(root, 'contratos', 'atualizacao', 'releases.json'), JSON.stringify({
    schemaVersion: 1,
    releases: [{ version: '0.21.2', changes: ['anterior'] }]
  }))
  await writeFile(join(root, 'contratos', 'personalidade', 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'omni-persona-v3-candidate',
    status: 'active-candidate-pending-evals',
    contract: './omni-persona-v3.md',
    promotion: null
  }))
  await writeFile(join(root, 'contratos', 'personalidade', 'ajustes-aprendidos.json'), JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-learned-personality-adjustments-v1',
    adjustments: []
  }))
  await writeFile(join(root, 'runtime', 'placeholder.mjs'), 'export default true\n')
  const payload = await calcularFingerprintPayload(root)
  const integrity = JSON.parse(await readFile(join(root, 'contratos', 'atualizacao', 'integridade.json'), 'utf8'))
  integrity.identity.releaseFingerprint = payload.fingerprint
  await writeFile(
    join(root, 'contratos', 'atualizacao', 'integridade.json'),
    JSON.stringify(integrity)
  )
  return { root, casa, evaluatedPayloadFingerprint: payload.fingerprint }
}

function passedRun(evaluatedPayloadFingerprint) {
  return {
    id: 'personality-auto-release-test',
    status: 'passed',
    evaluatedAt: '2026-08-29T12:00:00.000Z',
    suiteSha256: '1'.repeat(64),
    baseline: 'controle',
    candidate: 'omni-persona-v3-candidate',
    responseSets: { baselineSha256: '2'.repeat(64), candidateSha256: '3'.repeat(64) },
    caseResults: [{
      id: 'case-1', weight: 1, baselineAutomaticPassed: true,
      candidateAutomaticPassed: true, humanApproved: true
    }],
    gates: [{ id: 'all', passed: true }],
    trust: { promotable: true, decisionAuthority: 'omni-controlled-local-judge-v1' },
    provenance: { evaluatedPayloadFingerprint },
    adjustments: {
      directiveIds: ['increase-useful-analogies'],
      candidateIds: ['personality-candidate-test'],
      fingerprint: '4'.repeat(64)
    },
    rawResponsesStored: false,
    rawPrompt: 'SEGREDO-PROMPT-NAO-PERSISTIR',
    rawResponse: 'SEGREDO-RESPOSTA-NAO-PERSISTIR'
  }
}

function controlledPaths() {
  return [
    '.claude-plugin/plugin.json',
    'contratos/atualizacao/integridade.json',
    'contratos/atualizacao/releases.json',
    'contratos/eval/resultados/personality-auto-release-test.json',
    'contratos/personalidade/ajustes-aprendidos.json',
    'contratos/personalidade/manifest.json',
    'package.json'
  ].sort()
}

function repositoryFixture({ failPushes = 0, outsideChange = false, initiallyDirty = false } = {}) {
  const calls = { status: 0, commit: 0, push: 0, messages: [], paths: [] }
  let committed = false
  return {
    calls,
    adapter: {
      async status() {
        calls.status += 1
        if (initiallyDirty) return [{ status: ' M', path: 'README.md' }]
        if (committed) return []
        if (calls.status === 1) return []
        return [
          ...controlledPaths().map((path) => ({ status: ' M', path })),
          ...(outsideChange ? [{ status: ' M', path: 'README.md' }] : [])
        ]
      },
      async commit(_root, { paths, message }) {
        calls.commit += 1
        calls.messages.push(message)
        calls.paths.push([...paths].sort())
        committed = true
        return { commitSha: COMMIT, branchFingerprint: BRANCH }
      },
      async head() {
        return { commitSha: COMMIT, branchFingerprint: BRANCH }
      },
      async push(_root, input) {
        calls.push += 1
        if (calls.push <= failPushes) throw new Error('FALHA-TRANSITORIA-PUSH-COM-TEXTO-BRUTO')
        return { commitSha: input.commitSha, remoteRefFingerprint: REMOTE_REF }
      }
    }
  }
}

function gatesFixture(calls) {
  return async () => {
    calls.count += 1
    return {
      ok: true,
      checks: [{ ok: true, command: 'fixture gate', outputFingerprint: '5'.repeat(64) }]
    }
  }
}

function installFixture(calls, { fail = 0, mismatch = 0 } = {}) {
  return async ({ version, releaseFingerprint }) => {
    calls.count += 1
    if (calls.count <= fail) throw new Error('FALHA-INSTALACAO-COM-TEXTO-BRUTO')
    return {
      verified: true,
      installedVersion: version,
      installedFingerprint: calls.count <= mismatch ? 'f'.repeat(64) : releaseFingerprint,
      verificationFingerprint: '6'.repeat(64)
    }
  }
}

async function cleanup(...paths) {
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
}

test('eval aprovado publica, instala e fecha somente depois do readback exato', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture()
  const gateCalls = { count: 0 }
  const installCalls = { count: 0 }
  try {
    const result = await prepararReleaseAutonomaPersonalidade({
      casa,
      sourceRepository: root,
      run: passedRun(evaluatedPayloadFingerprint),
      repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls),
      at: '2026-08-29T12:05:00.000Z'
    })
    assert.equal(result.result, 'published-installed-verified')
    assert.equal(result.version, '0.21.3')
    assert.equal(result.publication, 'remote-commit-verified')
    assert.equal(result.installedReadback, true)
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 1)
    assert.equal(gateCalls.count, 1)
    assert.equal(installCalls.count, 1)
    assert.deepEqual(git.calls.paths[0], controlledPaths())
    assert.match(git.calls.messages[0], /release\(omni\): v0\.21\.3 \[[a-f0-9]{12}\]/)

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(root, 'contratos', 'personalidade', 'manifest.json'), 'utf8'))
    const stateRaw = await readFile(caminhoDoEstadoReleaseAutonoma(casa), 'utf8')
    const state = JSON.parse(stateRaw)
    const transaction = Object.values(state.releases)[0]
    assert.equal(pkg.version, '0.21.3')
    assert.equal(manifest.status, 'approved')
    assert.equal(transaction.stage, 'installed-verified')
    assert.equal(transaction.installedReadback.version, '0.21.3')
    assert.equal(transaction.installedReadback.fingerprint, result.releaseFingerprint)
    assert.doesNotMatch(stateRaw, /personality-auto-release-test|SEGREDO|FALHA-/)
    assert.match(Object.keys(state.releases)[0], /^[a-f0-9]{64}$/)

    const again = await prepararReleaseAutonomaPersonalidade({
      casa,
      sourceRepository: root,
      run: passedRun(evaluatedPayloadFingerprint),
      repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls)
    })
    assert.equal(again.result, 'already-published-installed-verified')
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 1)
    assert.equal(installCalls.count, 1)
  } finally {
    await cleanup(root, casa)
  }
})

test('push transitorio retoma o mesmo commit sem nova versao ou novo gate', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture({ failPushes: 1 })
  const gateCalls = { count: 0 }
  const installCalls = { count: 0 }
  try {
    const first = await prepararReleaseAutonomaPersonalidade({
      casa, sourceRepository: root, run: passedRun(evaluatedPayloadFingerprint), repository: git.adapter,
      runGates: gatesFixture(gateCalls), installAndReadback: installFixture(installCalls)
    })
    assert.equal(first.result, 'release-retryable')
    assert.equal(first.stage, 'committed')
    assert.equal(first.publication, 'not-confirmed')
    assert.equal(first.installedReadback, false)
    assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '0.21.3')

    const second = await prepararReleaseAutonomaPersonalidade({
      casa, sourceRepository: root, run: passedRun(evaluatedPayloadFingerprint), repository: git.adapter,
      runGates: gatesFixture(gateCalls), installAndReadback: installFixture(installCalls)
    })
    assert.equal(second.result, 'published-installed-verified')
    assert.equal(second.version, '0.21.3')
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 2)
    assert.equal(gateCalls.count, 1)
    assert.equal(installCalls.count, 1)
    const releases = JSON.parse(await readFile(join(root, 'contratos', 'atualizacao', 'releases.json'), 'utf8'))
    assert.equal(releases.releases.filter((item) => item.version === '0.21.3').length, 1)
  } finally {
    await cleanup(root, casa)
  }
})

test('instalacao ou readback divergente retoma depois do push sem republicar', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture()
  const gateCalls = { count: 0 }
  const installCalls = { count: 0 }
  try {
    const first = await prepararReleaseAutonomaPersonalidade({
      casa, sourceRepository: root, run: passedRun(evaluatedPayloadFingerprint), repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls, { mismatch: 1 })
    })
    assert.equal(first.result, 'release-retryable')
    assert.equal(first.stage, 'pushed')
    assert.equal(first.publication, 'remote-commit-verified')
    assert.equal(first.installedReadback, false)
    const pendingState = await readFile(caminhoDoEstadoReleaseAutonoma(casa), 'utf8')
    assert.doesNotMatch(pendingState, /Readback instalado divergiu|FALHA-|SEGREDO/)

    const second = await prepararReleaseAutonomaPersonalidade({
      casa, sourceRepository: root, run: passedRun(evaluatedPayloadFingerprint), repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls)
    })
    assert.equal(second.result, 'published-installed-verified')
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 1)
    assert.equal(gateCalls.count, 1)
    assert.equal(installCalls.count, 2)
  } finally {
    await cleanup(root, casa)
  }
})

test('falha transitoria da instalacao preserva o push e retoma somente a instalacao', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture()
  const gateCalls = { count: 0 }
  const installCalls = { count: 0 }
  try {
    const first = await prepararReleaseAutonomaPersonalidade({
      casa, sourceRepository: root, run: passedRun(evaluatedPayloadFingerprint), repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls, { fail: 1 })
    })
    assert.equal(first.result, 'release-retryable')
    assert.equal(first.stage, 'pushed')
    assert.equal(first.installedReadback, false)
    assert.doesNotMatch(
      await readFile(caminhoDoEstadoReleaseAutonoma(casa), 'utf8'),
      /FALHA-INSTALACAO-COM-TEXTO-BRUTO/
    )

    const second = await prepararReleaseAutonomaPersonalidade({
      casa, sourceRepository: root, run: passedRun(evaluatedPayloadFingerprint), repository: git.adapter,
      runGates: gatesFixture(gateCalls), installAndReadback: installFixture(installCalls)
    })
    assert.equal(second.result, 'published-installed-verified')
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 1)
    assert.equal(gateCalls.count, 1)
    assert.equal(installCalls.count, 2)
  } finally {
    await cleanup(root, casa)
  }
})

test('falha antes do commit restaura snapshot e nunca declara publicacao', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture()
  const before = await readFile(join(root, 'package.json'), 'utf8')
  try {
    const result = await prepararReleaseAutonomaPersonalidade({
      casa,
      sourceRepository: root,
      run: passedRun(evaluatedPayloadFingerprint),
      repository: git.adapter,
      runGates: async () => ({ ok: false, checks: [{ ok: false, error: 'teste vermelho bruto' }] }),
      installAndReadback: async () => { throw new Error('nao deveria instalar') }
    })
    assert.equal(result.result, 'release-reverted')
    assert.equal(result.publication, 'not-confirmed')
    assert.equal(result.installedReadback, false)
    assert.equal(git.calls.commit, 0)
    assert.equal(git.calls.push, 0)
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before)
    await assert.rejects(
      readFile(join(root, 'contratos', 'eval', 'resultados', 'personality-auto-release-test.json')),
      (error) => error.code === 'ENOENT'
    )
    assert.doesNotMatch(await readFile(caminhoDoEstadoReleaseAutonoma(casa), 'utf8'), /teste vermelho bruto/)
  } finally {
    await cleanup(root, casa)
  }
})

test('repo sujo ou arquivo fora do conjunto controlado impede o commit', async () => {
  for (const mode of ['dirty', 'outside']) {
    const { root, casa, evaluatedPayloadFingerprint } = await fixture()
    const git = repositoryFixture({ initiallyDirty: mode === 'dirty', outsideChange: mode === 'outside' })
    const before = await readFile(join(root, 'package.json'), 'utf8')
    try {
      const result = await prepararReleaseAutonomaPersonalidade({
        casa,
        sourceRepository: root,
        run: passedRun(evaluatedPayloadFingerprint),
        repository: git.adapter,
        runGates: async () => ({ ok: true, checks: [] }),
        installAndReadback: async () => { throw new Error('nao deveria instalar') }
      })
      assert.equal(result.publication, 'not-confirmed', mode)
      assert.equal(result.installedReadback, false, mode)
      assert.equal(git.calls.commit, 0, mode)
      assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before, mode)
      if (mode === 'dirty') assert.equal(result.result, 'repository-not-clean')
      else assert.equal(result.result, 'release-reverted')
    } finally {
      await cleanup(root, casa)
    }
  }
})

test('release recusa fonte diferente do payload realmente avaliado antes de qualquer mutacao', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture()
  const gateCalls = { count: 0 }
  const installCalls = { count: 0 }
  const otherFingerprint = evaluatedPayloadFingerprint === 'b'.repeat(64)
    ? 'c'.repeat(64)
    : 'b'.repeat(64)
  const before = await readFile(join(root, 'package.json'), 'utf8')
  try {
    const result = await prepararReleaseAutonomaPersonalidade({
      casa,
      sourceRepository: root,
      run: passedRun(otherFingerprint),
      repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls)
    })
    assert.equal(result.result, 'evaluated-source-diverged')
    assert.equal(result.publication, 'not-confirmed')
    assert.equal(result.installedReadback, false)
    assert.equal(git.calls.commit, 0)
    assert.equal(git.calls.push, 0)
    assert.equal(gateCalls.count, 0)
    assert.equal(installCalls.count, 0)
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before)
  } finally {
    await cleanup(root, casa)
  }
})

test('lock orfao vencido e recuperado sem bloquear a release', async () => {
  const { root, casa, evaluatedPayloadFingerprint } = await fixture()
  const git = repositoryFixture()
  const gateCalls = { count: 0 }
  const installCalls = { count: 0 }
  const lockPath = join(root, '.git', 'omni-autonomous-release.lock')
  try {
    await writeFile(lockPath, '{"schemaVersion":1,"token":"orphan"}\n', 'utf8')
    const stale = new Date(Date.now() - 3 * 60 * 60_000)
    await utimes(lockPath, stale, stale)
    const result = await prepararReleaseAutonomaPersonalidade({
      casa,
      sourceRepository: root,
      run: passedRun(evaluatedPayloadFingerprint),
      repository: git.adapter,
      runGates: gatesFixture(gateCalls),
      installAndReadback: installFixture(installCalls)
    })
    assert.equal(result.result, 'published-installed-verified')
    assert.equal(git.calls.commit, 1)
    await assert.rejects(readFile(lockPath), (error) => error.code === 'ENOENT')
  } finally {
    await cleanup(root, casa)
  }
})
