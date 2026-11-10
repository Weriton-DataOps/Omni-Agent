#!/usr/bin/env node
// `node runtime/maos-actions.mjs <comando> [argumentos]`: as mãos do Actions (F2, plano 4a, §3.5). A sessão
// do VS Code que recebeu uma execução devolve o estado por aqui, sem nunca ver token:
// - o Actions mora no agente oraculo; a raiz dele vem do nucleo.db, a porta do servir.json do Omni
//   (pid vivo), o token visita do cofre.db (cada abertura vira uma linha em usos);
// - roda <raiz>/scripts/actions/omni-actions.mjs com o Node atual, ORACULO_API e ORACULO_TOKEN no
//   ambiente e o stdio herdado, e sai com o código dele;
// - qualquer peça faltando dá {"ok":false,"erro":...} no stdout e saída 1. O token nunca aparece.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ErroDeAcesso as MaosError, arquivoServir, portaDoAgente, tokenVisita } from './casa/acesso-agente.mjs'
import { comBancoDaCasa } from './casa/banco.mjs'
import { criarPonteDpapi } from './casa/dpapi.mjs'
import { listarServidores } from './casa/loja-nucleo.mjs'
import { processoVivo } from './casa/sessoes-vivas.mjs'
import { casaDoNucleo } from './nucleo.mjs'

export { arquivoServir }
export const AGENTE_ACTIONS = 'oraculo'
export const SCRIPT_ACTIONS = join('scripts', 'actions', 'omni-actions.mjs')
const COMANDO = /^[a-z][a-z-]{0,29}$/

function raizDoAgente(casa, env, agente) {
  let raiz
  try {
    raiz = comBancoDaCasa(casa, 'nucleo', (db) => listarServidores(db).find((s) => s.agente === agente)?.raiz, env)
  } catch {
    throw new MaosError('o nucleo.db não abriu')
  }
  if (!raiz) throw new MaosError(`o ${agente} não está instalado nesta máquina com o modo servir`)
  return raiz
}

export async function rodarMaos(argv, {
  env = process.env, saida = process.stdout, casa = casaDoNucleo(env), ponte, iniciar = spawn, vivo = processoVivo
} = {}) {
  const abrirPonte = () => (ponte ??= criarPonteDpapi())
  let filho
  try {
    const raiz = raizDoAgente(casa, env, AGENTE_ACTIONS)
    const porta = portaDoAgente(casa, env, vivo, AGENTE_ACTIONS)
    const script = join(raiz, SCRIPT_ACTIONS)
    if (!existsSync(script)) throw new MaosError(`${SCRIPT_ACTIONS.replaceAll('\\', '/')} não existe na raiz do ${AGENTE_ACTIONS}`)
    const token = tokenVisita(casa, env, abrirPonte, AGENTE_ACTIONS, `mãos do Actions: ${COMANDO.test(argv[0] ?? '') ? argv[0] : '(outro)'}`)
    const ambiente = { ...env, ORACULO_API: `http://127.0.0.1:${porta}/v1`, ORACULO_TOKEN: token }
    filho = iniciar(process.execPath, [script, ...argv], { cwd: raiz, env: ambiente, stdio: 'inherit', windowsHide: true })
  } catch (falha) {
    if (!(falha instanceof MaosError)) throw falha
    saida.write(`${JSON.stringify({ ok: false, erro: falha.message })}\n`)
    return 1
  }
  return new Promise((resolver) => {
    filho.once('error', (falha) => {
      saida.write(`${JSON.stringify({ ok: false, erro: `o script do ${AGENTE_ACTIONS} não rodou (${falha?.code ?? 'erro'})` })}\n`)
      resolver(1)
    })
    filho.once('close', (codigo) => resolver(codigo ?? 1))
  })
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) {
  try {
    process.exitCode = await rodarMaos(process.argv.slice(2))
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, erro: 'falha inesperada nas mãos do Actions' })}\n`)
    process.exitCode = 1
  }
}
