import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/Weriton-DataOps/Omni-Agent/main/.claude-plugin/plugin.json'

function semver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value ?? '')
  return match ? match.slice(1, 4).map(Number) : null
}

export function compararVersoes(installed, latest) {
  const left = semver(installed)
  const right = semver(latest)
  if (!left || !right) throw new Error('Versão semântica inválida.')
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

export function caminhoDoCacheVersao(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do Omni precisa ser um caminho absoluto.')
  return join(casa, 'updates', 'version-check.json')
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(caminho, 'utf8'))
}

async function lerCache(casa) {
  try {
    const cache = await lerJson(caminhoDoCacheVersao(casa))
    if (
      cache?.schemaVersion === 1 &&
      semver(cache.latestVersion) &&
      typeof cache.checkedAt === 'string'
    ) {
      return cache
    }
  } catch (erro) {
    if (erro?.code !== 'ENOENT') return null
  }
  return null
}

async function gravarCache(casa, cache) {
  const arquivo = caminhoDoCacheVersao(casa)
  const temporario = `${arquivo}.${process.pid}.novo`
  await mkdir(dirname(arquivo), { recursive: true })
  await writeFile(temporario, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  await rename(temporario, arquivo)
}

function resultado(installedVersion, latestVersion, source, checkedAt) {
  const comparison = compararVersoes(installedVersion, latestVersion)
  return {
    installedVersion,
    latestVersion,
    status: comparison < 0 ? 'outdated' : comparison > 0 ? 'ahead' : 'current',
    updateAvailable: comparison < 0,
    source,
    checkedAt
  }
}

function timeoutSignal(timeoutMs) {
  return typeof globalThis.AbortSignal?.timeout === 'function'
    ? globalThis.AbortSignal.timeout(timeoutMs)
    : undefined
}

export async function verificarVersao({
  casa,
  pluginRoot = raiz,
  manifestUrl = DEFAULT_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 2_500
} = {}) {
  const installedManifest = await lerJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))
  if (installedManifest.name !== 'omni' || !semver(installedManifest.version)) {
    throw new Error('Manifest instalado do Omni é inválido.')
  }
  const installedVersion = installedManifest.version
  const cache = await lerCache(casa)
  const checkedAt = new Date(now).toISOString()

  try {
    if (typeof fetchImpl !== 'function') throw new Error('Consulta remota indisponível.')
    const headers = cache?.etag ? { 'If-None-Match': cache.etag } : {}
    const response = await fetchImpl(manifestUrl, {
      method: 'GET',
      headers,
      signal: timeoutSignal(timeoutMs)
    })

    if (response.status === 304 && cache) {
      const refreshed = { ...cache, checkedAt }
      await gravarCache(casa, refreshed)
      return resultado(installedVersion, cache.latestVersion, 'remote-not-modified', checkedAt)
    }
    if (!response.ok) throw new Error(`Consulta de versão retornou HTTP ${response.status}.`)

    const raw = await response.text()
    if (raw.length > 20_000) throw new Error('Manifest remoto excedeu o limite esperado.')
    const remote = JSON.parse(raw)
    if (remote.name !== 'omni' || !semver(remote.version)) {
      throw new Error('Manifest remoto do Omni é inválido.')
    }

    const nextCache = {
      schemaVersion: 1,
      latestVersion: remote.version,
      checkedAt,
      etag: response.headers?.get?.('etag') ?? null
    }
    await gravarCache(casa, nextCache)
    return resultado(installedVersion, remote.version, 'remote', checkedAt)
  } catch (error) {
    if (cache) {
      return {
        ...resultado(installedVersion, cache.latestVersion, 'stale-cache', cache.checkedAt),
        checkError: error instanceof Error ? error.message : String(error)
      }
    }
    return {
      installedVersion,
      latestVersion: null,
      status: 'unknown',
      updateAvailable: false,
      source: 'unavailable',
      checkedAt,
      checkError: error instanceof Error ? error.message : String(error)
    }
  }
}
