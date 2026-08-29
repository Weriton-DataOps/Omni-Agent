import { createHash } from 'node:crypto'
import { access, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

import {
  fingerprintSemanticoMelhoria,
  lerCicloOperacional,
  marcarMelhoriaOperacional
} from './ciclo-operacional.mjs'
import { verificarIntegridadeRelease } from './integridade-release.mjs'
import { pareceConterSegredo } from './memoria.mjs'
import { resolverImplementacaoOperacionalAuditoria } from './auditoria-autocorrecao.mjs'
import { validarSuite } from './eval-personalidade.mjs'

const CONFIG_SCHEMA_VERSION = 1

const DESTINATIONS = {
  'operational-rule': ['contratos', 'operacao', 'regras-aprendidas.json', 'rules'],
  personality: ['contratos', 'eval', 'casos-aprendidos.json', 'cases'],
  procedure: ['contratos', 'operacao', 'procedimentos-aprendidos.json', 'procedures'],
  eval: ['contratos', 'eval', 'casos-aprendidos.json', 'cases']
}

const SOURCE_CHANGE_DESTINATIONS = {
  routing: 'runtime/roteamento',
  hook: 'runtime/hook-contexto.mjs',
  'runtime-fix': 'runtime',
  capability: 'skills e contratos/capacidades/catalogo.json'
}
const PAYLOAD_ROOTS = new Set(['contratos', 'hooks', 'runtime', 'scripts', 'skills'])

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function caminhoPortatil(value) {
  const path = String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || isAbsolute(path) || path.split('/').includes('..') || !PAYLOAD_ROOTS.has(path.split('/')[0])) {
    throw new Error('O artefato precisa usar caminho portatil dentro do payload do Omni.')
  }
  return path
}

async function resolverArtefato(root, portablePath) {
  const canonicalRoot = await realpath(root)
  const target = await realpath(join(root, ...portablePath.split('/')))
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error('O artefato instalado escapa da raiz integra do plugin.')
  }
  return target
}

async function adquirirTravaRepositorio(root) {
  const path = join(root, '.git', 'omni-evolution.lock')
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(path).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 120_000) await unlink(path).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    }
  }
  throw new Error('Outra materializacao do Omni esta alterando o repositorio canonico.')
}

async function validarRepositorio(repoRoot) {
  if (!isAbsolute(repoRoot ?? '')) throw new Error('O repositorio canonico precisa usar caminho absoluto.')
  const root = resolve(repoRoot)
  await access(join(root, '.git'))
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (pkg.name !== 'omni-agent') throw new Error('O destino nao e o repositorio canonico do Omni.')
  return root
}

function caminhoDaConfiguracao(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'config', 'source-repository.json')
}

export async function configurarRepositorioCanonico(casa, repoRoot) {
  const root = await validarRepositorio(repoRoot)
  const path = caminhoDaConfiguracao(casa)
  const temporary = `${path}.${process.pid}.novo`
  const document = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    sourceRepository: root,
    configuredAt: new Date().toISOString()
  }
  await mkdir(join(casa, 'config'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
  return { result: 'configured', sourceRepository: root }
}

export async function lerRepositorioCanonico(casa) {
  const path = caminhoDaConfiguracao(casa)
  try {
    const document = JSON.parse(await readFile(path, 'utf8'))
    if (document?.schemaVersion !== CONFIG_SCHEMA_VERSION) {
      throw new Error('Configuracao do repositorio canonico fora da versao 1.')
    }
    const sourceRepository = await validarRepositorio(document.sourceRepository)
    return { status: 'configured', sourceRepository }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'unconfigured', sourceRepository: null }
    throw error
  }
}

function sourceRefs(candidate) {
  return Array.isArray(candidate?.sourceRefs) ? candidate.sourceRefs : []
}

function coverageFromSources(candidate, canonicalCaseIds) {
  const caseIds = [...new Set(
    sourceRefs(candidate).map((item) => item.canonicalCaseId).filter(Boolean)
  )]
  if (caseIds.length === 1 && canonicalCaseIds.has(caseIds[0])) {
    return {
      readiness: 'covered-by-canonical-case',
      scenario: { caseId: caseIds[0] }
    }
  }
  return { readiness: 'pending-scenario', scenario: null }
}

function mergeSourceRefs(...collections) {
  const merged = new Map()
  for (const item of collections.flat()) {
    if (!item || item.kind !== 'personality-feedback' || typeof item.turnFingerprint !== 'string') continue
    merged.set(`${item.kind}:${item.turnFingerprint}`, item)
  }
  return [...merged.values()]
}

