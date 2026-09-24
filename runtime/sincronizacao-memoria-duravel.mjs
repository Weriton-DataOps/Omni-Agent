import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'
import { lerMemoria } from './memoria.mjs'
import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'

function hash(value) { return createHash('sha256').update(value).digest('hex') }

export function durableScopeId(value) {
  if (value == null) return null
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value)) return value
  // Project paths are valid local scopes, but not broker identifiers. Preserve
  // the original in payload; encode only the indexed durable reference.
  const canonical = /^[a-z]:[\\/]/i.test(value) ? value.replace(/\\/g, '/').toLowerCase() : value
  return `scope-${hash(canonical).slice(0, 40)}`
}
export function durableMemoryEntry(item, lane) {
  return {
    id: item.id,
    lane,
    type: item.type,
    scopeType: item.scope.type,
    scopeId: durableScopeId(item.scope.id),
    projectId: durableScopeId(item.projectId),
    textFingerprint: hash(item.text),
    payload: item,
    sourceUpdatedAt: item.updatedAt
  }
}

/** Local JSON is written first; the broker receives bounded, replay-safe batches afterwards. */
export async function sincronizarMemoriaDuravel(casa, { broker = new NodeAccessBrokerClient(undefined, 10000), force = false } = {}) {
  const directory = join(casa, 'memory')
  await mkdir(directory, { recursive: true })
  const lock = await acquireLocalFileLock(join(directory, 'durable-sync.lock'), { acquisitionTimeoutMs: 1500, retryDelayMs: 50, staleLockMs: 30000, heartbeatMs: 2500, timeoutMessage: 'Sincronização de memória já em andamento.' })
  try {
  const memory = await lerMemoria(casa)
  const entries = [
    ...memory.confirmed.map((item) => durableMemoryEntry(item, 'confirmed')),
    ...memory.candidates.map((item) => durableMemoryEntry(item, 'candidate'))
  ].sort((a, b) => a.id.localeCompare(b.id))
  if (entries.length === 0) return { result: 'empty', batches: 0 }
  const checkpointPath = join(directory, 'durable-sync.json')
  let previous = {}
  try { const saved = JSON.parse(await readFile(checkpointPath, 'utf8')); if (!force && saved.version === 1 && Date.now() - Date.parse(saved.at) < 600000) previous = saved.receipts || {} } catch { /* Replay through broker receipts. */ }
  const receipts = {}; const failures = []
  let batches = 0
  let skipped = 0
  for (const item of entries) {
    const batch = [item]
    const sourceFingerprint = hash(JSON.stringify(batch))
    if (previous[item.id] === sourceFingerprint) { receipts[item.id] = sourceFingerprint; skipped++; continue }
    try {
      const result = await broker.importMemoryBatch({ importId: `memory-import-${sourceFingerprint.slice(0, 40)}`, sourceFingerprint, entries: batch })
      if (!['applied', 'duplicate'].includes(result)) throw new Error('Recibo de memória inválido.')
      receipts[item.id] = sourceFingerprint
      batches += 1
    } catch (error) {
      // A bad/oversized entry must not starve all later important memories.
      failures.push(item.id)
      if (/timed out|unavailable|ECONN|EACCES|EPERM/i.test(String(error?.message))) {
        // An unavailable broker affects the whole batch: do not spend one
        // timeout per memory while the owner is waiting to talk.
        failures.push(...entries.slice(entries.indexOf(item) + 1).filter(entry => !receipts[entry.id]).map(entry => entry.id))
        break
      }
    }
  }
  const temporary = `${checkpointPath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ version: 1, at: new Date().toISOString(), receipts }), 'utf8')
  await rename(temporary, checkpointPath)
  return { result: failures.length ? 'partial' : 'synced', entries: entries.length, batches, skipped, failed: failures.length, pendingIds: failures }
  } finally { await lock.release() }
}
