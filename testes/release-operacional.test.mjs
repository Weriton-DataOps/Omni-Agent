import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  lerCicloOperacional,
  marcarMelhoriaOperacional,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import {
  configurarRepositorioCanonico,
  materializarMelhoriaConfigurada
} from '../runtime/evolucao.mjs'
import {
  caminhoDoEstadoReleaseAutonoma,
  capturarBaselineReleaseOperacional,
  prepararReleaseAutonomaOperacional
} from '../runtime/release-autonoma.mjs'

const BASE_COMMIT = 'a'.repeat(40)
const RELEASE_COMMIT = 'b'.repeat(40)
const BRANCH = createHash('sha256').update('main').digest('hex')
const REMOTE_REF = createHash('sha256').update('refs/heads/main').digest('hex')
const ARTIFACT = 'contratos/operacao/regras-aprendidas.json'
const TYPESCRIPT_SOURCE = 'src/core/example/improvement.ts'
const TYPESCRIPT_EMIT = 'dist/core/example/improvement.js'
const METADATA = [
  '.claude-plugin/plugin.json',
  'contratos/atualizacao/integridade.json',
  'contratos/atualizacao/releases.json',
  'package.json'
]

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omni-operational-release-'))
  const casa = await mkdtemp(join(tmpdir(), 'omni-operational-release-home-'))
  for (const directory of [
    '.git', '.claude-plugin', 'contratos/atualizacao', 'contratos/operacao',
    'dist', 'hooks', 'runtime', 'scripts', 'skills'
  ]) await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'omni-agent', version: '0.21.2' }))
  await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'omni', version: '0.21.2' }))
  await writeFile(join(root, 'contratos', 'atualizacao', 'integridade.json'), JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-release-integrity-v1',
    identity: {
      version: '0.21.2',
      releaseFingerprint: '1'.repeat(64),
      releaseAuditScopeStartedAt: '2026-08-28T00:00:00.000Z'
    }
  }))
  await writeFile(join(root, 'contratos', 'atualizacao', 'releases.json'), JSON.stringify({
    schemaVersion: 1,
    releases: [{ version: '0.21.2', changes: ['anterior'] }]
  }))
  await writeFile(join(root, ...ARTIFACT.split('/')), JSON.stringify({
    schemaVersion: 1,
    contract: 'omni-learned-rules-v1',
    rules: []
  }))
  await writeFile(join(root, 'runtime', 'placeholder.mjs'), 'export default true\n')
  await configurarRepositorioCanonico(casa, root)
  const first = await proporMelhoriaOperacional(casa, {
    category: 'owner-correction',
    destination: 'operational-rule',
    statement: 'Ao detectar a mesma falha, corrigir, testar e confirmar o efeito instalado.'
  }, { at: '2026-08-29T10:00:00.000Z' })
  await proporMelhoriaOperacional(casa, {
    category: 'owner-correction',
    destination: 'operational-rule',
    statement: 'Ao detectar a mesma falha, corrigir, testar e confirmar o efeito instalado.'
  }, { at: '2026-08-29T10:01:00.000Z' })
  return { root, casa, candidateId: first.candidate.id }
}

function repositoryFixture({
  outside = false,
  dirtyBaseline = false,
  failPushes = 0,
  initialArtifacts = [ARTIFACT],
  finalArtifacts = initialArtifacts
} = {}) {
  let statusCalls = 0
  let committed = false
  const calls = { commit: 0, push: 0, paths: [], messages: [] }
  return {
    calls,
    adapter: {
      async status() {
        statusCalls += 1
        if (committed) return []
        if (statusCalls === 1) return dirtyBaseline ? [{ status: ' M', path: 'README.md' }] : []
        if (statusCalls === 2) {
          return [
            ...initialArtifacts.map((path) => ({ status: ' M', path })),
            ...(outside ? [{ status: ' M', path: 'README.md' }] : [])
          ]
        }
        return [...finalArtifacts, ...METADATA].map((path) => ({ status: ' M', path }))
      },
      async head() {
        return { commitSha: committed ? RELEASE_COMMIT : BASE_COMMIT, branchFingerprint: BRANCH }
      },
      async commit(_root, { paths, message }) {
        committed = true
        calls.commit += 1
        calls.paths.push([...paths].sort())
        calls.messages.push(message)
        return { commitSha: RELEASE_COMMIT, branchFingerprint: BRANCH }
      },
      async push(_root, input) {
        calls.push += 1
        if (calls.push <= failPushes) throw new Error('falha transitoria com texto que nao deve persistir')
        return { commitSha: input.commitSha, remoteRefFingerprint: REMOTE_REF }
      }
    }
  }
}

