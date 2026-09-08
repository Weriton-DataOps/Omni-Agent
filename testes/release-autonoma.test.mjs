import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  caminhoDoEstadoReleaseAutonoma,
  confirmarReleasesCarregadas,
  confirmarRuntimeCarregado,
  descreverPreparacaoMelhoriaOperacional,
  instalarEConfirmarPadrao,
  prepararReleaseAutonomaPersonalidade
} from '../runtime/release-autonoma.mjs'
import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'
import { tratarHookReleaseLoaded } from '../runtime/hook-release-loaded.mjs'

const COMMIT = 'a'.repeat(40)
const BRANCH = createHash('sha256').update('main').digest('hex')
const REMOTE_REF = createHash('sha256').update('refs/heads/main').digest('hex')
const SOURCE_PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

test('descricao pre-gates da melhoria operacional nao antecipa instalacao nem readback', () => {
  const fingerprint = 'f'.repeat(64)
  const description = descreverPreparacaoMelhoriaOperacional(fingerprint)

  assert.match(description, new RegExp(`auditada ${fingerprint.slice(0, 12)} para validacao da release`))
  assert.match(description, /gates, publicacao, instalacao e readback permanecem pendentes neste estagio/)
  assert.doesNotMatch(description, /com gates e readback instalado|publicada|instalada/i)
})

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
        installedRoot: 'C:\\omni-instalado',
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
  assert.equal(result.loadedReadback, null)

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
    'contratos/eval/resultados', 'dist', 'hooks', 'runtime', 'scripts', 'skills'
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

function installFixture(calls, { fail = 0, mismatch = 0, loaded = true } = {}) {
  return async ({ version, releaseFingerprint, sourceRepository }) => {
    calls.count += 1
    if (calls.count <= fail) throw new Error('FALHA-INSTALACAO-COM-TEXTO-BRUTO')
    const fingerprint = calls.count <= mismatch ? 'f'.repeat(64) : releaseFingerprint
    return {
      verified: true,
      installedVersion: version,
      installedFingerprint: fingerprint,
      installedRoot: sourceRepository,
      verificationFingerprint: '6'.repeat(64),
      loadedReadback: loaded ? {
        verified: true,
        root: sourceRepository,
        version,
        fingerprint,
        verificationFingerprint: '7'.repeat(64),
        verifiedAt: '2026-08-29T12:05:00.000Z'
      } : null
    }
  }
}

async function cleanup(...paths) {
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
}

function awaitingTransaction(key, root, {
  version = '1.2.3',
  fingerprint = 'e'.repeat(64),
  updatedAt = '2032-01-01T00:00:00.000Z'
} = {}) {
  return {
    stage: 'awaiting-reload',
    runFingerprint: key,
    repositoryFingerprint: createHash('sha256').update(`repo:${key}`).digest('hex'),
    version,
    releaseFingerprint: fingerprint,
    evidenceFingerprint: null,
    gatesFingerprint: null,
    commitSha: COMMIT,
    branchFingerprint: BRANCH,
    remoteCommitSha: COMMIT,
    installedReadback: {
      root,
      version,
      fingerprint,
      verificationFingerprint: '6'.repeat(64),
      verifiedAt: updatedAt
    },
    loadedReadback: null,
    attempts: { prepare: 1, push: 1, install: 1 },
    lastFailure: null,
    updatedAt
  }
}

