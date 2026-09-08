import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'
import {
  SELF_REPAIR_PROFILES,
  summarizeSelfRepairRun
} from '../dist/core/repair/self-repair-run.js'

const SCHEMA_VERSION = 2
const LEGACY_SCHEMA_VERSION = 1
const MAXIMUM_RUNS = 100
const EVENTS = new Set(['SessionStart', 'Stop'])
const PROFILES = new Set(Object.keys(SELF_REPAIR_PROFILES))
const KNOWN_STAGES = new Set(Object.values(SELF_REPAIR_PROFILES).flat())
const HASH = /^[a-f0-9]{64}$/
const RUN_ID = /^self-repair-run-[a-z0-9-]{8,80}$/

function now(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validPrivacy(value) {
  return value?.rawConversationStored === false &&
    value?.rawToolDataStored === false &&
    value?.rawPathsStored === false &&
    value?.rawErrorsStored === false
}

function privacy() {
  return {
    rawConversationStored: false,
    rawToolDataStored: false,
    rawPathsStored: false,
    rawErrorsStored: false
  }
}

function validStagePayload(item, { allowLegacyUnknown = false } = {}) {
  const known = KNOWN_STAGES.has(item?.stage) || (allowLegacyUnknown && item?.stage === 'legacy-unknown')
  return Boolean(
    item &&
    known &&
    ['fulfilled', 'rejected'].includes(item.status) &&
    (
      item.status === 'fulfilled'
        ? HASH.test(item.resultFingerprint ?? '') && item.errorFingerprint === undefined
        : HASH.test(item.errorFingerprint ?? '') && item.resultFingerprint === undefined
    )
  )
}

function normalizedStage(item, { legacy = false } = {}) {
  const stage = KNOWN_STAGES.has(item.stage) ? item.stage : legacy ? 'legacy-unknown' : item.stage
  return item.status === 'fulfilled'
    ? { stage, status: 'fulfilled', resultFingerprint: item.resultFingerprint }
    : { stage, status: 'rejected', errorFingerprint: item.errorFingerprint }
}

function normalizeProfileRun(run) {
  if (
    !RUN_ID.test(run?.id ?? '') ||
    !PROFILES.has(run?.profile) ||
    !EVENTS.has(run?.event) ||
    !validDate(run?.executedAt) ||
    !Array.isArray(run?.stages) ||
    !run.stages.every((item) => validStagePayload(item)) ||
    !validPrivacy(run?.privacy)
  ) throw new Error('Rodada classificada de autocorrecao fora do contrato v2.')

  const summary = summarizeSelfRepairRun(
    run.profile,
    run.stages.map(({ stage, status }) => ({ stage, status }))
  )
  const byStage = new Map(run.stages.map((item) => [item.stage, item]))
  const stages = SELF_REPAIR_PROFILES[run.profile].map((stage) => normalizedStage(byStage.get(stage)))
  return {
    id: run.id,
    profile: summary.profile,
    event: run.event,
    executedAt: run.executedAt,
    status: summary.status,
    completedStages: summary.completedStages,
    failedStages: summary.failedStages,
    stages,
    privacy: privacy()
  }
}

function normalizeLegacyRun(run) {
  if (
    !RUN_ID.test(run?.id ?? '') ||
    run?.profile !== 'legacy-unclassified' ||
    !EVENTS.has(run?.event) ||
    !validDate(run?.executedAt) ||
    !Array.isArray(run?.stages) ||
    !run.stages.every((item) => validStagePayload(item, { allowLegacyUnknown: true })) ||
    !validPrivacy(run?.privacy)
  ) throw new Error('Rodada legada de autocorrecao fora do contrato v2.')

  const stages = run.stages.map((item) => normalizedStage(item, { legacy: true }))
  const completedStages = stages.filter((item) => item.status === 'fulfilled').length
  const failedStages = stages.length - completedStages
  return {
    id: run.id,
    profile: 'legacy-unclassified',
    event: run.event,
    executedAt: run.executedAt,
    status: 'legacy-unclassified',
    completedStages,
    failedStages,
    stages,
    migration: {
      sourceSchemaVersion: LEGACY_SCHEMA_VERSION,
      reason: 'profile-unclassifiable'
    },
    privacy: privacy()
  }
}

function emptyStore(at = now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    store: { id: 'omni-local-self-repair-telemetry', createdAt: at, updatedAt: at },
    runs: [],
    legacyRuns: []
  }
}

