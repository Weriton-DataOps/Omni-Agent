#!/usr/bin/env node
// `node runtime/servir.mjs --porta <n>`: a API local do Omni e o supervisor do servir dos agentes.
// Contrato de 05/11:
// - a 1ª linha do stdout é {"ok":true,"porta":n}, só depois de escutar; o log vai para o stderr;
// - stdin fechado encerra: para os agentes, fecha o servidor e sai 0;
// - saída 2 é uso (argumento ou token fora do formato); saída 1 com {"recusa":true} é recusa
//   permanente (porta ocupada ou proibida); saída 1 sem recusa é falha que vale tentar de novo.
// O token vem de OMNI_API_TOKEN (quem sobe o servir é quem precisa dele: a ilha, no plano 4). Sem
// ele, nasce um aleatório só na memória e nunca é impresso. Os agentes supervisionados recebem outro
// token aleatório, que só lê a saúde e toca a campainha (plano 4a).
// Plano 4a, T9: o chamar fala com os agentes no ar com os tokens do cofre (abertos uma vez por agente e
// papel); a campainha e a entrada de um agente no ar acordam o carteiro; o servir.json na pasta do banco
// diz às mãos do Actions onde cada agente escuta. OMNI_CARTEIRO=seco grava o pedido e não entrega.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { TOKEN, criarApiOmni } from './casa/api-omni.mjs'
import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import { criarCarteiro, temFila } from './casa/carteiro.mjs'
import { criarChamador } from './casa/chamar-agente.mjs'
import { tokenDoAgente } from './casa/credenciais-agente.mjs'
import { criarPonteDpapi } from './casa/dpapi.mjs'
import { entregar } from './casa/entregar-sessao.mjs'
import { marcarDespacho } from './casa/loja-despachos.mjs'
import { listarInterfaces, listarServidores } from './casa/loja-nucleo.mjs'
import { sessoesVivas } from './casa/sessoes-vivas.mjs'
import { criarSupervisor } from './casa/supervisor.mjs'
import { arquivoServir } from './maos-actions.mjs'
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

const MAOS = fileURLToPath(new URL('./maos-actions.mjs', import.meta.url))
const ID_ARQUIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

// Cada token sai do cofre uma vez por agente e papel e fica na memória do servir; falha não fica.
function criarTokens(casa, env, ponte) {
  let aberta = ponte ?? null
  const guardados = new Map()
  return (agente, papel) => {
    const chave = `${agente}/${papel}`
    if (!guardados.has(chave)) {
      aberta ??= criarPonteDpapi()
      guardados.set(chave, comBancoDaCasa(casa, 'cofre', (db) => tokenDoAgente(db, aberta, agente, papel, `chamar do servir (${papel})`), env))
    }
    return guardados.get(chave)
  }
}

// O id vem do agente e vira nome de arquivo: nada de barra, dois-pontos ou "..".
export function criarGravadorDePedidos(pasta) {
  return async (id, texto, n) => {
    if (!ID_ARQUIVO.test(id) || id.includes('..')) throw new Error('id da execução fora do formato de arquivo')
    mkdirSync(pasta, { recursive: true })
    const arquivo = join(pasta, `${id}-${n}.md`)
    writeFileSync(arquivo, texto, 'utf8')
    return arquivo
  }
}

// O mapa de portas para as mãos do Actions: troca atômica, sem token.
function gravarJson(arquivo, objeto) {
  const temporario = `${arquivo}.${process.pid}.tmp`
  writeFileSync(temporario, JSON.stringify(objeto), 'utf8')
  renameSync(temporario, arquivo)
}

export async function rodarServir(argv, {
  env = process.env, saida = process.stdout, erro = process.stderr, entrada = process.stdin, casa = casaDoNucleo(env),
  ponte = null, sessoes = () => sessoesVivas()
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
  let telas = []
  try {
    ;({ agentes, telas } = comBancoDaCasa(casa, 'nucleo', (db) => ({ agentes: listarServidores(db), telas: listarInterfaces(db) }), env))
  } catch (falha) {
    registrarDegradacao(casa, 'servir.nucleo-db', falha, env)
    log('nucleo.db indisponível: a API sobe sem supervisionar agentes')
  }

  let supervisor = null
  let carteiro = null
  const tokenAgentes = randomBytes(32).toString('base64url')
  const rotas = new Map(agentes.map((a) => [a.agente, a.rotas ?? []]))
  const noAr = () => (supervisor?.estado() ?? []).filter((e) => e.estado === 'no-ar' && Number.isInteger(e.porta))
  const chamar = criarChamador({
    servidores: () => noAr().map((e) => ({ agente: e.agente, porta: e.porta, rotas: rotas.get(e.agente) ?? [] })),
    token: criarTokens(casa, env, ponte)
  })
  const servidor = criarApiOmni({
    casa, token, tokenAgentes, versao: versaoDoOmni(), agentes: () => supervisor?.estado() ?? [], env, chamar,
    // A ilha monta os painéis por aqui (plano 4b): o estado vem do supervisor, a porta do agente fica fora.
    interfaces: () => {
      const estados = supervisor?.estado() ?? []
      return telas.map((i) => ({ ...i, estado: estados.find((e) => e.agente === i.agente)?.estado ?? 'sem-servir' }))
    },
    aoDespachar: ({ agente }) => { carteiro?.tocar(agente) }
  })
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

  const seco = env.OMNI_CARTEIRO === 'seco'
  const pastaPedidos = join(casa, 'actions', 'pedidos')
  carteiro = criarCarteiro({
    chamar,
    agentes: () => noAr().filter((e) => temFila(rotas.get(e.agente))).map((e) => e.agente),
    sessoes,
    entregar: seco
      ? async (nome, arquivo) => { log(`carteiro seco: ${arquivo} gravado para ${nome}, sem entrega`); return { ok: true } }
      : (nome, arquivo) => entregar(nome, arquivo, { pastaPedidos, env }),
    gravarPedido: criarGravadorDePedidos(pastaPedidos),
    marcar: (recibo) => comBancoDaCasa(casa, 'omni', (db) => marcarDespacho(db, recibo), env),
    maos: MAOS,
    log: (texto) => log(`carteiro: ${texto}`)
  })

  const servirJson = arquivoServir(casa, env)
  const publicar = () => {
    try {
      gravarJson(servirJson, { pid: process.pid, porta: real, agentes: noAr().map((e) => ({ agente: e.agente, porta: e.porta })) })
    } catch (falha) {
      registrarDegradacao(casa, 'servir.json', falha, env)
    }
  }
  // Agente que entra no ar pode ter fila parada desde antes: o carteiro olha sem esperar a varredura.
  const aoMudar = () => {
    publicar()
    for (const agente of carteiro.agentes()) carteiro.tocar(agente)
  }

  supervisor = criarSupervisor({ agentes, omniApi: { url: `http://127.0.0.1:${real}/v1`, token: tokenAgentes }, env, log, aoMudar })
  publicar()
  linha({ ok: true, porta: real })
  log(`API no ar em 127.0.0.1:${real}; ${agentes.length} agente(s) para supervisionar${seco ? '; carteiro seco' : ''}`)
  supervisor.iniciar()
  carteiro.iniciar()

  await new Promise((resolver) => {
    entrada.once('end', resolver)
    entrada.once('close', resolver)
    entrada.resume()
  })
  log('stdin fechou: parando')
  await carteiro.parar()
  // O parar ainda avisa as saídas (e regrava o servir.json); só depois dele o arquivo some.
  await supervisor.parar()
  rmSync(servirJson, { force: true })
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
