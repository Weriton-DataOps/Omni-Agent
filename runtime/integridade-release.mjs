import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export const RELEASE_FINGERPRINT_ALGORITHM = 'sha256-canonical-text-v1'

const PAYLOAD_ROOTS = ['contratos', 'hooks', 'runtime', 'scripts', 'skills']
const EXCLUDED = new Set([
  'contratos/atualizacao/integridade.json',
  'contratos/atualizacao/releases.json'
])

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const RELEASE_FINGERPRINT = /^[a-f0-9]{64}$/

function portable(path) {
  return path.replace(/\\/g, '/')
}

async function walk(root, directory, files) {
  const entries = await readdir(join(root, directory), { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(root, path, files)
    else if (entry.isFile()) files.push(portable(path))
  }
}

export async function listarArquivosDoPayload(pluginRoot) {
  if (!isAbsolute(pluginRoot ?? '')) {
    throw new Error('A raiz do plugin precisa usar caminho absoluto para calcular integridade.')
  }
  const files = []
  for (const directory of PAYLOAD_ROOTS) await walk(pluginRoot, directory, files)
  return files.filter((path) => !EXCLUDED.has(path)).sort()
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
    const declared = hasDeclaredFingerprint ? contract.identity.releaseFingerprint : null
    return {
      version: contract.identity.version,
      releaseFingerprint: declared,
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
      manifestVersion,
      versionMatchesManifest: true,
      source: 'legacy-plugin-manifest'
    }
  }
}

export async function verificarIntegridadePayload(pluginRoot, declaredFingerprint) {
  const actual = await calcularFingerprintPayload(pluginRoot)
  const declared = typeof declaredFingerprint === 'string' && /^[a-f0-9]{64}$/.test(declaredFingerprint)
    ? declaredFingerprint
    : null
  return {
    ...actual,
    declaredFingerprint: declared,
    status: !declared ? 'legacy-unverifiable' : declared === actual.fingerprint ? 'verified' : 'drifted'
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
