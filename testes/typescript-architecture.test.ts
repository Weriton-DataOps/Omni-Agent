import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import test from 'node:test'

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.json'))) files.push(path)
  }
  return files
}

test('fronteiras TypeScript impedem dependências invertidas e vazamento do adapter', async () => {
  const root = process.cwd()
  for (const layer of ['core', 'application', 'contracts', 'ports'] as const) {
    for (const path of await sourceFiles(join(root, 'src', layer))) {
      const source = await readFile(path, 'utf8')
      assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]node:/, `${relative(root, path)} importa node:`)
      assert.doesNotMatch(
        source,
        /\b(?:Buffer|NodeJS\.|__dirname|__filename)\b|\bprocess\.(?:argv|env|platform|cwd|pid|versions)\b/,
        `${relative(root, path)} usa global de runtime`
      )
      assert.doesNotMatch(source, /(?:from\s+|import\s*\()[^'"\n]*['"][^'"\n]*adapters\//, `${relative(root, path)} importa adapter`)
      if (layer === 'core' || layer === 'application') {
        assert.doesNotMatch(source, /overcore/i, `${relative(root, path)} conhece integração externa`)
      }
    }
  }

  for (const path of await sourceFiles(join(root, 'src'))) {
    const source = await readFile(path, 'utf8')
    if (!/overcore/i.test(source)) continue
    const normalized = relative(join(root, 'src'), path).replaceAll('\\', '/')
    assert.match(normalized, /^(?:adapters\/overcore\/|entrypoints\/)/, `${normalized} contém menção externa`)
  }
})

test('runtime TypeScript permanece sem dependências de produção', async () => {
  const document = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as Record<string, unknown>
  assert.equal(document.dependencies, undefined)
  const devDependencies = document.devDependencies as Record<string, unknown>
  assert.deepEqual(Object.keys(devDependencies).sort(), ['@types/node', 'ajv', 'ajv-formats', 'typescript'])
})

test('fonte TypeScript não silencia erros com diretivas de supressão', async () => {
  const root = process.cwd()
  const paths = [
    ...await sourceFiles(join(root, 'src')),
    ...await sourceFiles(join(root, 'testes'))
  ]
  const forbiddenDirective = new RegExp('@' + 'ts-(?:ignore|expect-error|nocheck)')
  for (const path of paths.filter((candidate) => candidate.endsWith('.ts'))) {
    const source = await readFile(path, 'utf8')
    assert.doesNotMatch(source, forbiddenDirective, relative(root, path))
  }
})
