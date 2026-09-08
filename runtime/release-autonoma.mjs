import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-json-store.js'
import {
  deriveOperationalArtifacts,
  isEffectiveRelease,
  reduceRelease
} from '../dist/core/release/release-state.js'
import { TEXTO_DIRETIVA_PERSONALIDADE } from './ajustes-personalidade.mjs'
import { atualizarPlugin } from './atualizacao.mjs'
import { lerCicloOperacional } from './ciclo-operacional.mjs'
import {
  lerRepositorioCanonico,
  registrarReadbackOperacionalCarregado,
  registrarReadbackOperacionalInstalado
} from './evolucao.mjs'
import { calcularFingerprintPayload, verificarIntegridadeRelease } from './integridade-release.mjs'
import { criarEvidenciaPromocao } from './rodada-personalidade.mjs'

const STORE_SCHEMA_VERSION = 1
const STORE_CONTRACT = 'omni-autonomous-release-state-v1'
const RAIZ_CARREGADA = dirname(dirname(fileURLToPath(import.meta.url)))
const HASH = /^[a-f0-9]{40,64}$/
const HASH_SHA256 = /^[a-f0-9]{64}$/
const RELEASE_LOCK_LEASE_MS = 2 * 60 * 60_000
export const RELEASE_STATE_LOCK_POLICY = Object.freeze({
  acquisitionTimeoutMs: 5_000,
  retryDelayMs: 25,
  staleLockMs: 30_000,
  heartbeatMs: 10_000,
  recoverStaleLocks: true,
  timeoutMessage: 'Estado da release autonoma esta sendo atualizado por outro processo.'
})
const RELEASE_STAGES = new Set([
  'precommit-retry',
  'committed',
  'pushed',
  'installed-verified',
  'awaiting-reload',
  'loaded-verified'
])

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function portable(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function raizComparavel(root, platform = process.platform) {
  const normalized = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function mesmaRaiz(left, right, platform = process.platform) {
  return raizComparavel(left, platform) === raizComparavel(right, platform)
}

function fingerprintDaRaiz(root) {
  return sha256(raizComparavel(root))
}

function proximaVersaoPatch(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '')
  if (!match) throw new Error('Release autonoma exige uma versao semantica estavel.')
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

export function descreverPreparacaoMelhoriaOperacional(candidateFingerprint) {
  if (!HASH_SHA256.test(candidateFingerprint ?? '')) {
    throw new Error('Descricao da melhoria operacional exige fingerprint SHA-256.')
  }
  return [
    `Materializou melhoria operacional auditada ${candidateFingerprint.slice(0, 12)} para validacao da release;`,
    'gates, publicacao, instalacao e readback permanecem pendentes neste estagio.'
  ].join(' ')
}

async function lerJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function gravarJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.novo`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function adquirirLock(root) {
  const path = join(root, '.git', 'omni-autonomous-release.lock')
  const token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      try {
        await handle.writeFile(`${JSON.stringify({
          schemaVersion: 1,
          token,
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
          leaseMs: RELEASE_LOCK_LEASE_MS
        })}\n`, 'utf8')
      } catch (error) {
        await handle.close().catch(() => undefined)
        await unlink(path).catch(() => undefined)
        throw error
      }
      return async () => {
        await handle.close().catch(() => undefined)
        try {
          const current = JSON.parse(await readFile(path, 'utf8'))
          if (current?.token === token) await unlink(path).catch(() => undefined)
        } catch (error) {
          if (error?.code !== 'ENOENT') return undefined
        }
        return undefined
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(path).catch(() => null)
      if (!info || Date.now() - info.mtimeMs <= RELEASE_LOCK_LEASE_MS) return null
      await unlink(path).catch(() => undefined)
    }
  }
  return null
}

function executarProcesso(executable, args, root, timeout = 15 * 60_000) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || result.stdout?.trim() || 'sem diagnostico'
    throw new Error(`${executable} ${args.join(' ')} falhou: ${detail}`)
  }
  return result.stdout ?? ''
}

function executarGate(executable, args, root) {
  try {
    const output = executarProcesso(executable, args, root)
    return {
      ok: true,
      command: [executable, ...args].join(' '),
      outputFingerprint: sha256(output)
    }
  } catch (error) {
    return {
      ok: false,
      command: [executable, ...args].join(' '),
      outputFingerprint: sha256(error instanceof Error ? error.message : String(error)),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function gatesPadrao(root) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const checks = [
    executarGate(npm, ['run', 'check'], root),
    executarGate(npm, ['test'], root)
  ]
  return { ok: checks.every((item) => item.ok), checks }
}

function resultadoGit(executable, args, root) {
  return executarProcesso(executable, args, root, 120_000)
}

function lerStatusPorcelain(raw) {
  const records = String(raw ?? '').split('\0').filter(Boolean)
  const changes = []
  for (const record of records) {
    if (record.length < 4) throw new Error('Git retornou status ilegivel.')
    const status = record.slice(0, 2)
    const path = portable(record.slice(3))
    if (/^[RC]/.test(status) || /[RC]$/.test(status)) {
      throw new Error('Release autonoma recusa rename ou copy no conjunto controlado.')
    }
    changes.push({ status, path })
  }
  return changes
}

export function criarAdaptadorRepositorioGit({ execute = resultadoGit } = {}) {
  const run = (root, args) => execute('git', args, root)
  return {
    async status(root) {
      return lerStatusPorcelain(run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
    },
    async head(root) {
      const commitSha = String(run(root, ['rev-parse', 'HEAD'])).trim()
      if (!HASH.test(commitSha)) throw new Error('Git nao retornou um commit verificavel.')
      const branch = String(run(root, ['symbolic-ref', '--short', 'HEAD'])).trim()
      if (!branch) throw new Error('Release autonoma recusa HEAD destacado.')
      return { commitSha, branchFingerprint: sha256(branch) }
    },
    async commit(root, { paths, message }) {
      try {
        run(root, ['add', '--', ...paths])
        const staged = String(run(root, ['diff', '--cached', '--name-only', '-z']))
          .split('\0')
          .filter(Boolean)
          .map(portable)
          .sort()
        const expected = [...paths].map(portable).sort()
        if (JSON.stringify(staged) !== JSON.stringify(expected)) {
          throw new Error('Indice Git divergiu do conjunto controlado da release.')
        }
        run(root, ['commit', '-m', message])
        return this.head(root)
      } catch (error) {
        try { run(root, ['restore', '--staged', '--', ...paths]) } catch {}
        throw error
      }
    },
    async push(root, { commitSha, branchFingerprint }) {
      const branch = String(run(root, ['symbolic-ref', '--short', 'HEAD'])).trim()
      if (!branch || sha256(branch) !== branchFingerprint) {
        throw new Error('Branch atual divergiu da branch que produziu a release.')
      }
      run(root, ['push', 'origin', `HEAD:refs/heads/${branch}`])
      const remote = String(run(root, ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`])).trim()
        .split(/\s+/)[0]
      if (remote !== commitSha) throw new Error('Readback remoto nao confirmou o commit publicado.')
      return { commitSha, remoteRefFingerprint: sha256(`refs/heads/${branch}`) }
    }
  }
}

const REPOSITORIO_GIT_PADRAO = criarAdaptadorRepositorioGit()

export async function confirmarRuntimeCarregado({
  pluginRoot = RAIZ_CARREGADA,
  version,
  payloadFingerprint,
  verifyLoadedIntegrity = verificarIntegridadeRelease,
  at
} = {}) {
  if (!isAbsolute(pluginRoot ?? '')) throw new Error('Readback carregado exige raiz absoluta do plugin.')
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version ?? '')) {
    throw new Error('Readback carregado exige versao semantica estavel.')
  }
  if (!HASH_SHA256.test(payloadFingerprint ?? '')) {
    throw new Error('Readback carregado exige fingerprint SHA-256 da release.')
  }
  const loadedRoot = await realpath(resolve(pluginRoot))
  const integrity = await verifyLoadedIntegrity(loadedRoot)
  if (
    integrity?.status !== 'verified' ||
    integrity.versionMatchesManifest !== true ||
    integrity.releaseVersion !== version ||
    integrity.fingerprint !== payloadFingerprint ||
    integrity.declaredFingerprint !== payloadFingerprint
  ) {
    throw new Error('Runtime carregado nao corresponde a raiz, versao e fingerprint da release instalada.')
  }
  const verifiedAt = instante(at)
  return {
    verified: true,
    root: loadedRoot,
    version,
    fingerprint: payloadFingerprint,
    verificationFingerprint: sha256(JSON.stringify({
      root: raizComparavel(loadedRoot),
      version,
      fingerprint: payloadFingerprint,
      verifiedAt
    })),
    verifiedAt
  }
}

