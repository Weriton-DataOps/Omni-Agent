import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditarSaudeSistema } from './auditoria-sistema.mjs'
import { casaDoOmni } from './memoria.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))

export async function auditarAntesDaRelease({
  casa = casaDoOmni(),
  pluginRoot = raiz,
  at
} = {}) {
  const audit = await auditarSaudeSistema(casa, { pluginRoot, repair: false, at })
  const errors = audit.run.findings.filter((item) => item.severity === 'error')
  const recoverableErrors = errors.filter((item) =>
    item.code === 'unresolved-turn-findings' && item.releaseBlocking === false
  )
  const recoverable = new Set(recoverableErrors)
  const blockingErrors = errors.filter((item) => !recoverable.has(item))
  return {
    ok: blockingErrors.length === 0,
    trigger: 'before-release',
    auditId: audit.run.id,
    status: audit.run.status,
    errors,
    blockingErrors,
    recoverableErrors,
    warnings: audit.run.findings.filter((item) => item.severity === 'warning'),
    rawConversationStored: false
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await auditarAntesDaRelease()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      trigger: 'before-release',
      error: error instanceof Error ? error.message : String(error)
    })}\n`)
    process.exitCode = 1
  }
}
