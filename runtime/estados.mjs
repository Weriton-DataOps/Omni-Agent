// Ponte entre os donos dos estados de aprendizado e feedback e o omni.db (plano 3 da F1).
// Os seis módulos JS (modo p2) carregam e gravam por aqui. A loja TS do dist (modo espelho) segue
// no arquivo, e a varredura a acompanha. Quem vence entre arquivo e banco sai da tabela de decisão
// do plano, sempre dentro do BEGIN IMMEDIATE, com o arquivo lido sob a trava do banco (desvio 16).
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'
import { arquivoDoBanco, comBancoDaCasa, registrarDegradacao, sha256, sqliteDisponivel, transacao } from './casa/banco.mjs'
import {
  CATALOGO,
  baseNoDisco,
  confirmarEstadoNoDisco,
  docCanonico,
  escreverEstado,
  importarEstado,
  recomporEstado,
  shaDoEstado
} from './casa/loja-estados.mjs'
import { escreverAtomico, lerSeExistir } from './casa/projecao.mjs'

// Contrato v1 da loja TS de continuidade (dist/adapters/local-json/personality-continuity-store.js).
const VERSAO_DO_ESPELHO = 1

const carimbo = () => new Date().toISOString().replace(/[^0-9]/g, '')

function objetoSimples(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
}

// CATALOGO[rel]?.modo: 'constructor' e '__proto__' dão undefined e são recusados.
function caminhoDoEstado(casa, rel, modo) {
  if (CATALOGO[rel]?.modo !== modo) throw new Error(`Estado fora do catálogo ${modo}: ${rel}`)
  return join(casa, ...rel.split('/'))
}

// Estrutura mínima de um estado: objeto JSON com schemaVersion inteiro.
export function avaliarEstrutura(texto) {
  try {
    const doc = JSON.parse(texto)
    return objetoSimples(doc) && Number.isInteger(doc.schemaVersion)
  } catch {
    return false
  }
}

// quebrada | futura | fora-do-contrato | ok. Versão menor é ok: o dono migra.
export function avaliarTexto(texto, { versao, validar }) {
  let doc
  try {
    doc = JSON.parse(texto)
  } catch {
    return 'quebrada'
  }
  if (!objetoSimples(doc) || !Number.isInteger(doc.schemaVersion)) return 'quebrada'
  if (doc.schemaVersion > versao) return 'futura'
  if (doc.schemaVersion < versao) return 'ok'
  try {
    validar(doc) // o doc não volta a ser usado: o validador do dono pode mexer nele
  } catch {
    return 'fora-do-contrato'
  }
  return 'ok'
}

function validarEspelho(doc) {
  if (Object.keys(doc).sort().join(',') !== 'observations,schemaVersion' || doc.schemaVersion !== VERSAO_DO_ESPELHO ||
      !Array.isArray(doc.observations) || doc.observations.length > 100) {
    throw new Error('Espelho de personalidade fora do contrato v1.')
  }
}

// A tabela de decisão do plano. Roda dentro do BEGIN IMMEDIATE e não toca o disco: devolve o plano
// { acao, devolver, projetar?, copia? } para reconciliar executar.
function decidir(db, rel, fonte, avaliacao) {
  const noBanco = shaDoEstado(db, rel)
  if (noBanco === null) {
    if (fonte === null) return { acao: 'vazia', devolver: null }
    if (avaliarTexto(fonte, avaliacao) !== 'ok') return { acao: 'intocada', devolver: fonte }
    importarEstado(db, rel, fonte)
    return { acao: 'importada', devolver: fonte, copia: 'antes-da-casa' }
  }
  if (fonte === null) return { acao: 'projetada', devolver: recomporEstado(db, rel), projetar: true }
  const base = baseNoDisco(db, rel)
  if (sha256(fonte) === noBanco) {
    if (base !== noBanco) confirmarEstadoNoDisco(db, rel, noBanco)
    return { acao: 'atual', devolver: fonte }
  }
  const situacao = avaliarTexto(fonte, avaliacao)
  if (situacao === 'quebrada') {
    const texto = recomporEstado(db, rel)
    return avaliarTexto(texto, avaliacao) === 'ok'
      ? { acao: 'socorrida', devolver: texto, projetar: true, copia: 'invalida' }
      : { acao: 'intocada', devolver: fonte }
  }
  const doc = JSON.parse(fonte)
  const canonica = `${JSON.stringify(doc, null, 2)}\n`
  const shaCanonica = sha256(canonica)
  if (shaCanonica === noBanco) {
    if (base !== noBanco) confirmarEstadoNoDisco(db, rel, noBanco)
    return { acao: 'atual', devolver: fonte }
  }
  if (shaCanonica === base) return { acao: 'defasada', devolver: recomporEstado(db, rel), projetar: true }
  if (situacao !== 'ok') return { acao: 'intocada', devolver: fonte } // futura ou fora do contrato
  escreverEstado(db, rel, doc, canonica)
  confirmarEstadoNoDisco(db, rel, shaCanonica)
  return { acao: 'ingerida', devolver: fonte }
}

function copiar(casa, destino, texto, env) {
  try {
    writeFileSync(destino, texto, { flag: 'wx' })
    return true
  } catch (erro) {
    registrarDegradacao(casa, 'estado.copia', erro, env)
    return false
  }
}

function projetar(casa, db, rel, arquivo, texto, env) {
  try {
    escreverAtomico(arquivo, texto)
  } catch (erro) {
    registrarDegradacao(casa, 'estado.projetar', erro, env)
    return
  }
  confirmarEstadoNoDisco(db, rel, sha256(texto))
}

