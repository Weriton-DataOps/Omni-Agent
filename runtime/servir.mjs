#!/usr/bin/env node
// `node runtime/servir.mjs --porta <n>`: a API local do Omni e o supervisor do servir dos agentes.
// Contrato de 05/11:
// - a 1ª linha do stdout é {"ok":true,"porta":n}, só depois de escutar; o log vai para o stderr;
// - stdin fechado encerra: para os agentes, fecha o servidor e sai 0;
// - saída 2 é uso (argumento ou token fora do formato); saída 1 com {"recusa":true} é recusa
//   permanente (porta ocupada ou proibida); saída 1 sem recusa é falha que vale tentar de novo.
// O token vem de OMNI_API_TOKEN (quem sobe o servir é quem precisa dele: a ilha, no plano 4). Sem
// ele, nasce um aleatório só na memória e nunca é impresso: a API fica para os agentes supervisionados.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { TOKEN, criarApiOmni } from './casa/api-omni.mjs'
import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import { listarServidores } from './casa/loja-nucleo.mjs'
import { criarSupervisor } from './casa/supervisor.mjs'
import { casaDoNucleo } from './nucleo.mjs'

const USO = 'uso: node runtime/servir.mjs --porta <0-65535>   (token opcional em OMNI_API_TOKEN)'

class UsoError extends Error {}

function lerPorta(argv) {
  let valores
  try {
    ({ values: valores } = parseArgs({ args: argv, options: { porta: { type: 'string' } }, strict: true, allowPositionals: false }))
  } catch (falha) {
    throw new UsoError(String(falha?.message ?? falha))
  }
  const porta = valores.porta ?? ''
  if (!/^\d{1,5}$/.test(porta) || Number(porta) > 65535) throw new UsoError('--porta precisa ser um inteiro de 0 a 65535.')
  return Number(porta)
}

function versaoDoOmni() {
  try {
    return JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version ?? null
  } catch {
    return null
  }
}

function escutar(servidor, porta) {
  return new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar)
    servidor.listen(porta, '127.0.0.1', () => {
      servidor.off('error', rejeitar)
      resolver(servidor.address().port)
    })
  })
}

export async function rodarServir(argv, {
  env = process.env, saida = process.stdout, erro = process.stderr, entrada = process.stdin, casa = casaDoNucleo(env)
} = {}) {
  const linha = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const log = (texto) => erro.write(`[omni servir] ${texto}\n`)

  let porta
  let token
  try {
    porta = lerPorta(argv)
    token = env.OMNI_API_TOKEN ?? randomBytes(32).toString('base64url')
    if (!TOKEN.test(token)) throw new UsoError('OMNI_API_TOKEN fora do formato: de 1 a 512 caracteres visíveis, sem espaço.')
  } catch (falha) {
    if (!(falha instanceof UsoError)) throw falha
    erro.write(`${falha.message}\n${USO}\n`)
    linha({ ok: false, erro: falha.message })
    return 2
  }

  try {
    comBancoDaCasa(casa, 'omni', () => true, env)
  } catch (falha) {
    registrarDegradacao(casa, 'servir.omni-db', falha, env)
    linha({ ok: false, erro: 'omni.db indisponível' })
    return 1
  }
  let agentes = []
  try {
    agentes = comBancoDaCasa(casa, 'nucleo', (db) => listarServidores(db), env)
  } catch (falha) {
    registrarDegradacao(casa, 'servir.nucleo-db', falha, env)
    log('nucleo.db indisponível: a API sobe sem supervisionar agentes')
  }

  let supervisor = null
  const servidor = criarApiOmni({ casa, token, versao: versaoDoOmni(), agentes: () => supervisor?.estado() ?? [], env })
  let real
  try {
    real = await escutar(servidor, porta)
  } catch (falha) {
    const permanente = falha?.code === 'EADDRINUSE' || falha?.code === 'EACCES'
    linha(permanente
      ? { ok: false, erro: `porta ${porta} indisponível (${falha.code})`, recusa: true }
      : { ok: false, erro: 'não consegui escutar' })
    return 1
  }

  supervisor = criarSupervisor({ agentes, omniApi: { url: `http://127.0.0.1:${real}/v1`, token }, env, log })
  linha({ ok: true, porta: real })
  log(`API no ar em 127.0.0.1:${real}; ${agentes.length} agente(s) para supervisionar`)
  supervisor.iniciar()

  await new Promise((resolver) => {
    entrada.once('end', resolver)
    entrada.once('close', resolver)
    entrada.resume()
  })
  log('stdin fechou: parando')
  await supervisor.parar()
  servidor.closeAllConnections()
  await new Promise((resolver) => servidor.close(() => resolver(undefined)))
  return 0
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) {
  try {
    process.exitCode = await rodarServir(process.argv.slice(2))
  } catch (falha) {
    process.stdout.write(`${JSON.stringify({ ok: false, erro: 'falha inesperada no servir' })}\n`)
    process.stderr.write(`${String(falha?.message ?? falha).slice(0, 300)}\n`)
    process.exitCode = 1
  }
}
