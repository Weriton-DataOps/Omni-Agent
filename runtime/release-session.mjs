import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { NodeLocalJsonStore } from '../dist/adapters/local-json/node-local-json-store.js'
import { isPrimaryClaudeScope } from '../dist/adapters/claude/host-input.js'
import { verificarIntegridadeRelease } from './integridade-release.mjs'

export async function observarRuntimeCarregado(input, casa, pluginRoot, deps = {}) {
  if (!['SessionStart', 'UserPromptSubmit'].includes(input?.hook_event_name) ||
      !isPrimaryClaudeScope(input) || typeof input.session_id !== 'string' || !input.session_id) return null
  const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')
  const integrity = await (deps.verify ?? verificarIntegridadeRelease)(pluginRoot)
  const observation = {
    schemaVersion: 1, source: 'executed-hook', hookEvent: input.hook_event_name,
    sessionKey: digest(input.session_id), rootFingerprint: digest(pluginRoot),
    version: integrity.releaseVersion ?? integrity.manifestVersion ?? null,
    payloadFingerprint: integrity.fingerprint ?? null,
    integrity: integrity.status, observedAt: new Date().toISOString()
  }
  await (deps.store ?? new NodeLocalJsonStore()).write(join(casa, 'runtime', 'loaded-sessions', `${observation.sessionKey}.json`), observation)
  return observation
}

export function contextoRuntimeCarregado(observation) {
  return `<omni-runtime-carregado>Hook deste turno: versão ${observation.version ?? 'desconhecida'}; integridade ${observation.integrity}; observado ${observation.observedAt}. Esta é a raiz executada pelo hook, não apenas a instalação ou um operador manual. Readback: runtime/loaded-sessions/${observation.sessionKey}.json. Consulta operacional: powershell -NoProfile -ExecutionPolicy Bypass -File CAMINHO_ABSOLUTO_DO_PLUGIN/scripts/omni.ps1 diagnostico --sessao ID_ATUAL (somente leitura, sem pipeline node -e). Diferencie operator de loadedSession e tarefa histórica de capacidade atual. needs-owner só é solicitação comprovada com authorityRequest; diagnosis-required-not-proven-authority pede diagnóstico, não autorização genérica.</omni-runtime-carregado>`
}