// Tudo dentro do BEGIN IMMEDIATE: o arquivo é lido, decidido, copiado e projetado com a trava do
// banco na mão, para nenhuma escrita de outro processo cair entre a leitura e a decisão (desvio 16).
function reconciliar(casa, db, rel, arquivo, avaliacao, env) {
  const fonte = lerSeExistir(arquivo)
  const plano = decidir(db, rel, fonte, avaliacao)
  if (plano.copia === 'antes-da-casa') copiar(casa, `${arquivo}.antes-da-casa.${carimbo()}`, fonte, env)
  if (plano.copia === 'invalida') {
    // Sem cópia, sem socorro (desvio 13).
    if (!copiar(casa, `${arquivo}.invalida.${carimbo()}`, fonte, env)) return { acao: 'intocada', devolver: fonte }
    registrarDegradacao(casa, 'estado.arquivo-invalido', new Error(`${rel} quebrado no disco; cópia guardada e o banco assumiu.`), env)
  }
  if (plano.projetar) projetar(casa, db, rel, arquivo, plano.devolver, env)
  return plano
}

// Carga de um estado p2, sob a trava do dono. Devolve o texto que o dono deve interpretar, ou null
// quando não há estado em lugar nenhum.
export function carregarTextoDoEstado(casa, rel, { versao, validar, env = process.env } = {}) {
  const arquivo = caminhoDoEstado(casa, rel, 'p2')
  const fonte = lerSeExistir(arquivo) // EISDIR e afins sobem antes de abrir o banco
  if (!sqliteDisponivel(env)) return fonte
  if (fonte === null && !existsSync(arquivoDoBanco(casa, 'omni', env))) return null // não cria banco à toa
  try {
    return comBancoDaCasa(casa, 'omni', (db) =>
      transacao(db, () => reconciliar(casa, db, rel, arquivo, { versao, validar }, env)).devolver, env)
  } catch (erro) {
    registrarDegradacao(casa, 'estado.carregar', erro, env)
    if (fonte === null) throw new Error(`Estado ${rel} sem arquivo e sem leitura do banco: recusa começar vazio.`, { cause: erro })
    return fonte
  }
}

// Escrita de um estado p2, sob a trava do dono: banco, arquivo e base na mesma transação.
export function gravarTextoDoEstado(casa, rel, texto, { env = process.env } = {}) {
  const arquivo = caminhoDoEstado(casa, rel, 'p2')
  if (!sqliteDisponivel(env)) {
    escreverAtomico(arquivo, texto)
    return
  }
  let noDisco = false
  try {
    const doc = docCanonico(rel, texto)
    comBancoDaCasa(casa, 'omni', (db) => transacao(db, () => {
      escreverEstado(db, rel, doc, texto)
      try {
        escreverAtomico(arquivo, texto)
      } catch (erro) {
        registrarDegradacao(casa, 'estado.projetar', erro, env)
        return
      }
      noDisco = true
      confirmarEstadoNoDisco(db, rel, sha256(texto))
    }), env)
  } catch (erro) {
    registrarDegradacao(casa, 'estado.gravar', erro, env)
    if (!noDisco) escreverAtomico(arquivo, texto)
  }
}

// Varredura dos oito estados: os p2 só importam o que não tem linha; os espelhos rodam a decisão
// inteira sob a trava da loja TS. Falha num estado degrada só ele.
export async function reconciliarEstados(casa, { env = process.env } = {}) {
  if (!sqliteDisponivel(env)) return { resultado: 'sem-banco', arquivos: {} }
  const arquivos = {}
  for (const [rel, { modo }] of Object.entries(CATALOGO)) {
    try {
      arquivos[rel] = modo === 'p2' ? importarSeAusente(casa, rel, env) : await espelhar(casa, rel, env)
    } catch (erro) {
      registrarDegradacao(casa, modo === 'p2' ? 'estados.varredura' : 'estado.espelho', erro, env)
      arquivos[rel] = 'degradada'
    }
  }
  return { resultado: 'feita', arquivos }
}

function importarSeAusente(casa, rel, env) {
  const arquivo = caminhoDoEstado(casa, rel, 'p2')
  if (!existsSync(arquivo)) return 'sem-arquivo'
  return comBancoDaCasa(casa, 'omni', (db) => transacao(db, () => {
    if (shaDoEstado(db, rel) !== null) return 'presente'
    const fonte = lerSeExistir(arquivo)
    if (fonte === null) return 'sem-arquivo'
    if (!avaliarEstrutura(fonte)) return 'intocada'
    const feito = importarEstado(db, rel, fonte)
    if (feito === 'importada') copiar(casa, `${arquivo}.antes-da-casa.${carimbo()}`, fonte, env)
    return feito
  }), env)
}

function linhaNoBanco(casa, rel, env) {
  return existsSync(arquivoDoBanco(casa, 'omni', env)) &&
    comBancoDaCasa(casa, 'omni', (db) => shaDoEstado(db, rel) !== null, env)
}

async function espelhar(casa, rel, env) {
  const arquivo = caminhoDoEstado(casa, rel, 'espelho')
  // Sem arquivo e sem linha não há o que espelhar, e a trava criaria a pasta feedback/ à toa.
  if (lerSeExistir(arquivo) === null && !linhaNoBanco(casa, rel, env)) return 'vazia'
  const trava = await acquireLocalFileLock(`${arquivo}.lock`, {}) // a mesma trava e as mesmas opções da loja TS
  try {
    const avaliacao = { versao: VERSAO_DO_ESPELHO, validar: validarEspelho }
    return comBancoDaCasa(casa, 'omni', (db) =>
      transacao(db, () => reconciliar(casa, db, rel, arquivo, avaliacao, env)).acao, env)
  } finally {
    await trava.release()
  }
}
