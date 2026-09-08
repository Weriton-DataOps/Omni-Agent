import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const knownTargets = Object.freeze({
  '--dist': resolve(workspaceRoot, 'dist'),
  '--tests': resolve(workspaceRoot, '.test-dist')
})

function assertSafeTarget(target) {
  if (dirname(target) !== workspaceRoot || target === workspaceRoot) {
    throw new Error(`Alvo de limpeza fora da raiz permitida: ${target}`)
  }
}

export async function cleanBuildTargets(selection = Object.keys(knownTargets)) {
  const unknown = selection.find((item) => !(item in knownTargets))
  if (unknown) throw new Error(`Seleção de limpeza desconhecida: ${unknown}`)
  for (const item of selection) {
    const target = knownTargets[item]
    assertSafeTarget(target)
    await rm(target, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const selection = process.argv.slice(2)
  await cleanBuildTargets(selection.length > 0 ? selection : undefined)
}
