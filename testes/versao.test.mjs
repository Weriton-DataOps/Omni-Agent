import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  caminhoDoCacheVersao,
  compararVersoes,
  verificarVersao
} from '../runtime/versao.mjs'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const installedRelease = JSON.parse(
  await readFile(join(pluginRoot, 'contratos', 'atualizacao', 'integridade.json'), 'utf8')
)
const installedVersion = installedRelease.identity.version
const installedFingerprint = installedRelease.identity.releaseFingerprint

const verifiedRelease = async () => ({
  fingerprint: installedFingerprint,
  declaredFingerprint: installedFingerprint,
  status: 'verified'
})

function verificar(options) {
  return verificarVersao({ ...options, verifyReleaseIntegrity: verifiedRelease })
}

function resposta(version, options = {}) {
  const status = options.status ?? 200
  const etag = options.etag ?? '"etag-teste"'
  const releaseFingerprint = Object.hasOwn(options, 'releaseFingerprint')
    ? options.releaseFingerprint
    : installedFingerprint
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag : null) },
    text: async () => JSON.stringify({
      schemaVersion: 1,
      contract: 'omni-release-integrity-v1',
      identity: { version, releaseFingerprint }
    })
  }
}

async function casa() {
  return mkdtemp(join(tmpdir(), 'omni-version-'))
}

test('comparação semver distingue atual, antiga e adiantada', () => {
  assert.equal(compararVersoes('0.5.0', '0.5.0'), 0)
  assert.equal(compararVersoes('0.5.0', '0.6.0'), -1)
  assert.equal(compararVersoes('1.0.0', '0.9.9'), 1)
})

test('semver aplica precedencia de prerelease e ignora metadata de build', () => {
  assert.equal(compararVersoes('1.0.0-beta', '1.0.0'), -1)
  assert.equal(compararVersoes('1.0.0-beta.2', '1.0.0-beta.11'), -1)
  assert.equal(compararVersoes('1.0.0-beta.11', '1.0.0-rc.1'), -1)
  assert.equal(compararVersoes('1.0.0+build.1', '1.0.0+build.99'), 0)
  assert.equal(compararVersoes('1.0.0-rc.1+build.1', '1.0.0-rc.1+build.2'), 0)
  assert.throws(() => compararVersoes('1.0.0-01', '1.0.0'), /sem.ntica inv.lida/i)
})

test('detecta versão instalada atual', async () => {
  const home = await casa()
  try {
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta(installedVersion),
      now: Date.parse('2026-08-25T20:00:00.000Z')
    })
    assert.equal(result.status, 'current-verified')
    assert.equal(result.updateAvailable, false)
    assert.equal(result.source, 'remote')
    assert.equal(result.installedFingerprint, installedFingerprint)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('mesma versão com outro payload nunca é declarada current', async () => {
  const home = await casa()
  try {
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta(installedVersion, { releaseFingerprint: 'b'.repeat(64) })
    })
    assert.equal(result.status, 'diverged')
    assert.equal(result.updateAvailable, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('contrato remoto legado fica explicitamente não verificável', async () => {
  const home = await casa()
  try {
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta(installedVersion, { releaseFingerprint: undefined })
    })
    assert.equal(result.status, 'legacy-unverifiable')
    assert.equal(result.latestFingerprint, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('detecta atualização e persiste apenas metadados de versão', async () => {
  const home = await casa()
  try {
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('99.0.0', { releaseFingerprint: 'b'.repeat(64) }),
      now: Date.parse('2026-08-25T20:01:00.000Z')
    })
    assert.equal(result.status, 'outdated')
    assert.equal(result.installedVersion, installedVersion)
    assert.equal(result.latestVersion, '99.0.0')
    assert.equal(result.updateAvailable, true)

    const cache = JSON.parse(await readFile(caminhoDoCacheVersao(home), 'utf8'))
    assert.deepEqual(
      Object.keys(cache).sort(),
      ['checkedAt', 'etag', 'latestFingerprint', 'latestVersion', 'manifestBlobSha', 'schemaVersion']
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('falha de rede usa cache anterior sem bloquear o Omni', async () => {
  const home = await casa()
  try {
    await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('99.0.0', { releaseFingerprint: 'b'.repeat(64) })
    })
    const offline = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => {
        throw new Error('offline')
      }
    })
    assert.equal(offline.status, 'outdated')
    assert.equal(offline.source, 'stale-cache')
    assert.match(offline.checkError, /offline/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('HTTP 304 renova a conferência usando o ETag armazenado', async () => {
  const home = await casa()
  try {
    await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta(installedVersion),
      now: Date.parse('2026-08-25T20:10:00.000Z')
    })
    let receivedHeaders
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async (_url, options) => {
        receivedHeaders = options.headers
        return resposta(null, { status: 304 })
      },
      now: Date.parse('2026-08-25T20:11:00.000Z')
    })
    assert.equal(receivedHeaders['If-None-Match'], '"etag-teste"')
    assert.equal(result.status, 'current-verified')
    assert.equal(result.source, 'remote-not-modified')
    assert.equal(result.checkedAt, '2026-08-25T20:11:00.000Z')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('cache remoto atrás da instalação força segunda consulta sem ETag', async () => {
  const home = await casa()
  try {
    const ahead = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('0.8.0'),
      now: Date.parse('2026-08-25T20:20:00.000Z')
    })
    assert.equal(ahead.status, 'ahead')

    const calls = []
    const refreshed = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return calls.length === 1
          ? resposta(null, { status: 304 })
          : resposta(installedVersion, { etag: '"etag-novo"' })
      },
      now: Date.parse('2026-08-25T20:21:00.000Z')
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.headers['If-None-Match'], '"etag-teste"')
    assert.match(calls[1].url, /omni_check=/)
    assert.equal(calls[1].options.headers['Cache-Control'], 'no-cache')
    assert.equal(refreshed.status, 'current-verified')
    assert.equal(refreshed.latestVersion, installedVersion)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('sem rede e sem cache retorna unknown', async () => {
  const home = await casa()
  try {
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => {
        throw new Error('offline')
      }
    })
    assert.equal(result.status, 'unknown')
    assert.equal(result.updateAvailable, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('lê o contrato no formato base64 da API de conteúdo do GitHub', async () => {
  const home = await casa()
  try {
    const releaseContract = JSON.stringify({
      schemaVersion: 1,
      contract: 'omni-release-integrity-v1',
      identity: { version: installedVersion, releaseFingerprint: installedFingerprint }
    })
    const result = await verificar({
      casa: home,
      pluginRoot,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '"etag-api"' },
        text: async () =>
          JSON.stringify({
            encoding: 'base64',
            content: Buffer.from(releaseContract, 'utf8').toString('base64'),
            sha: 'sha-publicado'
          })
      })
    })
    assert.equal(result.status, 'current-verified')
    const cache = JSON.parse(await readFile(caminhoDoCacheVersao(home), 'utf8'))
    assert.equal(cache.manifestBlobSha, 'sha-publicado')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
