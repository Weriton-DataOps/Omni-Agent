// Ledger de recibos de autoevolução do Omni (recibo-com-veto).
//
// Modelo único de evolução decidido pelo proprietário em 10/10/2026: todo o
// pipeline de self-improvement (confirmação de memória, incorporação de regra/
// procedimento/eval, admissão de capacidade, promoção de personalidade) age
// sozinho depois dos gates técnicos e, em vez de pedir aprovação prévia,
// registra aqui um recibo visível e reversível. O proprietário vê no radar e
// veta com uma palavra; o veto aciona a reversão própria de cada tipo.
//
// Este módulo é só o ledger: grava, lê, resume para o radar e marca veto. A
// execução concreta da reversão (git revert, des-confirmar memória, supersede
// de personalidade) é responsabilidade de quem registrou, guiada por `revert`.

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'

export const RECIBOS_SCHEMA_VERSION = 1
const RETENCAO_MAXIMA = 200

export const TIPOS_RECIBO = Object.freeze([
  'memory-confirm',
  'operational-rule',
  'procedure',
  'eval',
  'capability',
  'personality'
])

export const ESTRATEGIAS_REVERSAO = Object.freeze([
  'git-revert',
  'contract-revert',
  'memory-unconfirm',
  'personality-supersede',
  'capability-remove'
])

const STATUS = Object.freeze(['active', 'vetoed', 'reverted'])

export function caminhoDosRecibos(casa) {
  if (!isAbsolute(casa ?? '')) {
    throw new Error('A casa do Omni precisa usar caminho absoluto para os recibos de evolução.')
  }
  return join(casa, 'learning', 'evolution-receipts.json')
}

function agora(at) {
  const quando = at ? new Date(at) : new Date()
  if (Number.isNaN(quando.getTime())) throw new Error('Carimbo de tempo inválido para o recibo.')
  return quando.toISOString()
}

function storeVazio(at) {
  const carimbo = agora(at)
  return {
    schemaVersion: RECIBOS_SCHEMA_VERSION,
    store: { id: 'omni-evolution-receipts', createdAt: carimbo, updatedAt: carimbo },
    receipts: []
  }
}

function textoCurto(valor, rotulo, max = 600) {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error(`${rotulo} é obrigatório no recibo.`)
  const limpo = valor.trim()
  if (limpo.length > max) throw new Error(`${rotulo} excede ${max} caracteres.`)
  return limpo
}

function reversaoValida(revert) {
  if (!revert || typeof revert !== 'object') throw new Error('O recibo precisa declarar como reverter.')
  if (!ESTRATEGIAS_REVERSAO.includes(revert.strategy)) {
    throw new Error(`Estratégia de reversão desconhecida: ${revert.strategy}.`)
  }
  const ref = textoCurto(revert.ref, 'A referência de reversão', 400)
  return { strategy: revert.strategy, ref }
}

function reciboValido(item) {
  return item &&
    typeof item.id === 'string' &&
    TIPOS_RECIBO.includes(item.kind) &&
    typeof item.summary === 'string' &&
    typeof item.at === 'string' &&
    STATUS.includes(item.status) &&
    item.revert && ESTRATEGIAS_REVERSAO.includes(item.revert.strategy)
}

function validarStore(store, caminho) {
  if (store?.schemaVersion !== RECIBOS_SCHEMA_VERSION || !Array.isArray(store?.receipts)) {
    throw new Error(`Ledger de recibos inválido em ${caminho}.`)
  }
  // Quarentena por registro: um recibo corrompido é descartado, nunca derruba o ledger inteiro.
  store.receipts = store.receipts.filter(reciboValido)
  return store
}

// Trava no molde das falhas (desvio 15): open com wx, 40 tentativas a cada 50 ms; trava com mais
// de 10 s é de escrita morta. O caminho sai de caminhoDosRecibos, que recusa casa relativa antes
// de criar pasta.
async function adquirirTrava(casa) {
  const pasta = dirname(caminhoDosRecibos(casa))
  await mkdir(pasta, { recursive: true })
  const caminhoDaTrava = join(pasta, 'evolution-receipts.lock')
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    try {
      const handle = await open(caminhoDaTrava, 'wx')
      return async () => {
        await handle.close()
        await unlink(caminhoDaTrava).catch(() => undefined)
      }
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro
      const idade = Date.now() - (await stat(caminhoDaTrava).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (idade > 10_000) await unlink(caminhoDaTrava).catch(() => undefined)
      await new Promise((resolver) => setTimeout(resolver, 50))
    }
  }
  throw new Error('Os recibos de evolução estão ocupados por outra escrita.')
}