async function canonicalPersonalityCaseIds(root) {
  try {
    const document = validarSuite(JSON.parse(
      await readFile(join(root, 'contratos', 'eval', 'personalidade.json'), 'utf8')
    ))
    return new Set(document.cases.map((item) => item?.id).filter((id) => typeof id === 'string'))
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set()
    throw error
  }
}

function artefato(candidate, canonicalCaseIds = new Set()) {
  const precisaDeCenario = candidate.destination === 'personality' || candidate.destination === 'eval'
  const references = sourceRefs(candidate)
  return {
    id: candidate.id,
    category: candidate.category,
    destination: candidate.destination,
    text: candidate.statement,
    evidence: {
      occurrences: candidate.occurrences,
      fingerprint: candidate.fingerprint,
      ...(references.length > 0 ? { sourceRefs: references } : {})
    },
    status: precisaDeCenario ? 'candidate' : 'active',
    ...(precisaDeCenario ? coverageFromSources(candidate, canonicalCaseIds) : {}),
    learnedAt: candidate.updatedAt
  }
}

function textoNormalizado(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function alvoNormalizado(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function mesmoArtefato(item, candidate) {
  return item?.destination === candidate.destination && (
    item?.evidence?.fingerprint === candidate.fingerprint ||
    textoNormalizado(item?.text) === textoNormalizado(candidate.statement)
  )
}

function referenciaDaEntrada(path, collection, item, candidate) {
  return {
    kind: 'portable-entry',
    path,
    collection,
    entryId: item.id,
    semanticFingerprint: fingerprintSemanticoMelhoria(candidate),
    contentFingerprint: null
  }
}

export async function materializarMelhoriaOperacional(casa, id, repoRoot) {
  const root = await validarRepositorio(repoRoot)
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) => item.id === id)
  if (!candidate) throw new Error(`Melhoria operacional inexistente: ${id}`)
  if (candidate.status !== 'ready') return { result: 'not-ready', candidate }
  if (pareceConterSegredo(candidate.statement)) throw new Error('Melhoria contem material sensivel.')
  const sourceTarget = SOURCE_CHANGE_DESTINATIONS[candidate.destination]
  if (sourceTarget) {
    const marked = await marcarMelhoriaOperacional(casa, id, {
      status: 'implementation-required',
      artifact: sourceTarget
    })
    return {
      result: 'implementation-required',
      candidateId: id,
      destination: candidate.destination,
      route: {
        kind: 'source-change',
        targetHint: sourceTarget,
        requiredGates: ['patch', 'regression-test', 'full-suite', 'release-fingerprint', 'installed-readback']
      },
      candidate: marked.candidate
    }
  }
  const destination = DESTINATIONS[candidate.destination]
  if (!destination) return { result: 'local-only', candidate }
  const release = await adquirirTravaRepositorio(root)
  try {
    const [directory, area, file, collection] = destination
    const portablePath = [directory, area, file].join('/')
    const path = join(root, directory, area, file)
    const document = JSON.parse(await readFile(path, 'utf8'))
    if (!Array.isArray(document[collection])) throw new Error(`Artefato de destino invalido: ${path}`)
    const canonicalCaseIds = candidate.destination === 'personality' || candidate.destination === 'eval'
      ? await canonicalPersonalityCaseIds(root)
      : new Set()
    const existing = document[collection].find((item) =>
      item.id === candidate.id || mesmoArtefato(item, candidate)
    )
    let materialized = existing
    if (!existing) {
      materialized = artefato(candidate, canonicalCaseIds)
      document[collection].push(materialized)
      const temporary = `${path}.${process.pid}.${id}.novo`
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    } else if (existing.id !== candidate.id) {
      const references = mergeSourceRefs(existing.evidence?.sourceRefs ?? [], candidate.sourceRefs ?? [])
      existing.evidence = {
        ...existing.evidence,
        occurrences: Math.max(existing.evidence?.occurrences ?? 0, candidate.occurrences),
        fingerprint: existing.evidence?.fingerprint ?? candidate.fingerprint,
        ...(references.length > 0 ? { sourceRefs: references } : {}),
        mergedCandidateIds: [...new Set([
          ...(existing.evidence?.mergedCandidateIds ?? []),
          candidate.id
        ])]
      }
      if (
        references.length > 0 &&
        existing.status === 'candidate' &&
        existing.readiness !== 'executable'
      ) {
        const coverage = coverageFromSources({ sourceRefs: references }, canonicalCaseIds)
        existing.readiness = coverage.readiness
        existing.scenario = coverage.scenario
      }
      const temporary = `${path}.${process.pid}.${id}.novo`
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    }
    const reference = referenciaDaEntrada(portablePath, collection, materialized, candidate)
    const marked = await marcarMelhoriaOperacional(casa, id, {
      status: 'materialized-pending-release',
      artifactRef: reference
    })
    return {
      result: 'materialized-pending-release',
      candidateId: id,
      destination: candidate.destination,
      artifact: portablePath,
      artifactRef: reference,
      deduplicated: Boolean(existing && existing.id !== candidate.id),
      candidate: marked.candidate,
      next: ['npm.cmd run check', 'npm.cmd test', 'review', 'version', 'commit', 'publish', 'installed-readback']
    }
  } finally {
    await release()
  }
}

