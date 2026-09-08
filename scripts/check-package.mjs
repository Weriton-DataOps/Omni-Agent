import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedDevelopmentDependencies = {
  '@types/node': '22.20.1',
  ajv: '8.20.0',
  'ajv-formats': '3.0.1',
  typescript: '7.0.2'
}

function fail(message) {
  throw new Error(`Gate de pacote falhou: ${message}`)
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

async function filesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

const packageDocument = record(JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8')))
const lockDocument = record(JSON.parse(await readFile(join(workspaceRoot, 'package-lock.json'), 'utf8')))
const pluginDocument = record(JSON.parse(await readFile(join(workspaceRoot, '.claude-plugin', 'plugin.json'), 'utf8')))
if (packageDocument === null || lockDocument === null || pluginDocument === null) fail('manifesto ausente ou malformado.')

if (
  packageDocument.name !== 'omni-agent' ||
  packageDocument.private !== true ||
  packageDocument.type !== 'module' ||
  record(packageDocument.engines)?.node !== '>=22'
) fail('package.json precisa ser ESM privado e exigir Node >=22.')
if (pluginDocument.version !== packageDocument.version) fail('versao do plugin diverge do package.json.')
if (packageDocument.dependencies !== undefined && Object.keys(record(packageDocument.dependencies) ?? {}).length > 0) {
  fail('runtime produtivo nao pode ter dependencies.')
}
if (JSON.stringify(packageDocument.devDependencies) !== JSON.stringify(expectedDevelopmentDependencies)) {
  fail('devDependencies precisam ser a lista exata, ordenada e pinada.')
}
for (const [name, version] of Object.entries(expectedDevelopmentDependencies)) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`${name} nao esta pinada.`)
  if (record(lockDocument.packages)?.[`node_modules/${name}`]?.version !== version) {
    fail(`package-lock nao fixa ${name}@${version}.`)
  }
}
const lockRoot = record(record(lockDocument.packages)?.[''])
if (
  lockDocument.lockfileVersion !== 3 ||
  lockDocument.name !== packageDocument.name ||
  lockDocument.version !== packageDocument.version ||
  JSON.stringify(lockRoot?.devDependencies) !== JSON.stringify(expectedDevelopmentDependencies) ||
  record(lockRoot?.engines)?.node !== '>=22'
) fail('package-lock raiz diverge do package.json.')

const scripts = record(packageDocument.scripts)
for (const name of ['architecture:check', 'contracts:check', 'package:check', 'test:dist', 'verify']) {
  if (typeof scripts?.[name] !== 'string' || scripts[name].length === 0) fail(`script ${name} ausente.`)
}
if (!scripts['test:dist'].includes('build:ts') || !scripts['test:dist'].includes('dist-production.test.mjs')) {
  fail('test:dist precisa buildar e executar o smoke do dist produtivo.')
}
if (scripts['test:dist'].includes('.test-dist')) fail('test:dist nao pode depender de .test-dist.')
for (const required of ['contracts:check', 'architecture:check', 'package:check', 'test:dist', 'verify:build']) {
  if (!scripts.verify.includes(required)) fail(`verify nao encadeia ${required}.`)
}

const buildConfig = record(JSON.parse(await readFile(join(workspaceRoot, 'tsconfig.build.json'), 'utf8')))
const buildOptions = record(buildConfig?.compilerOptions)
if (
  buildOptions?.rootDir !== 'src' ||
  buildOptions?.outDir !== 'dist' ||
  buildOptions?.sourceMap !== false ||
  buildOptions?.declaration !== false ||
  buildOptions?.declarationMap !== false
) fail('tsconfig.build.json nao descreve o payload JS/JSON minimo.')

const sourceRoot = join(workspaceRoot, 'src')
const distRoot = join(workspaceRoot, 'dist')
const sourceFiles = await filesBelow(sourceRoot)
const distFiles = await filesBelow(distRoot)
const expectedDist = sourceFiles
  .filter((path) => ['.ts', '.json'].includes(extname(path)))
  .map((path) => {
    const name = relative(sourceRoot, path).replaceAll('\\', '/')
    return name.endsWith('.ts') ? `${name.slice(0, -3)}.js` : name
  })
  .sort()
const actualDist = distFiles.map((path) => relative(distRoot, path).replaceAll('\\', '/')).sort()
if (actualDist.length === 0) fail('dist produtivo esta vazio; execute npm run build:ts.')
if (actualDist.some((path) => !/\.(?:js|json)$/.test(path))) fail('dist contem artefato diferente de JS/JSON.')
const missingDist = expectedDist.filter((path) => !actualDist.includes(path))
const staleDist = actualDist.filter((path) => !expectedDist.includes(path))
if (missingDist.length > 0) fail(`dist nao contem: ${missingDist.join(', ')}.`)
if (staleDist.length > 0) fail(`dist contem artefato stale: ${staleDist.join(', ')}.`)

const runtimeFiles = await filesBelow(join(workspaceRoot, 'runtime'))
for (const runtimePath of runtimeFiles.filter((path) => path.endsWith('.mjs'))) {
  const source = await readFile(runtimePath, 'utf8')
  for (const match of source.matchAll(/['"]\.\.\/dist\/([^'"]+)['"]/g)) {
    const target = join(distRoot, match[1])
    if (!await fileExists(target)) {
      fail(`${relative(workspaceRoot, runtimePath)} importa dist ausente: ${match[1]}.`)
    }
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, distFiles: actualDist.length, runtimeDependencies: 0 })}\n`)