export async function instalarEConfirmarPadrao({
  casa,
  version,
  releaseFingerprint,
  updatePlugin = atualizarPlugin,
  loadedRoot = RAIZ_CARREGADA,
  verifyLoadedIntegrity = verificarIntegridadeRelease,
  at
}) {
  // A raiz carregada deste runtime é a única referência válida para descobrir se a
  // sessão precisa recarregar. A árvore-fonte recém-publicada nunca pode servir de
  // fallback para o readback da instalação.
  const update = await updatePlugin({ casa })
  const proofs = new Set(update?.verifiedBy ?? [])
  if (
    update?.installedVersion !== version ||
    update?.installedFingerprint !== releaseFingerprint ||
    !proofs.has('installed-root-integrity') ||
    !proofs.has('github-release-contract') ||
    !proofs.has('payload-fingerprint')
  ) {
    throw new Error('Atualizacao nao comprovou a release publicada na raiz instalada.')
  }
  const installed = {
    verified: true,
    installedVersion: version,
    installedFingerprint: update.installedFingerprint,
    installedRoot: update.installedRoot,
    verificationFingerprint: sha256(JSON.stringify({
      installedVersion: update.installedVersion,
      latestVersion: update.latestVersion,
      verifiedBy: [...proofs].sort(),
      reloadRequired: update.reloadRequired === true
    })),
    reloadRequired: update.reloadRequired === true,
    loadedReadback: null
  }
  if (!installed.reloadRequired) {
    installed.loadedReadback = await confirmarRuntimeCarregado({
      pluginRoot: loadedRoot,
      version,
      payloadFingerprint: releaseFingerprint,
      verifyLoadedIntegrity,
      at
    })
  }
  return installed
}

async function snapshot(paths) {
  const entries = []
  for (const path of paths) {
    try {
      entries.push({ path, existed: true, raw: await readFile(path) })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      entries.push({ path, existed: false, raw: null })
    }
  }
  return entries
}

async function restaurar(entries) {
  for (const entry of entries) {
    if (entry.existed) {
      await mkdir(dirname(entry.path), { recursive: true })
      await writeFile(entry.path, entry.raw)
    } else {
      await unlink(entry.path).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
    }
  }
}

function validarRaiz(root) {
  if (!isAbsolute(root ?? '')) throw new Error('Repositorio fonte do Omni precisa usar caminho absoluto.')
  return root
}

function nomeEvidencia(roundId) {
  const safe = String(roundId ?? '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120)
  if (!safe) throw new Error('Rodada de eval sem identificador valido.')
  return `${safe}.json`
}

function estadoVazio() {
  return { schemaVersion: STORE_SCHEMA_VERSION, contract: STORE_CONTRACT, releases: {} }
}

export function caminhoDoEstadoReleaseAutonoma(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'runtime', 'autonomous-releases.json')
}

export function caminhoDoLockReleaseAutonoma(casa) {
  return `${caminhoDoEstadoReleaseAutonoma(casa)}.lock`
}

function adquirirLockDoEstado(casa) {
  return acquireLocalFileLock(caminhoDoLockReleaseAutonoma(casa), RELEASE_STATE_LOCK_POLICY)
}

function identidadeCore(transaction) {
  return {
    version: transaction.version,
    fingerprint: transaction.releaseFingerprint,
    commitSha: transaction.commitSha
  }
}

function readbackInstaladoCore(readback) {
  return {
    root: readback.root,
    version: readback.version,
    fingerprint: readback.fingerprint,
    verificationFingerprint: readback.verificationFingerprint
  }
}

function readbackCarregadoCore(readback) {
  return {
    ...readbackInstaladoCore(readback),
    verifiedAt: readback.verifiedAt
  }
}

function estadoCoreDaTransacao(transaction) {
  switch (transaction.stage) {
    case 'precommit-retry':
      return { stage: 'precommit-retry' }
    case 'committed':
      return { stage: 'committed', identity: identidadeCore(transaction) }
    case 'pushed':
      return {
        stage: 'pushed',
        identity: identidadeCore(transaction),
        remoteCommitSha: transaction.remoteCommitSha
      }
    case 'installed-verified':
    case 'awaiting-reload':
      return {
        stage: transaction.stage,
        identity: identidadeCore(transaction),
        installed: readbackInstaladoCore(transaction.installedReadback)
      }
    case 'loaded-verified':
      return {
        stage: 'loaded-verified',
        identity: identidadeCore(transaction),
        installed: readbackInstaladoCore(transaction.installedReadback),
        loaded: readbackCarregadoCore(transaction.loadedReadback)
      }
    default:
      throw new Error(`Estagio de release desconhecido: ${transaction.stage}.`)
  }
}

function reduzirTransicao(transaction, event, expectedStage) {
  const next = reduceRelease(estadoCoreDaTransacao(transaction), event)
  if (next.stage !== expectedStage) {
    throw new Error(`Reducer da release nao confirmou o estagio ${expectedStage}.`)
  }
  return next
}

function validarTransacaoPeloReducer(transaction) {
  if (transaction.stage === 'precommit-retry') return true
  let state = reduceRelease({ stage: 'precommit-retry' }, {
    type: 'commit-confirmed',
    identity: identidadeCore(transaction)
  })
  if (transaction.stage === 'committed') return state.stage === transaction.stage
  state = reduceRelease(state, {
    type: 'push-confirmed',
    remoteCommitSha: transaction.remoteCommitSha
  })
  if (transaction.stage === 'pushed') return state.stage === transaction.stage
  state = reduceRelease(state, {
    type: 'install-confirmed',
    readback: readbackInstaladoCore(transaction.installedReadback)
  })
  if (transaction.stage === 'installed-verified') return state.stage === transaction.stage
  state = reduceRelease(state, { type: 'reload-required' })
  if (transaction.stage === 'awaiting-reload') return state.stage === transaction.stage
  state = reduceRelease(state, {
    type: 'runtime-loaded',
    rootComparison: process.platform === 'win32' ? 'windows-insensitive' : 'case-sensitive',
    readback: readbackCarregadoCore(transaction.loadedReadback)
  })
  return isEffectiveRelease(state) && state.stage === transaction.stage
}

function reduzirCarregamento(transaction, readback) {
  if (
    readback?.verified !== true ||
    !isAbsolute(readback.root ?? '') ||
    !HASH_SHA256.test(readback.verificationFingerprint ?? '') ||
    !Number.isFinite(Date.parse(readback.verifiedAt ?? ''))
  ) return null
  try {
    const next = reduzirTransicao(transaction, {
      type: 'runtime-loaded',
      rootComparison: process.platform === 'win32' ? 'windows-insensitive' : 'case-sensitive',
      readback: readbackCarregadoCore({ ...readback, root: resolve(readback.root) })
    }, 'loaded-verified')
    return isEffectiveRelease(next) ? next : null
  } catch {
    return null
  }
}

function validarEstado(state) {
  if (
    state?.schemaVersion !== STORE_SCHEMA_VERSION ||
    state.contract !== STORE_CONTRACT ||
    !state.releases ||
    typeof state.releases !== 'object' ||
    Array.isArray(state.releases)
  ) throw new Error('Estado local da release autonoma e invalido.')
  for (const [key, release] of Object.entries(state.releases)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !RELEASE_STAGES.has(release?.stage)) {
      throw new Error('Transacao local de release autonoma e invalida.')
    }
    for (const field of ['runFingerprint', 'repositoryFingerprint']) {
      if (!/^[a-f0-9]{64}$/.test(release[field] ?? '')) {
        throw new Error('Transacao local contem identidade sem fingerprint.')
      }
    }
    if (release.commitSha !== null && release.commitSha !== undefined && !HASH.test(release.commitSha)) {
      throw new Error('Transacao local contem commit invalido.')
    }
    if (release.releaseFingerprint !== null && release.releaseFingerprint !== undefined &&
      !/^[a-f0-9]{64}$/.test(release.releaseFingerprint)) {
      throw new Error('Transacao local contem fingerprint de release invalido.')
    }
    if (['committed', 'pushed', 'installed-verified', 'awaiting-reload', 'loaded-verified'].includes(release.stage)) {
      if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.version ?? '') ||
        !HASH.test(release.commitSha ?? '') ||
        !/^[a-f0-9]{64}$/.test(release.branchFingerprint ?? '') ||
        !/^[a-f0-9]{64}$/.test(release.releaseFingerprint ?? '')) {
        throw new Error('Transacao commitada nao possui identidade completa.')
      }
    }
    if (['pushed', 'installed-verified', 'awaiting-reload', 'loaded-verified'].includes(release.stage) && release.remoteCommitSha !== release.commitSha) {
      throw new Error('Transacao publicada nao possui readback do commit remoto.')
    }
    if (['installed-verified', 'awaiting-reload', 'loaded-verified'].includes(release.stage) && (
      release.installedReadback?.version !== release.version ||
      release.installedReadback?.fingerprint !== release.releaseFingerprint ||
      !isAbsolute(release.installedReadback?.root ?? '') ||
      !/^[a-f0-9]{64}$/.test(release.installedReadback?.verificationFingerprint ?? '')
    )) throw new Error('Transacao instalada nao possui readback verificavel.')
    if (release.stage === 'loaded-verified' && (
      release.loadedReadback?.version !== release.version ||
      release.loadedReadback?.fingerprint !== release.releaseFingerprint ||
      !isAbsolute(release.loadedReadback?.root ?? '') ||
      !/^[a-f0-9]{64}$/.test(release.loadedReadback?.verificationFingerprint ?? '') ||
      !Number.isFinite(Date.parse(release.loadedReadback?.verifiedAt ?? ''))
    )) throw new Error('Transacao concluida nao possui readback do runtime carregado.')
    if (release.stage !== 'loaded-verified' && release.loadedReadback !== null && release.loadedReadback !== undefined) {
      throw new Error('Transacao nao carregada contem readback terminal indevido.')
    }
    try {
      if (!validarTransacaoPeloReducer(release)) throw new Error('estagio divergente')
    } catch {
      throw new Error('Transacao local tentou contornar o reducer canonico da release.')
    }
  }
  return state
}

