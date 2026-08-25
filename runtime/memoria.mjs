import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const MEMORY_SCHEMA_VERSION = 3

const MAX_CONFIRMED = 500
const MAX_CANDIDATES = 100
const MEMORY_TYPES = new Set(['preference', 'episodic', 'semantic', 'procedural', 'objective', 'capability'])
const SCOPE_TYPES = new Set(['user', 'project', 'task', 'environment'])
const VALIDATION_STATUS = new Set(['pending', 'validated', 'confirmed'])

function memoriaVazia(agora = new Date().toISOString()) {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    store: {
      id: 'omni-local-memory',
      createdAt: agora,
      updatedAt: agora,
      lastMigrationAt: null
    },
    confirmed: [],
    candidates: []
  }
}

export function casaDoOmni(env = process.env) {
  if (env.OMNI_HOME) return resolve(env.OMNI_HOME)
  if (env.APPDATA) return join(env.APPDATA, 'omni')
  return join(homedir(), '.omni')
}

export function caminhoDaMemoria(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa da memória precisa ser um caminho absoluto.')
  return join(casa, 'memory', 'memory.json')
}

function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function pareceConterSegredo(texto) {
  const formatos = [
    /\bsk-(?:ant-)?[a-z0-9_-]{20,}\b/i,
    /\bgh[pousr]_[a-z0-9]{20,}\b/i,
    /\bAKIA[A-Z0-9]{16}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s@]+@/i
  ]
  if (formatos.some((padrao) => padrao.test(texto))) return true
  return /\b(?:senha|password|token|secret|api[_ -]?key|chave)\b\s*(?:é|e|:|=)\s*["']?[^\s,;"']{12,}/i.test(texto)
}

function registroValido(item, status) {
  const scopeValid =
    item?.scope &&
    SCOPE_TYPES.has(item.scope.type) &&
    (item.scope.type === 'user' || (typeof item.scope.id === 'string' && item.scope.id.length > 0))
  const projectValid =
    item?.scope?.type === 'project'
      ? item.projectId === item.scope.id
      : item?.projectId === null
  const dateOrNull = (value) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
  return Boolean(
    item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      item.text.length > 0 &&
      MEMORY_TYPES.has(item.type) &&
      item.status === status &&
      scopeValid &&
      projectValid &&
      typeof item.confidence === 'number' &&
      item.confidence >= 0 &&
      item.confidence <= 1 &&
      typeof item.importance === 'number' &&
      item.importance >= 0 &&
      item.importance <= 1 &&
      Number.isInteger(item.occurrences) &&
      item.occurrences >= 1 &&
      item.validation &&
      VALIDATION_STATUS.has(item.validation.status) &&
      Array.isArray(item.validation.reasons) &&
      item.validation.reasons.every((reason) => typeof reason === 'string') &&
      Array.isArray(item.evidence) &&
      item.evidence.length > 0 &&
      item.evidence.every(
        (evidence) =>
          typeof evidence?.kind === 'string' &&
          typeof evidence.recordedAt === 'string' &&
          Number.isFinite(Date.parse(evidence.recordedAt))
      ) &&
      typeof item.createdAt === 'string' &&
      Number.isFinite(Date.parse(item.createdAt)) &&
      typeof item.updatedAt === 'string' &&
      Number.isFinite(Date.parse(item.updatedAt)) &&
      dateOrNull(item.lastValidatedAt) &&
      Number.isInteger(item.usageCount) &&
      item.usageCount >= 0 &&
      dateOrNull(item.expiresAt)
  )
}

function storeValido(store) {
  return Boolean(
    store &&
      store.id === 'omni-local-memory' &&
      typeof store.createdAt === 'string' &&
      typeof store.updatedAt === 'string' &&
      (store.lastMigrationAt === null || typeof store.lastMigrationAt === 'string')
  )
}

function validarMemoria(memoria, arquivo) {
  if (
    memoria?.schemaVersion !== MEMORY_SCHEMA_VERSION ||
    !storeValido(memoria.store) ||
    !Array.isArray(memoria.confirmed) ||
    !Array.isArray(memoria.candidates) ||
    !memoria.confirmed.every((item) => registroValido(item, 'confirmed')) ||
    !memoria.candidates.every((item) => registroValido(item, 'candidate'))
  ) {
    throw new Error(`Memória fora do contrato v${MEMORY_SCHEMA_VERSION}: ${arquivo}`)
  }
}

