import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const cache = new Map()

function caminhoInterno(diretorio, contrato) {
  if (typeof contrato !== 'string' || !contrato.trim() || isAbsolute(contrato)) {
    throw new Error('Manifesto da personalidade declara contrato inválido.')
  }
  const caminho = resolve(diretorio, contrato)
  const trecho = relative(diretorio, caminho)
  if (!trecho || trecho === '..' || trecho.startsWith(`..${sep}`) || isAbsolute(trecho)) {
    throw new Error('Contrato da personalidade saiu do diretório permitido.')
  }
  if (extname(caminho).toLowerCase() !== '.md') {
    throw new Error('Contrato da personalidade precisa ser Markdown.')
  }
  return caminho
}

function extrairNucleo(markdown) {
  const bloco = markdown.match(/## Núcleo textual\s+```text\s*([\s\S]*?)```/i)
  if (!bloco) throw new Error('Núcleo textual da personalidade não encontrado.')
  return bloco[1].trim()
}

async function carregar(pluginRoot) {
  const diretorio = join(pluginRoot, 'contratos', 'personalidade')
  const manifesto = JSON.parse(await readFile(join(diretorio, 'manifest.json'), 'utf8'))
  if (
    manifesto?.schemaVersion !== 1 ||
    typeof manifesto.id !== 'string' ||
    !/^omni-persona-v\d+-candidate$/.test(manifesto.id)
  ) {
    throw new Error('Manifesto da personalidade é inválido.')
  }
  const contractPath = caminhoInterno(diretorio, manifesto.contract)
  const markdown = await readFile(contractPath, 'utf8')
  const nucleus = extrairNucleo(markdown)
  if (!nucleus.includes(`PERSONALIDADE ${manifesto.id}.`)) {
    throw new Error('Identidade do núcleo não corresponde ao manifesto.')
  }
  return { manifest: manifesto, markdown, nucleus }
}

export async function lerPersonalidadeAtiva({ pluginRoot = raiz, useCache = true } = {}) {
  if (!useCache) return carregar(pluginRoot)
  if (!cache.has(pluginRoot)) {
    cache.set(
      pluginRoot,
      carregar(pluginRoot).catch((error) => {
        cache.delete(pluginRoot)
        throw error
      })
    )
  }
  return cache.get(pluginRoot)
}