function migrarEstado(state) {
  if (
    state?.schemaVersion !== STORE_SCHEMA_VERSION ||
    state?.contract !== STORE_CONTRACT ||
    !state?.releases ||
    typeof state.releases !== 'object' ||
    Array.isArray(state.releases)
  ) return state
  return {
    ...state,
    releases: Object.fromEntries(Object.entries(state.releases).map(([key, release]) => {
      if (!release || typeof release !== 'object') return [key, release]
      const migrated = { ...release }
      if (migrated.stage === 'installed-verified') {
        const installedProofIsCurrent =
          isAbsolute(migrated.installedReadback?.root ?? '') &&
          migrated.installedReadback?.version === migrated.version &&
          migrated.installedReadback?.fingerprint === migrated.releaseFingerprint &&
          HASH_SHA256.test(migrated.installedReadback?.verificationFingerprint ?? '')
        if (installedProofIsCurrent) {
          migrated.stage = 'awaiting-reload'
        } else {
          // Stores v1 antigos nao registravam a raiz instalada. Repetir apenas a
          // instalacao/readback e mais seguro do que promover uma prova incompleta.
          migrated.stage = 'pushed'
          migrated.installedReadback = null
        }
      }
      if (migrated.stage !== 'loaded-verified') migrated.loadedReadback = null
      return [key, migrated]
    }))
  }
}

async function lerEstado(casa) {
  try {
    return validarEstado(migrarEstado(await lerJson(caminhoDoEstadoReleaseAutonoma(casa))))
  } catch (error) {
    if (error?.code === 'ENOENT') return estadoVazio()
    throw error
  }
}

async function gravarEstado(casa, state) {
  await gravarJson(caminhoDoEstadoReleaseAutonoma(casa), validarEstado(state))
}

function revisaoDaTransacao(transaction) {
  return sha256(JSON.stringify(transaction ?? null))
}

function estagioDaTransacao(transaction) {
  return [
    'precommit-retry',
    'committed',
    'pushed',
    'installed-verified',
    'awaiting-reload',
    'loaded-verified'
  ].indexOf(transaction?.stage)
}

function mesmaIdentidadeDeFluxo(left, right) {
  return Boolean(
    left && right &&
    left.runFingerprint === right.runFingerprint &&
    left.repositoryFingerprint === right.repositoryFingerprint &&
    (left.version === null || right.version === null || left.version === right.version) &&
    (left.releaseFingerprint === null || right.releaseFingerprint === null ||
      left.releaseFingerprint === right.releaseFingerprint) &&
    (left.commitSha === null || right.commitSha === null || left.commitSha === right.commitSha)
  )
}

async function lerTransacaoComRevisao(casa, key) {
  const lock = await adquirirLockDoEstado(casa)
  try {
    const state = await lerEstado(casa)
    const transaction = state.releases[key] ?? null
    return { transaction, revision: revisaoDaTransacao(transaction) }
  } finally {
    await lock.release()
  }
}

async function persistirTransacaoCAS(casa, key, expectedRevision, proposed) {
  const lock = await adquirirLockDoEstado(casa)
  try {
    const state = await lerEstado(casa)
    const current = state.releases[key] ?? null
    const currentRevision = revisaoDaTransacao(current)
    if (currentRevision !== expectedRevision) {
      return { saved: false, transaction: current, revision: currentRevision }
    }
    state.releases[key] = proposed
    await gravarEstado(casa, state)
    return { saved: true, transaction: proposed, revision: revisaoDaTransacao(proposed) }
  } finally {
    await lock.release()
  }
}

function adotarAvancoConcorrente(current, proposed) {
  return Boolean(
    mesmaIdentidadeDeFluxo(current, proposed) &&
    estagioDaTransacao(current) >= estagioDaTransacao(proposed)
  )
}

export async function confirmarReleasesCarregadas({
  casa,
  pluginRoot = RAIZ_CARREGADA,
  confirmLoaded = confirmarRuntimeCarregado,
  recordOperationalLoaded = registrarReadbackOperacionalCarregado,
  at
} = {}) {
  if (!isAbsolute(casa ?? '')) throw new Error('Handshake carregado exige casa absoluta do Omni.')
  if (!isAbsolute(pluginRoot ?? '')) throw new Error('Handshake carregado exige raiz absoluta do plugin.')
  const loadedRoot = await realpath(resolve(pluginRoot))
  const snapshotLock = await adquirirLockDoEstado(casa)
  let snapshot
  try {
    snapshot = await lerEstado(casa)
  } finally {
    await snapshotLock.release()
  }

  let rejected = 0
  const verified = []
  for (const [key, transaction] of Object.entries(snapshot.releases)) {
    if (!['installed-verified', 'awaiting-reload'].includes(transaction.stage)) continue
    if (!mesmaRaiz(transaction.installedReadback?.root ?? '', loadedRoot)) continue
    let receipt
    try {
      receipt = await confirmLoaded({
        pluginRoot: loadedRoot,
        version: transaction.version,
        payloadFingerprint: transaction.releaseFingerprint,
        at
      })
    } catch {
      rejected += 1
      continue
    }
    const normalized = {
      ...receipt,
      root: loadedRoot,
      verifiedAt: receipt?.verifiedAt ?? instante(at)
    }
    if (!reduzirCarregamento(transaction, normalized)) {
      rejected += 1
      continue
    }
    verified.push({
      key,
      revision: revisaoDaTransacao(transaction),
      readback: normalized
    })
  }

  let confirmed = 0
  let concurrentSkipped = 0
  const operationalReceipts = new Map()
  if (verified.length > 0) {
    const applyLock = await adquirirLockDoEstado(casa)
    try {
      const currentState = await lerEstado(casa)
      for (const item of verified) {
        const current = currentState.releases[item.key] ?? null
        if (revisaoDaTransacao(current) !== item.revision) {
          concurrentSkipped += 1
          continue
        }
        const loadedCore = reduzirCarregamento(current, item.readback)
        if (!loadedCore) {
          rejected += 1
          continue
        }
        currentState.releases[item.key] = {
          ...current,
          stage: loadedCore.stage,
          loadedReadback: loadedCore.loaded,
          lastFailure: null,
          updatedAt: instante(at)
        }
        operationalReceipts.set(`${current.version}:${current.releaseFingerprint}`, loadedCore.loaded)
        confirmed += 1
      }
      if (confirmed > 0) await gravarEstado(casa, currentState)
    } finally {
      await applyLock.release()
    }
  }

  for (const receipt of operationalReceipts.values()) {
    await recordOperationalLoaded(casa, {
      pluginRoot: receipt.root,
      version: receipt.version,
      payloadFingerprint: receipt.fingerprint,
      verificationFingerprint: receipt.verificationFingerprint,
      now: at
    })
  }
  return {
    result: confirmed > 0 ? 'loaded-releases-confirmed' : 'no-loaded-release-match',
    confirmed,
    rejected,
    concurrentSkipped,
    loadedRootFingerprint: fingerprintDaRaiz(loadedRoot),
    rawPathsStoredInResult: false
  }
}

function fingerprintDaRodada(run) {
  return sha256(JSON.stringify({
    id: run.id,
    suiteSha256: run.suiteSha256,
    candidate: run.candidate,
    responseSets: run.responseSets,
    adjustmentsFingerprint: run.adjustments?.fingerprint ?? null,
    evaluatedPayloadFingerprint: run.provenance?.evaluatedPayloadFingerprint ?? null
  }))
}

async function verificarVinculoComPayloadAvaliado(root, run) {
  const expected = run?.provenance?.evaluatedPayloadFingerprint
  if (!HASH_SHA256.test(expected ?? '')) {
    return {
      ok: false,
      result: 'evaluated-source-unbound',
      errorFingerprint: sha256('Rodada sem fingerprint do payload avaliado.')
    }
  }
  const integrity = await verificarIntegridadeRelease(root)
  if (
    integrity.status !== 'verified' ||
    integrity.versionMatchesManifest !== true ||
    !HASH_SHA256.test(integrity.fingerprint ?? '')
  ) {
    return {
      ok: false,
      result: 'evaluated-source-unverifiable',
      errorFingerprint: sha256('Fonte atual sem integridade verificavel antes da release.')
    }
  }
  if (integrity.fingerprint !== expected) {
    return {
      ok: false,
      result: 'evaluated-source-diverged',
      errorFingerprint: sha256(`${expected}:${integrity.fingerprint}`)
    }
  }
  return { ok: true, evaluatedPayloadFingerprint: expected }
}

