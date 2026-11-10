// Executor do Omni (§4.2, §5): exportar, importar, verificar e instalar a casa. O atualizar chega com
// o zip da release (plano 5b-2), que chama este mesmo arquivo.
// A saída é JSON numa linha. Códigos de saída: 0 ok; 2 uso errado; 3 recusa ou divergência;
// 1 falha inesperada (vai para degradacoes.jsonl).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { arquivoDoBanco, comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import {
  BANCOS_DO_PACOTE, PacoteCasaError, compararRetratos, conferirPacote, exportarCasa, importarCasa, resumirRetrato, retratoDoBanco
} from './casa/pacote-casa.mjs'
import { InstalarError, instalarCasa } from './casa/instalar-casa.mjs'
import { NucleoError } from './casa/loja-nucleo.mjs'
import { casaDoNucleo } from './nucleo.mjs'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const USO = `uso: node runtime/executor.mjs <comando> [opções]
  exportar --saida <pasta>   (nucleo.db e omni.db por VACUUM INTO, com manifesto)
  importar --pacote <pasta> [--substituir]   (confere tudo antes; o banco atual vai para backup datado)
  verificar [--pacote <pasta>]   (integridade do SQLite; com --pacote, contagem e hash por tabela)
  instalar   (cria a casa com os três bancos e registra o Omni desta release)`
class UsoError extends Error {}

function lerOpcoes(argumentos, opcoes, obrigatorias = []) {
  let lidas
  try { lidas = parseArgs({ args: argumentos, options: opcoes, strict: true, allowPositionals: false }).values }
  catch (erro) { throw new UsoError(`opções inválidas (${erro.code ?? erro.name})`) } // nunca ecoa o argumento
  for (const nome of obrigatorias) if (lidas[nome] === undefined || lidas[nome] === '') throw new UsoError(`falta --${nome}`)
  return lidas
}

function versaoDoOmni() {
  try { return JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version ?? null } catch { return null }
}

// Verificar nunca cria banco: arquivo ausente é resposta, não convite.
function verificarCasa(casa, pacote, env) {
  const manifesto = pacote === undefined ? null : conferirPacote(pacote, { env })
  const bancos = {}
  const divergencias = []
  for (const nome of BANCOS_DO_PACOTE) {
    if (!existsSync(arquivoDoBanco(casa, nome, env))) { bancos[nome] = { existe: false }; continue }
    const { integridade, retrato } = comBancoDaCasa(casa, nome, (db) => ({
      integridade: db.prepare('PRAGMA integrity_check').all().map((linha) => Object.values(linha)[0]).join('; '),
      retrato: retratoDoBanco(db)
    }), env)
    bancos[nome] = { existe: true, integridade, ...resumirRetrato(retrato) }
    if (manifesto) for (const d of compararRetratos(manifesto.bancos[nome], retrato)) divergencias.push({ banco: nome, ...d })
  }
  const ok = Object.values(bancos).every((b) => b.existe && b.integridade === 'ok') && divergencias.length === 0
  return { ok, bancos, ...(manifesto ? { pacote: { criado_em: manifesto.criado_em, omni: manifesto.omni }, divergencias } : {}) }
}

export async function rodarExecutor(argv, { saida = process.stdout, erro = process.stderr, env = process.env } = {}) {
  const casa = casaDoNucleo(env)
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'exportar': {
        const o = lerOpcoes(resto, { saida: { type: 'string' } }, ['saida'])
        escrever({ ok: true, ...exportarCasa(casa, resolve(o.saida), { env, omni: versaoDoOmni() }) })
        return 0
      }
      case 'importar': {
        const o = lerOpcoes(resto, { pacote: { type: 'string' }, substituir: { type: 'boolean' } }, ['pacote'])
        escrever({ ok: true, ...importarCasa(casa, resolve(o.pacote), { env, substituir: o.substituir === true }) })
        return 0
      }
      case 'verificar': {
        const o = lerOpcoes(resto, { pacote: { type: 'string' } })
        const r = verificarCasa(casa, o.pacote === undefined ? undefined : resolve(o.pacote), env)
        escrever(r)
        return r.ok ? 0 : 3
      }
      case 'instalar': {
        lerOpcoes(resto, {})
        escrever({ ok: true, ...instalarCasa(casa, RAIZ, { env }) })
        return 0
      }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof PacoteCasaError) {
      escrever({ ok: false, codigo: falha.code, erro: falha.message, ...(falha.divergencias ? { divergencias: falha.divergencias } : {}) })
      return 3
    }
    if (falha instanceof InstalarError || falha instanceof NucleoError) {
      escrever({ ok: false, codigo: falha.code, erro: falha.message, ...(falha.erros ? { erros: falha.erros } : {}) })
      return 3
    }
    registrarDegradacao(casa, 'executor.cli', falha, env)
    erro.write(`falha inesperada no executor: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarExecutor(process.argv.slice(2))
