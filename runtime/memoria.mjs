import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const MEMORY_SCHEMA_VERSION = 4
export const MEMORY_GC_POLICY_VERSION = 1

const MAX_CANDIDATES = 100
const MEMORY_TYPES = new Set(['preference', 'episodic', 'semantic', 'procedural', 'objective', 'capability'])
const SCOPE_TYPES = new Set(['user', 'project', 'task', 'environment'])
const VALIDATION_STATUS = new Set(['pending', 'validated', 'confirmed'])
const ARCHIVE_ACTIONS = new Set([
  'expired',
  'stale-candidate',
  'capacity',
  'discarded',
  'obsolete',
  'updated',
  'consolidated'
])
const GC_CONTRACT = new URL('../contratos/memoria/garbage-collection.json', import.meta.url)

function memoriaVazia(agora = new Date().toISOString()) {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    store: {
      id: 'omni-local-memory',
      createdAt: agora,
      updatedAt: agora,
      lastMigrationAt: null,
      lastMaintenanceAt: null
    },
    confirmed: [],
    candidates: [],
    archive: []
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

function registroArquivadoValido(item) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('arc-') &&
      typeof item.memoryId === 'string' &&
      item.memoryId.startsWith('mem-') &&
      ARCHIVE_ACTIONS.has(item.action) &&
      typeof item.reason === 'string' &&
      item.reason.length > 0 &&
      typeof item.archivedAt === 'string' &&
      Number.isFinite(Date.parse(item.archivedAt)) &&
      (item.replacementId === null ||
        (typeof item.replacementId === 'string' && item.replacementId.startsWith('mem-'))) &&
      (registroValido(item.snapshot, 'confirmed') || registroValido(item.snapshot, 'candidate'))
  )
}

function storeValido(store) {
  return Boolean(
    store &&
      store.id === 'omni-local-memory' &&
      typeof store.createdAt === 'string' &&
      typeof store.updatedAt === 'string' &&
      (store.lastMigrationAt === null ||
        (typeof store.lastMigrationAt === 'string' && Number.isFinite(Date.parse(store.lastMigrationAt)))) &&
      (store.lastMaintenanceAt === null ||
        (typeof store.lastMaintenanceAt === 'string' && Number.isFinite(Date.parse(store.lastMaintenanceAt))))
  )
}

