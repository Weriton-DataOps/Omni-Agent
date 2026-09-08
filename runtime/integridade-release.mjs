import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'

export const RELEASE_FINGERPRINT_ALGORITHM = 'sha256-canonical-text-v1'

const PAYLOAD_ROOTS = Object.freeze([
  { path: 'adaptadores', required: false },
  { path: 'contratos', required: true },
  { path: 'dist', required: true },
  { path: 'hooks', required: true },
  { path: 'runtime', required: true },
  { path: 'scripts', required: true },
  { path: 'skills', required: true }
])
const EXCLUDED = new Set([
  'contratos/atualizacao/integridade.json',
  'contratos/atualizacao/releases.json',
  // Dedicated PostgreSQL is local runtime state, never release payload.
  'runtime/postgresql-5433'
])

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const RELEASE_FINGERPRINT = /^[a-f0-9]{64}$/

function portable(path) {
  return path.replace(/\\/g, '/')
}

async function walk(root, directory, files) {
  let entries
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(root, path, files)
    else if (entry.isFile()) files.push(portable(path))
  }
  return true
}

export async function listarArquivosDoPayload(pluginRoot) {
  if (!isAbsolute(pluginRoot ?? '')) {
    throw new Error('A raiz do plugin precisa usar caminho absoluto para calcular integridade.')
  }
  const files = []
  for (const root of PAYLOAD_ROOTS) {
    const found = await walk(pluginRoot, root.path, files)
    if (!found && root.required) throw new Error(`Raiz obrigatoria do payload ausente: ${root.path}.`)
  }
  return files.filter((path) => ![...EXCLUDED].some((excluded) => path === excluded || path.startsWith(`${excluded}/`))).sort()
}

function referenciaPortatil(value) {
  if (typeof value !== 'string') return null
  const normalized = portable(value.trim())
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, '')
    .replace(/^\.\//, '')
  if (!/^(?:adaptadores|dist|runtime|scripts)\/.+\.(?:c?js|mjs|ps1)$/i.test(normalized)) return null
  return normalized
}

function registrarReferencia(map, path, source) {
  const portablePath = referenciaPortatil(path)
  if (!portablePath) return
  const sources = map.get(portablePath) ?? new Set()
  sources.add(source)
  map.set(portablePath, sources)
}

async function lerOpcional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function referenciasDosHooks(pluginRoot, references) {
  const raw = await lerOpcional(join(pluginRoot, 'hooks', 'hooks.json'))
  if (!raw) return
  const document = JSON.parse(raw)
  for (const registrations of Object.values(document?.hooks ?? {})) {
    for (const registration of registrations ?? []) {
      for (const hook of registration?.hooks ?? []) {
        if (hook?.command !== 'node' || !Array.isArray(hook.args)) continue
        for (const argument of hook.args) registrarReferencia(references, argument, 'hooks/hooks.json')
      }
    }
  }
}

async function referenciasDoPackage(pluginRoot, references) {
  const raw = await lerOpcional(join(pluginRoot, 'package.json'))
  if (!raw) return
  const document = JSON.parse(raw)
  for (const [name, script] of Object.entries(document?.scripts ?? {})) {
    if (typeof script !== 'string') continue
    const pattern = /\bnode(?:\.exe)?\b(?:\s+--[^\s;&|]+)*\s+([^\s;&|]+\.(?:c?js|mjs))/gi
    for (const match of script.matchAll(pattern)) registrarReferencia(references, match[1], `package.json#${name}`)
  }
}

async function referenciasDosScripts(pluginRoot, references) {
  const raw = await lerOpcional(join(pluginRoot, 'scripts', 'omni.ps1'))
  if (!raw) return
  const pattern = /['"]((?:adaptadores|dist|runtime|scripts)[\\/][^'"]+\.(?:c?js|mjs|ps1))['"]/gi
  for (const match of raw.matchAll(pattern)) registrarReferencia(references, match[1], 'scripts/omni.ps1')
}

async function referenciasDosImports(pluginRoot, payloadFiles, references) {
  const executableFiles = payloadFiles.filter((item) => /\.(?:c?js|mjs)$/i.test(item))
  const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g
  for (const importer of executableFiles) {
    const raw = await readFile(join(pluginRoot, importer), 'utf8')
    for (const match of raw.matchAll(importPattern)) {
      const specifier = match[1]
      if (!specifier?.startsWith('.') || !/\.(?:c?js|mjs)$/i.test(specifier)) continue
      const imported = portable(normalize(join(dirname(importer), specifier)))
      registrarReferencia(references, imported, `import:${importer}`)
    }
  }
}

