import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { montarContexto } from './contexto.mjs'
import {
  atualizarMemoria,
  casaDoOmni,
  consolidarMemorias,
  decidirCandidata,
  executarManutencaoMemoria,
  lembrarExplicitamente,
  lerMemoria,
  marcarMemoriaObsoleta,
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
        candidates: memory.candidates.length,
        archived: memory.archive.length,
        lastMaintenanceAt: memory.store.lastMaintenanceAt
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
  if (action === 'arquivo') {
    const memory = await lerMemoria(home)
    return {
      ok: true,
      archived: memory.archive.map((item) => ({
        id: item.id,
        memoryId: item.memoryId,
        action: item.action,
        reason: item.reason,
        archivedAt: item.archivedAt,
        replacementId: item.replacementId
      }))
    }
  }
  if (action === 'manutencao') {
    return {
      ok: true,
      maintenance: await executarManutencaoMemoria(home, {
        dryRun: parts.includes('simular') || parts.includes('--dry-run')
      })
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
  if (action === 'atualizar-memoria') {
    const [id, ...contentParts] = parts
    const content = contentParts.filter((part) => part !== '--').join(' ').trim()
    if (!id || !content) throw new Error('Use: atualizar-memoria <id> <novo texto>.')
    return { ok: true, memory: await atualizarMemoria(home, id, content) }
  }
  if (action === 'obsoleta') {
    const [id, ...reasonParts] = parts
    if (!id) throw new Error('Use: obsoleta <id> [razão].')
    return {
      ok: true,
      memory: await marcarMemoriaObsoleta(home, id, reasonParts.join(' ').trim() || 'explicit-owner-obsolete')
    }
  }
  if (action === 'consolidar') {
    const [idsPart, ...contentParts] = parts
    const ids = idsPart?.split(',').map((id) => id.trim()).filter(Boolean) ?? []
    const content = contentParts.filter((part) => part !== '--').join(' ').trim()
    if (ids.length < 2 || !content) {
      throw new Error('Use: consolidar <id1,id2> <texto canônico>.')
    }
    return { ok: true, memory: await consolidarMemorias(home, ids, content) }
  }
  throw new Error(`Ação desconhecida: ${action}`)
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}
