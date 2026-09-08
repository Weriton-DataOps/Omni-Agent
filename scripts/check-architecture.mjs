import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(workspaceRoot, 'src')

function fail(message) {
  throw new Error(`Gate de arquitetura falhou: ${message}`)
}

async function filesBelow(directory, predicate) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(path, predicate))
    else if (entry.isFile() && predicate(entry.name)) result.push(path)
  }
  return result.sort()
}

function sourceName(path) {
  return relative(sourceRoot, path).replaceAll('\\', '/')
}

const sourceFiles = await filesBelow(sourceRoot, (name) => name.endsWith('.ts') || name.endsWith('.json'))
const typescriptFiles = sourceFiles.filter((path) => path.endsWith('.ts'))
const testFiles = await filesBelow(join(workspaceRoot, 'testes'), (name) => name.endsWith('.ts'))
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const forbiddenDirective = new RegExp('@' + 'ts-(?:ignore|expect-error|nocheck)')

for (const path of [...typescriptFiles, ...testFiles]) {
  const source = await readFile(path, 'utf8')
  const name = relative(workspaceRoot, path).replaceAll('\\', '/')
  if (forbiddenDirective.test(source)) fail(`${name} silencia o compilador TypeScript.`)

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier?.startsWith('.') && (specifier.endsWith('.ts') || !/\.(?:js|json)$/.test(specifier))) {
      fail(`${name} usa specifier relativo nao compativel com NodeNext: ${specifier}.`)
    }
  }
}

for (const path of sourceFiles) {
  const source = await readFile(path, 'utf8')
  const name = sourceName(path)
  const isCore = name.startsWith('core/')
  const isApplication = name.startsWith('application/')
  const isInnerLayer = isCore || isApplication || name.startsWith('contracts/') || name.startsWith('ports/')

  if (isInnerLayer && /(?:from\s+|import\s*\()['"]node:/.test(source)) {
    fail(`${name} importa node: em camada interna.`)
  }
  if (
    isInnerLayer &&
    /\b(?:Buffer|NodeJS\.|__dirname|__filename)\b|\bprocess\.(?:argv|env|platform|cwd|pid|versions)\b/.test(source)
  ) {
    fail(`${name} usa global de runtime em camada interna.`)
  }
  if (isInnerLayer && /(?:from\s+|import\s*\()[^'"\n]*['"][^'"\n]*adapters\//.test(source)) {
    fail(`${name} depende de adapter concreto.`)
  }
  if (isInnerLayer && /(?:from\s+|import\s*\()[^'"\n]*['"][^'"\n]*runtime\//.test(source)) {
    fail(`${name} depende do runtime legado.`)
  }
  if (/overcore/i.test(source) && !/^(?:adapters\/overcore\/|entrypoints\/)/.test(name)) {
    fail(`${name} conhece a integracao Overcore fora da borda permitida.`)
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, sourceFiles: sourceFiles.length, typescriptFiles: typescriptFiles.length })}\n`)
