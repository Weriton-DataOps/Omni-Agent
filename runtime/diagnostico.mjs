import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diagnosticarAutomacaoFalhas } from './automacao-falhas.mjs'
import { lerIdentidadeRelease } from './integridade-release.mjs'
import { consultarCapacidadesOvercore } from './overcore-task-flow.mjs'

/** No migration, synchronization, cache refresh, dispatch or paid model call. */
export async function diagnosticarRuntime(casa, pluginRoot, sessionId, env = process.env) {
  let loaded = null
  if (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 500) {
    const id = createHash('sha256').update(sessionId).digest('hex')
    try { loaded = JSON.parse(await readFile(join(casa, 'runtime', 'loaded-sessions', `${id}.json`), 'utf8')) }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  return { ok: true, readOnly: true, queriedAt: new Date().toISOString(),
    operator: await lerIdentidadeRelease(pluginRoot),
    loadedSession: loaded, loadedSessionIsHistoricalObservation: true,
    failures: await diagnosticarAutomacaoFalhas(casa),
    overcore: await consultarCapacidadesOvercore(env) }
}
