import { connect } from 'node:net'

import { parseCredentialMetadata } from '../../contracts/credential-metadata.js'
import type { CredentialMetadata, CredentialObservation } from '../../core/access/credential.js'
import type { AccessBrokerClient } from '../../ports/access-broker-client.js'
import type { DurableMemoryClient, DurableMemoryEntry } from '../../ports/durable-memory-client.js'
import type { DurableOperationalLearningClient, DurableOperationalLearningFinding } from '../../ports/durable-operational-learning-client.js'
import type { DurableMission, DurableMissionClient } from '../../ports/durable-mission-client.js'

const PIPE_NAME = '\\\\.\\pipe\\omni-access-broker-v8'
const MAX_RESPONSE_BYTES = 64 * 1024
const TIMESTAMP_KEYS = ['issuedAt', 'expiresAt', 'statusChangedAt', 'lastCheckedAt', 'lastSuccessAt', 'unusableSince', 'lastFailureAt', 'revokedAt', 'nextCheckAt', 'nextRetryAt'] as const

type Response = Readonly<Record<string, unknown>>
export interface CredentialRegistration {
  readonly credentialId: string; readonly providerRef: string; readonly accountRef: string; readonly environmentRef: string;
  readonly token: string; readonly expiresAt: string | null; readonly renewalMode: 'none' | 'refresh' | 'rotate' | 'reauthenticate'
}
export interface CredentialRegistrationReceipt {
  readonly credentialId: string; readonly version: number; readonly providerRef: string; readonly accountRef: string;
  readonly environmentRef: string; readonly expiresAt: string | null; readonly status: string; readonly secretRef: string
}
export interface CredentialVerification {
  readonly outcome: 'authenticated' | 'invalid-token' | 'insufficient-scope' | 'timeout' | 'unavailable' | 'rate-limited' | 'unsupported'
  readonly checkedAt: string
  readonly method: string
  readonly summary: string
}
export interface VerifiedCredentialReceipt {
  readonly credential: CredentialRegistrationReceipt
  readonly verification: CredentialVerification
  readonly disposition: 'created' | 'reused'
}

function verificationResult(value: unknown): CredentialVerification {
  const item = record(value)
  if (!['authenticated', 'invalid-token', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'unsupported'].includes(String(item.outcome)) ||
      typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt)) ||
      typeof item.method !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(item.method) || typeof item.summary !== 'string' || item.summary.length > 400) {
    throw new Error('Access broker credential verification response is invalid.')
  }
  return { outcome: item.outcome as CredentialVerification['outcome'], checkedAt: new Date(item.checkedAt).toISOString(), method: item.method, summary: item.summary }
}

function registrationReceipt(value: unknown): CredentialRegistrationReceipt {
  const item = record(value)
  for (const key of ['credentialId', 'providerRef', 'accountRef', 'environmentRef']) safeIdentifier(String(item[key] ?? ''), key)
  if (!Number.isSafeInteger(item.version) || Number(item.version) < 1 || typeof item.secretRef !== 'string' || !/^credential-ref:[a-zA-Z0-9._:-]{1,140}$/u.test(item.secretRef) ||
      !['unverified', 'active', 'expired', 'suspect', 'invalid', 'revoked', 'disabled', 'replaced'].includes(String(item.status)) ||
      (item.expiresAt !== null && (typeof item.expiresAt !== 'string' || !Number.isFinite(Date.parse(item.expiresAt))))) throw new Error('Access broker credential receipt is invalid.')
  return { credentialId: String(item.credentialId), version: Number(item.version), providerRef: String(item.providerRef), accountRef: String(item.accountRef), environmentRef: String(item.environmentRef), secretRef: item.secretRef, status: String(item.status), expiresAt: item.expiresAt === null ? null : new Date(String(item.expiresAt)).toISOString() }
}

function record(value: unknown): Response {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Access broker returned an invalid response.')
  return value as Response
}

function safeIdentifier(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

function safeVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Credential version is invalid.')
  return value
}

function credentialObservation(value: CredentialObservation): CredentialObservation {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.eventId) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.credentialId) || !Number.isSafeInteger(value.version) || value.version < 1 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.providerRef) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.accountRef) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.environmentRef) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.evidenceRef) || !['authenticated', 'invalid-token', 'revoked', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'reported-not-working', 'disabled', 'replaced'].includes(value.kind) ||
      !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.completedAt)) || Date.parse(value.startedAt) > Date.parse(value.completedAt) ||
      (value.replacedById !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.replacedById)) || (value.kind === 'replaced' && (!value.replacedById || value.replacedById === value.credentialId))) {
    throw new Error('Credential observation is invalid.')
  }
  return value
}

