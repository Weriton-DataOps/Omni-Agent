import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { hasContinuityComplaint, normalizeOwnerText } from '../../core/personality/owner-feedback.js'
import { NodeLocalJsonStore } from './node-local-json-store.js'

const store = new NodeLocalJsonStore()
type Observation = { fingerprint: string; recordedAt: string }
type State = { schemaVersion: 1; observations: Observation[] }

function parse(value: unknown): State {
  if (value === null) return { schemaVersion: 1, observations: [] }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid continuity store.')
  const item = value as Record<string, unknown>
  if (item.schemaVersion !== 1 || Object.keys(item).length !== 2 || !Array.isArray(item.observations) || item.observations.length > 100) {
    throw new Error('Unsupported continuity store.')
  }
  const observations = item.observations.map((raw: unknown): Observation => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid continuity observation.')
    const row = raw as Record<string, unknown>
    if (Object.keys(row).length !== 2 || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(row.fingerprint) || typeof row.recordedAt !== 'string' || !Number.isFinite(Date.parse(row.recordedAt))) throw new Error('Invalid continuity observation.')
    return { fingerprint: row.fingerprint, recordedAt: row.recordedAt }
  })
  return { schemaVersion: 1, observations }
}

function location(home: string): string {
  if (!isAbsolute(home)) throw new Error('Continuity home must be absolute.')
  return join(home, 'feedback', 'personality-continuity.json')
}

export async function observePersonalityContinuity(home: string, feedback: string, at?: string): Promise<void> {
  if (!hasContinuityComplaint(feedback)) return
  const recordedAt = new Date(at ?? Date.now()).toISOString()
  const fingerprint = createHash('sha256').update(normalizeOwnerText(feedback)).digest('hex')
  await store.update(location(home), current => {
    const state = parse(current)
    if (!state.observations.some(row => row.fingerprint === fingerprint)) state.observations.push({ fingerprint, recordedAt })
    return { schemaVersion: 1, observations: state.observations.slice(-100) }
  })
}

export async function readPersonalityContinuity(home: string): Promise<string[]> {
  return parse(await store.read(location(home))).observations.length > 0 ? ['maintain-personality-continuity'] : []
}
