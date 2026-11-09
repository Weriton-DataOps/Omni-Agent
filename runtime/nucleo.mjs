// Linha de comando do núcleo da casa (§4.2): o catálogo de agentes, onde cada um está instalado
// e as máquinas que a casa conhece. O executor de cada agente chama o registrar depois de instalar
// e o retirar ao desinstalar; o verificar confere o executor/agente.json sem abrir o banco.
// Cada máquina grava só as próprias linhas: o registrar e o retirar valem para esta máquina.
// A saída é JSON numa linha. Códigos de saída: 0 ok; 2 uso errado; 3 recusa do núcleo;
// 1 falha inesperada (vai para degradacoes.jsonl).
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import {
  NucleoError, lerManifesto, listarInstalados, listarMaquinas, registrarAgente, registrarMaquina, retirarAgente, validarManifesto
} from './casa/loja-nucleo.mjs'

const USO = `uso: node runtime/nucleo.mjs <comando> [opções]
  verificar --raiz <pasta do agente>   (confere executor/agente.json; não grava)
  registrar --raiz <pasta do agente>   (catálogo e instalação nesta máquina)
  retirar --agente <nome>   (desinstalação nesta máquina)
  listar [--maquina <m>]   (agentes instalados; padrão: esta máquina)
  maquinas
  maquina   (registra esta máquina)`
class UsoError extends Error {}

export function casaDoNucleo(env = process.env) {
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

export async function rodarNucleo(argv, { saida = process.stdout, erro = process.stderr, env = process.env } = {}) {
  const casa = casaDoNucleo(env)
  const comNucleo = (uso) => comBancoDaCasa(casa, 'nucleo', uso, env)   // uso síncrono
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'verificar': {
        const o = lerOpcoes(resto, { raiz: { type: 'string' } }, ['raiz'])
        const { manifesto, sha256 } = validarManifesto(lerManifesto(resolve(o.raiz)))
        escrever({ ok: true, agente: manifesto.agente, versao: manifesto.versao, sha256 }); return 0
      }
      case 'registrar': {
        const o = lerOpcoes(resto, { raiz: { type: 'string' } }, ['raiz'])
        const raiz = resolve(o.raiz)
        const conteudo = lerManifesto(raiz)
        escrever({ ok: true, ...comNucleo((db) => registrarAgente(db, conteudo, { raiz })) }); return 0
      }
      case 'retirar': {
        const o = lerOpcoes(resto, { agente: { type: 'string' } }, ['agente'])
        escrever({ ok: true, ...comNucleo((db) => retirarAgente(db, o.agente)) }); return 0
      }
      case 'listar': {
        const o = lerOpcoes(resto, { maquina: { type: 'string' } })
        escrever(comNucleo((db) => listarInstalados(db, o.maquina === undefined ? {} : { maquina: o.maquina }))); return 0
      }
      case 'maquinas': { lerOpcoes(resto, {}); escrever(comNucleo((db) => listarMaquinas(db))); return 0 }
      case 'maquina': { lerOpcoes(resto, {}); escrever({ ok: true, ...comNucleo((db) => registrarMaquina(db)) }); return 0 }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof NucleoError) { escrever({ ok: false, codigo: falha.code, erro: falha.message, erros: falha.erros }); return 3 }
    registrarDegradacao(casa, 'nucleo.cli', falha, env)
    erro.write(`falha inesperada no núcleo: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarNucleo(process.argv.slice(2))