// Carga dos escritores, sob a trava, pela ponte do omni.db. lerRecibos segue no arquivo (desvio 8).
function carregarSobTrava(casa) {
  const caminho = caminhoDosRecibos(casa)
  const texto = carregarTextoDoEstado(casa, 'learning/evolution-receipts.json', {
    versao: RECIBOS_SCHEMA_VERSION,
    validar: (doc) => validarStore(doc, caminho)
  })
  return texto === null ? storeVazio() : validarStore(JSON.parse(texto), caminho)
}

function gravar(casa, store, at) {
  store.store.updatedAt = agora(at)
  if (store.receipts.length > RETENCAO_MAXIMA) {
    store.receipts = store.receipts.slice(store.receipts.length - RETENCAO_MAXIMA)
  }
  gravarTextoDoEstado(casa, 'learning/evolution-receipts.json', `${JSON.stringify(store, null, 2)}\n`)
  return store
}

export async function lerRecibos(casa) {
  const caminho = caminhoDosRecibos(casa)
  try {
    return validarStore(JSON.parse(await readFile(caminho, 'utf8')), caminho)
  } catch (erro) {
    if (erro?.code === 'ENOENT') return storeVazio()
    throw erro
  }
}

export async function registrarRecibo(casa, entrada, { at } = {}) {
  const recibo = {
    id: `receipt-${randomUUID()}`,
    kind: TIPOS_RECIBO.includes(entrada?.kind) ? entrada.kind : (() => {
      throw new Error(`Tipo de recibo desconhecido: ${entrada?.kind}.`)
    })(),
    summary: textoCurto(entrada?.summary, 'O resumo do recibo'),
    reason: textoCurto(entrada?.reason, 'O motivo do recibo'),
    subjectId: typeof entrada?.subjectId === 'string' ? entrada.subjectId.slice(0, 200) : null,
    revert: reversaoValida(entrada?.revert),
    status: 'active',
    at: agora(at),
    vetoedAt: null
  }
  const release = await adquirirTrava(casa)
  try {
    const store = carregarSobTrava(casa)
    store.receipts.push(recibo)
    gravar(casa, store, at)
  } finally {
    await release()
  }
  return recibo
}

export async function vetarRecibo(casa, id, { at } = {}) {
  const release = await adquirirTrava(casa)
  try {
    const store = carregarSobTrava(casa)
    const recibo = store.receipts.find((item) => item.id === id)
    if (!recibo) return { result: 'not-found', id }
    if (recibo.status === 'vetoed') return { result: 'already-vetoed', recibo }
    recibo.status = 'vetoed'
    recibo.vetoedAt = agora(at)
    gravar(casa, store, at)
    // O chamador executa a reversão real guiado por recibo.revert e marca 'reverted' depois.
    return { result: 'vetoed', recibo }
  } finally {
    await release()
  }
}

export async function marcarRevertido(casa, id, { at } = {}) {
  const release = await adquirirTrava(casa)
  try {
    const store = carregarSobTrava(casa)
    const recibo = store.receipts.find((item) => item.id === id)
    if (!recibo) return { result: 'not-found', id }
    recibo.status = 'reverted'
    if (!recibo.vetoedAt) recibo.vetoedAt = agora(at)
    gravar(casa, store, at)
    return { result: 'reverted', recibo }
  } finally {
    await release()
  }
}

export async function recibosAtivos(casa) {
  return (await lerRecibos(casa)).receipts.filter((item) => item.status === 'active')
}

// Bloco compacto para o radar do proprietário no hook. Sem segredo, só resumo e o id do veto.
export function resumoParaRadar(receipts, { limite = 8 } = {}) {
  const ativos = (receipts ?? []).filter((item) => item?.status === 'active')
  if (ativos.length === 0) return null
  const recentes = ativos.slice(-limite)
  const linhas = recentes.map((item) => `- [${item.kind}] ${item.summary} — vete com "tira ${item.id}"`)
  const extra = ativos.length > recentes.length ? `\n(+${ativos.length - recentes.length} outros)` : ''
  return [
    `O Omni evoluiu sozinho desde a última vez (${ativos.length} ${ativos.length === 1 ? 'mudança' : 'mudanças'}); cada uma é reversível:`,
    ...linhas
  ].join('\n') + extra
}
