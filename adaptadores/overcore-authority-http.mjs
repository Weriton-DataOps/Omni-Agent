// Shim temporário: a fonte canônica desta fatia está em src/entrypoints/overcore-authority-http.ts.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export {
  createOvercoreAuthorityServer,
  criarServidorAutoridadeOvercore,
  evaluateOvercoreAuthorizationRequest,
  avaliarPedidoOvercore,
  startOvercoreAuthorityCli
} from '../dist/entrypoints/overcore-authority-http.js'

import { startOvercoreAuthorityCli } from '../dist/entrypoints/overcore-authority-http.js'

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await startOvercoreAuthorityCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