export async function materializarMelhoriaConfigurada(casa, id) {
  const configuration = await lerRepositorioCanonico(casa)
  if (configuration.status !== 'configured') return { result: 'unconfigured', candidateId: id }
  return materializarMelhoriaOperacional(casa, id, configuration.sourceRepository)
}

export async function registrarImplementacaoOperacional(casa, id, repoRoot, artifactPath, {
  now,
  mutationActionId,
  mutationEvidenceId,
  verificationActionId,
  verificationEvidenceId
} = {}) {
  const root = await validarRepositorio(repoRoot)
  const portablePath = caminhoPortatil(artifactPath)
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) => item.id === id)
  if (!candidate) throw new Error(`Melhoria operacional inexistente: ${id}`)
  if (candidate.status !== 'implementation-required') return { result: 'not-ready', candidate }
  const target = await resolverArtefato(root, portablePath)
  const requiredAt = [...candidate.transitionHistory]
    .reverse()
    .find((item) => item.to === 'implementation-required')?.recordedAt
  const audit = await resolverImplementacaoOperacionalAuditoria(casa, {
    mutationActionId,
    mutationEvidenceId,
    verificationActionId,
    verificationEvidenceId,
    targetFingerprints: [...new Set([
      hash(alvoNormalizado(portablePath)),
      hash(alvoNormalizado(join(root, ...portablePath.split('/')))),
      hash(alvoNormalizado(target))
    ])],
    notBefore: requiredAt
  })
  if (audit.result !== 'verified') {
    throw new Error('A implementacao exige mutacao auditada no proprio artefato e readback posterior, ambos depois de implementation-required.')
  }
  const raw = await readFile(target)
  const reference = {
    kind: 'source-file',
    path: portablePath,
    collection: null,
    entryId: null,
    semanticFingerprint: fingerprintSemanticoMelhoria(candidate),
    contentFingerprint: hash(raw),
    implementationReceipt: audit.receipt
  }
  const marked = await marcarMelhoriaOperacional(casa, id, {
    status: 'materialized-pending-release',
    artifactRef: reference
  }, { at: now })
  return { result: marked.result, candidate: marked.candidate, artifactRef: reference }
}

async function localizarEntradaInstalada(pluginRoot, candidate) {
  const reference = candidate.artifactRef
  const target = await resolverArtefato(pluginRoot, caminhoPortatil(reference.path))
  if (reference.kind === 'source-file') {
    if (!reference.implementationReceipt) return null
    const raw = await readFile(target)
    if (hash(raw) !== reference.contentFingerprint) return null
    return { fingerprint: hash(raw), entry: null }
  }
  const document = JSON.parse(await readFile(target, 'utf8'))
  if (!Array.isArray(document[reference.collection])) return null
  const matches = document[reference.collection].filter((item) =>
    item?.id === reference.entryId ||
    item?.id === candidate.id ||
    item?.evidence?.mergedCandidateIds?.includes(candidate.id) ||
    mesmoArtefato(item, candidate)
  )
  const entry = matches.find((item) =>
    fingerprintSemanticoMelhoria({ destination: item.destination, statement: item.text }) ===
      reference.semanticFingerprint
  )
  return entry ? {
    fingerprint: hash(JSON.stringify(entry)),
    entry,
    semanticFingerprint: fingerprintSemanticoMelhoria({
      destination: entry.destination,
      statement: entry.text
    })
  } : null
}

