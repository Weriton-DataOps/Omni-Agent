// scripts/actions/omni-actions.mjs de mentira, no lugar do do Oráculo: anota os argumentos, a API e o
// sha256 do token que recebeu (nunca o valor) em MAOS_REGISTRO e sai com MAOS_SAIDA.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const token = process.env.ORACULO_TOKEN ?? null
writeFileSync(process.env.MAOS_REGISTRO, JSON.stringify({
  argv: process.argv.slice(2),
  api: process.env.ORACULO_API ?? null,
  token: token === null ? null : createHash('sha256').update(token, 'utf8').digest('hex'),
  cwd: process.cwd()
}))
process.exitCode = Number(process.env.MAOS_SAIDA ?? 0)