function credentialRegistration(value: CredentialRegistration): CredentialRegistration {
  for (const [label, item] of Object.entries({ credentialId: value.credentialId, providerRef: value.providerRef, accountRef: value.accountRef, environmentRef: value.environmentRef })) safeIdentifier(item, label)
  if (value.credentialId.length > 80) throw new Error('Credential id is too long for its vault reference.')
  if (typeof value.token !== 'string' || !value.token.trim() || Buffer.byteLength(value.token, 'utf8') > 2400) throw new Error('Credential token is invalid.')
  if (!['none', 'refresh', 'rotate', 'reauthenticate'].includes(value.renewalMode)) throw new Error('Credential renewal mode is invalid.')
  if (value.expiresAt !== null && (!Number.isFinite(Date.parse(value.expiresAt)) || new Date(value.expiresAt).toISOString() !== value.expiresAt)) throw new Error('Credential expiry is invalid.')
  return value
}

function memoryEntry(value: DurableMemoryEntry): DurableMemoryEntry {
  if (!/^mem-[a-zA-Z0-9-]{1,160}$/u.test(value.id) || !/^[a-f0-9]{64}$/u.test(value.textFingerprint)) throw new Error('Durable memory id or fingerprint is invalid.')
  if (!['confirmed', 'candidate'].includes(value.lane) || !['preference', 'episodic', 'semantic', 'procedural', 'objective', 'capability'].includes(value.type)) throw new Error('Durable memory lane or type is invalid.')
  if (!['user', 'project', 'task', 'environment'].includes(value.scopeType) || (value.scopeType === 'user' ? value.scopeId !== null || value.projectId !== null : value.scopeId === null)) throw new Error('Durable memory scope is invalid.')
  if ((value.scopeId !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.scopeId)) || (value.projectId !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.projectId))) throw new Error('Durable memory scope reference is invalid.')
  if (value.payload === null || Array.isArray(value.payload) || typeof value.payload !== 'object' || !Number.isFinite(Date.parse(value.sourceUpdatedAt))) throw new Error('Durable memory payload is invalid.')
  return value
}

function operationalLearningFinding(value: DurableOperationalLearningFinding): DurableOperationalLearningFinding {
  if (!/^learning-event-[a-f0-9]{24,64}$/u.test(value.eventId) || !/^improvement-[a-zA-Z0-9-]{1,160}$/u.test(value.findingId) ||
      !/^[a-f0-9]{64}$/u.test(value.candidateFingerprint) || !/^[a-z][a-z0-9-]{1,79}$/u.test(value.category) ||
      !['operational-rule', 'procedure', 'routing', 'hook', 'runtime-fix', 'personality', 'eval', 'capability'].includes(value.destination) ||
      !['observing', 'ready', 'implementation-required', 'materialized-pending-release', 'installed-verified', 'loaded-verified', 'superseded'].includes(value.state) ||
      !Number.isSafeInteger(value.occurrences) || value.occurrences < 1 || value.occurrences > 1_000_000 ||
      !/^[a-f0-9]{64}$/u.test(value.statementFingerprint) || !/^[a-f0-9]{64}$/u.test(value.sourceFingerprint) ||
      (value.artifactFingerprint !== null && !/^[a-f0-9]{64}$/u.test(value.artifactFingerprint)) ||
      (value.releaseVersion !== null && !/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u.test(value.releaseVersion)) ||
      !Number.isFinite(Date.parse(value.observedAt))) {
    throw new Error('Sanitized operational learning finding is invalid.')
  }
  return value
}

/** The trusted PowerShell host may serialize UTC as +00; contracts use canonical Z milliseconds. */
function canonicalizeBrokerCredential(value: unknown): unknown {
  const source = record(value)
  const result: Record<string, unknown> = { ...source }
  for (const key of TIMESTAMP_KEYS) {
    if (result[key] === null) continue
    if (typeof result[key] !== 'string') throw new Error(`Broker credential ${key} is invalid.`)
    const parsed = Date.parse(result[key])
    if (!Number.isFinite(parsed)) throw new Error(`Broker credential ${key} is invalid.`)
    result[key] = new Date(parsed).toISOString()
  }
  return result
}

export class NodeAccessBrokerClient implements AccessBrokerClient, DurableMemoryClient, DurableMissionClient, DurableOperationalLearningClient {
  constructor(private readonly pipeName = PIPE_NAME, private readonly timeoutMs = 1_500) {
    if (!/^\\\\\.\\pipe\\[a-zA-Z0-9._-]{1,120}$/u.test(pipeName)) throw new Error('Access broker pipe name is invalid.')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new Error('Access broker timeout is invalid.')
  }

