import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { TEXTO_DIRETIVA_PERSONALIDADE } from './ajustes-personalidade.mjs'
import { atualizarPlugin } from './atualizacao.mjs'
import { lerCicloOperacional } from './ciclo-operacional.mjs'
import { lerRepositorioCanonico, registrarReadbackOperacionalInstalado } from './evolucao.mjs'
import { calcularFingerprintPayload, verificarIntegridadeRelease } from './integridade-release.mjs'
import { criarEvidenciaPromocao } from './rodada-personalidade.mjs'

const STORE_SCHEMA_VERSION = 1
const STORE_CONTRACT = 'omni-autonomous-release-state-v1'
const HASH = /^[a-f0-9]{40,64}$/
const HASH_SHA256 = /^[a-f0-9]{64}$/
const RELEASE_LOCK_LEASE_MS = 2 * 60 * 60_000
const RELEASE_STAGES = new Set([
  'precommit-retry',
  'committed',
  'pushed',
  'installed-verified'
])

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function portable(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function proximaVersaoPatch(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? '')
  if (!match) throw new Error('Release autonoma exige uma versao semantica estavel.')
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
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
    executarGate(npm, ['test'], root),
    executarGate(process.execPath, ['runtime/release-gate.mjs'], root)
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

export async function instalarEConfirmarPadrao({
  casa,
  version,
  releaseFingerprint,
  updatePlugin = atualizarPlugin
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
  return {
    verified: true,
    installedVersion: version,
    installedFingerprint: update.installedFingerprint,
    installedRoot: update.installedRoot,
    verificationFingerprint: sha256(JSON.stringify({
      installedVersion: update.installedVersion,
      latestVersion: update.latestVersion,
      verifiedBy: [...proofs].sort(),
      reloadRequired: update.reloadRequired === true
    }))
  }
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
    if (['committed', 'pushed', 'installed-verified'].includes(release.stage)) {
      if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.version ?? '') ||
        !HASH.test(release.commitSha ?? '') ||
        !/^[a-f0-9]{64}$/.test(release.branchFingerprint ?? '') ||
        !/^[a-f0-9]{64}$/.test(release.releaseFingerprint ?? '')) {
        throw new Error('Transacao commitada nao possui identidade completa.')
      }
    }
    if (['pushed', 'installed-verified'].includes(release.stage) && release.remoteCommitSha !== release.commitSha) {
      throw new Error('Transacao publicada nao possui readback do commit remoto.')
    }
    if (release.stage === 'installed-verified' && (
      release.installedReadback?.version !== release.version ||
      release.installedReadback?.fingerprint !== release.releaseFingerprint ||
      !/^[a-f0-9]{64}$/.test(release.installedReadback?.verificationFingerprint ?? '')
    )) throw new Error('Transacao concluida nao possui readback instalado verificavel.')
  }
  return state
}

async function lerEstado(casa) {
  try {
    return validarEstado(await lerJson(caminhoDoEstadoReleaseAutonoma(casa)))
  } catch (error) {
    if (error?.code === 'ENOENT') return estadoVazio()
    throw error
  }
}

async function gravarEstado(casa, state) {
  await gravarJson(caminhoDoEstadoReleaseAutonoma(casa), validarEstado(state))
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

function validarMudancasControladas(changes, controlled) {
  const allowed = new Set(controlled)
  const paths = [...new Set((changes ?? []).map((item) => portable(item?.path ?? item)))].sort()
  if (paths.length === 0) throw new Error('Release autonoma nao produziu mudancas para commitar.')
  const outside = paths.filter((path) => !allowed.has(path))
  if (outside.length > 0) throw new Error('Repositorio recebeu mudanca fora do conjunto controlado da release.')
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
    return {
      stage: 'committed',
      runFingerprint,
      repositoryFingerprint,
      version: pkg.version,
      releaseFingerprint: integrity.fingerprint,
      evidenceFingerprint: manifest.promotion.evidence.sha256,
      gatesFingerprint: null,
      commitSha: head.commitSha,
      branchFingerprint: head.branchFingerprint ?? null,
      remoteCommitSha: null,
      installedReadback: null,
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
  const payload = await calcularFingerprintPayload(root)
  integrity.identity.releaseFingerprint = payload.fingerprint
  await gravarJson(paths.absolute.integrity, integrity)
  return { version, releaseFingerprint: payload.fingerprint, evidenceFingerprint: sha256(evidenceRaw) }
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
  return {
    result: 'release-retryable',
    stage: transaction.stage,
    version: transaction.version ?? null,
    releaseFingerprint: transaction.releaseFingerprint ?? null,
    publication: transaction.stage === 'pushed' ? 'remote-commit-verified' : 'not-confirmed',
    installedReadback: false,
    errorFingerprint: transaction.lastFailure?.errorFingerprint ?? null,
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
  persist,
  at
}) {
  await verifyPrepared(transaction)
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
      transaction = {
        ...transaction,
        stage: 'pushed',
        remoteCommitSha: pushed.commitSha,
        remoteRefFingerprint: pushed.remoteRefFingerprint ?? null,
        lastFailure: null,
        updatedAt: instante(at)
      }
      await persist(transaction)
    } catch (error) {
      transaction = registrarFalha(transaction, 'push', error, at)
      await persist(transaction)
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
        readback.installedFingerprint !== transaction.releaseFingerprint
      ) throw new Error('Readback instalado divergiu da versao ou fingerprint publicado.')
      await confirmInstalled({ transaction, readback })
      transaction = {
        ...transaction,
        stage: 'installed-verified',
        installedReadback: {
          version: transaction.version,
          fingerprint: transaction.releaseFingerprint,
            verificationFingerprint: /^[a-f0-9]{64}$/.test(readback.verificationFingerprint ?? '')
              ? readback.verificationFingerprint
              : sha256(JSON.stringify({
                verified: true,
                version: readback.installedVersion,
                fingerprint: readback.installedFingerprint
              })),
          verifiedAt: instante(at)
        },
        lastFailure: null,
        updatedAt: instante(at)
      }
      await persist(transaction)
    } catch (error) {
      transaction = registrarFalha(transaction, 'install-readback', error, at)
      await persist(transaction)
      return resultadoPendente(transaction)
    }
  }

  return {
    result: 'published-installed-verified',
    stage: transaction.stage,
    version: transaction.version,
    releaseFingerprint: transaction.releaseFingerprint,
    commitSha: transaction.commitSha,
    publication: 'remote-commit-verified',
    installedReadback: true,
    rawResponsesStored: false
  }
}

