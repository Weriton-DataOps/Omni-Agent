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

function resposta(version, { status = 200, etag = '"etag-teste"' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag : null) },
    text: async () => JSON.stringify({ name: 'omni', version })
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

test('detecta versão instalada atual', async () => {
  const home = await casa()
  try {
    const result = await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('0.16.0'),
      now: Date.parse('2026-08-25T20:00:00.000Z')
    })
    assert.equal(result.status, 'current')
    assert.equal(result.updateAvailable, false)
    assert.equal(result.source, 'remote')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('detecta atualização e persiste apenas metadados de versão', async () => {
  const home = await casa()
  try {
    const result = await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('0.17.0'),
      now: Date.parse('2026-08-25T20:01:00.000Z')
    })
    assert.equal(result.status, 'outdated')
    assert.equal(result.installedVersion, '0.16.0')
    assert.equal(result.latestVersion, '0.17.0')
    assert.equal(result.updateAvailable, true)

    const cache = JSON.parse(await readFile(caminhoDoCacheVersao(home), 'utf8'))
    assert.deepEqual(
      Object.keys(cache).sort(),
      ['checkedAt', 'etag', 'latestVersion', 'remoteSha', 'schemaVersion']
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('falha de rede usa cache anterior sem bloquear o Omni', async () => {
  const home = await casa()
  try {
    await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('0.17.0')
    })
    const offline = await verificarVersao({
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
    await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('0.16.0'),
      now: Date.parse('2026-08-25T20:10:00.000Z')
    })
    let receivedHeaders
    const result = await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async (_url, options) => {
        receivedHeaders = options.headers
        return resposta(null, { status: 304 })
      },
      now: Date.parse('2026-08-25T20:11:00.000Z')
    })
    assert.equal(receivedHeaders['If-None-Match'], '"etag-teste"')
    assert.equal(result.status, 'current')
    assert.equal(result.source, 'remote-not-modified')
    assert.equal(result.checkedAt, '2026-08-25T20:11:00.000Z')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('cache remoto atrás da instalação força segunda consulta sem ETag', async () => {
  const home = await casa()
  try {
    const ahead = await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async () => resposta('0.8.0'),
      now: Date.parse('2026-08-25T20:20:00.000Z')
    })
    assert.equal(ahead.status, 'ahead')

    const calls = []
    const refreshed = await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return calls.length === 1
          ? resposta(null, { status: 304 })
          : resposta('0.16.0', { etag: '"etag-novo"' })
      },
      now: Date.parse('2026-08-25T20:21:00.000Z')
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.headers['If-None-Match'], '"etag-teste"')
    assert.match(calls[1].url, /omni_check=/)
    assert.equal(calls[1].options.headers['Cache-Control'], 'no-cache')
    assert.equal(refreshed.status, 'current')
    assert.equal(refreshed.latestVersion, '0.16.0')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('sem rede e sem cache retorna unknown', async () => {
  const home = await casa()
  try {
    const result = await verificarVersao({
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

test('lê o formato base64 da API de conteúdo do GitHub', async () => {
  const home = await casa()
  try {
    const manifest = JSON.stringify({ name: 'omni', version: '0.16.0' })
    const result = await verificarVersao({
      casa: home,
      pluginRoot,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '"etag-api"' },
        text: async () =>
          JSON.stringify({
            encoding: 'base64',
            content: Buffer.from(manifest, 'utf8').toString('base64'),
            sha: 'sha-publicado'
          })
      })
    })
    assert.equal(result.status, 'current')
    const cache = JSON.parse(await readFile(caminhoDoCacheVersao(home), 'utf8'))
    assert.equal(cache.remoteSha, 'sha-publicado')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