async function writeReleaseState(casa, releases) {
  const statePath = caminhoDoEstadoReleaseAutonoma(casa)
  await mkdir(join(casa, 'runtime'), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-autonomous-release-state-v1',
    releases
  }, null, 2)}\n`, 'utf8')
  return statePath
}

test('readback carregado exige raiz, versao e fingerprint da mesma release', async () => {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'omni-loaded-proof-'))
  try {
    const fingerprint = 'd'.repeat(64)
    const receipt = await confirmarRuntimeCarregado({
      pluginRoot,
      version: '1.2.3',
      payloadFingerprint: fingerprint,
      verifyLoadedIntegrity: async () => ({
        status: 'verified',
        versionMatchesManifest: true,
        releaseVersion: '1.2.3',
        fingerprint,
        declaredFingerprint: fingerprint
      }),
      at: '2032-01-01T00:00:00.000Z'
    })
    assert.equal(receipt.root, await realpath(pluginRoot))
    assert.equal(receipt.version, '1.2.3')
    assert.equal(receipt.fingerprint, fingerprint)
    await assert.rejects(
      confirmarRuntimeCarregado({
        pluginRoot,
        version: '1.2.4',
        payloadFingerprint: fingerprint,
        verifyLoadedIntegrity: async () => ({
          status: 'verified', versionMatchesManifest: true, releaseVersion: '1.2.3',
          fingerprint, declaredFingerprint: fingerprint
        })
      }),
      /nao corresponde a raiz, versao e fingerprint/
    )
  } finally {
    await cleanup(pluginRoot)
  }
})

test('SessionStart carregado fecha awaiting-reload; fonte e instalacao sozinhas nao fecham', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-loaded-hook-home-'))
  const sourceRoot = await mkdtemp(join(tmpdir(), 'omni-loaded-hook-source-'))
  const installedRootRaw = await mkdtemp(join(tmpdir(), 'omni-loaded-hook-installed-'))
  const installedRoot = await realpath(installedRootRaw)
  const fingerprint = 'e'.repeat(64)
  const key = '9'.repeat(64)
  const statePath = caminhoDoEstadoReleaseAutonoma(casa)
  await mkdir(join(casa, 'runtime'), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-autonomous-release-state-v1',
    releases: {
      [key]: {
        stage: 'awaiting-reload',
        runFingerprint: key,
        repositoryFingerprint: '8'.repeat(64),
        version: '1.2.3',
        releaseFingerprint: fingerprint,
        evidenceFingerprint: null,
        gatesFingerprint: null,
        commitSha: COMMIT,
        branchFingerprint: BRANCH,
        remoteCommitSha: COMMIT,
        installedReadback: {
          root: installedRoot,
          version: '1.2.3',
          fingerprint,
          verificationFingerprint: '6'.repeat(64),
          verifiedAt: '2032-01-01T00:00:00.000Z'
        },
        loadedReadback: null,
        attempts: { prepare: 1, push: 1, install: 1 },
        lastFailure: null,
        updatedAt: '2032-01-01T00:00:00.000Z'
      }
    }
  }, null, 2)}\n`, 'utf8')
  const confirmCalls = []
  const operationalCalls = []
  const confirmLoaded = async (input) => {
    confirmCalls.push(input)
    return {
      verified: true,
      root: installedRoot,
      version: '1.2.3',
      fingerprint,
      verificationFingerprint: '7'.repeat(64),
      verifiedAt: '2032-01-01T00:01:00.000Z'
    }
  }
  try {
    const fromSource = await confirmarReleasesCarregadas({
      casa,
      pluginRoot: sourceRoot,
      confirmLoaded,
      recordOperationalLoaded: async () => undefined
    })
    assert.equal(fromSource.confirmed, 0)
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).releases[key].stage, 'awaiting-reload')
    assert.equal(confirmCalls.length, 0)

    const loaded = await confirmarReleasesCarregadas({
      casa,
      pluginRoot: installedRoot,
      confirmLoaded,
      recordOperationalLoaded: async (...args) => operationalCalls.push(args),
      at: '2032-01-01T00:01:00.000Z'
    })
    assert.equal(loaded.result, 'loaded-releases-confirmed')
    assert.equal(loaded.confirmed, 1)
    assert.equal(operationalCalls.length, 1)
    const persisted = JSON.parse(await readFile(statePath, 'utf8')).releases[key]
    assert.equal(persisted.stage, 'loaded-verified')
    assert.equal(persisted.loadedReadback.root, installedRoot)

    let wired = null
    const hook = await tratarHookReleaseLoaded(
      { hook_event_name: 'SessionStart' },
      { OMNI_HOME: casa },
      {
        pluginRoot: installedRoot,
        confirmarReleasesCarregadas: async (input) => {
          wired = input
          return {
            result: 'no-loaded-release-match', confirmed: 0, rejected: 0,
            loadedRootFingerprint: 'a'.repeat(64)
          }
        }
      }
    )
    assert.equal(wired.casa, casa)
    assert.equal(wired.pluginRoot, installedRoot)
    assert.equal(hook.suppressOutput, true)
  } finally {
    await cleanup(casa, sourceRoot, installedRootRaw)
  }
})