export async function prepararReleaseAutonomaPersonalidade({
  casa,
  run,
  sourceRepository,
  runGates = gatesPadrao,
  repository = REPOSITORIO_GIT_PADRAO,
  installAndReadback = instalarEConfirmarPadrao,
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
  const repositoryFingerprint = sha256(root.toLowerCase())
  const state = await lerEstado(casa)
  const paths = caminhosDaRelease(root, run)
  let transaction = state.releases[runFingerprint] ?? null
  let before = null
  let committed = transaction && ['committed', 'pushed', 'installed-verified'].includes(transaction.stage)

  const save = async () => {
    state.releases[runFingerprint] = transaction
    await gravarEstado(casa, state)
  }

  try {
    if (transaction && (
      transaction.runFingerprint !== runFingerprint ||
      transaction.repositoryFingerprint !== repositoryFingerprint
    )) throw new Error('Estado local da release pertence a outra fonte ou rodada.')

    if (transaction?.stage === 'installed-verified') {
      return {
        result: 'already-published-installed-verified',
        stage: transaction.stage,
        version: transaction.version,
        releaseFingerprint: transaction.releaseFingerprint,
        publication: 'remote-commit-verified',
        installedReadback: true,
        rawResponsesStored: false
      }
    }

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
          const gates = await runGates(root)
          if (gates?.ok !== true) throw new Error('Um ou mais gates da release autonoma reprovaram.')
          const changedPaths = validarMudancasControladas(await repository.status(root), paths.controlled)
          const gateSummary = resumoDosGates(gates)
          const commit = await repository.commit(root, {
            paths: changedPaths,
            message: `release(omni): v${prepared.version} [${runFingerprint.slice(0, 12)}]`
          })
          if (!HASH.test(commit?.commitSha ?? '') || !/^[a-f0-9]{64}$/.test(commit?.branchFingerprint ?? '')) {
            throw new Error('Commit da release nao retornou identidade verificavel.')
          }
          committed = true
          transaction = {
            stage: 'committed',
            runFingerprint,
            repositoryFingerprint,
            version: prepared.version,
            releaseFingerprint: prepared.releaseFingerprint,
            evidenceFingerprint: prepared.evidenceFingerprint,
            gatesFingerprint: gateSummary.fingerprint,
            commitSha: commit.commitSha,
            branchFingerprint: commit.branchFingerprint,
            remoteCommitSha: null,
            installedReadback: null,
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
      verifyPrepared: () => verificarFontePreparada(root, transaction),
      persist: async (next) => {
        transaction = next
        await save()
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

function mesmaRaiz(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

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
      repositoryFingerprint: sha256(root.toLowerCase()),
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
      repositoryFingerprint: sha256(root.toLowerCase()),
      commitSha: head.commitSha,
      branchFingerprint: head.branchFingerprint,
      statusFingerprint: EMPTY_STATUS_FINGERPRINT,
      capturedAt: instante(at)
    },
    observationFingerprint: sha256(JSON.stringify({
      repositoryFingerprint: sha256(root.toLowerCase()),
      commitSha: head.commitSha,
      branchFingerprint: head.branchFingerprint,
      statusFingerprint
    }))
  }
}

function validarBaselineOperacional(baseline, root) {
  if (
    baseline?.contract !== BASELINE_CONTRACT ||
    baseline.repositoryFingerprint !== sha256(root.toLowerCase()) ||
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
    !['contratos', 'hooks', 'runtime', 'scripts', 'skills'].includes(path.split('/')[0])) {
    throw new Error('Release operacional exige artefato portatil dentro do payload do Omni.')
  }
  return path
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

function caminhosDaReleaseOperacional(root, artifactPath) {
  const relative = {
    package: 'package.json',
    plugin: '.claude-plugin/plugin.json',
    integrity: 'contratos/atualizacao/integridade.json',
    releases: 'contratos/atualizacao/releases.json',
    artifact: artifactPath
  }
  return {
    relative,
    absolute: Object.fromEntries(Object.entries(relative).map(([key, path]) => [key, join(root, ...path.split('/'))])),
    controlled: [...new Set(Object.values(relative).map(portable))].sort()
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
    changes: [`Promoveu melhoria operacional auditada ${candidate.fingerprint.slice(0, 12)} com gates e readback instalado.`]
  })
  await Promise.all([
    gravarJson(paths.absolute.package, pkg),
    gravarJson(paths.absolute.plugin, plugin),
    gravarJson(paths.absolute.releases, releases)
  ])
  const payload = await calcularFingerprintPayload(root)
  integrity.identity.releaseFingerprint = payload.fingerprint
  await gravarJson(paths.absolute.integrity, integrity)
  return {
    version,
    releaseFingerprint: payload.fingerprint,
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
  confirmOperationalReadback = confirmarCandidataOperacionalInstalada,
  at
} = {}) {
  const root = await raizOperacionalConfigurada(casa, sourceRepository)
  if (!root) return { result: 'source-repository-unconfigured' }
  validarBaselineOperacional(baseline, root)
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) => item.id === candidateId)
  if (!candidate ||
    !['materialized-pending-release', 'installed-verified'].includes(candidate.status) ||
    !candidate.artifactRef) {
    return { result: 'not-awaiting-release', candidateFingerprint: candidate?.fingerprint ?? null }
  }
  const artifactPath = await verificarArtefatoOperacional(root, candidate)
  if (allowedArtifacts !== undefined) {
    const allowed = [...new Set((allowedArtifacts ?? []).map((item) => validarCaminhoArtefato(item?.path ?? item)))]
    if (allowed.length !== 1 || allowed[0] !== artifactPath) {
      throw new Error('Modelo atual permite somente o artefato auditado da candidata; testes extras ainda nao possuem vinculo seguro.')
    }
  }

  const paths = caminhosDaReleaseOperacional(root, artifactPath)
  const identityFingerprint = fingerprintMelhoriaOperacional(candidate, baseline)
  const repositoryFingerprint = sha256(root.toLowerCase())
  const release = await adquirirLock(root)
  if (!release) return { result: 'release-in-progress' }
  const state = await lerEstado(casa)
  let transaction = state.releases[identityFingerprint] ?? null
  let before = null
  let committed = Boolean(transaction && ['committed', 'pushed', 'installed-verified'].includes(transaction.stage))
  const save = async () => {
    state.releases[identityFingerprint] = transaction
    await gravarEstado(casa, state)
  }

  try {
    if (transaction && (
      transaction.runFingerprint !== identityFingerprint ||
      transaction.repositoryFingerprint !== repositoryFingerprint
    )) throw new Error('Estado local da release operacional pertence a outra fonte ou candidata.')
    if (transaction?.stage === 'installed-verified') {
      return {
        result: 'already-published-installed-verified',
        stage: transaction.stage,
        version: transaction.version,
        releaseFingerprint: transaction.releaseFingerprint,
        publication: 'remote-commit-verified',
        installedReadback: true,
        rawResponsesStored: false
      }
    }
    if (candidate.status === 'installed-verified' && !transaction) {
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
      } else if (currentPaths.length !== 1 || currentPaths[0] !== artifactPath) {
        result = 'uncontrolled-repository-changes'
        phase = 'operational-scope-diverged'
        reason = 'Mudancas atuais nao correspondem somente ao artefato auditado da candidata.'
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
        const gates = await runGates(root)
        if (gates?.ok !== true) throw new Error('Um ou mais gates da release operacional reprovaram.')
        const changedPaths = validarMudancasControladas(await repository.status(root), paths.controlled)
        const commit = await repository.commit(root, {
          paths: changedPaths,
          message: `release(omni): v${prepared.version} operational [${identityFingerprint.slice(0, 12)}]`
        })
        if (!HASH.test(commit?.commitSha ?? '') || !/^[a-f0-9]{64}$/.test(commit?.branchFingerprint ?? '')) {
          throw new Error('Commit operacional nao retornou identidade verificavel.')
        }
        committed = true
        transaction = {
          stage: 'committed',
          runFingerprint: identityFingerprint,
          repositoryFingerprint,
          version: prepared.version,
          releaseFingerprint: prepared.releaseFingerprint,
          evidenceFingerprint: prepared.evidenceFingerprint,
          gatesFingerprint: resumoDosGates(gates).fingerprint,
          commitSha: commit.commitSha,
          branchFingerprint: commit.branchFingerprint,
          remoteCommitSha: null,
          installedReadback: null,
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
      persist: async (next) => {
        transaction = next
        await save()
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