function resultadoVinculoRecusado(binding) {
  return {
    result: binding.result,
    publication: 'not-confirmed',
    installedReadback: false,
    errorFingerprint: binding.errorFingerprint,
    rawResponsesStored: false
  }
}

function instante(at) {
  return new Date(at ?? Date.now()).toISOString()
}

function resumoDosGates(gates) {
  const checks = Array.isArray(gates?.checks) ? gates.checks : []
  return {
    count: checks.length,
    fingerprint: sha256(JSON.stringify(checks.map((item) => ({
      ok: item?.ok === true,
      commandFingerprint: sha256(item?.command ?? ''),
      outputFingerprint: /^[a-f0-9]{64}$/.test(item?.outputFingerprint ?? '')
        ? item.outputFingerprint
        : sha256(item?.error ?? '')
    }))))
  }
}

async function finalizarFingerprintRelease(root, integrityPath, gates) {
  const integrity = await lerJson(integrityPath)
  const payload = await calcularFingerprintPayload(root)
  integrity.identity.releaseFingerprint = payload.fingerprint
  await gravarJson(integrityPath, integrity)
  const verified = await verificarIntegridadeRelease(root)
  if (
    verified.status !== 'verified' ||
    verified.versionMatchesManifest !== true ||
    verified.fingerprint !== payload.fingerprint ||
    verified.declaredFingerprint !== payload.fingerprint
  ) throw new Error('Gate final de integridade reprovou o payload emitido da release.')
  return {
    releaseFingerprint: payload.fingerprint,
    gates: {
      ...gates,
      checks: [
        ...(Array.isArray(gates?.checks) ? gates.checks : []),
        {
          ok: true,
          command: 'internal:verify-release-integrity-after-build',
          outputFingerprint: sha256(JSON.stringify({
            fingerprint: payload.fingerprint,
            files: payload.files
          }))
        }
      ]
    }
  }
}

function caminhosDaRelease(root, run) {
  const relative = {
    package: 'package.json',
    plugin: '.claude-plugin/plugin.json',
    integrity: 'contratos/atualizacao/integridade.json',
    releases: 'contratos/atualizacao/releases.json',
    manifest: 'contratos/personalidade/manifest.json',
    adjustments: 'contratos/personalidade/ajustes-aprendidos.json',
    evidence: `contratos/eval/resultados/${nomeEvidencia(run.id)}`
  }
  return {
    relative,
    absolute: Object.fromEntries(Object.entries(relative).map(([key, path]) => [key, join(root, path)])),
    controlled: Object.values(relative).map(portable).sort()
  }
}

function validarMudancasControladas(changes, controlled, required = []) {
  const allowed = new Set(controlled)
  const paths = [...new Set((changes ?? []).map((item) => portable(item?.path ?? item)))].sort()
  if (paths.length === 0) throw new Error('Release autonoma nao produziu mudancas para commitar.')
  const outside = paths.filter((path) => !allowed.has(path))
  if (outside.length > 0) throw new Error('Repositorio recebeu mudanca fora do conjunto controlado da release.')
  const missing = required.map(portable).filter((path) => !paths.includes(path))
  if (missing.length > 0) throw new Error('Release nao produziu todos os artefatos fonte/emit esperados.')
  return paths
}

async function verificarFontePreparada(root, transaction) {
  const [pkg, plugin, integrity] = await Promise.all([
    lerJson(join(root, 'package.json')),
    lerJson(join(root, '.claude-plugin', 'plugin.json')),
    verificarIntegridadeRelease(root)
  ])
  if (
    pkg.version !== transaction.version ||
    plugin.version !== transaction.version ||
    integrity.releaseVersion !== transaction.version ||
    integrity.status !== 'verified' ||
    integrity.fingerprint !== transaction.releaseFingerprint
  ) throw new Error('Arvore fonte divergiu da release commitada.')
}

async function recuperarCommitPreparado(root, run, repository, repositoryFingerprint, runFingerprint) {
  try {
    const [pkg, plugin, manifest, integrity] = await Promise.all([
      lerJson(join(root, 'package.json')),
      lerJson(join(root, '.claude-plugin', 'plugin.json')),
      lerJson(join(root, 'contratos', 'personalidade', 'manifest.json')),
      verificarIntegridadeRelease(root)
    ])
    if (
      manifest.status !== 'approved' ||
      manifest.promotion?.roundId !== run.id ||
      pkg.version !== plugin.version ||
      pkg.version !== integrity.releaseVersion ||
      integrity.status !== 'verified'
    ) return null
    const evidencePath = manifest.promotion.evidence?.path
    if (typeof evidencePath !== 'string' || isAbsolute(evidencePath) || evidencePath.includes('..')) return null
    const evidenceRaw = await readFile(join(root, portable(evidencePath)), 'utf8')
    if (sha256(evidenceRaw) !== manifest.promotion.evidence?.sha256) return null
    const head = await repository.head(root)
    const identity = {
      version: pkg.version,
      fingerprint: integrity.fingerprint,
      commitSha: head.commitSha
    }
    const committedCore = reduzirTransicao({ stage: 'precommit-retry' }, {
      type: 'commit-confirmed',
      identity
    }, 'committed')
    return {
      stage: committedCore.stage,
      runFingerprint,
      repositoryFingerprint,
      version: committedCore.identity.version,
      releaseFingerprint: committedCore.identity.fingerprint,
      evidenceFingerprint: manifest.promotion.evidence.sha256,
      gatesFingerprint: null,
      commitSha: committedCore.identity.commitSha,
      branchFingerprint: head.branchFingerprint ?? null,
      remoteCommitSha: null,
      installedReadback: null,
      loadedReadback: null,
      attempts: { prepare: 1, push: 0, install: 0 },
      lastFailure: null,
      updatedAt: instante()
    }
  } catch {
    return null
  }
}

