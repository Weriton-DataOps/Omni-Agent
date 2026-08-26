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
import { lerAtalhos, registrarObservacaoAtalho, validarAtalho } from './atalhos.mjs'
import {
  avaliarMelhoria,
  decidirMelhoria,
  lerAutoaperfeicoamento,
  promoverMelhoria,
  proporMelhoriaDeAtalho,
  proporMelhoriaDeFalha
} from './autoaperfeicoamento.mjs'
import {
  analisarPadraoFalha,
  avaliarPadraoFalha,
  lerFalhas,
  registrarFalha,
  testarCorrecaoFalha
} from './falhas.mjs'

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

function lerOpcoes(argumentos) {
  const options = {}
  const positionals = []
  for (let index = 0; index < argumentos.length; index += 1) {
    const part = argumentos[index]
    if (!part.startsWith('--')) {
      positionals.push(part)
      continue
    }
    const key = part.slice(2)
    if (key === 'falhou' || key === 'portavel') {
      options[key] = true
      continue
    }
    const value = argumentos[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`A opção --${key} exige um valor.`)
    options[key] = value
    index += 1
  }
  return { options, positionals }
}

function lerPassos(value, label) {
  if (!value) throw new Error(`Informe --${label} com etapas separadas por >.`)
  return value.split(/\s*(?:>|→)\s*/u).map((step) => step.trim()).filter(Boolean)
}

function resumirAtalho(item) {
  return {
    id: item.id,
    goal: item.goal,
    scope: item.scope,
    baselineSteps: item.baselineSteps,
    shortcutSteps: item.shortcutSteps,
    status: item.status,
    consecutiveSuccesses: item.consecutiveSuccesses,
    successCount: item.successCount,
    failureCount: item.failureCount,
    inconsistentCount: item.inconsistentCount,
    validation: item.validation
  }
}

function resumirMelhoria(item) {
  return {
    id: item.id,
    category: item.category,
    destination: item.destination,
    status: item.status,
    capability: item.draft.capability.name,
    evaluationPassed: item.evaluation?.passed ?? null,
    ownerDecision: item.approval?.decision ?? null,
    portable: item.approval?.portable ?? false,
    promotion: item.promotion?.status ?? null
  }
}

function resumirFalha(item) {
  return {
    id: item.id,
    agent: item.agent,
    action: item.action,
    failureClass: item.failureClass,
    status: item.status,
    occurrences: item.occurrences,
    analyzed: item.analysis !== null,
    fixTests: item.fixTests.length,
    successfulFixTests: item.fixTests.filter((test) => test.success && test.consistent).length,
    evaluationPassed: item.evaluation?.passed ?? null
  }
}

