#!/usr/bin/env node
// `node runtime/tarefa-agente.mjs listar | rodar <agente> <id> [--motivo m] [--seco pasta] [--teto-min n]`:
// o lançador das tarefas que os agentes declaram no agente.json (F2, plano 5c). A tarefa do Windows
// (scripts/omni-tarefa.vbs) chama o rodar; o scripts/omni-tarefas.ps1 registra a partir do listar.
// - lançador (roteiro): lê o roteiro dentro da raiz do agente, preenche as variáveis declaradas e roda o
//   `claude -p` escondido no Actions, com a porta e o token visita do agente no ambiente quando ele serve;
// - comando: roda na raiz do agente pelo cmd, escondido e sem token;
// - trava por tarefa (dono vivo → pulada), teto (taskkill → interrompida), uma linha JSON por rodada no
//   tarefas.log da pasta do banco; a última linha do stdout é o JSON da rodada; o token nunca aparece.
// Saída: 0 concluida/pulada, 1 falhou ou recusa, 3 interrompida.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ErroDeAcesso, portaDoAgente, tokenVisita } from './casa/acesso-agente.mjs'
import { comBancoDaCasa, pastaDoBanco } from './casa/banco.mjs'
import { criarPonteDpapi } from './casa/dpapi.mjs'
import { claudePadrao, matarArvore, resultadoDoClaude } from './casa/entregar-sessao.mjs'
import { listarServidores, listarTarefas } from './casa/loja-nucleo.mjs'
import { processoVivo } from './casa/sessoes-vivas.mjs'
import { ErroDeTarefa, argumentosDoClaude, hojeBr, idDaVisita, preencherRoteiro, variavelDoAgente } from './casa/tarefas.mjs'
import { casaDoNucleo } from './nucleo.mjs'

const RAIZ_OMNI = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USO = 'uso: tarefa-agente.mjs listar | rodar <agente> <id> [--motivo <texto>] [--seco <pasta>] [--teto-min <1-240>]'
const NOME = /^[a-z][a-z0-9-]{0,39}$/
const TETO_ROTEIRO_MS = 30 * 60_000
const TETO_COMANDO_MS = 10 * 60_000
const ESPERA_SERVIR_MS = 5 * 60_000
const TETO_SAIDA = 1024 * 1024
const SAIDA_DO_ESTADO = { concluida: 0, pulada: 0, falhou: 1, interrompida: 3 }

class Recusa extends Error {}

function lerArgumentos(argv) {
  const [modo, ...resto] = argv
  if (modo === 'listar' && resto.length === 0) return { modo }
  if (modo !== 'rodar') throw new Recusa(USO)
  const [agente, id, ...opcoes] = resto
  if (!NOME.test(agente ?? '') || !NOME.test(id ?? '')) throw new Recusa(USO)
  const r = { modo, agente, id, motivo: 'manual', seco: null, tetoMin: null }
  for (let i = 0; i < opcoes.length; i += 2) {
    const valor = opcoes[i + 1]
    if (valor === undefined) throw new Recusa(USO)
    if (opcoes[i] === '--motivo') r.motivo = valor.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || 'manual'
    else if (opcoes[i] === '--seco') r.seco = resolve(valor)
    else if (opcoes[i] === '--teto-min' && /^\d{1,3}$/.test(valor) && Number(valor) >= 1 && Number(valor) <= 240) r.tetoMin = Number(valor)
    else throw new Recusa(USO)
  }
  return r
}

// Trava por tarefa: o pid do dono num arquivo criado exclusivo. Dono vivo → não roda; dono morto → sobra.
function travar(arquivo, vivo) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      writeFileSync(arquivo, String(process.pid), { flag: 'wx' })
      return true
    } catch (falha) {
      if (falha?.code !== 'EEXIST') throw falha
      const dono = Number.parseInt(readFileSync(arquivo, 'utf8'), 10)
      if (Number.isInteger(dono) && dono !== process.pid && vivo(dono)) return false
      try { unlinkSync(arquivo) } catch { /* outro levou a sobra junto */ }
    }
  }
  return false
}

