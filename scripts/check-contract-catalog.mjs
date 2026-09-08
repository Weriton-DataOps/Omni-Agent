import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(workspaceRoot, 'contratos', 'catalogo-contratos.json')
const allowedKinds = new Set(['schema', 'fixture', 'policy', 'store'])
const allowedValidationModes = new Set(['generated', 'json-schema', 'manual', 'none'])
const allowedPrivacy = new Set(['derived-store', 'internal-config', 'public-contract', 'synthetic-fixture'])
const allowedPayloadModes = new Set(['compiled', 'direct', 'excluded'])
const allowedTypeModes = new Set(['runtime-structural', 'typescript-derived'])

function fail(message) {
  throw new Error(`Catalogo de contratos invalido: ${message}`)
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function normalizePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value.includes('\\')) {
    fail(`${label} precisa ser um caminho relativo normalizado.`)
  }
  const resolved = resolve(workspaceRoot, value)
  const prefix = `${workspaceRoot}${sep}`
  if (resolved !== workspaceRoot && !resolved.startsWith(prefix)) fail(`${label} sai da raiz do workspace.`)
  const normalized = relative(workspaceRoot, resolved).replaceAll('\\', '/')
  if (normalized !== value || normalized.startsWith('../')) fail(`${label} nao e canonico: ${value}`)
  return resolved
}

async function exists(path) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function jsonFilesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await jsonFilesBelow(path))
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      result.push(relative(workspaceRoot, path).replaceAll('\\', '/'))
    }
  }
  return result.sort()
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  const object = record(value)
  if (object === null) return value
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortJson(object[key])]))
}

function canonicalSha256(value) {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex')
}

async function referencedFile(value, label, { nullable = false } = {}) {
  if (value === null && nullable) return null
  const path = normalizePath(value, label)
  if (!await exists(path)) fail(`${label} nao existe: ${value}`)
  return path
}

const catalog = record(JSON.parse(await readFile(catalogPath, 'utf8')))
if (
  catalog === null ||
  catalog.schemaVersion !== 1 ||
  catalog.contract !== 'omni-contract-catalog-v1' ||
  !Array.isArray(catalog.roots) ||
  !Array.isArray(catalog.entries)
) fail('cabecalho v1 ausente ou malformado.')

const roots = []
for (const [index, value] of catalog.roots.entries()) {
  const path = normalizePath(value, `roots[${index}]`)
  if (!(await stat(path)).isDirectory()) fail(`roots[${index}] nao e diretorio.`)
  roots.push(path)
}

const discovered = (await Promise.all(roots.map(jsonFilesBelow))).flat().sort()
const paths = catalog.entries.map((entry) => record(entry)?.path)
if (paths.some((path) => typeof path !== 'string')) fail('toda entrada precisa de path textual.')
if (new Set(paths).size !== paths.length) fail('ha paths duplicados.')
if ([...paths].sort().join('\n') !== paths.join('\n')) fail('entries precisa estar ordenado por path.')

const missing = discovered.filter((path) => !paths.includes(path))
const extra = paths.filter((path) => !discovered.includes(path))
if (missing.length > 0) fail(`JSON sem classificacao: ${missing.join(', ')}`)
if (extra.length > 0) fail(`entrada sem JSON correspondente: ${extra.join(', ')}`)

const integrity = record(JSON.parse(await readFile(join(workspaceRoot, 'contratos', 'atualizacao', 'integridade.json'), 'utf8')))
const payloadRoots = new Set(Array.isArray(integrity?.payloadRoots) ? integrity.payloadRoots : [])
const payloadExcluded = new Set(Array.isArray(integrity?.excluded) ? integrity.excluded : [])

