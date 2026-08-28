import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  lerIdentidadeRelease,
  verificarIntegridadeRelease
} from './integridade-release.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_RELEASE_URL =
  'https://api.github.com/repos/Weriton-DataOps/Omni-Agent/contents/contratos/atualizacao/integridade.json?ref=main'

function semver(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value ?? '')
  if (!match) return null
  const prerelease = match[4] ? match[4].split('.') : []
  if (prerelease.some((item) => /^\d+$/.test(item) && item.length > 1 && item.startsWith('0'))) return null
  return {
    core: match.slice(1, 4).map((item) => BigInt(item)),
    prerelease
  }
}

function fingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
}

export function compararVersoes(installed, latest) {
  const left = semver(installed)
  const right = semver(latest)
  if (!left || !right) throw new Error('Versão semântica inválida.')
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] < right.core[index]) return -1
    if (left.core[index] > right.core[index]) return 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftId = left.prerelease[index]
    const rightId = right.prerelease[index]
    if (leftId === undefined) return -1
    if (rightId === undefined) return 1
    if (leftId === rightId) continue
    const leftNumeric = /^\d+$/.test(leftId)
    const rightNumeric = /^\d+$/.test(rightId)
    if (leftNumeric && rightNumeric) return BigInt(leftId) < BigInt(rightId) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftId < rightId ? -1 : 1
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
    if (!semver(cache?.latestVersion) || typeof cache.checkedAt !== 'string') return null
    if (cache.schemaVersion === 2) return cache
    if (cache.schemaVersion === 1) return {
      schemaVersion: 2,
      latestVersion: cache.latestVersion,
      latestFingerprint: null,
      checkedAt: cache.checkedAt,
      etag: cache.etag ?? null,
      manifestBlobSha: cache.remoteSha ?? null,
      migratedFrom: 1
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

function resultado({ installedVersion, latestVersion, latestFingerprint, integrity, source, checkedAt, manifestBlobSha = null }) {
  const comparison = compararVersoes(installedVersion, latestVersion)
  let status = 'current-verified'
  let updateAvailable = false
  if (integrity.status === 'drifted') {
    status = 'drifted'
    updateAvailable = true
  } else if (comparison < 0) {
    status = 'outdated'
    updateAvailable = true
  } else if (comparison > 0) {
    status = 'ahead'
  } else if (latestFingerprint && integrity.fingerprint !== latestFingerprint) {
    status = 'diverged'
    updateAvailable = true
  } else if (!latestFingerprint || integrity.status === 'legacy-unverifiable') {
    status = 'legacy-unverifiable'
    updateAvailable = Boolean(latestFingerprint)
  }
  return {
    installedVersion,
    installedFingerprint: integrity.fingerprint,
    installedDeclaredFingerprint: integrity.declaredFingerprint,
    installedIntegrity: integrity.status,
    latestVersion,
    latestFingerprint: latestFingerprint ?? null,
    manifestBlobSha,
    status,
    updateAvailable,
    source,
    checkedAt
  }
}

function identidadeDoDocumento(document) {
  if (
    document?.contract === 'omni-release-integrity-v1' &&
    semver(document.identity?.version)
  ) {
    const hasDeclaredFingerprint = Object.hasOwn(document.identity, 'releaseFingerprint')
    if (hasDeclaredFingerprint && !fingerprint(document.identity.releaseFingerprint)) return null
    return {
      version: document.identity.version,
      releaseFingerprint: hasDeclaredFingerprint ? document.identity.releaseFingerprint : null,
      source: 'release-integrity-contract'
    }
  }
  if (document?.name === 'omni' && semver(document.version)) {
    return {
      version: document.version,
      releaseFingerprint: null,
      source: 'legacy-plugin-manifest'
    }
  }
  return null
}

function extrairIdentidadeRemota(raw) {
  const payload = JSON.parse(raw)
  const direct = identidadeDoDocumento(payload)
  if (direct) {
    return { release: direct, manifestBlobSha: null }
  }
  if (
    payload?.encoding === 'base64' &&
    typeof payload.content === 'string' &&
    typeof payload.sha === 'string'
  ) {
    const decoded = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8')
    const release = identidadeDoDocumento(JSON.parse(decoded))
    if (release) {
      return { release, manifestBlobSha: payload.sha }
    }
  }
  throw new Error('Contrato remoto de identidade do Omni é inválido.')
}

function timeoutSignal(timeoutMs) {
  return typeof globalThis.AbortSignal?.timeout === 'function'
    ? globalThis.AbortSignal.timeout(timeoutMs)
    : undefined
}

export async function verificarVersao({
  casa,
  pluginRoot = raiz,
  releaseUrl = DEFAULT_RELEASE_URL,
  manifestUrl,
  fetchImpl = globalThis.fetch,
  readReleaseIdentity = lerIdentidadeRelease,
  verifyReleaseIntegrity = verificarIntegridadeRelease,
  now = Date.now(),
  timeoutMs = 2_500
} = {}) {
  const remoteUrl = manifestUrl ?? releaseUrl
  const installedIdentity = await readReleaseIdentity(pluginRoot)
  const installedVersion = installedIdentity.version
  const integrity = await verifyReleaseIntegrity(pluginRoot)
  const cache = await lerCache(casa)
  const checkedAt = new Date(now).toISOString()
  const buildResult = (latestVersion, latestFingerprint, source, at, manifestBlobSha = null) => resultado({
    installedVersion,
    latestVersion,
    latestFingerprint,
    integrity,
    source,
    checkedAt: at,
    manifestBlobSha
  })

  try {
    if (typeof fetchImpl !== 'function') throw new Error('Consulta remota indisponível.')
    const headers = cache?.etag ? { 'If-None-Match': cache.etag } : {}
    let response = await fetchImpl(remoteUrl, {
      method: 'GET',
      headers,
      signal: timeoutSignal(timeoutMs)
    })

    if (response.status === 304 && cache) {
      if (compararVersoes(installedVersion, cache.latestVersion) > 0) {
        const separator = remoteUrl.includes('?') ? '&' : '?'
        response = await fetchImpl(`${remoteUrl}${separator}omni_check=${encodeURIComponent(checkedAt)}`, {
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache' },
          signal: timeoutSignal(timeoutMs)
        })
      } else {
        const refreshed = { ...cache, checkedAt }
        await gravarCache(casa, refreshed)
        return buildResult(
          cache.latestVersion,
          fingerprint(cache.latestFingerprint),
          'remote-not-modified',
          checkedAt,
          cache.manifestBlobSha ?? null
        )
      }
    }
    if (!response.ok) throw new Error(`Consulta de versão retornou HTTP ${response.status}.`)

    const raw = await response.text()
    if (raw.length > 20_000) throw new Error('Contrato remoto excedeu o limite esperado.')
    const { release: remote, manifestBlobSha } = extrairIdentidadeRemota(raw)
    const latestFingerprint = fingerprint(remote.releaseFingerprint)

    const nextCache = {
      schemaVersion: 2,
      latestVersion: remote.version,
      latestFingerprint,
      checkedAt,
      etag: response.headers?.get?.('etag') ?? null,
      manifestBlobSha
    }
    await gravarCache(casa, nextCache)
    return buildResult(remote.version, latestFingerprint, 'remote', checkedAt, manifestBlobSha)
  } catch (error) {
    if (cache) {
      return {
        ...buildResult(
          cache.latestVersion,
          fingerprint(cache.latestFingerprint),
          'stale-cache',
          cache.checkedAt,
          cache.manifestBlobSha ?? null
        ),
        checkError: error instanceof Error ? error.message : String(error)
      }
    }
    return {
      installedVersion,
      installedFingerprint: integrity.fingerprint,
      installedDeclaredFingerprint: integrity.declaredFingerprint,
      installedIntegrity: integrity.status,
      latestVersion: null,
      latestFingerprint: null,
      manifestBlobSha: null,
      status: integrity.status === 'drifted'
        ? 'drifted'
        : integrity.status === 'legacy-unverifiable'
          ? 'legacy-unverifiable'
          : 'unknown',
      updateAvailable: integrity.status === 'drifted',
      source: 'unavailable',
      checkedAt,
      checkError: error instanceof Error ? error.message : String(error)
    }
  }
}