async function localizarSupersessaoInstalada(
  pluginRoot,
  candidate,
  cycle,
  installedByCandidate,
  installedCandidateIds,
  { version, payloadFingerprint, verifiedAt }
) {
  const reference = candidate.artifactRef
  if (reference?.kind !== 'portable-entry') return null
  const target = await resolverArtefato(pluginRoot, caminhoPortatil(reference.path))
  const document = JSON.parse(await readFile(target, 'utf8'))
  if (!Array.isArray(document[reference.collection])) return null

  const canonicalEntry = document[reference.collection].find((item) => item?.id === reference.entryId)
  if (!canonicalEntry) return null
  const semanticFingerprint = fingerprintSemanticoMelhoria({
    destination: canonicalEntry.destination,
    statement: canonicalEntry.text
  })
  if (semanticFingerprint === reference.semanticFingerprint) return null

  const mergedCandidateIds = canonicalEntry.evidence?.mergedCandidateIds
  if (!Array.isArray(mergedCandidateIds) || mergedCandidateIds.length === 0) return null
  const canonicalFingerprint = hash(JSON.stringify(canonicalEntry))
  const replacements = cycle.improvementCandidates.filter((replacement) => {
    const installed = installedByCandidate.get(replacement.id)
    return replacement.id !== candidate.id &&
      mergedCandidateIds.includes(replacement.id) &&
      installedCandidateIds.has(replacement.id) &&
      replacement.fingerprint === canonicalEntry.evidence?.fingerprint &&
      replacement.artifactRef?.kind === 'portable-entry' &&
      replacement.artifactRef.path === reference.path &&
      replacement.artifactRef.collection === reference.collection &&
      replacement.artifactRef.semanticFingerprint === semanticFingerprint &&
      installed?.fingerprint === canonicalFingerprint &&
      installed?.semanticFingerprint === semanticFingerprint
  })
  if (replacements.length !== 1) return null

  return {
    proof: 'explicit-merged-candidate',
    replacementCandidateId: replacements[0].id,
    canonicalEntryId: canonicalEntry.id,
    path: reference.path,
    collection: reference.collection,
    semanticFingerprint,
    artifactFingerprint: canonicalFingerprint,
    version,
    payloadFingerprint,
    verifiedAt
  }
}

export async function registrarReadbackOperacionalInstalado(casa, {
  pluginRoot,
  version,
  payloadFingerprint,
  now
} = {}) {
  if (!isAbsolute(pluginRoot ?? '')) throw new Error('O plugin instalado precisa usar caminho absoluto.')
  if (typeof version !== 'string' || !version.trim()) throw new Error('A versao instalada e obrigatoria.')
  if (!/^[a-f0-9]{64}$/.test(payloadFingerprint ?? '')) {
    throw new Error('O readback operacional exige fingerprint do payload instalado.')
  }
  const integrity = await verificarIntegridadeRelease(resolve(pluginRoot))
  if (
    integrity.status !== 'verified' ||
    integrity.versionMatchesManifest !== true ||
    integrity.releaseVersion !== version ||
    integrity.fingerprint !== payloadFingerprint ||
    integrity.declaredFingerprint !== payloadFingerprint
  ) {
    throw new Error('O readback operacional exige release instalada integra, identificada e da mesma versao.')
  }
  const cycle = await lerCicloOperacional(casa)
  let verified = 0
  let superseded = 0
  const verifiedAt = agora(now)
  const installedByCandidate = new Map()
  const installedCandidateIds = new Set()
  for (const candidate of cycle.improvementCandidates) {
    if (!candidate.artifactRef || !['materialized-pending-release', 'installed-verified'].includes(candidate.status)) {
      continue
    }
    const installed = await localizarEntradaInstalada(pluginRoot, candidate)
    if (!installed) continue
    installedByCandidate.set(candidate.id, installed)
    installedCandidateIds.add(candidate.id)
  }
  for (const candidate of cycle.improvementCandidates) {
    if (candidate.status !== 'materialized-pending-release' || !candidate.artifactRef) continue
    const installed = installedByCandidate.get(candidate.id)
    if (!installed) continue
    await marcarMelhoriaOperacional(casa, candidate.id, {
      status: 'installed-verified',
      installedReadback: {
        verified: true,
        version,
        payloadFingerprint,
        artifactFingerprint: installed.fingerprint,
        verifiedAt
      }
    }, { at: now })
    verified += 1
  }
  for (const candidate of cycle.improvementCandidates) {
    if (candidate.status !== 'materialized-pending-release' || !candidate.artifactRef) continue
    if (installedByCandidate.has(candidate.id)) continue
    const supersededBy = await localizarSupersessaoInstalada(
      pluginRoot,
      candidate,
      cycle,
      installedByCandidate,
      installedCandidateIds,
      { version, payloadFingerprint, verifiedAt }
    )
    if (!supersededBy) continue
    await marcarMelhoriaOperacional(casa, candidate.id, {
      status: 'superseded',
      supersededBy
    }, { at: now })
    superseded += 1
  }
  return { result: 'checked', verified, superseded, version, payloadFingerprint }
}
