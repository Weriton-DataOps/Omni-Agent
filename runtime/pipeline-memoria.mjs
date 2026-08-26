import { pareceConterSegredo, registrarMemoriaAnalisada } from './memoria.mjs'

export const MEMORY_WRITE_PIPELINE_VERSION = 2

const SINAIS = [
  {
    type: 'preference',
    pattern: /\b(?:eu\s+)?(?:prefiro|gosto de|nao gosto de|minha preferencia|quero que voce|me explique sempre)\b/,
    confidence: 0.9,
    importance: 0.75
  },
  {
    type: 'procedural',
    pattern: /\b(?:sempre que|quando eu disser|de agora em diante|da proxima vez|o procedimento|passo a passo)\b/,
    confidence: 0.85,
    importance: 0.85
  },
  {
    type: 'objective',
    pattern: /\b(?:meu objetivo|minha meta|quero construir|estou construindo|quero chegar)\b/,
    confidence: 0.82,
    importance: 0.85
  },
  {
    type: 'capability',
    pattern: /\b(?:agora voce consegue|voce aprendeu a|funcionou quando|passou a conseguir)\b/,
    confidence: 0.72,
    importance: 0.75
  },
  {
    type: 'semantic',
    pattern: /\b(?:aprendi que|descobri que|fica definido que|lembre que|a regra e)\b/,
    confidence: 0.76,
    importance: 0.7
  },
  {
    type: 'episodic',
    pattern: /\b(?:percebi que|na ultima vez|aconteceu quando|ontem funcionou)\b/,
    confidence: 0.65,
    importance: 0.55
  }
]

function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function arredondar(valor) {
  return Math.round(valor * 100) / 100
}

function escopoValido(scope) {
  return Boolean(
    scope &&
      ['user', 'project', 'task', 'environment'].includes(scope.type) &&
      (scope.type === 'user' || (typeof scope.id === 'string' && scope.id.trim()))
  )
}

export function analisarExperiencia(texto, { scope = { type: 'user' } } = {}) {
  return analisarExperiencias(texto, { scope })[0] ?? { result: 'discarded', reason: 'no-memory-signal' }
}

export function analisarExperiencias(texto, { scope = { type: 'user' } } = {}) {
  const bruto = typeof texto === 'string' ? texto.trim() : ''
  if (!bruto) return [{ result: 'discarded', reason: 'empty' }]
  if (bruto.startsWith('/')) return [{ result: 'discarded', reason: 'command' }]
  if (pareceConterSegredo(bruto)) return [{ result: 'refused', reason: 'possible-secret' }]
  if (!escopoValido(scope)) return [{ result: 'discarded', reason: 'invalid-scope' }]
  if (bruto.length > 4_000) return [{ result: 'discarded', reason: 'experience-too-long' }]

  const units = bruto
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .map((unit) => unit.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const analyses = units.flatMap((original) => {
    const normalized = normalizar(original)
    const signal = SINAIS.find((candidate) => candidate.pattern.test(normalized))
    if (!signal) return []
    if (/\b(?:so nesta sessao|somente nesta sessao|so agora|hoje apenas|temporariamente)\b/.test(normalized)) {
      return [{ result: 'transient', reason: 'explicitly-transient' }]
    }
    if (original.length < 12 || original.length > 800) return []

    const specificity = Math.min(1, Math.max(0.35, original.length / 240))
    const score = arredondar(signal.confidence * 0.5 + signal.importance * 0.35 + specificity * 0.15)
    if (score < 0.6) return []
    const explicitDeclaration = /\b(?:lembre|guarde|registre|fica definido|de agora em diante|sempre que|quando eu disser|prefiro|quero que voce|me explique sempre)\b/.test(normalized)
    return [{
      result: 'validated',
      text: original,
      type: signal.type,
      scope,
      confidence: arredondar(signal.confidence),
      importance: arredondar(signal.importance),
      score,
      autoConfirm: explicitDeclaration && score >= 0.72,
      source: 'user-prompt-pipeline-v2',
      evidenceKind: explicitDeclaration ? 'owner-declaration' : 'observed-user-signal',
      validationReasons: [
        'persistent-language-signal',
        `pipeline-score:${score.toFixed(2)}`,
        ...(explicitDeclaration ? ['owner-declaration-auto-confirmed'] : [])
      ]
    }]
  })
  return analyses.length ? analyses : [{ result: 'discarded', reason: 'no-memory-signal' }]
}

export async function processarExperiencia(casa, texto, options = {}) {
  const analyses = analisarExperiencias(texto, options)
  const valid = analyses.filter((analysis) => analysis.result === 'validated')
  if (!valid.length) {
    const analysis = analyses[0]
    return {
      result: analysis.result,
      reason: analysis.reason,
      score: analysis.score ?? null,
      classification: null,
      memory: null,
      pipelineVersion: MEMORY_WRITE_PIPELINE_VERSION
    }
  }

  const stored = []
  for (const analysis of valid) stored.push(await registrarMemoriaAnalisada(casa, analysis))
  return {
    result: stored.some((item) => item.result === 'confirmed') ? 'confirmed' : stored[0].result,
    reason: null,
    score: valid[0].score,
    classification: valid[0].type,
    classifications: valid.map((item) => item.type),
    memory: stored[0].memory,
    memories: stored.map((item) => item.memory),
    pipelineVersion: MEMORY_WRITE_PIPELINE_VERSION
  }
}
