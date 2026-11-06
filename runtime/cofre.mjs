// Linha de comando do cofre do Omni (§8.1, §8.3, §8.4). Segredo nunca entra por argumento: o valor
// da credencial e a frase-mestra chegam pela primeira linha do stdin, e o executar entrega o valor
// ao processo filho numa variável de ambiente. O stdin só é tocado por quem lê; no executar ele
// fica intocado e o filho o herda. A saída é JSON numa linha e nunca leva o valor.
// Códigos de saída: 0 ok; 2 uso errado; 3 recusa do cofre; 1 falha inesperada (vai para degradacoes.jsonl).
import { spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import { criarPonteDpapi } from './casa/dpapi.mjs'
import { CofreError, cadastrarCredencial, credencialPorNome, exportarCofre, importarPacoteCofre, importarPastaDpapi, listarCredenciais, registrarInventarioWindows, registrarTeste, usarCredencial } from './casa/loja-cofre.mjs'
import { PacoteCofreError } from './casa/pacote-cofre.mjs'
import { testarCredencial } from './casa/testadores-cofre.mjs'

const USO = `uso: node runtime/cofre.mjs <comando> [opções]
  listar
  cadastrar --nome <n> --tipo <t> [--servico <s>] [--url <u>] [--usuario <u>] [--notas <n>] [--agentes <a,b>]   (valor pelo stdin)
  importar-dpapi [--pasta <pasta>] [--classificacao <arquivo.json>]
  inventario-windows
  exportar --saida <arquivo>   (frase-mestra pelo stdin)
  importar-pacote --arquivo <arquivo>   (frase-mestra pelo stdin)
  testar --nome <n>
  executar --nome <n> --variavel <VAR> --motivo <m> [--agente omni] [--sessao <s>] -- <comando> [args...]`
const VARIAVEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const LIMITE_LINHA = 64 * 1024
class UsoError extends Error {}

export function casaDoCofre(env = process.env) {
  if (env.OMNI_HOME) return resolve(env.OMNI_HOME)
  if (env.APPDATA) return join(env.APPDATA, 'omni')
  return join(homedir(), '.omni')
}
function lerOpcoes(argumentos, opcoes, obrigatorias = []) {
  let lidas
  try { lidas = parseArgs({ args: argumentos, options: opcoes, strict: true, allowPositionals: false }).values }
  catch (erro) { throw new UsoError(`opções inválidas (${erro.code ?? erro.name})`) }   // nunca ecoa o argumento
  for (const nome of obrigatorias) if (lidas[nome] === undefined || lidas[nome] === '') throw new UsoError(`falta --${nome}`)
  return lidas
}
async function linhaDaEntrada(entrada) {
  const pedacos = []; let total = 0
  try {
    for await (const pedaco of entrada) {
      const bytes = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco)
      pedacos.push(bytes); total += bytes.length
      if (bytes.includes(10)) break
      if (total > LIMITE_LINHA) throw new UsoError('a linha do stdin passou de 64 KB')
    }
    const tudo = Buffer.concat(pedacos)
    try {
      let fim = tudo.indexOf(10); if (fim === -1) fim = tudo.length
      if (fim > 0 && tudo[fim - 1] === 13) fim -= 1
      const inicio = tudo[0] === 0xef && tudo[1] === 0xbb && tudo[2] === 0xbf ? 3 : 0
      return Buffer.from(tudo.subarray(inicio, Math.max(inicio, fim)))
    } finally { tudo.fill(0) }
  } finally { for (const pedaco of pedacos) pedaco.fill(0) }
}
function lerClassificacao(arquivo) {
  if (arquivo === undefined) return {}
  try { return JSON.parse(readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '')) } catch { throw new UsoError('não consegui ler a classificação (JSON)') }
}