for (const [index, rawEntry] of catalog.entries.entries()) {
  const entry = record(rawEntry)
  if (entry === null) fail(`entries[${index}] nao e objeto.`)
  const label = `entries[${index}] (${String(entry.path)})`
  if (!allowedKinds.has(entry.kind)) fail(`${label} tem kind desconhecido.`)
  await referencedFile(entry.path, `${label}.path`)
  await referencedFile(entry.owner, `${label}.owner`)

  const validation = record(entry.validation)
  if (validation === null || !allowedValidationModes.has(validation.mode)) {
    fail(`${label}.validation e invalida.`)
  }
  const decoder = await referencedFile(validation.decoder, `${label}.validation.decoder`, { nullable: true })
  const schema = await referencedFile(validation.schema, `${label}.validation.schema`, { nullable: true })
  await referencedFile(validation.parityTest, `${label}.validation.parityTest`, { nullable: true })
  if (validation.mode === 'none' && (decoder !== null || schema !== null)) {
    fail(`${label} declara validation none com decoder ou schema.`)
  }
  if (validation.mode !== 'none' && decoder === null) fail(`${label} nao declara decoder/runtime validation.`)

  const privacy = record(entry.privacy)
  if (
    privacy === null ||
    !allowedPrivacy.has(privacy.classification) ||
    typeof privacy.rawUserData !== 'boolean'
  ) fail(`${label}.privacy e invalida.`)

  const payload = record(entry.payload)
  if (payload === null || !allowedPayloadModes.has(payload.mode)) fail(`${label}.payload e invalido.`)
  if (payload.mode === 'compiled') {
    if (typeof payload.target !== 'string' || !payload.target.startsWith('dist/')) {
      fail(`${label} compilado precisa declarar target em dist/.`)
    }
    normalizePath(payload.target, `${label}.payload.target`)
    if (!payloadRoots.has('dist')) fail(`${label} depende de dist fora das payloadRoots.`)
  } else if (payload.target !== null) fail(`${label}.payload.target precisa ser null.`)

  if (String(entry.path).startsWith('contratos/')) {
    const expectedMode = payloadExcluded.has(entry.path) ? 'excluded' : 'direct'
    if (payload.mode !== expectedMode || (!payloadRoots.has('contratos') && expectedMode === 'direct')) {
      fail(`${label}.payload diverge de contratos/atualizacao/integridade.json.`)
    }
  } else if (String(entry.path).startsWith('src/') && payload.mode !== 'compiled') {
    fail(`${label} em src precisa apontar para o artefato compilado.`)
  }

  const document = record(JSON.parse(await readFile(normalizePath(entry.path, `${label}.path`), 'utf8')))
  if (document === null) fail(`${label} nao contem objeto JSON.`)
  const schemaLike = entry.path.endsWith('.schema.json') || entry.path.endsWith('/schema.json') || '$schema' in document
  if (schemaLike !== (entry.kind === 'schema')) fail(`${label}.kind diverge da forma do documento.`)

  if (entry.kind !== 'schema') {
    if (entry.provenance !== null) fail(`${label} nao-schema deve usar provenance null.`)
    continue
  }

  const provenance = record(entry.provenance)
  if (
    provenance === null ||
    typeof provenance.schemaId !== 'string' ||
    typeof provenance.canonicalSha256 !== 'string' ||
    !allowedTypeModes.has(provenance.typeMode)
  ) fail(`${label}.provenance e invalida.`)
  if (document.$id !== provenance.schemaId) fail(`${label}.schemaId diverge do JSON Schema.`)
  const digest = canonicalSha256(document)
  if (digest !== provenance.canonicalSha256) fail(`${label}.canonicalSha256 diverge: ${digest}.`)
  if (validation.schema !== entry.path) fail(`${label} precisa apontar para o proprio schema.`)
  const typeSource = await referencedFile(provenance.typeSource, `${label}.provenance.typeSource`)
  const bindingSource = await referencedFile(
    provenance.bindingSource,
    `${label}.provenance.bindingSource`,
    { nullable: true }
  )
  await referencedFile(provenance.parityTest, `${label}.provenance.parityTest`)
  if (provenance.parityTest !== validation.parityTest) fail(`${label} tem testes de paridade divergentes.`)
  if (provenance.typeMode === 'runtime-structural' && typeSource !== decoder) {
    fail(`${label} runtime-structural precisa usar o decoder como typeSource.`)
  }
  if (provenance.typeMode === 'typescript-derived') {
    if (!String(provenance.typeSource).endsWith('.ts') || bindingSource === null) {
      fail(`${label} TypeScript precisa de typeSource e bindingSource.`)
    }
    const binding = await readFile(bindingSource, 'utf8')
    if (!binding.includes(digest)) fail(`${label} binding TypeScript nao fixa o fingerprint do schema.`)
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, contracts: catalog.entries.length, roots: catalog.roots })}\n`)