  async health(): Promise<{ readonly protocol: 'omni-access-broker-v1'; readonly status: 'ready' | 'degraded' }> {
    const response = await this.call({ operation: 'health' })
    if (response.protocol !== 'omni-access-broker-v1' || (response.status !== 'ready' && response.status !== 'degraded')) {
      throw new Error('Access broker health response is invalid.')
    }
    return { protocol: response.protocol, status: response.status }
  }

  async registerCredential(input: CredentialRegistration): Promise<CredentialRegistrationReceipt> {
    const value = credentialRegistration(input)
    const registrationBase64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
    if (registrationBase64.length > 12_000) throw new Error('Credential registration exceeds the broker limit.')
    const response = await this.call({ operation: 'credential.register', registrationBase64 })
    if (typeof response.credentialJson !== 'string') throw new Error('Access broker credential registration response is invalid.')
    let raw: unknown
    try { raw = JSON.parse(response.credentialJson) } catch { throw new Error('Access broker credential registration response is invalid.') }
    const receipt = record(raw)
    if (!safeIdentifier(String(receipt.credentialId || ''), 'Credential id') || !Number.isSafeInteger(receipt.version) || Number(receipt.version) < 1 ||
        !safeIdentifier(String(receipt.providerRef || ''), 'Provider') || !safeIdentifier(String(receipt.accountRef || ''), 'Account') || !safeIdentifier(String(receipt.environmentRef || ''), 'Environment') ||
        typeof receipt.secretRef !== 'string' || !/^credential-ref:[a-zA-Z0-9._:-]{1,140}$/u.test(receipt.secretRef) ||
        (receipt.expiresAt !== null && (typeof receipt.expiresAt !== 'string' || !Number.isFinite(Date.parse(receipt.expiresAt)))) || receipt.status !== 'unverified') {
      throw new Error('Access broker credential registration response is invalid.')
    }
    return { credentialId: String(receipt.credentialId), version: Number(receipt.version), providerRef: String(receipt.providerRef), accountRef: String(receipt.accountRef), environmentRef: String(receipt.environmentRef), secretRef: receipt.secretRef, expiresAt: receipt.expiresAt as string | null, status: receipt.status }
  }

  async verifyCredential(input: CredentialRegistration): Promise<CredentialVerification> {
    const registrationBase64 = Buffer.from(JSON.stringify(credentialRegistration(input)), 'utf8').toString('base64')
    const response = await this.call({ operation: 'credential.verify', registrationBase64 }, 20_000)
    return verificationResult(response.verification)
  }

  async registerVerifiedCredential(input: CredentialRegistration, expectedVersion: number | null): Promise<VerifiedCredentialReceipt> {
    if (expectedVersion !== null) safeVersion(expectedVersion)
    const registrationBase64 = Buffer.from(JSON.stringify(credentialRegistration(input)), 'utf8').toString('base64')
    const response = await this.call({ operation: 'credential.register-verified', registrationBase64, expectedVersion }, 20_000)
    if (response.disposition !== 'created' && response.disposition !== 'reused') throw new Error('Access broker registration disposition is invalid.')
    const verification = verificationResult(response.verification)
    if (verification.outcome !== 'authenticated') throw new Error('Access broker did not authenticate this credential.')
    return { credential: registrationReceipt(response.credential), verification, disposition: response.disposition }
  }

  async verifyStoredCredential(credentialId: string): Promise<{ readonly credential: CredentialRegistrationReceipt; readonly verification: CredentialVerification }> {
    const response = await this.call({ operation: 'credential.verify-stored', credentialId: safeIdentifier(credentialId, 'Credential id') }, 20_000)
    return { credential: registrationReceipt(response.credential), verification: verificationResult(response.verification) }
  }