function validarMemoria(memoria, arquivo) {
  if (
    memoria?.schemaVersion !== MEMORY_SCHEMA_VERSION ||
    !storeValido(memoria.store) ||
    !Array.isArray(memoria.confirmed) ||
    !Array.isArray(memoria.candidates) ||
    !Array.isArray(memoria.archive) ||
    !memoria.confirmed.every((item) => registroValido(item, 'confirmed')) ||
    !memoria.candidates.every((item) => registroValido(item, 'candidate')) ||
    !memoria.archive.every(registroArquivadoValido)
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

  if (atual.schemaVersion === 3) {
    atual = {
      ...atual,
      schemaVersion: 4,
      store: {
        ...atual.store,
        updatedAt: agora,
        lastMigrationAt: agora,
        lastMaintenanceAt: null
      },
      archive: []
    }
  }

  validarMemoria(atual, arquivo)
  return { memory: atual, migratedFrom: origem < MEMORY_SCHEMA_VERSION ? origem : null }
}

async function lerPoliticaManutencao() {
  const policy = JSON.parse(await readFile(GC_CONTRACT, 'utf8'))
  if (
    policy?.schemaVersion !== MEMORY_GC_POLICY_VERSION ||
    policy.policy !== 'memory-gc-safe-v1' ||
    !Number.isFinite(policy.automaticIntervalHours) ||
    policy.automaticIntervalHours <= 0 ||
    policy.automatic?.archiveExpired !== true ||
    policy.confirmedMemory?.neverArchiveWithoutExplicitExpiryOrOwnerDecision !== true ||
    policy.archive?.preserveFullSnapshot !== true ||
    policy.archive?.automaticPermanentDeletion !== false ||
    policy.semanticConsolidation?.automaticMerge !== false
  ) {
    throw new Error('Política de manutenção da memória fora do contrato seguro v1.')
  }
  return policy
}

function chaveDeEscopo(item) {
  return `${item.scope.type}:${item.scope.id ?? ''}`
}

function arquivar(memoria, item, action, reason, archivedAt, replacementId = null) {
  memoria.archive.push({
    id: `arc-${randomUUID()}`,
    memoryId: item.id,
    action,
    reason,
    archivedAt,
    replacementId,
    snapshot: structuredClone(item)
  })
}

function retirarAtiva(memoria, id) {
  memoria.confirmed = memoria.confirmed.filter((item) => item.id !== id)
  memoria.candidates = memoria.candidates.filter((item) => item.id !== id)
}

function consolidarDuplicatasExatas(memoria, agora) {
  const groups = new Map()
  for (const item of [...memoria.confirmed, ...memoria.candidates]) {
    const key = `${chaveDeEscopo(item)}:${item.type}:${normalizar(item.text)}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const actions = []
  for (const items of groups.values()) {
    if (items.length < 2) continue
    const ordered = [...items].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'confirmed' ? -1 : 1
      return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    })
    const keeper = ordered[0]
    for (const duplicate of ordered.slice(1)) {
      keeper.occurrences += duplicate.occurrences
      keeper.usageCount += duplicate.usageCount
      keeper.confidence = Math.max(keeper.confidence, duplicate.confidence)
      keeper.importance = Math.max(keeper.importance, duplicate.importance)
      keeper.updatedAt = [keeper.updatedAt, duplicate.updatedAt].sort().at(-1)
      keeper.evidence = [...keeper.evidence, ...duplicate.evidence]
        .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
        .slice(-20)
      arquivar(memoria, duplicate, 'consolidated', 'exact-active-duplicate', agora, keeper.id)
      retirarAtiva(memoria, duplicate.id)
      actions.push({ memoryId: duplicate.id, action: 'consolidated', replacementId: keeper.id })
    }
  }
  return actions
}

function tokens(text) {
  return new Set(normalizar(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 2))
}

function similaridade(a, b) {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0
  const intersection = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size
  return intersection / union
}

function detectarPropostasConsolidacao(memoria, policy) {
  const active = [...memoria.confirmed, ...memoria.candidates]
  const proposals = []
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      const a = active[left]
      const b = active[right]
      if (a.type !== b.type || chaveDeEscopo(a) !== chaveDeEscopo(b)) continue
      if (normalizar(a.text) === normalizar(b.text)) continue
      const score = similaridade(a.text, b.text)
      if (score < policy.semanticConsolidation.similarityThreshold) continue
      proposals.push({
        memoryIds: [a.id, b.id],
        type: a.type,
        scope: a.scope,
        similarity: Math.round(score * 1000) / 1000,
        occurrences: a.occurrences + b.occurrences,
        requiresOwnerDecision: true
      })
    }
  }
  return proposals
    .sort((a, b) => b.similarity - a.similarity || b.occurrences - a.occurrences)
    .slice(0, policy.semanticConsolidation.maximumProposals)
}

function aplicarManutencaoAutomatica(memoria, policy, agora) {
  const nowMs = Date.parse(agora)
  const actions = []
  const active = [...memoria.confirmed, ...memoria.candidates]

  for (const item of active) {
    if (policy.automatic.archiveExpired && item.expiresAt !== null && Date.parse(item.expiresAt) <= nowMs) {
      arquivar(memoria, item, 'expired', 'explicit-expiration-reached', agora)
      retirarAtiva(memoria, item.id)
      actions.push({ memoryId: item.id, action: 'expired', replacementId: null })
    }
  }

  const stale = policy.automatic.staleCandidates
  if (stale.enabled) {
    const minimumAgeMs = stale.minimumAgeDays * 24 * 60 * 60 * 1000
    for (const item of [...memoria.candidates]) {
      if (
        nowMs - Date.parse(item.updatedAt) >= minimumAgeMs &&
        item.occurrences <= stale.maximumOccurrences &&
        item.importance <= stale.maximumImportance
      ) {
        arquivar(memoria, item, 'stale-candidate', 'old-low-signal-candidate', agora)
        retirarAtiva(memoria, item.id)
        actions.push({ memoryId: item.id, action: 'stale-candidate', replacementId: null })
      }
    }
  }

  if (policy.automatic.consolidateExactDuplicates) {
    actions.push(...consolidarDuplicatasExatas(memoria, agora))
  }
  return actions
}

function manutencaoVencida(memoria, policy, agora) {
  if (memoria.store.lastMaintenanceAt === null) return true
  const intervalMs = policy.automaticIntervalHours * 60 * 60 * 1000
  return Date.parse(agora) - Date.parse(memoria.store.lastMaintenanceAt) >= intervalMs
}

async function carregarSemTrava(casa) {
  const arquivo = caminhoDaMemoria(casa)
  try {
    const source = await readFile(arquivo, 'utf8')
    const original = JSON.parse(source)
    const migrated = migrarMemoria(original, arquivo)
    let migrationBackup = null
    if (migrated.migratedFrom !== null) {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '')
      migrationBackup = `${arquivo}.before-v${migrated.migratedFrom}-to-v${MEMORY_SCHEMA_VERSION}.${stamp}.backup`
      await writeFile(migrationBackup, source, { encoding: 'utf8', flag: 'wx' })
    }
    return {
      memory: migrated.memory,
      result: migrated.migratedFrom === null ? 'ready' : 'migrated',
      migratedFrom: migrated.migratedFrom,
      migrationBackup,
      changed: migrated.migratedFrom !== null
    }
  } catch (erro) {
    if (erro?.code === 'ENOENT') {
      return {
        memory: memoriaVazia(),
        result: 'initialized',
        migratedFrom: null,
        migrationBackup: null,
        changed: true
      }
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
    const agora = new Date().toISOString()
    const policy = await lerPoliticaManutencao()
    const maintenanceDue = manutencaoVencida(carregada.memory, policy, agora)
    const actions = maintenanceDue
      ? aplicarManutencaoAutomatica(carregada.memory, policy, agora)
      : []
    if (maintenanceDue) carregada.memory.store.lastMaintenanceAt = agora
    if (carregada.changed || maintenanceDue) await gravar(casa, carregada.memory)
    return {
      result: carregada.result,
      migratedFrom: carregada.migratedFrom,
      migrationBackupCreated: carregada.migrationBackup !== null,
      schemaVersion: carregada.memory.schemaVersion,
      maintenance: {
        policy: policy.policy,
        ran: maintenanceDue,
        actions
      },
      memory: carregada.memory
    }
  } finally {
    await liberar()
  }
}

export async function lerMemoria(casa) {
  return (await prepararMemoria(casa)).memory
}

export async function executarManutencaoMemoria(casa, { dryRun = false, now } = {}) {
  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    const policy = await lerPoliticaManutencao()
    const agora = now ? new Date(now).toISOString() : new Date().toISOString()
    const working = dryRun ? structuredClone(carregada.memory) : carregada.memory
    const actions = aplicarManutencaoAutomatica(working, policy, agora)
    const consolidationProposals = detectarPropostasConsolidacao(working, policy)
    if (!dryRun) {
      working.store.lastMaintenanceAt = agora
      await gravar(casa, working)
    }
    return {
      result: dryRun ? 'simulated' : 'maintained',
      policy: policy.policy,
      actions,
      consolidationProposals,
      counts: {
        confirmed: working.confirmed.length,
        candidates: working.candidates.length,
        archived: working.archive.length
      },
      permanentDeletions: 0
    }
  } finally {
    await liberar()
  }
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

function abrirEspacoParaCandidata(memoria, agora) {
  if (memoria.candidates.length < MAX_CANDIDATES) return null
  const selected = [...memoria.candidates].sort(
    (a, b) =>
      a.importance - b.importance ||
      a.occurrences - b.occurrences ||
      Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
  )[0]
  arquivar(memoria, selected, 'capacity', 'candidate-active-capacity-reached', agora)
  retirarAtiva(memoria, selected.id)
  return selected.id
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
        memoria.confirmed = [...memoria.confirmed, existente]
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
      memoria.confirmed = [...memoria.confirmed, item]
    } else {
      abrirEspacoParaCandidata(memoria, agora)
      memoria.candidates = [...memoria.candidates, item]
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

export function registrarMemoriaAnalisada(casa, analise) {
  const confirmada = analise.autoConfirm === true
  return registrar(casa, {
    text: analise.text,
    type: analise.type,
    scope: analise.scope,
    source: analise.source,
    status: confirmada ? 'confirmed' : 'candidate',
    confidence: confirmada ? Math.max(0.95, analise.confidence) : analise.confidence,
    importance: analise.importance,
    validation: {
      status: confirmada ? 'confirmed' : 'validated',
      reasons: analise.validationReasons
    },
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
      memoria.confirmed = [...memoria.confirmed, confirmada]
      await gravar(casa, memoria)
      return { result: 'confirmed', memory: confirmada }
    }
    const agora = new Date().toISOString()
    arquivar(memoria, candidata, 'discarded', 'explicit-owner-discard', agora)
    await gravar(casa, memoria)
    return { result: 'discarded', memory: candidata, archived: true }
  } finally {
    await liberar()
  }
}

export async function atualizarMemoria(casa, id, text) {
  const normalizedText = typeof text === 'string' ? text.trim() : ''
  if (!normalizedText) throw new Error('Informe o novo texto da memória.')
  if (normalizedText.length > 800) throw new Error('O novo texto da memória excede 800 caracteres.')
  if (pareceConterSegredo(normalizedText)) throw new Error('O novo texto parece conter segredo.')

  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    const memoria = carregada.memory
    const previous = [...memoria.confirmed, ...memoria.candidates].find((item) => item.id === id)
    if (!previous) return { result: 'not-found', memory: null }
    const agora = new Date().toISOString()
    const replacement = {
      ...previous,
      id: `mem-${randomUUID()}`,
      text: normalizedText,
      source: 'explicit-memory-update',
      confidence: previous.status === 'confirmed' ? 1 : previous.confidence,
      occurrences: 1,
      validation: {
        status: previous.status === 'confirmed' ? 'confirmed' : 'validated',
        reasons: [...previous.validation.reasons, 'explicit-owner-update']
      },
      evidence: [{ kind: 'explicit-owner-update', recordedAt: agora }],
      createdAt: agora,
      updatedAt: agora,
      lastValidatedAt: previous.status === 'confirmed' ? agora : previous.lastValidatedAt,
      usageCount: 0,
      expiresAt: previous.expiresAt
    }
    arquivar(memoria, previous, 'updated', 'explicit-owner-update', agora, replacement.id)
    retirarAtiva(memoria, previous.id)
    if (replacement.status === 'confirmed') memoria.confirmed.push(replacement)
    else {
      abrirEspacoParaCandidata(memoria, agora)
      memoria.candidates.push(replacement)
    }
    await gravar(casa, memoria)
    return { result: 'updated', previousId: previous.id, memory: replacement }
  } finally {
    await liberar()
  }
}

export async function marcarMemoriaObsoleta(casa, id, reason = 'explicit-owner-obsolete') {
  const normalizedReason = typeof reason === 'string' ? reason.trim() : ''
  if (!normalizedReason) throw new Error('Informe a razão da obsolescência.')
  if (normalizedReason.length > 240) throw new Error('A razão da obsolescência excede 240 caracteres.')
  if (pareceConterSegredo(normalizedReason)) throw new Error('A razão parece conter segredo.')
  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    const memoria = carregada.memory
    const item = [...memoria.confirmed, ...memoria.candidates].find((memory) => memory.id === id)
    if (!item) return { result: 'not-found', memory: null }
    const agora = new Date().toISOString()
    arquivar(memoria, item, 'obsolete', normalizedReason, agora)
    retirarAtiva(memoria, item.id)
    await gravar(casa, memoria)
    return { result: 'obsolete', memory: item, archived: true }
  } finally {
    await liberar()
  }
}

export async function consolidarMemorias(casa, ids, text, type = 'semantic') {
  const uniqueIds = [...new Set(Array.isArray(ids) ? ids : [])]
  const normalizedText = typeof text === 'string' ? text.trim() : ''
  if (uniqueIds.length < 2) throw new Error('A consolidação exige ao menos dois IDs distintos.')
  if (!normalizedText) throw new Error('Informe o texto canônico da consolidação.')
  if (normalizedText.length > 800) throw new Error('O texto consolidado excede 800 caracteres.')
  if (!['semantic', 'procedural'].includes(type)) {
    throw new Error('Consolidação só pode gerar memória semantic ou procedural.')
  }
  if (pareceConterSegredo(normalizedText)) throw new Error('O texto consolidado parece conter segredo.')

  const liberar = await adquirirTrava(casa)
  try {
    const carregada = await carregarSemTrava(casa)
    const memoria = carregada.memory
    const active = [...memoria.confirmed, ...memoria.candidates]
    const sources = uniqueIds.map((id) => active.find((item) => item.id === id)).filter(Boolean)
    if (sources.length !== uniqueIds.length) return { result: 'not-found', memory: null }
    const scopeKey = chaveDeEscopo(sources[0])
    if (!sources.every((item) => chaveDeEscopo(item) === scopeKey)) {
      throw new Error('Memórias de escopos diferentes não podem ser consolidadas.')
    }

    const agora = new Date().toISOString()
    const scope = structuredClone(sources[0].scope)
    const consolidated = {
      id: `mem-${randomUUID()}`,
      type,
      scope,
      projectId: scope.type === 'project' ? scope.id : null,
      text: normalizedText,
      source: 'explicit-memory-consolidation',
      status: 'confirmed',
      confidence: 1,
      importance: Math.max(...sources.map((item) => item.importance)),
      occurrences: sources.reduce((sum, item) => sum + item.occurrences, 0),
      validation: { status: 'confirmed', reasons: ['explicit-owner-consolidation'] },
      evidence: [{ kind: 'explicit-owner-consolidation', recordedAt: agora }],
      createdAt: agora,
      updatedAt: agora,
      lastValidatedAt: agora,
      usageCount: sources.reduce((sum, item) => sum + item.usageCount, 0),
      expiresAt: null
    }
    for (const source of sources) {
      arquivar(memoria, source, 'consolidated', 'explicit-owner-consolidation', agora, consolidated.id)
      retirarAtiva(memoria, source.id)
    }
    memoria.confirmed.push(consolidated)
    await gravar(casa, memoria)
    return { result: 'consolidated', sourceIds: uniqueIds, memory: consolidated }
  } finally {
    await liberar()
  }
}