test('handshakes concorrentes preservam duas chaves e nao regridem a mesma chave', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-release-cas-home-'))
  const firstRoot = await realpath(await mkdtemp(join(tmpdir(), 'omni-release-cas-first-')))
  const secondRoot = await realpath(await mkdtemp(join(tmpdir(), 'omni-release-cas-second-')))
  const firstKey = '1'.repeat(64)
  const secondKey = '2'.repeat(64)
  const fingerprint = 'e'.repeat(64)
  const statePath = await writeReleaseState(casa, {
    [firstKey]: awaitingTransaction(firstKey, firstRoot, { fingerprint }),
    [secondKey]: awaitingTransaction(secondKey, secondRoot, { fingerprint })
  })
  try {
    let arrivals = 0
    let releaseBarrier
    const barrier = new Promise((resolveBarrier) => { releaseBarrier = resolveBarrier })
    const confirmLoaded = async ({ pluginRoot, version, payloadFingerprint }) => {
      arrivals += 1
      if (arrivals === 2) releaseBarrier()
      await barrier
      return {
        verified: true,
        root: pluginRoot,
        version,
        fingerprint: payloadFingerprint,
        verificationFingerprint: '7'.repeat(64),
        verifiedAt: '2032-01-01T00:01:00.000Z'
      }
    }
    const distinct = await Promise.all([
      confirmarReleasesCarregadas({
        casa, pluginRoot: firstRoot, confirmLoaded, recordOperationalLoaded: async () => undefined
      }),
      confirmarReleasesCarregadas({
        casa, pluginRoot: secondRoot, confirmLoaded, recordOperationalLoaded: async () => undefined
      })
    ])
    assert.deepEqual(distinct.map((item) => item.confirmed).sort(), [1, 1])
    let state = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(state.releases[firstKey].stage, 'loaded-verified')
    assert.equal(state.releases[secondKey].stage, 'loaded-verified')

    await writeReleaseState(casa, {
      [firstKey]: awaitingTransaction(firstKey, firstRoot, { fingerprint })
    })
    arrivals = 0
    let releaseSameBarrier
    const sameBarrier = new Promise((resolveBarrier) => { releaseSameBarrier = resolveBarrier })
    const sameConfirm = async ({ pluginRoot, version, payloadFingerprint }) => {
      arrivals += 1
      if (arrivals === 2) releaseSameBarrier()
      await sameBarrier
      return {
        verified: true,
        root: pluginRoot,
        version,
        fingerprint: payloadFingerprint,
        verificationFingerprint: '8'.repeat(64),
        verifiedAt: '2032-01-01T00:02:00.000Z'
      }
    }
    const same = await Promise.all([
      confirmarReleasesCarregadas({
        casa, pluginRoot: firstRoot, confirmLoaded: sameConfirm,
        recordOperationalLoaded: async () => undefined
      }),
      confirmarReleasesCarregadas({
        casa, pluginRoot: firstRoot, confirmLoaded: sameConfirm,
        recordOperationalLoaded: async () => undefined
      })
    ])
    assert.equal(same.reduce((sum, item) => sum + item.confirmed, 0), 1)
    assert.equal(same.reduce((sum, item) => sum + item.concurrentSkipped, 0), 1)
    state = JSON.parse(await readFile(statePath, 'utf8'))
    assert.equal(state.releases[firstKey].stage, 'loaded-verified')
    assert.equal(state.releases[firstKey].loadedReadback.root, firstRoot)
  } finally {
    await cleanup(casa, firstRoot, secondRoot)
  }
})

test('store adulterado nao contorna o reducer canonico para declarar loaded', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-release-tamper-home-'))
  const installedRoot = await realpath(await mkdtemp(join(tmpdir(), 'omni-release-tamper-installed-')))
  const wrongRoot = await realpath(await mkdtemp(join(tmpdir(), 'omni-release-tamper-wrong-')))
  const key = '3'.repeat(64)
  const transaction = awaitingTransaction(key, installedRoot)
  transaction.stage = 'loaded-verified'
  transaction.loadedReadback = {
    ...transaction.installedReadback,
    root: wrongRoot,
    verifiedAt: '2032-01-01T00:01:00.000Z'
  }
  try {
    await writeReleaseState(casa, { [key]: transaction })
    await assert.rejects(
      confirmarReleasesCarregadas({
        casa,
        pluginRoot: installedRoot,
        confirmLoaded: async () => { throw new Error('nao deve verificar store terminal adulterado') },
        recordOperationalLoaded: async () => undefined
      }),
      /contornar o reducer canonico/
    )
  } finally {
    await cleanup(casa, installedRoot, wrongRoot)
  }
})