async function prepararCandidata(casa, candidateId) {
  const result = await materializarMelhoriaConfigurada(casa, candidateId)
  assert.equal(result.result, 'materialized-pending-release')
  return result.candidate
}

function implementationReceipt() {
  return {
    sessionFingerprint: '1'.repeat(64),
    mutationActionId: 'audit-action-mutation',
    mutationEvidenceId: 'audit-evidence-mutation',
    mutationActionFingerprint: '2'.repeat(64),
    mutationEvidenceFingerprint: '3'.repeat(64),
    verificationActionId: 'audit-action-verification',
    verificationEvidenceId: 'audit-evidence-verification',
    verificationActionFingerprint: '4'.repeat(64),
    verificationEvidenceFingerprint: '5'.repeat(64),
    targetFingerprint: '6'.repeat(64),
    verifiedAt: '2026-08-29T10:05:00.000Z'
  }
}

function gates() {
  return async () => ({
    ok: true,
    checks: [
      { ok: true, command: 'npm run check', outputFingerprint: '2'.repeat(64) },
      { ok: true, command: 'npm test', outputFingerprint: '3'.repeat(64) },
      { ok: true, command: 'release gate', outputFingerprint: '4'.repeat(64) }
    ]
  })
}

function instalarComRaizInstalada(installedRoot, calls = { count: 0 }) {
  return async ({ version, releaseFingerprint }) => {
    calls.count += 1
    return {
      verified: true,
      installedVersion: version,
      installedFingerprint: releaseFingerprint,
      installedRoot,
      verificationFingerprint: '6'.repeat(64),
      loadedReadback: {
        verified: true,
        root: installedRoot,
        version,
        fingerprint: releaseFingerprint,
        verificationFingerprint: '7'.repeat(64),
        verifiedAt: '2026-08-29T10:10:00.000Z'
      }
    }
  }
}

async function cleanup(...paths) {
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
}

test('baseline operacional nasce somente de repositorio canonico limpo e guarda apenas fingerprints', async () => {
  for (const dirty of [false, true]) {
    const { root, casa } = await fixture()
    const git = repositoryFixture({ dirtyBaseline: dirty })
    try {
      const result = await capturarBaselineReleaseOperacional({
        casa, sourceRepository: root, repository: git.adapter, at: '2026-08-29T10:02:00.000Z'
      })
      if (dirty) {
        assert.equal(result.result, 'repository-not-clean')
        assert.equal(result.baseline, null)
      } else {
        assert.equal(result.result, 'captured')
        assert.equal(result.baseline.commitSha, BASE_COMMIT)
        assert.equal(result.baseline.branchFingerprint, BRANCH)
        assert.match(result.baseline.repositoryFingerprint, /^[a-f0-9]{64}$/)
        assert.match(result.baseline.statusFingerprint, /^[a-f0-9]{64}$/)
        assert.doesNotMatch(JSON.stringify(result.baseline), new RegExp(root.replaceAll('\\', '\\\\')))
      }
    } finally {
      await cleanup(root, casa)
    }
  }
})