  async findLatestCredential(credentialId: string): Promise<CredentialRegistrationReceipt | null> {
    const response = await this.call({ operation: 'credential.latest', credentialId: safeIdentifier(credentialId, 'Credential id') })
    if (response.found === false) return null
    if (response.found !== true || typeof response.credentialJson !== 'string') throw new Error('Access broker credential lookup response is invalid.')
    let raw: unknown
    try { raw = JSON.parse(response.credentialJson) } catch { throw new Error('Access broker credential lookup response is invalid.') }
    const receipt = record(raw)
    if (!safeIdentifier(String(receipt.credentialId || ''), 'Credential id') || !Number.isSafeInteger(receipt.version) || Number(receipt.version) < 1 ||
        !safeIdentifier(String(receipt.providerRef || ''), 'Provider') || !safeIdentifier(String(receipt.accountRef || ''), 'Account') || !safeIdentifier(String(receipt.environmentRef || ''), 'Environment') ||
        typeof receipt.secretRef !== 'string' || !/^credential-ref:[a-zA-Z0-9._:-]{1,140}$/u.test(receipt.secretRef) ||
        (receipt.expiresAt !== null && (typeof receipt.expiresAt !== 'string' || !Number.isFinite(Date.parse(receipt.expiresAt)))) || typeof receipt.status !== 'string') {
      throw new Error('Access broker credential lookup response is invalid.')
    }
    return { credentialId: String(receipt.credentialId), version: Number(receipt.version), providerRef: String(receipt.providerRef), accountRef: String(receipt.accountRef), environmentRef: String(receipt.environmentRef), secretRef: receipt.secretRef, expiresAt: receipt.expiresAt as string | null, status: receipt.status }
  }

  async readCredentialVersion(credentialId: string, version: number): Promise<CredentialMetadata | null> {
    const response = await this.call({ operation: 'credential.read', credentialId: safeIdentifier(credentialId, 'Credential id'), version: safeVersion(version) })
    if (response.found === false) return null
    if (response.found !== true) throw new Error('Access broker credential response is invalid.')
    return parseCredentialMetadata(canonicalizeBrokerCredential(response.credential))
  }

  async recordCredentialObservation(event: CredentialObservation, expectedRevision: number): Promise<
    | { readonly outcome: 'recorded' | 'duplicate'; readonly credential: CredentialMetadata }
    | { readonly outcome: 'conflict' | 'version-not-found' }
  > {
    const encoded = Buffer.from(JSON.stringify(credentialObservation(event)), 'utf8').toString('base64')
    if (encoded.length > 12_000) throw new Error('Credential observation exceeds the broker limit.')
    const response = await this.call({ operation: 'credential.observe', expectedRevision: safeVersion(expectedRevision), eventBase64: encoded })
    if (response.outcome === 'conflict' || response.outcome === 'version-not-found') return { outcome: response.outcome }
    if ((response.outcome !== 'recorded' && response.outcome !== 'duplicate') || typeof response.credentialJson !== 'string') {
      throw new Error('Access broker credential observation response is invalid.')
    }
    let rawCredential: unknown
    try { rawCredential = JSON.parse(response.credentialJson) } catch { throw new Error('Access broker credential observation response is invalid.') }
    return { outcome: response.outcome, credential: parseCredentialMetadata(canonicalizeBrokerCredential(rawCredential)) }
  }

  async importMemoryBatch(input: { readonly importId: string; readonly sourceFingerprint: string; readonly entries: readonly DurableMemoryEntry[] }): Promise<'applied' | 'duplicate'> {
    if (!/^memory-import-[a-zA-Z0-9-]{1,160}$/u.test(input.importId) || !/^[a-f0-9]{64}$/u.test(input.sourceFingerprint) || input.entries.length < 1 || input.entries.length > 64) {
      throw new Error('Durable memory import is invalid.')
    }
    const entries = input.entries.map(memoryEntry).map((entry) => ({
      id: entry.id,
      lane: entry.lane,
      type: entry.type,
      scope_type: entry.scopeType,
      scope_id: entry.scopeId,
      project_id: entry.projectId,
      text_fingerprint: entry.textFingerprint,
      payload: entry.payload,
      source_updated_at: entry.sourceUpdatedAt
    }))
    const encoded = Buffer.from(JSON.stringify(entries), 'utf8').toString('base64')
    if (encoded.length > 12_000) throw new Error('Durable memory import exceeds the broker batch limit.')
    const response = await this.call({ operation: 'memory.import', importId: input.importId, sourceFingerprint: input.sourceFingerprint, entriesBase64: encoded })
    if (response.result !== 'applied' && response.result !== 'duplicate') throw new Error('Access broker memory import response is invalid.')
    return response.result
  }

  async recordOperationalLearningFinding(input: DurableOperationalLearningFinding): Promise<'recorded' | 'duplicate'> {
    const encoded = Buffer.from(JSON.stringify(operationalLearningFinding(input)), 'utf8').toString('base64')
    if (encoded.length > 12_000) throw new Error('Operational learning finding exceeds the broker limit.')
    const response = await this.call({ operation: 'learning.record-improvement', findingBase64: encoded })
    if (response.outcome !== 'recorded' && response.outcome !== 'duplicate') {
      throw new Error('Access broker operational learning response is invalid.')
    }
    return response.outcome
  }