async function prepararArquivos({ root, run, paths, at }) {
  const [pkg, plugin, integrity, releases, manifest] = await Promise.all([
    lerJson(paths.absolute.package),
    lerJson(paths.absolute.plugin),
    lerJson(paths.absolute.integrity),
    lerJson(paths.absolute.releases),
    lerJson(paths.absolute.manifest)
  ])
  if (pkg.name !== 'omni-agent' || plugin.name !== 'omni' ||
    pkg.version !== plugin.version || pkg.version !== integrity.identity?.version) {
    throw new Error('Identidade da release fonte esta divergente antes da promocao.')
  }
  if (manifest.id !== run.candidate) {
    throw new Error('Rodada aprovada nao corresponde a personalidade da arvore fonte.')
  }

  const decidedAt = instante(at ?? run.evaluatedAt)
  const evidence = criarEvidenciaPromocao(run)
  const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`
  await mkdir(dirname(paths.absolute.evidence), { recursive: true })
  await writeFile(paths.absolute.evidence, evidenceRaw, 'utf8')

  let adjustments
  try {
    adjustments = await lerJson(paths.absolute.adjustments)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    adjustments = {
      schemaVersion: 1,
      contract: 'omni-learned-personality-adjustments-v1',
      adjustments: []
    }
  }
  const existing = new Map((adjustments.adjustments ?? []).map((item) => [item.directiveId, item]))
  for (const directiveId of run.adjustments?.directiveIds ?? []) {
    if (!TEXTO_DIRETIVA_PERSONALIDADE[directiveId]) continue
    existing.set(directiveId, {
      directiveId,
      evalRoundId: run.id,
      evidenceFingerprint: run.adjustments.fingerprint,
      approvedAt: decidedAt
    })
  }
  adjustments.adjustments = [...existing.values()].sort((left, right) => left.directiveId.localeCompare(right.directiveId))
  await gravarJson(paths.absolute.adjustments, adjustments)

  manifest.status = 'approved'
  manifest.promotion = {
    roundId: run.id,
    decidedAt,
    decidedBy: run.trust.decisionAuthority,
    evidence: { path: paths.relative.evidence, sha256: sha256(evidenceRaw) }
  }
  await gravarJson(paths.absolute.manifest, manifest)

  const version = proximaVersaoPatch(pkg.version)
  pkg.version = version
  plugin.version = version
  integrity.identity.version = version
  integrity.identity.releaseAuditScopeStartedAt = decidedAt
  const change = run.adjustments?.directiveIds?.length > 0
    ? `Promoveu ajustes de personalidade aprendidos na rodada ${run.id}, com eval automatico controlado e sem conversa bruta.`
    : `Promoveu a personalidade ${run.candidate} pela rodada automatica controlada ${run.id}.`
  releases.releases.push({ version, changes: [change] })
  await Promise.all([
    gravarJson(paths.absolute.package, pkg),
    gravarJson(paths.absolute.plugin, plugin),
    gravarJson(paths.absolute.releases, releases)
  ])
  await gravarJson(paths.absolute.integrity, integrity)
  return { version, releaseFingerprint: null, evidenceFingerprint: sha256(evidenceRaw) }
}

function registrarFalha(transaction, phase, error, at) {
  return {
    ...transaction,
    lastFailure: {
      phase,
      errorFingerprint: sha256(error instanceof Error ? error.message : String(error)),
      at: instante(at)
    },
    updatedAt: instante(at)
  }
}

function resultadoPendente(transaction) {
  const published = ['pushed', 'installed-verified', 'awaiting-reload', 'loaded-verified'].includes(transaction.stage)
  const installed = ['installed-verified', 'awaiting-reload', 'loaded-verified'].includes(transaction.stage)
  return {
    result: 'release-retryable',
    stage: transaction.stage,
    version: transaction.version ?? null,
    releaseFingerprint: transaction.releaseFingerprint ?? null,
    publication: published ? 'remote-commit-verified' : 'not-confirmed',
    installedReadback: installed,
    loadedReadback: transaction.stage === 'loaded-verified',
    errorFingerprint: transaction.lastFailure?.errorFingerprint ?? null,
    rawResponsesStored: false
  }
}

function resultadoAguardandoReload(transaction) {
  return {
    result: 'published-installed-awaiting-reload',
    stage: 'awaiting-reload',
    version: transaction.version,
    releaseFingerprint: transaction.releaseFingerprint,
    commitSha: transaction.commitSha,
    publication: 'remote-commit-verified',
    installedReadback: true,
    loadedReadback: false,
    reloadRequired: true,
    rawResponsesStored: false
  }
}

function resultadoCarregado(transaction, { already = false } = {}) {
  if (!isEffectiveRelease(estadoCoreDaTransacao(transaction))) {
    throw new Error('Release nao pode produzir resultado efetivo sem confirmacao do reducer canonico.')
  }
  return {
    result: already ? 'already-published-loaded-verified' : 'published-loaded-verified',
    stage: 'loaded-verified',
    version: transaction.version,
    releaseFingerprint: transaction.releaseFingerprint,
    commitSha: transaction.commitSha,
    publication: 'remote-commit-verified',
    installedReadback: true,
    loadedReadback: true,
    loadedRoot: transaction.loadedReadback.root,
    reloadRequired: false,
    rawResponsesStored: false
  }
}

async function publicarInstalarEConfirmar({
  casa,
  root,
  transaction,
  repository,
  installAndReadback,
  verifyPrepared,
  confirmInstalled = async () => undefined,
  confirmLoaded = async () => undefined,
  readLoaded = confirmarRuntimeCarregado,
  persist,
  at
}) {
  await verifyPrepared(transaction)
  let installationLoadedReadback = null
  const head = await repository.head(root)
  if (head.commitSha !== transaction.commitSha) {
    throw new Error('HEAD atual nao corresponde ao commit controlado da release.')
  }

  if (transaction.stage === 'committed') {
    transaction.attempts.push += 1
    try {
      const pushed = await repository.push(root, {
        commitSha: transaction.commitSha,
        branchFingerprint: transaction.branchFingerprint
      })
      if (pushed?.commitSha !== transaction.commitSha) {
        throw new Error('Push nao confirmou exatamente o commit da release.')
      }
      const pushedCore = reduzirTransicao(transaction, {
        type: 'push-confirmed',
        remoteCommitSha: pushed.commitSha
      }, 'pushed')
      transaction = {
        ...transaction,
        stage: pushedCore.stage,
        remoteCommitSha: pushedCore.remoteCommitSha,
        remoteRefFingerprint: pushed.remoteRefFingerprint ?? null,
        lastFailure: null,
        updatedAt: instante(at)
      }
      transaction = await persist(transaction)
    } catch (error) {
      transaction = registrarFalha(transaction, 'push', error, at)
      transaction = await persist(transaction)
      return resultadoPendente(transaction)
    }
  }

  if (transaction.stage === 'pushed') {
    transaction.attempts.install += 1
    try {
      const readback = await installAndReadback({
        casa,
        sourceRepository: root,
        version: transaction.version,
        releaseFingerprint: transaction.releaseFingerprint,
        commitSha: transaction.commitSha
      })
      if (
        readback?.verified !== true ||
        readback.installedVersion !== transaction.version ||
        readback.installedFingerprint !== transaction.releaseFingerprint ||
        !isAbsolute(readback.installedRoot ?? '')
      ) throw new Error('Readback instalado divergiu da versao ou fingerprint publicado.')
      installationLoadedReadback = readback.loadedReadback ?? null
      await confirmInstalled({ transaction, readback })
      const installedAt = instante(at)
      const installedReadback = {
        root: resolve(readback.installedRoot),
        version: transaction.version,
        fingerprint: transaction.releaseFingerprint,
        verificationFingerprint: /^[a-f0-9]{64}$/.test(readback.verificationFingerprint ?? '')
          ? readback.verificationFingerprint
          : sha256(JSON.stringify({
            verified: true,
            version: readback.installedVersion,
            fingerprint: readback.installedFingerprint
          }))
      }
      const installedCore = reduzirTransicao(transaction, {
        type: 'install-confirmed',
        readback: installedReadback
      }, 'installed-verified')
      transaction = {
        ...transaction,
        stage: installedCore.stage,
        installedReadback: {
          ...installedCore.installed,
          verifiedAt: installedAt
        },
        loadedReadback: null,
        lastFailure: null,
        updatedAt: instante(at)
      }
      transaction = await persist(transaction)
    } catch (error) {
      transaction = registrarFalha(transaction, 'install-readback', error, at)
      transaction = await persist(transaction)
      return resultadoPendente(transaction)
    }
  }

  if (transaction.stage === 'installed-verified') {
    const waitingCore = reduzirTransicao(transaction, { type: 'reload-required' }, 'awaiting-reload')
    transaction = {
      ...transaction,
      stage: waitingCore.stage,
      loadedReadback: null,
      updatedAt: instante(at)
    }
    transaction = await persist(transaction)
  }

  if (transaction.stage === 'awaiting-reload') {
    let loadedReadback = installationLoadedReadback
    let loadedCore = reduzirCarregamento(transaction, loadedReadback
      ? { ...loadedReadback, verifiedAt: loadedReadback.verifiedAt ?? instante(at) }
      : null)
    if (!loadedCore) {
      try {
        loadedReadback = await readLoaded({
          version: transaction.version,
          payloadFingerprint: transaction.releaseFingerprint,
          at
        })
      } catch {
        loadedReadback = null
      }
      loadedCore = reduzirCarregamento(transaction, loadedReadback
        ? { ...loadedReadback, verifiedAt: loadedReadback.verifiedAt ?? instante(at) }
        : null)
    }
    if (!loadedCore) {
      return resultadoAguardandoReload(transaction)
    }
    await confirmLoaded({ transaction, readback: loadedCore.loaded })
    transaction = {
      ...transaction,
      stage: loadedCore.stage,
      loadedReadback: loadedCore.loaded,
      lastFailure: null,
      updatedAt: instante(at)
    }
    transaction = await persist(transaction)
  }

  return resultadoCarregado(transaction)
}

export async function prepararReleaseAutonomaPersonalidade({
  casa,
  run,
  sourceRepository,
  runGates = gatesPadrao,
  repository = REPOSITORIO_GIT_PADRAO,
  installAndReadback = instalarEConfirmarPadrao,
  readLoaded = confirmarRuntimeCarregado,
  confirmLoaded = async () => undefined,
  at
} = {}) {
  if (run?.status !== 'passed' || run?.trust?.promotable !== true) {
    return { result: 'not-promotable', roundFingerprint: run?.id ? sha256(run.id) : null }
  }
  let root = sourceRepository
  if (!root) {
    const configured = await lerRepositorioCanonico(casa)
    if (configured.status !== 'configured') return { result: 'source-repository-unconfigured' }
    root = configured.sourceRepository
  }
  root = validarRaiz(root)
  const release = await adquirirLock(root)
  if (!release) return { result: 'release-in-progress' }

  const runFingerprint = fingerprintDaRodada(run)
  const repositoryFingerprint = fingerprintDaRaiz(root)
  let persisted
  try {
    persisted = await lerTransacaoComRevisao(casa, runFingerprint)
  } catch (error) {
    await release()
    throw error
  }
  const paths = caminhosDaRelease(root, run)
  let transaction = persisted.transaction
  let persistedRevision = persisted.revision
  let before = null
  let committed = transaction && ['committed', 'pushed', 'installed-verified', 'awaiting-reload', 'loaded-verified'].includes(transaction.stage)

  const save = async () => {
    const proposed = transaction
    const result = await persistirTransacaoCAS(
      casa,
      runFingerprint,
      persistedRevision,
      proposed
    )
    if (!result.saved && !adotarAvancoConcorrente(result.transaction, proposed)) {
      throw new Error('Estado concorrente da release divergiu da revisao esperada.')
    }
    transaction = result.transaction
    persistedRevision = result.revision
    return transaction
  }

  try {
    if (transaction && (
      transaction.runFingerprint !== runFingerprint ||
      transaction.repositoryFingerprint !== repositoryFingerprint
    )) throw new Error('Estado local da release pertence a outra fonte ou rodada.')

    if (transaction?.stage === 'loaded-verified') return resultadoCarregado(transaction, { already: true })

    const initialChanges = await repository.status(root)
    if (initialChanges.length > 0) {
      if (committed) throw new Error('Repositorio divergiu depois do commit controlado da release.')
      transaction = registrarFalha({
        stage: 'precommit-retry',
        runFingerprint,
        repositoryFingerprint,
        version: null,
        releaseFingerprint: null,
        evidenceFingerprint: null,
        gatesFingerprint: null,
        commitSha: null,
        branchFingerprint: null,
        remoteCommitSha: null,
        installedReadback: null,
        loadedReadback: null,
        attempts: transaction?.attempts ?? { prepare: 0, push: 0, install: 0 }
      }, 'initial-repository-not-clean', new Error('Repositorio fonte precisa estar limpo antes da release.'), at)
      await save()
      return {
        result: 'repository-not-clean',
        publication: 'not-confirmed',
        installedReadback: false,
        errorFingerprint: transaction.lastFailure.errorFingerprint,
        rawResponsesStored: false
      }
    }

    if (!transaction || transaction.stage === 'precommit-retry') {
      const recovered = await recuperarCommitPreparado(
        root, run, repository, repositoryFingerprint, runFingerprint
      )
      if (recovered) {
        transaction = recovered
        committed = true
        await save()
      } else {
        const binding = await verificarVinculoComPayloadAvaliado(root, run)
        if (!binding.ok) return resultadoVinculoRecusado(binding)
        before = await snapshot(Object.values(paths.absolute))
        try {
          const prepared = await prepararArquivos({ root, run, paths, at })
          let gates = await runGates(root)
          if (gates?.ok !== true) throw new Error('Um ou mais gates da release autonoma reprovaram.')
          const finalized = await finalizarFingerprintRelease(root, paths.absolute.integrity, gates)
          prepared.releaseFingerprint = finalized.releaseFingerprint
          gates = finalized.gates
          const changedPaths = validarMudancasControladas(await repository.status(root), paths.controlled)
          const gateSummary = resumoDosGates(gates)
          const commit = await repository.commit(root, {
            paths: changedPaths,
            message: `release(omni): v${prepared.version} [${runFingerprint.slice(0, 12)}]`
          })
          if (!HASH.test(commit?.commitSha ?? '') || !/^[a-f0-9]{64}$/.test(commit?.branchFingerprint ?? '')) {
            throw new Error('Commit da release nao retornou identidade verificavel.')
          }
          const committedCore = reduzirTransicao({ stage: 'precommit-retry' }, {
            type: 'commit-confirmed',
            identity: {
              version: prepared.version,
              fingerprint: prepared.releaseFingerprint,
              commitSha: commit.commitSha
            }
          }, 'committed')
          committed = true
          transaction = {
            stage: committedCore.stage,
            runFingerprint,
            repositoryFingerprint,
            version: committedCore.identity.version,
            releaseFingerprint: committedCore.identity.fingerprint,
            evidenceFingerprint: prepared.evidenceFingerprint,
            gatesFingerprint: gateSummary.fingerprint,
            commitSha: committedCore.identity.commitSha,
            branchFingerprint: commit.branchFingerprint,
            remoteCommitSha: null,
            installedReadback: null,
            loadedReadback: null,
            attempts: {
              prepare: (transaction?.attempts?.prepare ?? 0) + 1,
              push: transaction?.attempts?.push ?? 0,
              install: transaction?.attempts?.install ?? 0
            },
            lastFailure: null,
            updatedAt: instante(at)
          }
          await save()
        } catch (error) {
          if (!committed && before) await restaurar(before)
          transaction = registrarFalha({
            stage: committed ? 'committed' : 'precommit-retry',
            runFingerprint,
            repositoryFingerprint,
            version: transaction?.version ?? null,
            releaseFingerprint: transaction?.releaseFingerprint ?? null,
            evidenceFingerprint: transaction?.evidenceFingerprint ?? null,
            gatesFingerprint: transaction?.gatesFingerprint ?? null,
            commitSha: transaction?.commitSha ?? null,
            branchFingerprint: transaction?.branchFingerprint ?? null,
            remoteCommitSha: transaction?.remoteCommitSha ?? null,
            installedReadback: null,
            loadedReadback: null,
            attempts: transaction?.attempts ?? { prepare: 1, push: 0, install: 0 }
          }, committed ? 'commit-state' : 'precommit', error, at)
          await save()
          return committed ? resultadoPendente(transaction) : {
            result: 'release-reverted',
            stage: 'precommit-retry',
            publication: 'not-confirmed',
            installedReadback: false,
            errorFingerprint: transaction.lastFailure.errorFingerprint,
            rawResponsesStored: false
          }
        }
      }
    }

    return publicarInstalarEConfirmar({
      casa,
      root,
      transaction,
      repository,
      installAndReadback,
      readLoaded,
      confirmLoaded,
      verifyPrepared: () => verificarFontePreparada(root, transaction),
      persist: async (next) => {
        transaction = next
        return save()
      },
      at
    })
  } catch (error) {
    if (!committed && before) await restaurar(before)
    if (transaction) {
      transaction = registrarFalha(transaction, committed ? transaction.stage : 'precommit', error, at)
      await save()
      return committed ? resultadoPendente(transaction) : {
        result: 'release-reverted',
        stage: 'precommit-retry',
        publication: 'not-confirmed',
        installedReadback: false,
        errorFingerprint: transaction.lastFailure.errorFingerprint,
        rawResponsesStored: false
      }
    }
    return {
      result: 'release-reverted',
      stage: 'precommit-retry',
      publication: 'not-confirmed',
      installedReadback: false,
      errorFingerprint: sha256(error instanceof Error ? error.message : String(error)),
      rawResponsesStored: false
    }
  } finally {
    await release()
  }
}

const BASELINE_CONTRACT = 'omni-operational-release-baseline-v1'
const EMPTY_STATUS_FINGERPRINT = sha256('[]')

async function raizOperacionalConfigurada(casa, sourceRepository) {
  const configured = await lerRepositorioCanonico(casa)
  if (configured.status !== 'configured') return null
  if (sourceRepository && !mesmaRaiz(sourceRepository, configured.sourceRepository)) {
    throw new Error('Release operacional recusa fonte diferente do repositorio canonico configurado.')
  }
  return validarRaiz(configured.sourceRepository)
}

export async function capturarBaselineReleaseOperacional({
  casa,
  sourceRepository,
  repository = REPOSITORIO_GIT_PADRAO,
  at
} = {}) {
  const root = await raizOperacionalConfigurada(casa, sourceRepository)
  if (!root) return { result: 'source-repository-unconfigured', baseline: null }
  const changes = await repository.status(root)
  if (changes.length !== 0) {
    return {
      result: 'repository-not-clean',
      baseline: null,
      statusFingerprint: sha256(JSON.stringify(changes.map((item) => portable(item.path)).sort()))
    }
  }
  const head = await repository.head(root)
  if (!HASH.test(head?.commitSha ?? '') || !/^[a-f0-9]{64}$/.test(head?.branchFingerprint ?? '')) {
    throw new Error('Baseline operacional exige HEAD e branch verificaveis.')
  }
  return {
    result: 'captured',
    baseline: {
      contract: BASELINE_CONTRACT,
      repositoryFingerprint: fingerprintDaRaiz(root),
      commitSha: head.commitSha,
      branchFingerprint: head.branchFingerprint,
      statusFingerprint: EMPTY_STATUS_FINGERPRINT,
      capturedAt: instante(at)
    }
  }
}

export async function recuperarBaselineReleaseOperacionalLegado({
  casa,
  candidateId,
  sourceRepository,
  repository = REPOSITORIO_GIT_PADRAO,
  at
} = {}) {
  const root = await raizOperacionalConfigurada(casa, sourceRepository)
  if (!root) return { result: 'source-repository-unconfigured', baseline: null }
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) =>
    item.id === candidateId && item.status === 'materialized-pending-release' && item.artifactRef
  )
  if (!candidate) return { result: 'candidate-not-awaiting-release', baseline: null }
  const artifactPath = await verificarArtefatoOperacional(root, candidate)
  const changes = await repository.status(root)
  const currentPaths = [...new Set(changes.map((item) => portable(item.path)))].sort()
  const statusFingerprint = sha256(JSON.stringify(currentPaths))
  if (currentPaths.length !== 1 || currentPaths[0] !== artifactPath) {
    return {
      result: 'legacy-baseline-unprovable',
      baseline: null,
      statusFingerprint,
      changedPathCount: currentPaths.length,
      auditedArtifactIsOnlyChange: currentPaths.length === 1 && currentPaths[0] === artifactPath,
      observedPathFingerprint: currentPaths.length === 1 ? sha256(currentPaths[0]) : null,
      auditedPathFingerprint: sha256(artifactPath)
    }
  }
  const head = await repository.head(root)
  if (!HASH.test(head?.commitSha ?? '') || !/^[a-f0-9]{64}$/.test(head?.branchFingerprint ?? '')) {
    throw new Error('Recuperacao do baseline legado exige HEAD e branch verificaveis.')
  }
  return {
    result: 'recovered-single-audited-artifact',
    baseline: {
      contract: BASELINE_CONTRACT,
      repositoryFingerprint: fingerprintDaRaiz(root),
      commitSha: head.commitSha,
      branchFingerprint: head.branchFingerprint,
      statusFingerprint: EMPTY_STATUS_FINGERPRINT,
      capturedAt: instante(at)
    },
    observationFingerprint: sha256(JSON.stringify({
      repositoryFingerprint: fingerprintDaRaiz(root),
      commitSha: head.commitSha,
      branchFingerprint: head.branchFingerprint,
      statusFingerprint
    }))
  }
}

function validarBaselineOperacional(baseline, root) {
  if (
    baseline?.contract !== BASELINE_CONTRACT ||
    baseline.repositoryFingerprint !== fingerprintDaRaiz(root) ||
    !HASH.test(baseline.commitSha ?? '') ||
    !/^[a-f0-9]{64}$/.test(baseline.branchFingerprint ?? '') ||
    baseline.statusFingerprint !== EMPTY_STATUS_FINGERPRINT ||
    !Number.isFinite(Date.parse(baseline.capturedAt ?? ''))
  ) throw new Error('Baseline operacional limpo nao e verificavel.')
  return baseline
}

function validarCaminhoArtefato(value) {
  const path = portable(value)
  if (!path || isAbsolute(path) || path.split('/').includes('..') ||
    !['adaptadores', 'contratos', 'dist', 'hooks', 'runtime', 'scripts', 'skills', 'src'].includes(path.split('/')[0])) {
    throw new Error('Release operacional exige artefato portatil dentro das fontes ou do payload do Omni.')
  }
  return path
}

export function derivarArtefatosReleaseOperacional(reference) {
  const sourcePath = validarCaminhoArtefato(reference?.path ?? reference)
  const artifacts = deriveOperationalArtifacts(sourcePath)
  if (sourcePath.startsWith('src/') && artifacts.length === 1) {
    throw new Error('Fonte operacional em src precisa possuir emit deterministico distribuivel.')
  }
  return artifacts
}

async function verificarArtefatoOperacional(root, candidate) {
  const reference = candidate.artifactRef
  const path = validarCaminhoArtefato(reference?.path)
  const raw = await readFile(join(root, ...path.split('/')))
  if (reference.kind === 'source-file') {
    if (sha256(raw) !== reference.contentFingerprint || !reference.implementationReceipt) {
      throw new Error('Artefato operacional divergiu do recibo auditado da implementacao.')
    }
  } else if (reference.kind === 'portable-entry') {
    const document = JSON.parse(raw.toString('utf8'))
    const collection = document?.[reference.collection]
    const entry = Array.isArray(collection)
      ? collection.find((item) => item?.id === reference.entryId)
      : null
    const linked = entry?.evidence?.fingerprint === candidate.fingerprint ||
      entry?.evidence?.mergedCandidateIds?.includes(candidate.id)
    if (!entry || !linked) throw new Error('Entrada operacional nao corresponde a candidata materializada.')
  } else {
    throw new Error('Referencia do artefato operacional fora do contrato.')
  }
  return path
}

function caminhosDaReleaseOperacional(root, artifactPaths) {
  const relative = {
    package: 'package.json',
    plugin: '.claude-plugin/plugin.json',
    integrity: 'contratos/atualizacao/integridade.json',
    releases: 'contratos/atualizacao/releases.json'
  }
  const artifacts = Object.fromEntries(artifactPaths.map((path, index) => [`artifact${index}`, path]))
  return {
    relative,
    absolute: Object.fromEntries(Object.entries({ ...relative, ...artifacts })
      .map(([key, path]) => [key, join(root, ...path.split('/'))])),
    controlled: [...new Set([...Object.values(relative), ...artifactPaths].map(portable))].sort()
  }
}

function fingerprintMelhoriaOperacional(candidate, baseline) {
  const receipt = candidate.artifactRef?.implementationReceipt
  return sha256(JSON.stringify({
    kind: 'operational-improvement',
    candidateFingerprint: candidate.fingerprint,
    semanticFingerprint: candidate.artifactRef?.semanticFingerprint,
    contentFingerprint: candidate.artifactRef?.contentFingerprint,
    implementationReceiptFingerprint: receipt ? sha256(JSON.stringify(receipt)) : null,
    baselineCommitSha: baseline.commitSha,
    baselineBranchFingerprint: baseline.branchFingerprint
  }))
}

async function prepararArquivosOperacionais({ root, candidate, paths, at }) {
  await verificarArtefatoOperacional(root, candidate)
  const [pkg, plugin, integrity, releases] = await Promise.all([
    lerJson(paths.absolute.package),
    lerJson(paths.absolute.plugin),
    lerJson(paths.absolute.integrity),
    lerJson(paths.absolute.releases)
  ])
  if (pkg.name !== 'omni-agent' || plugin.name !== 'omni' ||
    pkg.version !== plugin.version || pkg.version !== integrity.identity?.version) {
    throw new Error('Identidade da release fonte esta divergente antes da melhoria operacional.')
  }
  const version = proximaVersaoPatch(pkg.version)
  if (!Array.isArray(releases.releases) || releases.releases.some((item) => item?.version === version)) {
    throw new Error('Versao patch da melhoria operacional ja existe ou manifesto de releases e invalido.')
  }
  pkg.version = version
  plugin.version = version
  integrity.identity.version = version
  integrity.identity.releaseAuditScopeStartedAt = instante(at)
  releases.releases.push({
    version,
    changes: [descreverPreparacaoMelhoriaOperacional(candidate.fingerprint)]
  })
  await Promise.all([
    gravarJson(paths.absolute.package, pkg),
    gravarJson(paths.absolute.plugin, plugin),
    gravarJson(paths.absolute.releases, releases)
  ])
  await gravarJson(paths.absolute.integrity, integrity)
  return {
    version,
    releaseFingerprint: null,
    evidenceFingerprint: candidate.artifactRef?.contentFingerprint ?? candidate.artifactRef?.semanticFingerprint
  }
}

async function confirmarCandidataOperacionalInstalada(casa, candidateId, candidateFingerprint, transaction) {
  const cycle = await lerCicloOperacional(casa)
  const installed = cycle.improvementCandidates.find((item) =>
    item.id === candidateId && item.fingerprint === candidateFingerprint
  )
  if (
    installed?.status !== 'installed-verified' ||
    installed.installedReadback?.verified !== true ||
    installed.installedReadback.version !== transaction.version ||
    installed.installedReadback.payloadFingerprint !== transaction.releaseFingerprint
  ) throw new Error('Readback instalado nao confirmou a melhoria operacional especifica.')
}

async function confirmarCandidataOperacionalCarregada(casa, candidateId, candidateFingerprint, transaction) {
  const cycle = await lerCicloOperacional(casa)
  const loaded = cycle.improvementCandidates.find((item) =>
    item.id === candidateId && item.fingerprint === candidateFingerprint
  )
  if (
    loaded?.status !== 'loaded-verified' ||
    loaded.loadedReadback?.verified !== true ||
    loaded.loadedReadback.version !== transaction.version ||
    loaded.loadedReadback.payloadFingerprint !== transaction.releaseFingerprint
  ) throw new Error('Readback carregado nao confirmou a melhoria operacional especifica.')
}

function transacaoOperacionalInicial(identityFingerprint, repositoryFingerprint, previous) {
  return {
    stage: 'precommit-retry',
    runFingerprint: identityFingerprint,
    repositoryFingerprint,
    version: null,
    releaseFingerprint: null,
    evidenceFingerprint: null,
    gatesFingerprint: null,
    commitSha: null,
    branchFingerprint: null,
    remoteCommitSha: null,
    installedReadback: null,
    loadedReadback: null,
    attempts: previous?.attempts ?? { prepare: 0, push: 0, install: 0 }
  }
}

export async function prepararReleaseAutonomaOperacional({
  casa,
  candidateId,
  baseline,
  sourceRepository,
  allowedArtifacts,
  runGates = gatesPadrao,
  repository = REPOSITORIO_GIT_PADRAO,
  installAndReadback = instalarEConfirmarPadrao,
  recordOperationalReadback = registrarReadbackOperacionalInstalado,
  recordOperationalLoadedReadback = registrarReadbackOperacionalCarregado,
  confirmOperationalReadback = confirmarCandidataOperacionalInstalada,
  confirmOperationalLoadedReadback = confirmarCandidataOperacionalCarregada,
  readLoaded = confirmarRuntimeCarregado,
  at
} = {}) {
  const root = await raizOperacionalConfigurada(casa, sourceRepository)
  if (!root) return { result: 'source-repository-unconfigured' }
  validarBaselineOperacional(baseline, root)
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) => item.id === candidateId)
  if (!candidate ||
    !['materialized-pending-release', 'installed-verified', 'loaded-verified'].includes(candidate.status) ||
    !candidate.artifactRef) {
    return { result: 'not-awaiting-release', candidateFingerprint: candidate?.fingerprint ?? null }
  }
  const artifactPath = await verificarArtefatoOperacional(root, candidate)
  const releaseArtifacts = derivarArtefatosReleaseOperacional(candidate.artifactRef)
  if (allowedArtifacts !== undefined) {
    const allowed = [...new Set((allowedArtifacts ?? [])
      .flatMap((item) => derivarArtefatosReleaseOperacional(item)))].sort()
    if (JSON.stringify(allowed) !== JSON.stringify(releaseArtifacts)) {
      throw new Error('Release permite somente a fonte auditada e seus emits determinísticos; artefato extra nao possui vinculo seguro.')
    }
  }

  const paths = caminhosDaReleaseOperacional(root, releaseArtifacts)
  const identityFingerprint = fingerprintMelhoriaOperacional(candidate, baseline)
  const repositoryFingerprint = fingerprintDaRaiz(root)
  const release = await adquirirLock(root)
  if (!release) return { result: 'release-in-progress' }
  let persisted
  try {
    persisted = await lerTransacaoComRevisao(casa, identityFingerprint)
  } catch (error) {
    await release()
    throw error
  }
  let transaction = persisted.transaction
  let persistedRevision = persisted.revision
  let before = null
  let committed = Boolean(transaction && ['committed', 'pushed', 'installed-verified', 'awaiting-reload', 'loaded-verified'].includes(transaction.stage))
  const save = async () => {
    const proposed = transaction
    const result = await persistirTransacaoCAS(
      casa,
      identityFingerprint,
      persistedRevision,
      proposed
    )
    if (!result.saved && !adotarAvancoConcorrente(result.transaction, proposed)) {
      throw new Error('Estado concorrente da release operacional divergiu da revisao esperada.')
    }
    transaction = result.transaction
    persistedRevision = result.revision
    return transaction
  }

  try {
    if (transaction && (
      transaction.runFingerprint !== identityFingerprint ||
      transaction.repositoryFingerprint !== repositoryFingerprint
    )) throw new Error('Estado local da release operacional pertence a outra fonte ou candidata.')
    if (transaction?.stage === 'loaded-verified') return resultadoCarregado(transaction, { already: true })
    if (['installed-verified', 'loaded-verified'].includes(candidate.status) && !transaction) {
      return { result: 'not-awaiting-release', candidateFingerprint: candidate.fingerprint }
    }

    const changes = await repository.status(root)
    if (committed && changes.length > 0) {
      throw new Error('Repositorio divergiu depois do commit operacional controlado.')
    }
    if (!committed) {
      const head = await repository.head(root)
      const currentPaths = [...new Set(changes.map((item) => portable(item.path)))].sort()
      let result = null
      let phase = null
      let reason = null
      if (head.commitSha !== baseline.commitSha || head.branchFingerprint !== baseline.branchFingerprint) {
        result = 'baseline-diverged'
        phase = 'baseline-head-diverged'
        reason = 'HEAD ou branch mudou desde o baseline limpo anterior ao despacho.'
      } else if (
        !currentPaths.includes(artifactPath) ||
        currentPaths.some((path) => !releaseArtifacts.includes(path))
      ) {
        result = 'uncontrolled-repository-changes'
        phase = 'operational-scope-diverged'
        reason = 'Mudancas atuais nao correspondem a fonte auditada e seus emits deterministicos.'
      }
      if (result) {
        transaction = registrarFalha(
          transacaoOperacionalInicial(identityFingerprint, repositoryFingerprint, transaction),
          phase,
          new Error(reason),
          at
        )
        await save()
        return {
          result,
          publication: 'not-confirmed',
          installedReadback: false,
          errorFingerprint: transaction.lastFailure.errorFingerprint,
          rawResponsesStored: false
        }
      }
      await verificarArtefatoOperacional(root, candidate)
    }

    if (!transaction || transaction.stage === 'precommit-retry') {
      before = await snapshot(Object.values(paths.absolute))
      try {
        const prepared = await prepararArquivosOperacionais({ root, candidate, paths, at })
        let gates = await runGates(root)
        if (gates?.ok !== true) throw new Error('Um ou mais gates da release operacional reprovaram.')
        const finalized = await finalizarFingerprintRelease(root, paths.absolute.integrity, gates)
        prepared.releaseFingerprint = finalized.releaseFingerprint
        gates = finalized.gates
        const changedPaths = validarMudancasControladas(
          await repository.status(root),
          paths.controlled,
          releaseArtifacts
        )
        const commit = await repository.commit(root, {
          paths: changedPaths,
          message: `release(omni): v${prepared.version} operational [${identityFingerprint.slice(0, 12)}]`
        })
        if (!HASH.test(commit?.commitSha ?? '') || !/^[a-f0-9]{64}$/.test(commit?.branchFingerprint ?? '')) {
          throw new Error('Commit operacional nao retornou identidade verificavel.')
        }
        const committedCore = reduzirTransicao({ stage: 'precommit-retry' }, {
          type: 'commit-confirmed',
          identity: {
            version: prepared.version,
            fingerprint: prepared.releaseFingerprint,
            commitSha: commit.commitSha
          }
        }, 'committed')
        committed = true
        transaction = {
          stage: committedCore.stage,
          runFingerprint: identityFingerprint,
          repositoryFingerprint,
          version: committedCore.identity.version,
          releaseFingerprint: committedCore.identity.fingerprint,
          evidenceFingerprint: prepared.evidenceFingerprint,
          gatesFingerprint: resumoDosGates(gates).fingerprint,
          commitSha: committedCore.identity.commitSha,
          branchFingerprint: commit.branchFingerprint,
          remoteCommitSha: null,
          installedReadback: null,
          loadedReadback: null,
          attempts: {
            prepare: (transaction?.attempts?.prepare ?? 0) + 1,
            push: transaction?.attempts?.push ?? 0,
            install: transaction?.attempts?.install ?? 0
          },
          lastFailure: null,
          updatedAt: instante(at)
        }
        await save()
      } catch (error) {
        if (!committed && before) await restaurar(before)
        transaction = registrarFalha(
          transacaoOperacionalInicial(identityFingerprint, repositoryFingerprint, transaction),
          committed ? 'commit-state' : 'precommit',
          error,
          at
        )
        await save()
        return committed ? resultadoPendente(transaction) : {
          result: 'release-reverted',
          stage: 'precommit-retry',
          publication: 'not-confirmed',
          installedReadback: false,
          errorFingerprint: transaction.lastFailure.errorFingerprint,
          rawResponsesStored: false
        }
      }
    }

    return publicarInstalarEConfirmar({
      casa,
      root,
      transaction,
      repository,
      installAndReadback,
      readLoaded,
      verifyPrepared: async () => {
        await verificarFontePreparada(root, transaction)
        await verificarArtefatoOperacional(root, candidate)
      },
      confirmInstalled: async ({ transaction: installedTransaction, readback }) => {
        if (!isAbsolute(readback?.installedRoot ?? '')) {
          throw new Error('Readback operacional exige a raiz realmente instalada.')
        }
        await recordOperationalReadback(casa, {
          pluginRoot: readback.installedRoot,
          version: installedTransaction.version,
          payloadFingerprint: installedTransaction.releaseFingerprint,
          now: at
        })
        await confirmOperationalReadback(
          casa,
          candidate.id,
          candidate.fingerprint,
          installedTransaction
        )
      },
      confirmLoaded: async ({ transaction: loadedTransaction, readback }) => {
        await recordOperationalLoadedReadback(casa, {
          pluginRoot: readback.root,
          version: loadedTransaction.version,
          payloadFingerprint: loadedTransaction.releaseFingerprint,
          verificationFingerprint: readback.verificationFingerprint,
          now: at
        })
        await confirmOperationalLoadedReadback(
          casa,
          candidate.id,
          candidate.fingerprint,
          loadedTransaction
        )
      },
      persist: async (next) => {
        transaction = next
        return save()
      },
      at
    })
  } catch (error) {
    if (!committed && before) await restaurar(before)
    if (transaction) {
      transaction = registrarFalha(transaction, committed ? transaction.stage : 'precommit', error, at)
      await save()
      return committed ? resultadoPendente(transaction) : {
        result: 'release-reverted',
        stage: 'precommit-retry',
        publication: 'not-confirmed',
        installedReadback: false,
        errorFingerprint: transaction.lastFailure.errorFingerprint,
        rawResponsesStored: false
      }
    }
    return {
      result: 'release-reverted',
      stage: 'precommit-retry',
      publication: 'not-confirmed',
      installedReadback: false,
      errorFingerprint: sha256(error instanceof Error ? error.message : String(error)),
      rawResponsesStored: false
    }
  } finally {
    await release()
  }
}
