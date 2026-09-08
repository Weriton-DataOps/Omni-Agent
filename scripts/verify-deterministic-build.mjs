import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { cleanBuildTargets } from './clean-build.mjs'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(workspaceRoot, 'dist')
const tscPath = resolve(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc')

async function filesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

async function fingerprintTree() {
  const entries = []
  for (const path of await filesBelow(distRoot)) {
    const name = relative(distRoot, path).replaceAll('\\', '/')
    const digest = createHash('sha256').update(await readFile(path)).digest('hex')
    entries.push(`${name}:${digest}`)
  }
  return entries
}

async function build() {
  await cleanBuildTargets(['--dist'])
  const result = spawnSync(process.execPath, [tscPath, '-p', 'tsconfig.build.json'], {
    cwd: workspaceRoot,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`Build TypeScript terminou com status ${String(result.status)}.`)
  }
}

await build()
const first = await fingerprintTree()
const staleProbe = join(distRoot, '.stale-build-probe')
await writeFile(staleProbe, 'stale\n', 'utf8')
await build()
const second = await fingerprintTree()

if (first.length === 0) throw new Error('Build TypeScript não emitiu arquivos.')
if (first.some((entry) => !/\.(?:js|json):/.test(entry))) {
  throw new Error('Build produtivo contém artefato diferente de JavaScript ou JSON.')
}
if (first.join('\n') !== second.join('\n')) {
  throw new Error('Duas builds limpas produziram árvores diferentes.')
}
try {
  await readFile(staleProbe)
  throw new Error('A limpeza não removeu o artefato stale de controle.')
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
}

process.stdout.write(`${JSON.stringify({ ok: true, files: second.length })}\n`)