  async upsertMission(input: DurableMission): Promise<'applied' | 'duplicate'> {
    if (!/^mission-[a-zA-Z0-9-]{1,160}$/u.test(input.id) || input.objective.length < 3 || input.objective.length > 800 || !['open', 'in-progress', 'blocked', 'completed', 'cancelled'].includes(input.state) || !Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 100 || input.payload === null || Array.isArray(input.payload) || typeof input.payload !== 'object' || !Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.updatedAt)) || (input.closedAt !== null && !Number.isFinite(Date.parse(input.closedAt))) || ((input.state === 'completed' || input.state === 'cancelled') !== (input.closedAt !== null))) {
      throw new Error('Durable mission is invalid.')
    }
    const missionBase64 = Buffer.from(JSON.stringify(input), 'utf8').toString('base64')
    if (missionBase64.length > 12_000) throw new Error('Durable mission payload exceeds the broker limit.')
    const response = await this.call({ operation: 'mission.upsert', missionBase64 })
    if (response.result !== 'applied' && response.result !== 'duplicate') throw new Error('Access broker mission response is invalid.')
    return response.result
  }

  async listActiveMissions(): Promise<readonly DurableMission[]> {
    const response = await this.call({ operation: 'mission.list-active' })
    if (typeof response.missionsJson !== 'string') throw new Error('Access broker mission list response is invalid.')
    let rawMissions: unknown
    try { rawMissions = JSON.parse(response.missionsJson) } catch { throw new Error('Access broker mission list response is invalid.') }
    if (!Array.isArray(rawMissions)) throw new Error('Access broker mission list response is invalid.')
    return rawMissions.map((raw): DurableMission => {
      const value = record(raw)
      const mission: DurableMission = { id: String(value.id ?? ''), objective: String(value.objective ?? ''), state: value.state as DurableMission['state'], priority: Number(value.priority), payload: record(value.payload), createdAt: String(value.createdAt ?? ''), updatedAt: String(value.updatedAt ?? ''), closedAt: value.closedAt === null ? null : String(value.closedAt ?? '') }
      if (!/^mission-[a-zA-Z0-9-]{1,160}$/u.test(mission.id) || !['open', 'in-progress', 'blocked'].includes(mission.state) || !Number.isSafeInteger(mission.priority) || !Number.isFinite(Date.parse(mission.createdAt)) || !Number.isFinite(Date.parse(mission.updatedAt))) throw new Error('Access broker mission list item is invalid.')
      return mission
    })
  }

  private async call(request: Readonly<Record<string, unknown>>, timeoutMs = this.timeoutMs): Promise<Response> {
    return new Promise((resolve, reject) => {
      let settled = false
      const deadline = Date.now() + timeoutMs
      let retryTimer: NodeJS.Timeout | undefined
      const finish = (error: Error | null, response?: Response): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (retryTimer !== undefined) clearTimeout(retryTimer)
        if (error !== null) reject(error)
        else resolve(response as Response)
      }
      const timeout = setTimeout(() => finish(new Error('Access broker timed out.')), timeoutMs)
      const attempt = (): void => {
        if (settled) return
        const socket = connect(this.pipeName)
        let received = ''
        let connected = false
        const retry = (): void => {
          socket.destroy()
          if (settled) return
          if (Date.now() >= deadline) return finish(new Error('Access broker is unavailable.'))
          retryTimer = setTimeout(attempt, 25)
        }
        socket.setEncoding('utf8')
        socket.once('connect', () => {
          connected = true
          socket.write(`${JSON.stringify(request)}\n`)
        })
        socket.on('data', (chunk: string) => {
          received += chunk
          if (Buffer.byteLength(received, 'utf8') > MAX_RESPONSE_BYTES) return finish(new Error('Access broker response exceeds the limit.'))
          const newline = received.indexOf('\n')
          if (newline < 0) return
          try {
            const response = record(JSON.parse(received.slice(0, newline)))
            if (response.ok !== true) {
              const code = typeof response.code === 'string' && /^[a-z-]{1,64}$/u.test(response.code) ? response.code : 'unknown'
              throw new Error(`Access broker rejected the request (${code}).`)
            }
            finish(null, response)
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Access broker response is invalid.'))
          }
        })
        socket.once('error', retry)
        socket.once('end', () => {
          if (!settled && connected && received.length === 0) retry()
          else if (!settled) finish(new Error('Access broker closed without a response.'))
        })
      }
      attempt()
    })
  }
}
