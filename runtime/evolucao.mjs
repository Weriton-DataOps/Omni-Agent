import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { lerCicloOperacional, marcarMelhoriaOperacional } from './ciclo-operacional.mjs'
import { pareceConterSegredo } from './memoria.mjs'

const CONFIG_SCHEMA_VERSION = 1

const DESTINATIONS = {
  'operational-rule': ['contratos', 'operacao', 'regras-aprendidas.json', 'rules'],
  routing: ['contratos', 'operacao', 'regras-aprendidas.json', 'rules'],
  hook: ['contratos', 'operacao', 'regras-aprendidas.json', 'rules'],
  personality: ['contratos', 'operacao', 'regras-aprendidas.json', 'rules'],
  procedure: ['contratos', 'operacao', 'procedimentos-aprendidos.json', 'procedures'],
  capability: ['contratos', 'operacao', 'procedimentos-aprendidos.json', 'procedures'],
  eval: ['contratos', 'eval', 'casos-aprendidos.json', 'cases']
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

function artefato(candidate) {
  return {
    id: candidate.id,
    category: candidate.category,
    destination: candidate.destination,
    text: candidate.statement,
    evidence: {
      occurrences: candidate.occurrences,
      fingerprint: candidate.fingerprint
    },
    status: 'active',
    learnedAt: candidate.updatedAt
  }
}

export async function materializarMelhoriaOperacional(casa, id, repoRoot) {
  const root = await validarRepositorio(repoRoot)
  const cycle = await lerCicloOperacional(casa)
  const candidate = cycle.improvementCandidates.find((item) => item.id === id)
  if (!candidate) throw new Error(`Melhoria operacional inexistente: ${id}`)
  if (candidate.status !== 'ready') return { result: 'not-ready', candidate }
  if (pareceConterSegredo(candidate.statement)) throw new Error('Melhoria contem material sensivel.')
  const destination = DESTINATIONS[candidate.destination]
  if (!destination) return { result: 'local-only', candidate }
  const [directory, area, file, collection] = destination
  const path = join(root, directory, area, file)
  const document = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(document[collection])) throw new Error(`Artefato de destino invalido: ${path}`)
  if (!document[collection].some((item) => item.id === candidate.id)) {
    document[collection].push(artefato(candidate))
    const temporary = `${path}.${process.pid}.novo`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  }
  await marcarMelhoriaOperacional(casa, id, { status: 'materialized', artifact: path })
  return {
    result: 'materialized',
    candidateId: id,
    destination: candidate.destination,
    artifact: path,
    next: ['npm.cmd run check', 'npm.cmd test', 'review', 'version', 'commit', 'publish']
  }
}

export async function materializarMelhoriaConfigurada(casa, id) {
  const configuration = await lerRepositorioCanonico(casa)
  if (configuration.status !== 'configured') return { result: 'unconfigured', candidateId: id }
  return materializarMelhoriaOperacional(casa, id, configuration.sourceRepository)
}
