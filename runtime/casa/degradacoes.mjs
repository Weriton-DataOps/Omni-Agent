// Leitura do registro de degradações da casa (desenho §3.6), só para o diagnóstico. Quem grava é o
// registrarDegradacao do banco.mjs. Nada é criado nem aberto além do próprio arquivo, e nada sai que
// o gravador não escreva: cada linha é refeita só com data, operação, código e erro.
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { pastaDoBanco } from './banco.mjs'

export const LIMITE_LEITURA = 256 * 1024
const DIA_MS = 24 * 60 * 60 * 1000
const OPERACAO = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/
const CODIGO = /^[A-Z][A-Z0-9_]{0,39}$/

function vazio(registro, codigo = null) {
  return { registro, codigo, bytes: 0, truncado: false, linhas: 0, linhasInvalidas: 0, nas24h: 0, ultimaEm: null, operacoes: [] }
}

// Uma linha só conta se tiver a forma exata que o gravador escreve; o resto vira null e é contado
// como inválido, sem que nenhum trecho dela saia.
function linhaDoRegistro(texto) {
  let dado
  try { dado = JSON.parse(texto) } catch { return null }
  // A data só vale se voltar idêntica do toISOString, que é como o gravador a escreve: isso recusa
  // de uma vez o que não é texto, o que não é data e a data sem os milissegundos.
  const quando = Date.parse(dado?.em)
  if (Number.isNaN(quando) || new Date(quando).toISOString() !== dado.em) return null
  const { em, operacao, codigo, erro } = dado
  if (typeof operacao !== 'string' || operacao.length > 60 || !OPERACAO.test(operacao)) return null
  return { em, quando, operacao,
    codigo: typeof codigo === 'string' && CODIGO.test(codigo) ? codigo : null,
    erro: typeof erro === 'string' ? erro.slice(0, 300) : '' }
}

// Lê no máximo os últimos LIMITE_LEITURA bytes. O byte anterior à cauda diz se ela começa no meio
// de uma linha: se começa, essa linha cortada é descartada inteira.
async function lerCauda(arquivo) {
  const fh = await open(arquivo, 'r')
  try {
    const info = await fh.stat()
    if (!info.isFile()) throw Object.assign(new Error('o registro não é um arquivo'), { code: 'EISDIR' })
    const inicio = Math.max(0, info.size - LIMITE_LEITURA)
    const desde = inicio > 0 ? inicio - 1 : 0
    const buffer = Buffer.alloc(info.size - desde)
    const { bytesRead } = await fh.read(buffer, 0, buffer.length, desde)
    let cauda = buffer.subarray(0, bytesRead)
    if (inicio > 0) {
      const quebra = cauda.indexOf(0x0a)
      cauda = quebra < 0 ? cauda.subarray(cauda.length) : cauda.subarray(quebra + 1)
    }
    return { bytes: info.size, truncado: inicio > 0, texto: cauda.toString('utf8') }
  } finally {
    await fh.close()
  }
}

export async function lerDegradacoes(casa, env = process.env, { agora = new Date() } = {}) {
  let cauda
  try { cauda = await lerCauda(join(pastaDoBanco(casa, env), 'degradacoes.jsonl')) }
  catch (erro) {
    if (erro?.code === 'ENOENT') return vazio('ausente')
    return vazio('ilegivel', typeof erro?.code === 'string' ? erro.code : null)
  }
  const desde = agora.getTime() - DIA_MS
  const porOperacao = new Map()
  const resumo = { ...vazio('presente'), bytes: cauda.bytes, truncado: cauda.truncado }
  let ultima = null
  for (const texto of cauda.texto.split('\n')) {
    if (texto.trim() === '') continue
    const linha = linhaDoRegistro(texto)
    if (!linha) { resumo.linhasInvalidas++; continue }
    resumo.linhas++
    const recente = linha.quando >= desde
    if (recente) resumo.nas24h++
    if (!ultima || linha.quando > ultima.quando) ultima = linha
    let op = porOperacao.get(linha.operacao)
    if (!op) {
      op = { operacao: linha.operacao, total: 0, nas24h: 0, primeira: linha, ultima: linha }
      porOperacao.set(linha.operacao, op)
    }
    op.total++
    if (recente) op.nas24h++
    if (linha.quando < op.primeira.quando) op.primeira = linha
    // Empate na data: vence a linha mais adiante no arquivo, que é a gravada por último.
    if (linha.quando >= op.ultima.quando) op.ultima = linha
  }
  resumo.ultimaEm = ultima ? ultima.em : null
  resumo.operacoes = [...porOperacao.values()]
    .sort((a, b) => b.ultima.quando - a.ultima.quando)
    .map((op) => ({ operacao: op.operacao, total: op.total, nas24h: op.nas24h,
      primeiraEm: op.primeira.em, ultimaEm: op.ultima.em,
      ultimoCodigo: op.ultima.codigo, ultimoErro: op.ultima.erro }))
  return resumo
}
