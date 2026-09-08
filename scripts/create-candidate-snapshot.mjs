import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const hash = (value) => createHash('sha256').update(value).digest('hex')

/** Capture tracked AND untracked candidate files without modifying Git or private stores. */
export async function createCandidateSnapshot(root, destination) {
  root = resolve(root)
  destination = resolve(destination)
  const inside = relative(root, destination)
  if (!inside.startsWith(`out${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Candidate snapshots must be placed below workspace/out.')
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const headBefore = git('rev-parse', 'HEAD').trim()
  const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].sort()
  const files = []
  const inputs = []
  for (const name of paths) {
    if (/^(?:\.git|\.claude|\.codex|\.agents|\.runtime|memory|sessions|audio|evidence|out|node_modules)(?:\/|$)|(?:^|\/)\.env(?:\.|$)/u.test(name)) {
      throw new Error(`Private state cannot enter a candidate snapshot: ${name}`)
    }
    const source = resolve(root, name)
    const rel = relative(root, source)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error('Snapshot input escapes the workspace.')
    }
    const stat = await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!stat) continue // Preserve deletions through the exact manifest, never restore HEAD files.
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsupported snapshot input: ${name}`)
    const content = await readFile(source)
    inputs.push({ source, name, content })
    files.push({ path: name, bytes: content.length, sha256: hash(content) })
  }
  // Fail before publishing a mixed candidate if another session changed its sources.
  for (const input of inputs) {
    if (hash(await readFile(input.source)) !== hash(input.content)) throw new Error(`Source changed during capture: ${input.name}`)
  }
  const finalPaths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].sort()
  if (JSON.stringify(paths) !== JSON.stringify(finalPaths) || git('rev-parse', 'HEAD').trim() !== headBefore) throw new Error('Source inventory or HEAD changed during capture.')
  await mkdir(destination, { recursive: false })
  for (const input of inputs) {
    const target = join(destination, 'source', input.name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, input.content, { flag: 'wx' })
  }
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    head: headBefore,
    purpose: 'candidate-baseline-not-a-release',
    sourceFingerprint: hash(JSON.stringify(files)),
    files
  }
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return { destination, files: files.length, sourceFingerprint: manifest.sourceFingerprint, head: manifest.head }
}

export async function verifyCandidateSnapshot(destination) {
  const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || hash(JSON.stringify(manifest.files)) !== manifest.sourceFingerprint) throw new Error('Invalid snapshot manifest.')
  const root = resolve(destination, 'source')
  const actual = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Snapshot cannot contain symbolic links.')
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) actual.push(relative(root, path).replaceAll('\\', '/'))
      else throw new Error('Unsupported snapshot object.')
    }
  }
  await walk(root)
  if (JSON.stringify(actual.sort()) !== JSON.stringify(manifest.files.map(file => file.path).sort())) throw new Error('Snapshot inventory changed.')
  for (const file of manifest.files) {
    if (!actual.includes(file.path) || hash(await readFile(join(root, file.path))) !== file.sha256) throw new Error('Snapshot content changed.')
  }
  return manifest.sourceFingerprint
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const parent = join(root, 'out', 'implementation')
  await mkdir(parent, { recursive: true })
  const destination = join(parent, `baseline-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  console.log(JSON.stringify(await createCandidateSnapshot(root, destination)))
}