export async function rodarCofre(argv, { entrada, saida = process.stdout, erro = process.stderr, env = process.env, ponte, fetch = globalThis.fetch, executar = spawn } = {}) {
  const casa = casaDoCofre(env)
  let ponteViva = ponte
  const daPonte = () => (ponteViva ??= criarPonteDpapi())
  const comCofre = (uso) => comBancoDaCasa(casa, 'cofre', uso, env)   // uso síncrono
  const lerLinha = () => linhaDaEntrada(entrada ?? process.stdin)
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'listar': { lerOpcoes(resto, {}); escrever(comCofre((db) => listarCredenciais(db))); return 0 }
      case 'cadastrar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' }, tipo: { type: 'string' }, servico: { type: 'string' }, url: { type: 'string' }, usuario: { type: 'string' }, notas: { type: 'string' }, agentes: { type: 'string' } }, ['nome', 'tipo'])
        const valor = await lerLinha()
        try {
          const dados = { nome: o.nome, tipo: o.tipo, servico: o.servico, url: o.url, usuario: o.usuario, notas: o.notas, agentes: o.agentes === undefined ? undefined : o.agentes.split(',').map((a) => a.trim()).filter(Boolean) }
          escrever({ ok: true, credencial: comCofre((db) => cadastrarCredencial(db, daPonte(), dados, valor)) })
          return 0
        } finally { valor.fill(0) }
      }
      case 'importar-dpapi': {
        const o = lerOpcoes(resto, { pasta: { type: 'string' }, classificacao: { type: 'string' } })
        const classificacao = lerClassificacao(o.classificacao)
        const r = comCofre((db) => importarPastaDpapi(db, daPonte(), o.pasta ?? join(casa, 'access'), { classificacao }))
        escrever({ ok: true, importadas: r.importadas, resultados: r.resultados }); return 0
      }
      case 'inventario-windows': {
        lerOpcoes(resto, {})
        const entradas = daPonte().inventariarGerenciador()   // fora da conexão
        escrever({ ok: true, ...comCofre((db) => registrarInventarioWindows(db, entradas)) }); return 0
      }
      case 'exportar': {
        const o = lerOpcoes(resto, { saida: { type: 'string' } }, ['saida'])
        const destino = resolve(o.saida)
        const fraseBytes = await lerLinha()
        let descritor = null; let gravado = false
        try {
          try { descritor = openSync(destino, 'wx', 0o600) } catch (falha) {
            if (falha.code === 'EEXIST') throw new CofreError('saida-existe', 'O arquivo de saída já existe; o cofre não sobrescreve pacote.')
            throw falha
          }
          const r = comCofre((db) => exportarCofre(db, daPonte(), fraseBytes.toString('utf8')))
          writeSync(descritor, r.texto); gravado = true
          escrever({ ok: true, saida: destino, credenciais: r.credenciais, recadastrar: r.recadastrar }); return 0
        } finally {
          fraseBytes.fill(0)
          if (descritor !== null) closeSync(descritor)
          if (descritor !== null && !gravado) rmSync(destino, { force: true })
        }
      }
      case 'importar-pacote': {
        const o = lerOpcoes(resto, { arquivo: { type: 'string' } }, ['arquivo'])
        let texto
        try { texto = readFileSync(o.arquivo, 'utf8') } catch { throw new UsoError('não consegui ler o pacote') }
        const fraseBytes = await lerLinha()
        try { escrever({ ok: true, ...comCofre((db) => importarPacoteCofre(db, daPonte(), texto, fraseBytes.toString('utf8'))) }); return 0 }
        finally { fraseBytes.fill(0) }
      }
      case 'testar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        const credencial = comCofre((db) => credencialPorNome(db, o.nome))
        if (!credencial) throw new CofreError('inexistente', `Não há credencial com o nome ${o.nome}.`)
        const obterValor = () => comCofre((db) => usarCredencial(db, daPonte(), { nome: o.nome, agente: 'omni', motivo: 'teste do cofre' }).valor)
        const resultado = await testarCredencial(credencial, obterValor, { fetch })   // fetch fora da conexão
        comCofre((db) => registrarTeste(db, o.nome, resultado))
        escrever({ ok: true, nome: o.nome, teste: resultado }); return 0
      }
      case 'executar': {
        const separador = resto.indexOf('--')
        if (separador === -1 || separador === resto.length - 1) throw new UsoError('falta o comando depois de --')
        const o = lerOpcoes(resto.slice(0, separador), { nome: { type: 'string' }, variavel: { type: 'string' }, motivo: { type: 'string' }, agente: { type: 'string' }, sessao: { type: 'string' } }, ['nome', 'variavel', 'motivo'])
        if (!VARIAVEL.test(o.variavel)) throw new UsoError('variável de ambiente inválida')
        const [programa, ...argumentos] = resto.slice(separador + 1)
        const { valor } = comCofre((db) => usarCredencial(db, daPonte(), { nome: o.nome, agente: o.agente ?? 'omni', motivo: o.motivo, sessao: o.sessao ?? null }))
        let filhoEnv
        try { filhoEnv = { ...env, [o.variavel]: valor.toString('utf8') } } finally { valor.fill(0) }
        return await new Promise((resolver) => {
          const filho = executar(programa, argumentos, { stdio: 'inherit', env: filhoEnv, windowsHide: true, shell: false })
          filho.on('error', () => resolver(1))
          filho.on('exit', (codigo, sinal) => resolver(codigo ?? (sinal ? 1 : 0)))
        })
      }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof CofreError || falha instanceof PacoteCofreError) { escrever({ ok: false, codigo: falha.code, erro: falha.message }); return 3 }
    registrarDegradacao(casa, 'cofre.cli', falha, env)
    erro.write(`falha inesperada no cofre: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarCofre(process.argv.slice(2))
