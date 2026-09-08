import { createHash } from 'node:crypto'

import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'
import { lerMemoria } from './memoria.mjs'

function hash(value) { return createHash('sha256').update(value).digest('hex') }

function entry(item, lane) {
  return {
    id: item.id,
    lane,
    type: item.type,
    scopeType: item.scope.type,
    scopeId: item.scope.id ?? null,
    projectId: item.projectId,
    textFingerprint: hash(item.text),
    payload: item,
    sourceUpdatedAt: item.updatedAt
  }
}

/** Local JSON is written first; the broker receives bounded, replay-safe batches afterwards. */
export async function sincronizarMemoriaDuravel(casa) {
  const memory = await lerMemoria(casa)
  const entries = [
    ...memory.confirmed.map((item) => entry(item, 'confirmed')),
    ...memory.candidates.map((item) => entry(item, 'candidate'))
  ].sort((a, b) => a.id.localeCompare(b.id))
  if (entries.length === 0) return { result: 'empty', batches: 0 }
  const broker = new NodeAccessBrokerClient()
  let batches = 0
  for (let offset = 0; offset < entries.length; offset += 1) {
    const batch = entries.slice(offset, offset + 1)
    const sourceFingerprint = hash(JSON.stringify(batch))
    await broker.importMemoryBatch({
      importId: `memory-import-${offset}-${sourceFingerprint.slice(0, 24)}`,
      sourceFingerprint,
      entries: batch
    })
    batches += 1
  }
  return { result: 'synced', batches }
}
