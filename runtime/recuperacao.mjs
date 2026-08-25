import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const contratoPath = join(raiz, 'contratos', 'contexto', 'recuperacao.json')
let contratoPromise

function limitar(value) {
  return Math.max(0, Math.min(1, value))
}

function normalizar(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function radical(token) {
  if (token.length < 5) return token
  const suffixes = [
    'amentos', 'imentos', 'amento', 'imento', 'adoras', 'adores', 'ando', 'endo', 'indo',
    'ções', 'coes', 'ção', 'cao', 'mente', 'idades', 'idade', 'ismos', 'istas', 'osos', 'osas',
    'ado', 'ada', 'idos', 'idas', 'ico', 'ica', 'icos', 'icas', 'ar', 'er', 'ir', 'es', 's'
  ]
  const suffix = suffixes.find((item) => token.endsWith(item) && token.length - item.length >= 3)
  return suffix ? token.slice(0, -suffix.length) : token
}

function tokens(value) {
  return new Set(
    normalizar(value)
      .split(' ')
      .filter((token) => token.length >= 3)
      .map(radical)
  )
}

function conceitos(value, contrato) {
  const text = ` ${normalizar(value)} `
  const valueTokens = tokens(value)
  const result = new Set()
  for (const concept of contrato.concepts) {
    const found = concept.terms.some((term) => {
      const normalizedTerm = normalizar(term)
      if (normalizedTerm.includes(' ')) return text.includes(` ${normalizedTerm} `)
      return valueTokens.has(radical(normalizedTerm))
    })
    if (found) result.add(concept.id)
  }
  return result
}

function similaridadeConjuntos(left, right) {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const item of left) if (right.has(item)) intersection += 1
  return intersection / Math.sqrt(left.size * right.size)
}

function bigramas(value) {
  const result = new Set()
  const padded = ` ${value} `
  for (let index = 0; index < padded.length - 1; index += 1) {
    result.add(padded.slice(index, index + 2))
  }
  return result
}

function dice(left, right) {
  if (left === right) return 1
  const a = bigramas(left)
  const b = bigramas(right)
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const item of a) if (b.has(item)) intersection += 1
  return (2 * intersection) / (a.size + b.size)
}

function similaridadeFuzzy(queryTokens, memoryTokens) {
  if (!queryTokens.size || !memoryTokens.size) return 0
  let total = 0
  for (const query of queryTokens) {
    let best = 0
    for (const memory of memoryTokens) best = Math.max(best, dice(query, memory))
    if (best >= 0.72) total += best
  }
  return total / queryTokens.size
}

function tiposDaIntencao(intent) {
  const text = normalizar(intent)
  const result = new Set()
  if (/\b(pref|gost|estilo|formato|explic|respost)\w*/.test(text)) result.add('preference')
  if (/\b(como|passo|proced|process|rotina|verbo)\w*/.test(text)) result.add('procedural')
  if (/\b(objetiv|meta|resultado|constru|chegar)\w*/.test(text)) result.add('objective')
  if (/\b(acontec|ontem|hoje|ultima|quando)\w*/.test(text)) result.add('episodic')
  if (/\b(capacidad|ferrament|consegue|pode fazer)\w*/.test(text)) result.add('capability')
  return result
}

function contextoScore(memory, intentTypes) {
  if (!intentTypes.size) return 0.25
  return intentTypes.has(memory.type) ? 1 : 0
}

function escopoScore(memory, current) {
  if (memory.scope.type === 'user') return { eligible: true, score: 0.65 }
  const ids = {
    project: current.projectId,
    task: current.taskId,
    environment: current.environmentId
  }
  const currentId = ids[memory.scope.type]
  return currentId && memory.scope.id === currentId
    ? { eligible: true, score: 1 }
    : { eligible: false, score: 0 }
}

function recenciaScore(memory, now, halfLifeDays) {
  const timestamp = Date.parse(memory.lastValidatedAt ?? memory.updatedAt)
  if (!Number.isFinite(timestamp)) return 0
  const days = Math.max(0, (now - timestamp) / 86_400_000)
  return Math.exp((-Math.log(2) * days) / halfLifeDays)
}

function frequenciaScore(memory, saturation) {
  return 1 - Math.exp(-(memory.occurrences + memory.usageCount) / saturation)
}