function normalizeV2Store(value, at = now()) {
  if (
    value?.schemaVersion !== SCHEMA_VERSION ||
    value.store?.id !== 'omni-local-self-repair-telemetry' ||
    !validDate(value.store?.createdAt) ||
    !validDate(value.store?.updatedAt) ||
    !Array.isArray(value.runs) ||
    !Array.isArray(value.legacyRuns)
  ) throw new Error('Telemetria de autocorrecao fora do contrato v2.')

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    store: {
      id: 'omni-local-self-repair-telemetry',
      createdAt: value.store.createdAt,
      updatedAt: value.store.updatedAt
    },
    runs: value.runs.slice(-MAXIMUM_RUNS).map(normalizeProfileRun),
    legacyRuns: value.legacyRuns.slice(-MAXIMUM_RUNS).map(normalizeLegacyRun)
  }
  const changed = JSON.stringify(normalized) !== JSON.stringify(value)
  if (changed) normalized.store.updatedAt = at
  return { store: normalized, changed }
}

function validV1Stage(item) {
  return Boolean(
    item &&
    typeof item.stage === 'string' &&
    ['fulfilled', 'rejected'].includes(item.status) &&
    (item.status !== 'fulfilled' || HASH.test(item.resultFingerprint ?? '')) &&
    (item.status !== 'rejected' || HASH.test(item.errorFingerprint ?? ''))
  )
}

function validV1Run(run) {
  return Boolean(
    typeof run?.id === 'string' && run.id.startsWith('self-repair-run-') &&
    EVENTS.has(run.event) &&
    validDate(run.executedAt) &&
    ['healthy', 'degraded'].includes(run.status) &&
    Number.isInteger(run.completedStages) && run.completedStages >= 0 &&
    Number.isInteger(run.failedStages) && run.failedStages >= 0 &&
    Array.isArray(run.stages) && run.stages.every(validV1Stage) &&
    validPrivacy(run.privacy)
  )
}

function safeMigratedRunId(value) {
  return RUN_ID.test(value ?? '')
    ? value
    : `self-repair-run-legacy-${hash(value).slice(0, 24)}`
}

function inferProfile(stages) {
  if (!Array.isArray(stages)) return null
  const ids = stages.map((item) => item.stage)
  if (ids.some((id) => !KNOWN_STAGES.has(id)) || new Set(ids).size !== ids.length) return null
  for (const [profile, expected] of Object.entries(SELF_REPAIR_PROFILES)) {
    if (ids.length === expected.length && expected.every((stage) => ids.includes(stage))) return profile
  }
  return null
}

function migrateV1Run(run) {
  const profile = inferProfile(run.stages)
  const migrated = {
    id: safeMigratedRunId(run.id),
    profile: profile ?? 'legacy-unclassified',
    event: run.event,
    executedAt: run.executedAt,
    stages: run.stages.map((item) => normalizedStage(item, { legacy: profile === null })),
    privacy: privacy()
  }
  return profile === null
    ? normalizeLegacyRun(migrated)
    : normalizeProfileRun(migrated)
}

function migrateV1Store(value, at = now()) {
  if (
    value?.schemaVersion !== LEGACY_SCHEMA_VERSION ||
    value.store?.id !== 'omni-local-self-repair-telemetry' ||
    !validDate(value.store?.createdAt) ||
    !validDate(value.store?.updatedAt) ||
    !Array.isArray(value.runs) ||
    !value.runs.every(validV1Run)
  ) throw new Error('Telemetria legada de autocorrecao fora do contrato v1.')

  const classified = []
  const legacy = []
  for (const run of value.runs) {
    const migrated = migrateV1Run(run)
    if (migrated.profile === 'legacy-unclassified') legacy.push(migrated)
    else classified.push(migrated)
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    store: {
      id: 'omni-local-self-repair-telemetry',
      createdAt: value.store.createdAt,
      updatedAt: at
    },
    runs: classified.slice(-MAXIMUM_RUNS),
    legacyRuns: legacy.slice(-MAXIMUM_RUNS)
  }
}

