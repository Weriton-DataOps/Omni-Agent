import { fileURLToPath } from 'node:url'

import { casaDoOmni } from './memoria.mjs'
import { varrerAtividadesDoDia } from './varredura-diaria.mjs'
import { sincronizarAutomacaoFalhas } from './automacao-falhas.mjs'

export async function tratarHookVarredura(input, env = process.env) {
  if (!['SessionStart', 'Stop'].includes(input?.hook_event_name)) {
    return { suppressOutput: true }
  }
  await varrerAtividadesDoDia(casaDoOmni(env), { automatic: true })
  await sincronizarAutomacaoFalhas(casaDoOmni(env))
  return { suppressOutput: true }
}

async function entradaPadrao() {
  let conteudo = ''
  for await (const parte of process.stdin) conteudo += parte
  return conteudo.trim() ? JSON.parse(conteudo) : {}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${JSON.stringify(await tratarHookVarredura(await entradaPadrao()))}\n`)
  } catch (erro) {
    process.stderr.write(`Varredura diaria do Omni: ${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.stdout.write(`${JSON.stringify({ suppressOutput: true })}\n`)
  }
}