function soltar(arquivo) {
  try {
    if (readFileSync(arquivo, 'utf8') === String(process.pid)) unlinkSync(arquivo)
  } catch { /* já saiu */ }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// A corrida do logon: a tarefa atrasada pode disparar antes da ilha subir o servir.
async function esperarPorta(casa, env, vivo, agente, esperaMs) {
  const fim = Date.now() + esperaMs
  for (;;) {
    try {
      return portaDoAgente(casa, env, vivo, agente)
    } catch (falha) {
      if (!(falha instanceof ErroDeAcesso) || Date.now() >= fim) throw falha
      await dormir(Math.min(5000, fim - Date.now()))
    }
  }
}

function executar(iniciar, exe, args, opcoes, entrada, tetoMs) {
  return new Promise((resolver) => {
    let saida = ''
    let erro = ''
    let estourou = false
    let fechado = false
    const fim = (r) => { if (!fechado) { fechado = true; clearTimeout(teto); resolver({ saida, erro, estourou, ...r }) } }
    let filho
    try {
      filho = iniciar(exe, args, { ...opcoes, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (falha) {
      resolver({ saida, erro: String(falha?.message ?? falha), estourou, codigo: null, naoAbriu: true })
      return
    }
    const teto = setTimeout(() => { estourou = true; matarArvore(filho) }, tetoMs)
    const juntar = (atual, pedaco) => (atual + pedaco).slice(-TETO_SAIDA)
    filho.stdout.setEncoding('utf8').on('data', (d) => { saida = juntar(saida, d) })
    filho.stderr.setEncoding('utf8').on('data', (d) => { erro = juntar(erro, d) })
    filho.stdin.on('error', () => { /* morreu antes de ler; o close conta */ })
    filho.once('error', (falha) => fim({ codigo: null, naoAbriu: true, erro: String(falha?.message ?? falha) }))
    filho.once('close', (codigo) => fim({ codigo }))
    filho.stdin.end(entrada ?? '')
  })
}

function estadoDe(r) {
  if (r.estourou) return 'interrompida'
  return r.codigo === 0 ? 'concluida' : 'falhou'
}

async function rodarRoteiro(tarefa, pedido, ctx) {
  const { env, casa, vivo, abrirPonte, iniciar, agora, raizOmni, esperaMs } = ctx
  const raiz = resolve(tarefa.raiz)
  const caminho = resolve(raiz, tarefa.roteiro)
  const rel = relative(raiz, caminho)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new ErroDeTarefa('roteiro-fora', 'o roteiro sai da raiz do agente')
  let texto
  try { texto = readFileSync(caminho, 'utf8') } catch { throw new ErroDeTarefa('roteiro-ausente', `o roteiro ${tarefa.roteiro} não abriu`) }

  const quando = agora()
  const actions = pedido.seco ?? resolve(env.OMNI_ACTIONS || join(env.USERPROFILE || homedir(), 'Documents', 'Actions'))
  mkdirSync(actions, { recursive: true })
  let visita = idDaVisita(quando)
  if (existsSync(join(actions, 'visitas', `${visita}.md`))) visita = `${visita}-${String(quando.getSeconds()).padStart(2, '0')}`
  const valores = { MOTIVO: pedido.motivo, VISITA: visita, HOJE: hojeBr(quando), ACTIONS: actions, OMNI: raizOmni, [variavelDoAgente(tarefa.agente)]: raiz }
  const variaveis = tarefa.variaveis ?? []
  let ordem = preencherRoteiro(texto, variaveis, valores)
  if (pedido.seco) ordem = `VISITA A SECO: trabalhe só em ${actions} (cópia). Não use avisar nem risco.\n\n${ordem}`

  const ambiente = { ...env, OMNI_VISITA_ID: visita, OMNI_ACTIONS: actions }
  delete ambiente.ELECTRON_RUN_AS_NODE
  delete ambiente.OMNI_VISITA_SECO
  const prefixo = variavelDoAgente(tarefa.agente)
  delete ambiente[`${prefixo}_API`]
  delete ambiente[`${prefixo}_TOKEN`]
  if (pedido.seco) ambiente.OMNI_VISITA_SECO = '1'
  const serve = comBancoDaCasa(casa, 'nucleo', (db) => listarServidores(db).some((s) => s.agente === tarefa.agente), env)
  if (serve) {
    const porta = await esperarPorta(casa, env, vivo, tarefa.agente, esperaMs)
    ambiente[`${prefixo}_API`] = `http://127.0.0.1:${porta}/v1`
    ambiente[`${prefixo}_TOKEN`] = tokenVisita(casa, env, abrirPonte, tarefa.agente, `tarefa ${tarefa.agente}/${tarefa.id}`)
  }

  const r = await executar(iniciar, claudePadrao(env), argumentosDoClaude([actions, raizOmni, raiz]), { cwd: actions, env: ambiente }, ordem, ctx.tetoMs ?? (pedido.tetoMin ? pedido.tetoMin * 60_000 : TETO_ROTEIRO_MS))
  const estado = estadoDe(r)
  const resumo = resultadoDoClaude(r.saida, r.erro).slice(0, 300)
  const registro = join(actions, 'visitas', `${visita}.md`)
  if (variaveis.includes('VISITA') && variaveis.includes('ACTIONS') && !existsSync(registro)) {
    mkdirSync(dirname(registro), { recursive: true })
    writeFileSync(registro, `# Visita ${visita}\n\n- Motivo: ${pedido.motivo}\n- Estado: ${estado} (sem registro do roteiro)\n- Resumo: ${resumo || '(vazio)'}\n`)
  }
  return { estado, visita, resumo }
}

async function rodarComando(tarefa, pedido, ctx) {
  const { env, iniciar } = ctx
  const ambiente = { ...env }
  delete ambiente.ELECTRON_RUN_AS_NODE
  const prefixo = variavelDoAgente(tarefa.agente)
  delete ambiente[`${prefixo}_API`]
  delete ambiente[`${prefixo}_TOKEN`]
  const [exe, args, extra] = process.platform === 'win32'
    ? [env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${tarefa.comando}"`], { windowsVerbatimArguments: true }]
    : ['/bin/sh', ['-c', tarefa.comando], {}]
  const r = await executar(iniciar, exe, args, { cwd: resolve(tarefa.raiz), env: ambiente, ...extra }, '', ctx.tetoMs ?? (pedido.tetoMin ? pedido.tetoMin * 60_000 : TETO_COMANDO_MS))
  return { estado: estadoDe(r), resumo: (r.erro || r.saida).trim().slice(-300) }
}

export async function rodarTarefa(argv, {
  env = process.env, saida = process.stdout, casa = casaDoNucleo(env), ponte, iniciar = spawn, vivo = processoVivo,
  agora = () => new Date(), tetoMs, esperaMs = ESPERA_SERVIR_MS, raizOmni = RAIZ_OMNI
} = {}) {
  const dizer = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  let pedido
  try {
    pedido = lerArgumentos(argv)
  } catch (falha) {
    if (!(falha instanceof Recusa)) throw falha
    dizer({ ok: false, erro: falha.message })
    return 1
  }
  if (pedido.modo === 'listar') {
    let tarefas
    try {
      tarefas = comBancoDaCasa(casa, 'nucleo', (db) => listarTarefas(db), env)
    } catch {
      dizer({ ok: false, erro: 'o nucleo.db não abriu' })
      return 1
    }
    dizer({ ok: true, tarefas })
    return 0
  }

  const { agente, id, motivo } = pedido
  let tarefa
  try {
    tarefa = comBancoDaCasa(casa, 'nucleo', (db) => listarTarefas(db).find((t) => t.agente === agente && t.id === id), env)
  } catch {
    dizer({ ok: false, agente, id, erro: 'o nucleo.db não abriu' })
    return 1
  }
  if (!tarefa) { dizer({ ok: false, agente, id, erro: `a tarefa ${agente}/${id} não está instalada nesta máquina` }); return 1 }
  if (tarefa.divergente) { dizer({ ok: false, agente, id, erro: `o ${agente} instalado aqui diverge do catálogo; reinstale antes de rodar a tarefa` }); return 1 }

  const pasta = join(pastaDoBanco(casa, env), 'tarefas')
  mkdirSync(pasta, { recursive: true })
  const inicio = Date.now()
  const registrar = (linha) => {
    try {
      appendFileSync(join(pasta, 'tarefas.log'), `${JSON.stringify({ em: new Date().toISOString(), agente, id, motivo, ...linha, ms: Date.now() - inicio })}\n`)
    } catch { /* log é testemunha, não juiz */ }
  }
  const trava = join(pasta, `${agente}-${id}.trava`)
  if (!travar(trava, vivo)) {
    registrar({ estado: 'pulada' })
    dizer({ ok: true, agente, id, estado: 'pulada' })
    return 0
  }
  try {
    const ctx = { env, casa, vivo, abrirPonte: () => (ponte ??= criarPonteDpapi()), iniciar, agora, raizOmni, esperaMs, tetoMs }
    let r
    try {
      r = tarefa.lancador ? await rodarRoteiro(tarefa, pedido, ctx) : await rodarComando(tarefa, pedido, ctx)
    } catch (falha) {
      if (!(falha instanceof ErroDeTarefa) && !(falha instanceof ErroDeAcesso)) throw falha
      registrar({ estado: 'falhou', erro: falha.message })
      dizer({ ok: false, agente, id, estado: 'falhou', erro: falha.message })
      return 1
    }
    registrar({ estado: r.estado, ...(r.visita ? { visita: r.visita } : {}) })
    dizer({ ok: SAIDA_DO_ESTADO[r.estado] === 0, agente, id, estado: r.estado, ...(r.visita ? { visita: r.visita } : {}), resumo: r.resumo })
    return SAIDA_DO_ESTADO[r.estado]
  } finally {
    soltar(trava)
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) {
  try {
    process.exitCode = await rodarTarefa(process.argv.slice(2))
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, erro: 'falha inesperada no lançador de tarefas' })}\n`)
    process.exitCode = 1
  }
}