async function main() {
  if (action === 'estado') {
    const [memory, persona, version, shortcutStore, improvementStore, failureStore] = await Promise.all([
      lerMemoria(home),
      lerPersonalidadeAtiva({ pluginRoot: root }),
      verificarVersao({ casa: home, pluginRoot: root }),
      lerAtalhos(home),
      lerAutoaperfeicoamento(home),
      lerFalhas(home)
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
      learning: {
        shortcutSchemaVersion: shortcutStore.schemaVersion,
        observing: shortcutStore.shortcuts.filter((item) => item.status === 'observing').length,
        candidates: shortcutStore.shortcuts.filter((item) => item.status === 'candidate').length,
        validated: shortcutStore.shortcuts.filter((item) => item.status === 'validated').length,
        automaticPromotion: false
      },
      selfImprovement: {
        pipelineVersion: improvementStore.schemaVersion,
        drafts: improvementStore.proposals.filter((item) => item.status === 'draft').length,
        evaluated: improvementStore.proposals.filter((item) => item.status === 'evaluated').length,
        approved: improvementStore.proposals.filter((item) => item.status === 'approved').length,
        materialized: improvementStore.proposals.filter((item) => item.status === 'materialized-pending-version').length,
        automaticPromotion: false,
        automaticGitPush: false
      },
      failureLearning: {
        schemaVersion: failureStore.schemaVersion,
        observing: failureStore.patterns.filter((item) => item.status === 'observing').length,
        candidates: failureStore.patterns.filter((item) => item.status === 'candidate').length,
        underTest: failureStore.patterns.filter((item) => ['analyzed', 'testing', 'ready-for-eval'].includes(item.status)).length,
        evaluated: failureStore.patterns.filter((item) => item.status === 'evaluated').length,
        automaticGlobalRule: false,
        automaticPromotion: false
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
  if (action === 'atalhos') {
    const store = await lerAtalhos(home)
    return { ok: true, shortcuts: store.shortcuts.map(resumirAtalho), automaticPromotion: false }
  }
  if (action === 'atalho-observar') {
    const { options } = lerOpcoes(parts)
    const observation = await registrarObservacaoAtalho(home, {
      goal: options.objetivo,
      baselineSteps: lerPassos(options.base, 'base'),
      shortcutSteps: lerPassos(options.atalho, 'atalho'),
      outcome: options.resultado,
      success: options.falhou !== true,
      durationMs: options.duracao === undefined ? undefined : Number(options.duracao),
      scope: { type: 'user' }
    })
    return { ok: true, learning: { ...observation, shortcut: resumirAtalho(observation.shortcut) } }
  }
  if (action === 'atalho-validar') {
    const { options, positionals } = lerOpcoes(parts)
    const id = positionals[0]
    if (!id) throw new Error('Use: atalho-validar <id> --resultado <resultado verificado>.')
    const validation = await validarAtalho(home, id, {
      outcome: options.resultado,
      success: options.falhou !== true,
      durationMs: options.duracao === undefined ? undefined : Number(options.duracao)
    })
    let improvement = null
    if (validation.result === 'validated') {
      const proposed = await proporMelhoriaDeAtalho(home, validation.shortcut.id)
      improvement = proposed.proposal ? await avaliarMelhoria(home, proposed.proposal.id) : proposed
    }
    return {
      ok: true,
      learning: {
        ...validation,
        shortcut: validation.shortcut ? resumirAtalho(validation.shortcut) : null
      },
      selfImprovement: improvement?.proposal ? resumirMelhoria(improvement.proposal) : improvement
    }
  }
  if (action === 'melhorias') {
    const store = await lerAutoaperfeicoamento(home)
    return { ok: true, proposals: store.proposals.map(resumirMelhoria), automaticPromotion: false }
  }
  if (action === 'melhoria-propor') {
    if (!parts[0]) throw new Error('Use: melhoria-propor <id-do-atalho-validado>.')
    const proposal = await proporMelhoriaDeAtalho(home, parts[0])
    return { ok: true, improvement: proposal.proposal ? resumirMelhoria(proposal.proposal) : proposal }
  }
  if (action === 'melhoria-avaliar') {
    if (!parts[0]) throw new Error('Use: melhoria-avaliar <id>.')
    const evaluation = await avaliarMelhoria(home, parts[0])
    return { ok: true, improvement: evaluation.proposal ? resumirMelhoria(evaluation.proposal) : evaluation }
  }
  if (action === 'melhoria-aprovar' || action === 'melhoria-rejeitar') {
    const { options, positionals } = lerOpcoes(parts)
    const id = positionals[0]
    if (!id) throw new Error(`Use: ${action} <id>${action === 'melhoria-aprovar' ? ' --portavel' : ''}.`)
    const decision = await decidirMelhoria(
      home,
      id,
      action === 'melhoria-aprovar' ? 'approve' : 'reject',
      { portable: options.portavel === true }
    )
    return { ok: true, improvement: decision.proposal ? resumirMelhoria(decision.proposal) : decision }
  }
  if (action === 'melhoria-promover') {
    const { options, positionals } = lerOpcoes(parts)
    const id = positionals[0]
    if (!id || !options.repo) throw new Error('Use: melhoria-promover <id> --repo <caminho absoluto>.')
    const promotion = await promoverMelhoria(home, id, options.repo)
    return { ok: true, improvement: promotion.proposal ? resumirMelhoria(promotion.proposal) : promotion }
  }
  if (action === 'falhas') {
    const store = await lerFalhas(home)
    return { ok: true, patterns: store.patterns.map(resumirFalha), automaticGlobalRule: false }
  }
  if (action === 'falha-registrar') {
    const { options } = lerOpcoes(parts)
    const failure = await registrarFalha(home, {
      agent: options.agente,
      action: options.acao,
      failureClass: options.classe,
      signature: options.assinatura,
      evidenceId: options.execucao
    })
    return { ok: true, failure: failure.pattern ? resumirFalha(failure.pattern) : failure }
  }
  if (action === 'falha-analisar') {
    const { options, positionals } = lerOpcoes(parts)
    if (!positionals[0]) throw new Error('Use: falha-analisar <id> --causa <texto> --hipotese <texto>.')
    const analysis = await analisarPadraoFalha(home, positionals[0], {
      rootCause: options.causa,
      hypothesis: options.hipotese
    })
    return { ok: true, failure: analysis.pattern ? resumirFalha(analysis.pattern) : analysis }
  }
  if (action === 'falha-testar') {
    const { options, positionals } = lerOpcoes(parts)
    if (!positionals[0]) throw new Error('Use: falha-testar <id> --execucao <id> --resultado <texto> [--falhou].')
    const testResult = await testarCorrecaoFalha(home, positionals[0], {
      evidenceId: options.execucao,
      outcome: options.resultado,
      success: options.falhou !== true
    })
    return { ok: true, failure: testResult.pattern ? resumirFalha(testResult.pattern) : testResult }
  }
  if (action === 'falha-avaliar') {
    if (!parts[0]) throw new Error('Use: falha-avaliar <id>.')
    const evaluation = await avaliarPadraoFalha(home, parts[0])
    let improvement = null
    if (evaluation.result === 'passed') {
      const proposed = await proporMelhoriaDeFalha(home, evaluation.pattern.id)
      improvement = proposed.proposal ? await avaliarMelhoria(home, proposed.proposal.id) : proposed
    }
    return {
      ok: true,
      failure: evaluation.pattern ? resumirFalha(evaluation.pattern) : evaluation,
      selfImprovement: improvement?.proposal ? resumirMelhoria(improvement.proposal) : improvement
    }
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