function validarContrato(contract) {
  const weightNames = [
    'semantic', 'lexical', 'scope', 'recency', 'frequency', 'confidence', 'importance', 'context'
  ]
  const weightTotal = Object.values(contract?.weights ?? {}).reduce((sum, value) => sum + value, 0)
  if (
    contract?.schemaVersion !== 1 ||
    contract.algorithm !== 'hybrid-local-v1' ||
    !Array.isArray(contract.concepts) ||
    !contract.concepts.every(
      (concept) =>
        typeof concept?.id === 'string' &&
        Array.isArray(concept.terms) &&
        concept.terms.length > 0 &&
        concept.terms.every((term) => typeof term === 'string' && term.trim())
    ) ||
    !weightNames.every(
      (name) => typeof contract.weights?.[name] === 'number' && contract.weights[name] >= 0
    ) ||
    !Number.isInteger(contract.limits?.fast) ||
    !Number.isInteger(contract.limits?.deep) ||
    contract.limits.fast < 1 ||
    contract.limits.deep < contract.limits.fast ||
    typeof contract.minimumIntentMatch !== 'number' ||
    contract.minimumIntentMatch < 0 ||
    contract.minimumIntentMatch > 1 ||
    !(contract.recencyHalfLifeDays > 0) ||
    !(contract.frequencySaturation > 0) ||
    Math.abs(weightTotal - 1) > 1e-9
  ) {
    throw new Error('Contrato de recuperação de memória inválido.')
  }
  return contract
}

export async function lerContratoRecuperacao() {
  contratoPromise ??= readFile(contratoPath, 'utf8').then(JSON.parse).then(validarContrato)
  return contratoPromise
}

function arredondar(value) {
  return Number(value.toFixed(6))
}

export async function ranquearMemorias(memories, {
  intent = '',
  projectId,
  taskId,
  environmentId,
  now = Date.now(),
  contract
} = {}) {
  const config = contract ? validarContrato(contract) : await lerContratoRecuperacao()
  const queryTokens = tokens(intent)
  const queryConcepts = conceitos(intent, config)
  const intentTypes = tiposDaIntencao(intent)
  const ranked = []
  const excluded = []

  for (const memory of memories) {
    if (memory.expiresAt !== null && Date.parse(memory.expiresAt) <= now) {
      excluded.push({ id: memory.id, reason: 'expired' })
      continue
    }
    const scope = escopoScore(memory, { projectId, taskId, environmentId })
    if (!scope.eligible) {
      excluded.push({ id: memory.id, reason: 'scope-mismatch' })
      continue
    }

    const memoryTokens = tokens(memory.text)
    const lexical = similaridadeConjuntos(queryTokens, memoryTokens)
    const conceptSimilarity = similaridadeConjuntos(queryConcepts, conceitos(memory.text, config))
    const semantic = Math.max(conceptSimilarity, similaridadeFuzzy(queryTokens, memoryTokens))
    const context = contextoScore(memory, intentTypes)
    const intentMatch = semantic * 0.6 + lexical * 0.25 + context * 0.15
    if (!normalizar(intent) || intentMatch < config.minimumIntentMatch) {
      excluded.push({ id: memory.id, reason: 'below-intent-threshold' })
      continue
    }

    const components = {
      semantic,
      lexical,
      scope: scope.score,
      recency: recenciaScore(memory, now, config.recencyHalfLifeDays),
      frequency: frequenciaScore(memory, config.frequencySaturation),
      confidence: limitar(memory.confidence),
      importance: limitar(memory.importance),
      context
    }
    const score = Object.entries(config.weights).reduce(
      (sum, [name, weight]) => sum + components[name] * weight,
      0
    )
    ranked.push({
      memory,
      score: arredondar(score),
      intentMatch: arredondar(intentMatch),
      components: Object.fromEntries(
        Object.entries(components).map(([name, value]) => [name, arredondar(value)])
      )
    })
  }

  ranked.sort((left, right) => right.score - left.score || left.memory.id.localeCompare(right.memory.id))
  return {
    schemaVersion: 1,
    algorithm: config.algorithm,
    limits: config.limits,
    considered: memories.length,
    eligible: ranked.length,
    ranked,
    excluded
  }
}