export async function listarEntrypointsReferenciados(pluginRoot) {
  if (!isAbsolute(pluginRoot ?? '')) {
    throw new Error('A raiz do plugin precisa usar caminho absoluto para enumerar entrypoints.')
  }
  const files = await listarArquivosDoPayload(pluginRoot)
  const references = new Map()
  await Promise.all([
    referenciasDosHooks(pluginRoot, references),
    referenciasDoPackage(pluginRoot, references),
    referenciasDosScripts(pluginRoot, references),
    referenciasDosImports(pluginRoot, files, references)
  ])
  for (const path of files.filter((item) => /\.(?:c?js|mjs)$/i.test(item))) {
    const raw = await readFile(join(pluginRoot, path), 'utf8')
    if (/process\.argv\s*\[\s*1\s*\]/.test(raw)) registrarReferencia(references, path, 'self-executable')
  }
  return [...references.entries()]
    .map(([path, sources]) => ({ path, sources: [...sources].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function verificarCoberturaEntrypoints(pluginRoot, payloadFiles) {
  const payload = new Set(payloadFiles ?? await listarArquivosDoPayload(pluginRoot))
  const entrypoints = await listarEntrypointsReferenciados(pluginRoot)
  const missing = []
  const outsidePayload = []
  for (const entrypoint of entrypoints) {
    try {
      await readFile(join(pluginRoot, entrypoint.path), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') missing.push(entrypoint.path)
      else throw error
    }
    if (!payload.has(entrypoint.path)) outsidePayload.push(entrypoint.path)
  }
  return {
    ok: missing.length === 0 && outsidePayload.length === 0,
    entrypoints,
    missing,
    outsidePayload
  }
}

export async function calcularFingerprintPayload(pluginRoot) {
  const files = await listarArquivosDoPayload(pluginRoot)
  const digest = createHash('sha256')
  for (const path of files) {
    const raw = await readFile(join(pluginRoot, path), 'utf8')
    const canonical = raw.replace(/\r\n/g, '\n')
    digest.update(path, 'utf8')
    digest.update('\0')
    digest.update(String(Buffer.byteLength(canonical, 'utf8')), 'utf8')
    digest.update('\0')
    digest.update(canonical, 'utf8')
    digest.update('\0')
  }
  return {
    algorithm: RELEASE_FINGERPRINT_ALGORITHM,
    fingerprint: digest.digest('hex'),
    files: files.length
  }
}

export async function lerIdentidadeRelease(pluginRoot) {
  if (!isAbsolute(pluginRoot ?? '')) {
    throw new Error('A raiz do plugin precisa usar caminho absoluto para ler a identidade da release.')
  }
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')
  )
  if (manifest?.name !== 'omni') {
    throw new Error('Manifest instalado do Omni é inválido.')
  }
  const manifestVersion = SEMVER.test(manifest.version ?? '') ? manifest.version : null

  try {
    const contract = JSON.parse(
      await readFile(join(pluginRoot, 'contratos', 'atualizacao', 'integridade.json'), 'utf8')
    )
    if (
      contract?.schemaVersion !== 1 ||
      contract.contract !== 'omni-release-integrity-v1' ||
      !SEMVER.test(contract.identity?.version ?? '')
    ) {
      throw new Error('Contrato de identidade da release é inválido.')
    }
    const hasDeclaredFingerprint = Object.hasOwn(contract.identity, 'releaseFingerprint')
    if (hasDeclaredFingerprint && !RELEASE_FINGERPRINT.test(contract.identity.releaseFingerprint ?? '')) {
      throw new Error('Fingerprint declarado no contrato da release é inválido.')
    }
    const releaseAuditScopeStartedAt = contract.identity.releaseAuditScopeStartedAt
    if (
      releaseAuditScopeStartedAt !== undefined &&
      (typeof releaseAuditScopeStartedAt !== 'string' || !Number.isFinite(Date.parse(releaseAuditScopeStartedAt)))
    ) {
      throw new Error('Marco inicial da auditoria da release é inválido.')
    }
    const declared = hasDeclaredFingerprint ? contract.identity.releaseFingerprint : null
    return {
      version: contract.identity.version,
      releaseFingerprint: declared,
      releaseAuditScopeStartedAt: releaseAuditScopeStartedAt ?? null,
      manifestVersion,
      versionMatchesManifest: contract.identity.version === manifestVersion,
      source: 'release-integrity-contract'
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    if (!manifestVersion) throw new Error('Manifest legado do Omni é inválido.')
    return {
      version: manifestVersion,
      releaseFingerprint: null,
      releaseAuditScopeStartedAt: null,
      manifestVersion,
      versionMatchesManifest: true,
      source: 'legacy-plugin-manifest'
    }
  }
}

export async function verificarIntegridadePayload(pluginRoot, declaredFingerprint) {
  const payloadFiles = await listarArquivosDoPayload(pluginRoot)
  const [actual, entrypointCoverage] = await Promise.all([
    calcularFingerprintPayload(pluginRoot),
    verificarCoberturaEntrypoints(pluginRoot, payloadFiles)
  ])
  const declared = typeof declaredFingerprint === 'string' && /^[a-f0-9]{64}$/.test(declaredFingerprint)
    ? declaredFingerprint
    : null
  const fingerprintStatus = !declared
    ? 'legacy-unverifiable'
    : declared === actual.fingerprint ? 'verified' : 'drifted'
  return {
    ...actual,
    declaredFingerprint: declared,
    entrypointCoverage,
    status: entrypointCoverage.ok ? fingerprintStatus : 'drifted'
  }
}

export async function verificarIntegridadeRelease(pluginRoot) {
  const identity = await lerIdentidadeRelease(pluginRoot)
  const integrity = await verificarIntegridadePayload(pluginRoot, identity.releaseFingerprint)
  return {
    ...integrity,
    releaseVersion: identity.version,
    manifestVersion: identity.manifestVersion,
    identitySource: identity.source,
    versionMatchesManifest: identity.versionMatchesManifest,
    status: identity.versionMatchesManifest ? integrity.status : 'drifted'
  }
}