export function caminhoDaTelemetriaAutocorrecao(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa do Omni precisa usar caminho absoluto.')
  return join(casa, 'audits', 'self-repair-runs.json')
}

async function persist(path, store) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, path)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function quarantineAndReplace(path, reason, at = now()) {
  await mkdir(dirname(path), { recursive: true })
  const safeTimestamp = at.replace(/[:.]/g, '-')
  const quarantine = `${path}.quarantine-${reason}-${safeTimestamp}-${randomUUID()}`
  try {
    await rename(path, quarantine)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const replacement = emptyStore(at)
  await persist(path, replacement)
  return replacement
}

function quarantineReason(value, error) {
  if (value?.schemaVersion > SCHEMA_VERSION) return 'future-schema'
  if (value?.schemaVersion === LEGACY_SCHEMA_VERSION) return 'invalid-v1'
  if (value?.schemaVersion === SCHEMA_VERSION) return 'invalid-v2'
  return error instanceof SyntaxError ? 'invalid-json' : 'unsupported-schema'
}

async function loadUnderLock(casa, { at = now() } = {}) {
  const path = caminhoDaTelemetriaAutocorrecao(casa)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore(at)
    throw error
  }

  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    return quarantineAndReplace(path, quarantineReason(null, error), at)
  }

  if (value?.schemaVersion === LEGACY_SCHEMA_VERSION) {
    let migrated
    try {
      migrated = migrateV1Store(value, at)
    } catch (error) {
      return quarantineAndReplace(path, quarantineReason(value, error), at)
    }
    await persist(path, migrated)
    return migrated
  }
  if (value?.schemaVersion === SCHEMA_VERSION) {
    let normalized
    try {
      normalized = normalizeV2Store(value, at)
    } catch (error) {
      return quarantineAndReplace(path, quarantineReason(value, error), at)
    }
    if (normalized.changed) await persist(path, normalized.store)
    return normalized.store
  }
  return quarantineAndReplace(path, quarantineReason(value), at)
}

async function safeReadOnlySnapshot(casa, at = now()) {
  const path = caminhoDaTelemetriaAutocorrecao(casa)
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (value?.schemaVersion === LEGACY_SCHEMA_VERSION) return migrateV1Store(value, at)
    if (value?.schemaVersion === SCHEMA_VERSION) return normalizeV2Store(value, at).store
    return emptyStore(at)
  } catch {
    return emptyStore(at)
  }
}

async function lock(casa) {
  const path = join(casa, 'audits', 'self-repair-runs.lock')
  return acquireLocalFileLock(path, {
    acquisitionTimeoutMs: 2_000,
    retryDelayMs: 25,
    staleLockMs: 30_000,
    heartbeatMs: 5_000,
    timeoutMessage: 'A telemetria de autocorrecao esta ocupada por outra escrita.'
  })
}

export async function lerTelemetriaAutocorrecao(casa) {
  let held
  try {
    held = await lock(casa)
  } catch (error) {
    if (error?.name === 'LocalJsonLockTimeoutError') return safeReadOnlySnapshot(casa)
    throw error
  }
  try {
    return await loadUnderLock(casa)
  } finally {
    await held.release()
  }
}

export async function registrarTelemetriaAutocorrecao(casa, {
  profile,
  event,
  stages,
  at
} = {}) {
  if (!PROFILES.has(profile)) throw new Error('Perfil de autocorrecao fora do contrato.')
  if (!EVENTS.has(event)) throw new Error('Evento de autocorrecao fora do contrato.')
  if (!Array.isArray(stages)) throw new Error('Etapas de autocorrecao precisam ser uma lista.')
  const timestamp = now(at)
  const run = normalizeProfileRun({
    id: `self-repair-run-${randomUUID()}`,
    profile,
    event,
    executedAt: timestamp,
    stages,
    privacy: privacy()
  })
  const held = await lock(casa)
  try {
    const path = caminhoDaTelemetriaAutocorrecao(casa)
    const store = await loadUnderLock(casa, { at: timestamp })
    store.runs.push(run)
    store.runs = store.runs.slice(-MAXIMUM_RUNS)
    store.store.updatedAt = timestamp
    const normalized = normalizeV2Store(store, timestamp).store
    await persist(path, normalized)
    return run
  } finally {
    await held.release()
  }
}
