import { pareceConterSegredo, registrarCandidataAnalisada } from './memoria.mjs'

export const MEMORY_WRITE_PIPELINE_VERSION = 1

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
  const bruto = typeof texto === 'string' ? texto.trim() : ''
  if (!bruto) return { result: 'discarded', reason: 'empty' }
  if (bruto.startsWith('/')) return { result: 'discarded', reason: 'command' }
  if (pareceConterSegredo(bruto)) return { result: 'refused', reason: 'possible-secret' }
  if (!escopoValido(scope)) return { result: 'discarded', reason: 'invalid-scope' }
  if (bruto.length > 4_000) return { result: 'discarded', reason: 'experience-too-long' }

  const units = bruto
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .map((unit) => unit.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const selected = units
    .map((unit) => ({ unit, signal: SINAIS.find((candidate) => candidate.pattern.test(normalizar(unit))) }))
    .find((candidate) => candidate.signal)
  if (!selected) return { result: 'discarded', reason: 'no-memory-signal' }

  const original = selected.unit
  const signal = selected.signal
  const normalized = normalizar(original)
  if (/\b(?:so nesta sessao|somente nesta sessao|so agora|hoje apenas|temporariamente)\b/.test(normalized)) {
    return { result: 'transient', reason: 'explicitly-transient' }
  }
  if (original.length < 12) return { result: 'discarded', reason: 'too-short' }
  if (original.length > 800) return { result: 'discarded', reason: 'too-long' }

  const specificity = Math.min(1, Math.max(0.35, original.length / 240))
  const score = arredondar(
    signal.confidence * 0.5 + signal.importance * 0.35 + specificity * 0.15
  )
  if (score < 0.6) return { result: 'discarded', reason: 'low-score', score }

  return {
    result: 'validated',
    text: original,
    type: signal.type,
    scope,
    confidence: arredondar(signal.confidence),
    importance: arredondar(signal.importance),
    score,
    source: 'user-prompt-pipeline-v1',
    evidenceKind: 'observed-user-signal',
    validationReasons: ['persistent-language-signal', `pipeline-score:${score.toFixed(2)}`]
  }
}

export async function processarExperiencia(casa, texto, options = {}) {
  const analysis = analisarExperiencia(texto, options)
  if (analysis.result !== 'validated') {
    return {
      result: analysis.result,
      reason: analysis.reason,
      score: analysis.score ?? null,
      classification: null,
      memory: null,
      pipelineVersion: MEMORY_WRITE_PIPELINE_VERSION
    }
  }

  const stored = await registrarCandidataAnalisada(casa, analysis)
  return {
    result: stored.result,
    reason: null,
    score: analysis.score,
    classification: analysis.type,
    memory: stored.memory,
    pipelineVersion: MEMORY_WRITE_PIPELINE_VERSION
  }
}