test('E2E SessionStart carrega hook de copia instalada e verifica integridade real', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-release-e2e-home-'))
  const installedRootRaw = await mkdtemp(join(tmpdir(), 'omni-release-e2e-installed-'))
  try {
    for (const path of [
      '.claude-plugin', 'adaptadores', 'contratos', 'dist', 'hooks', 'runtime', 'scripts', 'skills'
    ]) {
      await cp(join(SOURCE_PLUGIN_ROOT, path), join(installedRootRaw, path), { recursive: true })
    }
    await cp(join(SOURCE_PLUGIN_ROOT, 'package.json'), join(installedRootRaw, 'package.json'))
    const installedRoot = await realpath(installedRootRaw)
    const manifest = JSON.parse(
      await readFile(join(installedRoot, '.claude-plugin', 'plugin.json'), 'utf8')
    )
    const payload = await calcularFingerprintPayload(installedRoot)
    const integrityPath = join(installedRoot, 'contratos', 'atualizacao', 'integridade.json')
    const integrity = JSON.parse(await readFile(integrityPath, 'utf8'))
    integrity.identity.version = manifest.version
    integrity.identity.releaseFingerprint = payload.fingerprint
    await writeFile(integrityPath, `${JSON.stringify(integrity, null, 2)}\n`, 'utf8')
    const key = '4'.repeat(64)
    const statePath = await writeReleaseState(casa, {
      [key]: awaitingTransaction(key, installedRoot, {
        version: manifest.version,
        fingerprint: payload.fingerprint
      })
    })
    const input = `${JSON.stringify({ hook_event_name: 'SessionStart' })}\n`
    const sourceHook = spawnSync(
      process.execPath,
      [join(SOURCE_PLUGIN_ROOT, 'runtime', 'hook-release-loaded.mjs')],
      { input, encoding: 'utf8', windowsHide: true, env: { ...process.env, OMNI_HOME: casa } }
    )
    assert.equal(sourceHook.status, 0, sourceHook.stderr)
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).releases[key].stage, 'awaiting-reload')

    const installedHook = spawnSync(
      process.execPath,
      [join(installedRoot, 'runtime', 'hook-release-loaded.mjs')],
      { input, encoding: 'utf8', windowsHide: true, env: { ...process.env, OMNI_HOME: casa } }
    )
    assert.equal(installedHook.status, 0, installedHook.stderr)
    assert.equal(JSON.parse(installedHook.stdout).handshake, 'loaded-releases-confirmed')
    const loaded = JSON.parse(await readFile(statePath, 'utf8')).releases[key]
    assert.equal(loaded.stage, 'loaded-verified')
    assert.equal(loaded.loadedReadback.root, installedRoot)
    assert.equal(loaded.loadedReadback.fingerprint, payload.fingerprint)
  } finally {
    await cleanup(casa, installedRootRaw)
  }
})

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
    assert.equal(result.result, 'published-loaded-verified')
    assert.equal(result.version, '0.21.3')
    assert.equal(result.publication, 'remote-commit-verified')
    assert.equal(result.installedReadback, true)
    assert.equal(result.loadedReadback, true)
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
    assert.equal(transaction.stage, 'loaded-verified')
    assert.equal(transaction.installedReadback.version, '0.21.3')
    assert.equal(transaction.installedReadback.fingerprint, result.releaseFingerprint)
    assert.equal(transaction.loadedReadback.fingerprint, result.releaseFingerprint)
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
    assert.equal(again.result, 'already-published-loaded-verified')
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
    assert.equal(second.result, 'published-loaded-verified')
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
    assert.equal(second.result, 'published-loaded-verified')
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
    assert.equal(second.result, 'published-loaded-verified')
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
    assert.equal(result.result, 'published-loaded-verified')
    assert.equal(git.calls.commit, 1)
    await assert.rejects(readFile(lockPath), (error) => error.code === 'ENOENT')
  } finally {
    await cleanup(root, casa)
  }
})