function primeiroRegistro(memoria, fallback) {
  const timestamps = [...memoria.confirmed, ...memoria.candidates]
    .map((item) => item.createdAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
  return timestamps[0] ?? fallback
}

function importanciaPadrao(type) {
  if (type === 'procedural' || type === 'objective') return 0.8
  if (type === 'preference' || type === 'capability') return 0.7
  return 0.5
}

function enriquecerRegistroV3(item) {
  return {
    ...item,
    projectId: item.scope?.type === 'project' ? (item.scope.id ?? null) : null,
    importance: importanciaPadrao(item.type),
    occurrences: 1,
    validation: {
      status: item.status === 'confirmed' ? 'confirmed' : 'validated',
      reasons: ['migrated-to-v3']
    }
  }
}

function migrarMemoria(memoria, arquivo, agora = new Date().toISOString()) {
  if (!memoria || typeof memoria !== 'object') throw new Error(`Memória inválida: ${arquivo}`)
  if (memoria.schemaVersion > MEMORY_SCHEMA_VERSION) {
    throw new Error(`Memória v${memoria.schemaVersion} é mais nova que este plugin.`)
  }

  let atual = memoria
  const origem = atual.schemaVersion

  if (atual.schemaVersion === 1) {
    if (!Array.isArray(atual.confirmed) || !Array.isArray(atual.candidates)) {
      throw new Error(`Memória v1 incompleta: ${arquivo}`)
    }
    atual = {
      schemaVersion: 2,
      store: {
        id: 'omni-local-memory',
        createdAt: primeiroRegistro(atual, agora),
        updatedAt: agora,
        lastMigrationAt: agora
      },
      confirmed: atual.confirmed,
      candidates: atual.candidates
    }
  }

  if (atual.schemaVersion === 2) {
    atual = {
      ...atual,
      schemaVersion: 3,
      store: { ...atual.store, updatedAt: agora, lastMigrationAt: agora },
      confirmed: atual.confirmed.map(enriquecerRegistroV3),
      candidates: atual.candidates.map(enriquecerRegistroV3)
    }
  }

  validarMemoria(atual, arquivo)
  return { memory: atual, migratedFrom: origem < MEMORY_SCHEMA_VERSION ? origem : null }
}

async function carregarSemTrava(casa) {
  const arquivo = caminhoDaMemoria(casa)
  try {
    const original = JSON.parse(await readFile(arquivo, 'utf8'))
    const migrated = migrarMemoria(original, arquivo)
    return {
      memory: migrated.memory,
      result: migrated.migratedFrom === null ? 'ready' : 'migrated',
      migratedFrom: migrated.migratedFrom,
      changed: migrated.migratedFrom !== null
    }
  } catch (erro) {
    if (erro?.code === 'ENOENT') {
      return { memory: memoriaVazia(), result: 'initialized', migratedFrom: null, changed: true }
    }
    throw erro
  }
}

async function adquirirTrava(casa) {
  await mkdir(join(casa, 'memory'), { recursive: true })
  const trava = join(casa, 'memory', 'memory.lock')
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    try {
      const handle = await open(trava, 'wx')
      return async () => {
        await handle.close()
        await unlink(trava).catch(() => undefined)
      }
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro
      const idade = Date.now() - (await stat(trava).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (idade > 10_000) await unlink(trava).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('A memória está ocupada por outra escrita.')
}

async function gravar(casa, memoria) {
  const arquivo = caminhoDaMemoria(casa)
  const temporario = `${arquivo}.${process.pid}.novo`
  memoria.store.updatedAt = new Date().toISOString()
  validarMemoria(memoria, arquivo)
  await mkdir(join(casa, 'memory'), { recursive: true })
  await writeFile(temporario, `${JSON.stringify(memoria, null, 2)}\n`, 'utf8')
  await rename(temporario, arquivo)
}

export async function prepararMemoria(casa) {
  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    if (carregada.changed) await gravar(casa, carregada.memory)
    return {
      result: carregada.result,
      migratedFrom: carregada.migratedFrom,
      schemaVersion: carregada.memory.schemaVersion,
      memory: carregada.memory
    }
  } finally {
    await liberar()
  }
}

export async function lerMemoria(casa) {
  return (await prepararMemoria(casa)).memory
}

export async function registrarUsoMemorias(casa, ids) {
  const wanted = new Set(ids)
  if (!wanted.size) return { result: 'unchanged', updated: 0 }
  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    let updated = 0
    for (const memory of carregada.memory.confirmed) {
      if (!wanted.has(memory.id)) continue
      memory.usageCount += 1
      updated += 1
    }
    if (updated > 0 || carregada.changed) await gravar(casa, carregada.memory)
    return { result: updated > 0 ? 'updated' : 'unchanged', updated }
  } finally {
    await liberar()
  }
}

async function registrar(casa, entrada) {
  const text = entrada.text.trim()
  if (!text) return { result: 'ignored', memory: null }
  if (pareceConterSegredo(text)) {
    return { result: 'refused', memory: null, reason: 'possible-secret' }
  }

  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    const memoria = carregada.memory
    const key = `${entrada.scope.type}:${entrada.scope.id ?? ''}:${normalizar(text)}`
    const existente = [...memoria.confirmed, ...memoria.candidates].find(
      (item) => `${item.scope.type}:${item.scope.id ?? ''}:${normalizar(item.text)}` === key
    )
    if (existente) {
      const agora = new Date().toISOString()
      existente.occurrences += 1
      existente.updatedAt = agora
      existente.confidence = Math.min(1, Math.max(existente.confidence, entrada.confidence) + 0.03)
      existente.importance = Math.max(existente.importance, entrada.importance ?? 0.5)
      existente.evidence = [
        ...existente.evidence,
        { kind: entrada.evidenceKind, recordedAt: agora }
      ].slice(-20)

      if (entrada.status === 'confirmed' && existente.status === 'candidate') {
        memoria.candidates = memoria.candidates.filter((item) => item.id !== existente.id)
        existente.status = 'confirmed'
        existente.confidence = 1
        existente.lastValidatedAt = agora
        existente.validation = {
          status: 'confirmed',
          reasons: [...existente.validation.reasons, 'explicit-owner-confirmation']
        }
        memoria.confirmed = [...memoria.confirmed, existente].slice(-MAX_CONFIRMED)
        await gravar(casa, memoria)
        return { result: 'confirmed', memory: existente }
      }

      await gravar(casa, memoria)
      return { result: 'reinforced', memory: existente }
    }

    const agora = new Date().toISOString()
    const item = {
      id: `mem-${randomUUID()}`,
      type: entrada.type,
      scope: entrada.scope,
      text,
      source: entrada.source,
      status: entrada.status,
      confidence: entrada.confidence,
      importance: entrada.importance ?? importanciaPadrao(entrada.type),
      occurrences: 1,
      projectId: entrada.scope.type === 'project' ? (entrada.scope.id ?? null) : null,
      validation: entrada.validation ?? {
        status: entrada.status === 'confirmed' ? 'confirmed' : 'validated',
        reasons: []
      },
      evidence: [{ kind: entrada.evidenceKind, recordedAt: agora }],
      createdAt: agora,
      updatedAt: agora,
      lastValidatedAt: entrada.status === 'confirmed' ? agora : null,
      usageCount: 0,
      expiresAt: null
    }
    if (item.status === 'confirmed') {
      memoria.confirmed = [...memoria.confirmed, item].slice(-MAX_CONFIRMED)
    } else {
      memoria.candidates = [...memoria.candidates, item].slice(-MAX_CANDIDATES)
    }
    await gravar(casa, memoria)
    return { result: item.status, memory: item }
  } finally {
    await liberar()
  }
}