test('melhoria operacional publica apenas artefato auditado e metadados, instala e confirma a candidata', async () => {
  const { root, casa, candidateId } = await fixture()
  const git = repositoryFixture()
  try {
    const captured = await capturarBaselineReleaseOperacional({ casa, repository: git.adapter })
    const candidate = await prepararCandidata(casa, candidateId)
    const installCalls = { count: 0 }
    const result = await prepararReleaseAutonomaOperacional({
      casa,
      candidateId,
      baseline: captured.baseline,
      sourceRepository: root,
      allowedArtifacts: [candidate.artifactRef],
      repository: git.adapter,
      runGates: gates(),
      installAndReadback: instalarComRaizInstalada(root, installCalls),
      at: '2026-08-29T10:10:00.000Z'
    })
    assert.equal(result.result, 'published-loaded-verified')
    assert.equal(result.version, '0.21.3')
    assert.equal(result.publication, 'remote-commit-verified')
    assert.equal(result.installedReadback, true)
    assert.equal(result.loadedReadback, true)
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 1)
    assert.equal(installCalls.count, 1)
    assert.deepEqual(git.calls.paths[0], [ARTIFACT, ...METADATA].sort())
    assert.match(git.calls.messages[0], /v0\.21\.3 operational \[[a-f0-9]{12}\]/)
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.improvementCandidates.find((item) => item.id === candidateId).status, 'loaded-verified')

    const rawState = await readFile(caminhoDoEstadoReleaseAutonoma(casa), 'utf8')
    assert.doesNotMatch(rawState, new RegExp(candidateId))
    assert.doesNotMatch(rawState, /regras-aprendidas|falha transitoria/)
    assert.match(Object.keys(JSON.parse(rawState).releases)[0], /^[a-f0-9]{64}$/)

    const again = await prepararReleaseAutonomaOperacional({
      casa, candidateId, baseline: captured.baseline, repository: git.adapter,
      runGates: gates(), installAndReadback: async () => { throw new Error('nao deve repetir') }
    })
    assert.equal(again.result, 'already-published-loaded-verified')
    assert.equal(git.calls.commit, 1)
  } finally {
    await cleanup(root, casa)
  }
})

