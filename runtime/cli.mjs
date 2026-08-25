import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { montarContexto } from './contexto.mjs'
import {
  casaDoOmni,
  decidirCandidata,
  lembrarExplicitamente,
  lerMemoria,
  proporLicao
} from './memoria.mjs'
import { processarExperiencia } from './pipeline-memoria.mjs'
import { verificarVersao } from './versao.mjs'
import { atualizarPlugin } from './atualizacao.mjs'
import { lerPersonalidadeAtiva } from './personalidade.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [action = 'estado', ...parts] = process.argv.slice(2)
const text = parts.join(' ').trim()
const home = casaDoOmni()

function memoryType(value) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(prefiro|preferencia|gosto|nao gosto)\b/.test(normalized)) return 'preference'
  if (/\b(objetivo|meta|quero chegar|estou construindo)\b/.test(normalized)) return 'objective'
  if (/\b(sempre que|procedimento|passo a passo|quando eu disser)\b/.test(normalized)) return 'procedural'
  if (/\b(aconteceu|ontem|hoje|na ultima vez)\b/.test(normalized)) return 'episodic'
  return 'semantic'
}

async function main() {
  if (action === 'estado') {
    const [memory, persona, version] = await Promise.all([
      lerMemoria(home),
      lerPersonalidadeAtiva({ pluginRoot: root }),
      verificarVersao({ casa: home, pluginRoot: root })
    ])
    return {
      ok: true,
      identity: {
        id: persona.manifest.id,
        name: persona.manifest.name,
        status: persona.manifest.status
      },
      memory: {
        schemaVersion: memory.schemaVersion,
        confirmed: memory.confirmed.length,
        candidates: memory.candidates.length
      },
      version,
      context: { schemaVersion: 2, retrieval: 'hybrid-local-v1', projections: ['fast', 'deep'] }
    }
  }
  if (action === 'personalidade') {
    const persona = await lerPersonalidadeAtiva({ pluginRoot: root })
    return {
      ok: true,
      personality: {
        id: persona.manifest.id,
        name: persona.manifest.name,
        status: persona.manifest.status,
        nucleus: persona.nucleus
      }
    }
  }
  if (action === 'atualizar') {
    return { ok: true, update: await atualizarPlugin({ casa: home, pluginRoot: root }) }
  }
  if (action === 'contexto') return { ok: true, context: await montarContexto(home, { intent: text }) }
  if (action === 'experiencia') {
    if (!text) throw new Error('Informe a experiência que deve ser analisada.')
    return { ok: true, pipeline: await processarExperiencia(home, text) }
  }
  if (action === 'candidatas') {
    const memory = await lerMemoria(home)
    return {
      ok: true,
      candidates: memory.candidates.map((item) => ({
        id: item.id,
        type: item.type,
        text: item.text,
        confidence: item.confidence,
        importance: item.importance,
        occurrences: item.occurrences
      }))
    }
  }
  if (action === 'lembrar') {
    if (!text) throw new Error('Informe o que deve ser lembrado.')
    return { ok: true, memory: await lembrarExplicitamente(home, text, memoryType(text)) }
  }
  if (action === 'licao') {
    if (!text) throw new Error('Informe a lição observada.')
    return { ok: true, memory: await proporLicao(home, text) }
  }
  if (action === 'confirmar' || action === 'descartar') {
    if (!text) throw new Error('Informe o id da memória candidata.')
    return { ok: true, memory: await decidirCandidata(home, text, action === 'confirmar' ? 'confirm' : 'discard') }
  }
  throw new Error(`Ação desconhecida: ${action}`)
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}