export function lembrarExplicitamente(casa, text, type = 'semantic', scope = { type: 'user' }) {
  return registrar(casa, {
    text,
    type,
    scope,
    source: 'explicit-plugin-command',
    status: 'confirmed',
    confidence: 1,
    importance: importanciaPadrao(type),
    validation: { status: 'confirmed', reasons: ['explicit-owner-request'] },
    evidenceKind: 'explicit-request'
  })
}

export function proporLicao(casa, text, scope = { type: 'user' }) {
  return registrar(casa, {
    text,
    type: 'procedural',
    scope,
    source: 'plugin-lesson',
    status: 'candidate',
    confidence: 0.6,
    importance: 0.8,
    validation: { status: 'validated', reasons: ['explicit-lesson-proposal'] },
    evidenceKind: 'lesson-proposal'
  })
}

export function registrarCandidataAnalisada(casa, analise) {
  return registrar(casa, {
    text: analise.text,
    type: analise.type,
    scope: analise.scope,
    source: analise.source,
    status: 'candidate',
    confidence: analise.confidence,
    importance: analise.importance,
    validation: { status: 'validated', reasons: analise.validationReasons },
    evidenceKind: analise.evidenceKind
  })
}

export async function decidirCandidata(casa, id, decision) {
  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    const memoria = carregada.memory
    const candidata = memoria.candidates.find((item) => item.id === id)
    if (!candidata) {
      if (carregada.changed) await gravar(casa, memoria)
      return { result: 'not-found', memory: null }
    }
    memoria.candidates = memoria.candidates.filter((item) => item.id !== id)
    if (decision === 'confirm') {
      const agora = new Date().toISOString()
      const confirmada = {
        ...candidata,
        status: 'confirmed',
        confidence: Math.max(0.9, candidata.confidence),
        updatedAt: agora,
        lastValidatedAt: agora,
        validation: {
          status: 'confirmed',
          reasons: [...candidata.validation.reasons, 'human-confirmation']
        },
        evidence: [...candidata.evidence, { kind: 'human-confirmation', recordedAt: agora }]
      }
      memoria.confirmed = [...memoria.confirmed, confirmada].slice(-MAX_CONFIRMED)
      await gravar(casa, memoria)
      return { result: 'confirmed', memory: confirmada }
    }
    await gravar(casa, memoria)
    return { result: 'discarded', memory: candidata }
  } finally {
    await liberar()
  }
}