test('release TypeScript controla exatamente fonte auditada e emit deterministico', async () => {
  const { root, casa, candidateId } = await fixture()
  const git = repositoryFixture({
    initialArtifacts: [TYPESCRIPT_SOURCE, TYPESCRIPT_EMIT],
    finalArtifacts: [TYPESCRIPT_SOURCE, TYPESCRIPT_EMIT]
  })
  try {
    const captured = await capturarBaselineReleaseOperacional({ casa, repository: git.adapter })
    const cycle = await lerCicloOperacional(casa)
    const ready = cycle.improvementCandidates.find((item) => item.id === candidateId)
    assert.equal(ready.status, 'ready')
    await marcarMelhoriaOperacional(casa, candidateId, {
      status: 'implementation-required',
      artifact: TYPESCRIPT_SOURCE
    }, { at: '2026-08-29T10:03:00.000Z' })
    await mkdir(join(root, 'src', 'core', 'example'), { recursive: true })
    await mkdir(join(root, 'dist', 'core', 'example'), { recursive: true })
    const sourceRaw = 'export const operationalImprovement: string = \'verified\'\n'
    await writeFile(join(root, ...TYPESCRIPT_SOURCE.split('/')), sourceRaw, 'utf8')
    await writeFile(
      join(root, ...TYPESCRIPT_EMIT.split('/')),
      'export const operationalImprovement = \'verified\';\n',
      'utf8'
    )
    const materialized = await marcarMelhoriaOperacional(casa, candidateId, {
      status: 'materialized-pending-release',
      artifactRef: {
        kind: 'source-file',
        path: TYPESCRIPT_SOURCE,
        collection: null,
        entryId: null,
        semanticFingerprint: ready.fingerprint,
        contentFingerprint: createHash('sha256').update(sourceRaw).digest('hex'),
        implementationReceipt: implementationReceipt()
      }
    }, { at: '2026-08-29T10:06:00.000Z' })
    assert.equal(materialized.result, 'materialized-pending-release')

    const result = await prepararReleaseAutonomaOperacional({
      casa,
      candidateId,
      baseline: captured.baseline,
      sourceRepository: root,
      allowedArtifacts: [TYPESCRIPT_SOURCE],
      repository: git.adapter,
      runGates: gates(),
      installAndReadback: instalarComRaizInstalada(root),
      at: '2026-08-29T10:10:00.000Z'
    })
    assert.equal(result.result, 'published-loaded-verified')
    assert.deepEqual(
      git.calls.paths[0],
      [TYPESCRIPT_SOURCE, TYPESCRIPT_EMIT, ...METADATA].sort()
    )
    const loaded = (await lerCicloOperacional(casa)).improvementCandidates
      .find((item) => item.id === candidateId)
    assert.equal(loaded.status, 'loaded-verified')
    assert.match(loaded.loadedReadback.artifactFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await cleanup(root, casa)
  }
})

test('release operacional recusa mudanca alheia e teste sem vinculo auditavel', async () => {
  for (const mode of ['outside', 'extra-test']) {
    const { root, casa, candidateId } = await fixture()
    const git = repositoryFixture({ outside: mode === 'outside' })
    try {
      const captured = await capturarBaselineReleaseOperacional({ casa, repository: git.adapter })
      const candidate = await prepararCandidata(casa, candidateId)
      if (mode === 'extra-test') {
        await assert.rejects(
          prepararReleaseAutonomaOperacional({
            casa,
            candidateId,
            baseline: captured.baseline,
            repository: git.adapter,
            allowedArtifacts: [candidate.artifactRef, 'runtime/teste-nao-vinculado.test.mjs']
          }),
          /artefato extra nao possui vinculo seguro/
        )
      } else {
        const result = await prepararReleaseAutonomaOperacional({
          casa, candidateId, baseline: captured.baseline, repository: git.adapter
        })
        assert.equal(result.result, 'uncontrolled-repository-changes')
        assert.equal(result.publication, 'not-confirmed')
      }
      assert.equal(git.calls.commit, 0)
      assert.equal(git.calls.push, 0)
    } finally {
      await cleanup(root, casa)
    }
  }
})

test('gate vermelho restaura metadados sem apagar o artefato materializado', async () => {
  const { root, casa, candidateId } = await fixture()
  const git = repositoryFixture()
  try {
    const captured = await capturarBaselineReleaseOperacional({ casa, repository: git.adapter })
    await prepararCandidata(casa, candidateId)
    const artifactBefore = await readFile(join(root, ...ARTIFACT.split('/')), 'utf8')
    const result = await prepararReleaseAutonomaOperacional({
      casa,
      candidateId,
      baseline: captured.baseline,
      repository: git.adapter,
      runGates: async () => ({ ok: false, checks: [{ ok: false, error: 'saida bruta privada' }] })
    })
    assert.equal(result.result, 'release-reverted')
    assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '0.21.2')
    assert.equal(await readFile(join(root, ...ARTIFACT.split('/')), 'utf8'), artifactBefore)
    assert.doesNotMatch(await readFile(caminhoDoEstadoReleaseAutonoma(casa), 'utf8'), /saida bruta privada/)
  } finally {
    await cleanup(root, casa)
  }
})

test('push transitorio retoma o mesmo commit sem novo bump ou novo gate', async () => {
  const { root, casa, candidateId } = await fixture()
  const git = repositoryFixture({ failPushes: 1 })
  let gateCalls = 0
  try {
    const captured = await capturarBaselineReleaseOperacional({ casa, repository: git.adapter })
    await prepararCandidata(casa, candidateId)
    const runGates = async () => {
      gateCalls += 1
      return { ok: true, checks: [] }
    }
    const first = await prepararReleaseAutonomaOperacional({
      casa, candidateId, baseline: captured.baseline, repository: git.adapter, runGates,
      installAndReadback: async () => { throw new Error('nao instala antes do push') }
    })
    assert.equal(first.result, 'release-retryable')
    assert.equal(first.stage, 'committed')
    const second = await prepararReleaseAutonomaOperacional({
      casa, candidateId, baseline: captured.baseline, repository: git.adapter, runGates,
      installAndReadback: instalarComRaizInstalada(root)
    })
    assert.equal(second.result, 'published-loaded-verified')
    assert.equal(second.version, '0.21.3')
    assert.equal(git.calls.commit, 1)
    assert.equal(git.calls.push, 2)
    assert.equal(gateCalls, 1)
  } finally {
    await cleanup(root, casa)
  }
})
