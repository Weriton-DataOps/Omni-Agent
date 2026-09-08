import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { casaDoOmni } from './memoria.mjs'
import { confirmarReleasesCarregadas } from './release-autonoma.mjs'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

export async function tratarHookReleaseLoaded(input, env = process.env, deps = {}) {
  if (input?.hook_event_name !== 'SessionStart') return { suppressOutput: true }
  const casa = (deps.casaDoOmni ?? casaDoOmni)(env)
  const result = await (deps.confirmarReleasesCarregadas ?? confirmarReleasesCarregadas)({
    casa,
    pluginRoot: deps.pluginRoot ?? PLUGIN_ROOT,
    at: deps.at
  })
  return {
    suppressOutput: true,
    handshake: result.result,
    confirmed: result.confirmed,
    evidenceFingerprint: hash(JSON.stringify({
      result: result.result,
      confirmed: result.confirmed,
      rejected: result.rejected,
      loadedRootFingerprint: result.loadedRootFingerprint
    }))
  }
}

async function entradaPadrao() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  return raw.trim() ? JSON.parse(raw) : {}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${JSON.stringify(await tratarHookReleaseLoaded(await entradaPadrao()))}\n`)
  } catch (error) {
    process.stderr.write(`Handshake carregado do Omni: ${hash(`${error?.name ?? 'Error'}:${error?.code ?? 'no-code'}`)}\n`)
    process.stdout.write(`${JSON.stringify({ suppressOutput: true })}\n`)
  }
}
