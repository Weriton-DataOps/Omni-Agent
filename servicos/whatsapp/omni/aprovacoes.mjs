// Omni — aprovação por reação (21/10). A visita do Actions pede antes de rodar código de terceiro ou algo
// pago: manda ao Weriton uma mensagem de risco e espera a reação dele NAQUELA mensagem.
//   👍 roda · 👎 não · ❓ explica (a visita manda o detalhe e espera nova reação) · resposta em texto
//   citando a mensagem = "outra resposta" (a ponte grava aqui e a visita segue o texto)
// Só vale vindo do número dele, naquela mensagem, uma vez, antes de expirar e para o mesmo commit e
// comando do pedido. Reação retirada antes do início cancela; trocada, vale a última; emoji fora da
// tabela não autoriza nada. O motor já guarda as reações em metadata.reactions da mensagem.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { arquivo, api, sessaoBot, dono, usuario, enviarAoDono, anotar } from './config.mjs'

const REGISTRO = () => arquivo('aprovacoes.json')
export const VALIDADE_MS = 4 * 3600_000
const SIM = /^👍(?:[\u{1F3FB}-\u{1F3FF}])?$/u
const NAO = /^👎(?:[\u{1F3FB}-\u{1F3FF}])?$/u
const EXPLICA = /^[❓❔](?:️)?$/u

export function carregar() {
  try { return JSON.parse(readFileSync(REGISTRO(), 'utf8')) } catch { return { pedidos: {} } }
}
function guardar(reg) {
  const tmp = `${REGISTRO()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(reg, null, 2))
  renameSync(tmp, REGISTRO())
}

export const assinatura = (commit, comando) => createHash('sha256').update(`${String(commit).trim()}\n${String(comando).trim()}`).digest('hex')

export function textoDoPedido(p) {
  return [
    `⚠️ *Actions · pedido de risco* — ${p.titulo}`,
    '',
    `*O que é:* ${p.repo} @ ${String(p.commit).slice(0, 12)}`,
    `*O que vai rodar:* ${p.comando}`,
    `*O que pode tocar:* ${p.toca}`,
    `*Risco:* ${p.nivel}`,
    '',
    'Reaja nesta mensagem: 👍 roda / 👎 não / ❓ explica / responda pra outra coisa.',
    `Vale uma vez, só para este commit, até ${new Date(p.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`,
  ].join('\n')
}

// Decisão pura (testável): pedido + reações já resolvidas para telefone → estado.
//   reacoes: [{ fone, emoji }] — a do dono é a única que conta
export function decidir(pedido, reacoes, { donoFone, agora = Date.now(), commit, comando } = {}) {
  if (!pedido) return { estado: 'invalido', motivo: 'pedido desconhecido' }
  if (commit !== undefined && assinatura(commit, comando) !== pedido.assinatura) return { estado: 'invalido', motivo: 'o código ou o comando mudou: precisa de pedido novo' }
  if (pedido.estado === 'usado') return { estado: 'usado', motivo: 'esta aprovação já foi usada' }
  if (pedido.estado === 'cancelado') return { estado: 'cancelado', motivo: 'pedido cancelado' }
  if (agora > pedido.expiraEm) return { estado: 'expirado', motivo: 'passou da validade' }
  const dele = (reacoes || []).filter(r => r && r.fone && r.fone === donoFone && r.emoji)
  const emoji = dele.length ? dele[dele.length - 1].emoji : ''
  if (emoji && SIM.test(emoji)) return { estado: 'sim' }
  if (emoji && NAO.test(emoji)) return { estado: 'nao' }
  if (emoji && EXPLICA.test(emoji)) return { estado: 'explica', jaExplicado: !!pedido.explicadoEm }
  if (pedido.resposta?.texto) return { estado: 'outra', texto: pedido.resposta.texto }
  if (emoji) return { estado: 'pendente', motivo: `emoji fora da tabela (${emoji}) não autoriza nada` }
  return { estado: 'pendente', motivo: 'sem reação dele ainda' }
}

// metadata.reactions: { senderJid: emoji }. O jid pode ser @lid: resolve para telefone pela API.
async function resolver(reactions) {
  const saida = []
  for (const [jid, emoji] of Object.entries(reactions || {})) {
    let fone = usuario(jid)
    if (String(jid).endsWith('@lid')) {
      const r = await api(`/api/sessions/${sessaoBot()}/contacts/${encodeURIComponent(jid)}/phone`)
      fone = r.ok ? usuario(r.dados?.phone || r.dados?.phoneNumber || r.dados?.number || '') : ''
    }
    saida.push({ fone: String(fone).replace(/\D/g, ''), emoji: String(emoji || '') })
  }
  return saida
}

export async function reacoesDa(waId, mensagens) {
  let lista = mensagens
  if (!lista) {
    const r = await api(`/api/sessions/${sessaoBot()}/messages?limit=200&inlineMedia=false`)
    if (!r.ok) throw new Error(`não consegui ler as mensagens do bot (HTTP ${r.status})`)
    lista = r.dados?.messages || []
  }
  const m = lista.find(x => x.waMessageId === waId)
  return m ? resolver(m.metadata?.reactions) : null
}

export async function pedir({ titulo, repo, commit, comando, toca, nivel, visita = '' }) {
  for (const [k, v] of Object.entries({ titulo, repo, commit, comando, toca, nivel })) if (!String(v || '').trim()) throw new Error(`falta ${k}`)
  if (!/^(baixo|médio|medio|alto)$/i.test(nivel)) throw new Error('nível: baixo, médio ou alto')
  const reg = carregar()
  if (visita && Object.values(reg.pedidos).some(p => p.visita === visita)) throw new Error('esta visita já fez o seu pedido de risco (um por visita)')
  const agora = Date.now()
  const pedido = { titulo, repo, commit: String(commit).trim(), comando: String(comando).trim(), toca, nivel, visita, criadoEm: agora, expiraEm: agora + VALIDADE_MS, estado: 'pendente', assinatura: assinatura(commit, comando) }
  const waId = await enviarAoDono(textoDoPedido(pedido))
  anotar({ waMessageId: waId, identidade: 'Actions · visita', tipo: 'pedido-de-risco' })
  reg.pedidos[waId] = pedido
  guardar(reg)
  return { waId, expiraEm: pedido.expiraEm }
}

export async function consultar(waId, { commit, comando } = {}, mensagens) {
  const reg = carregar()
  const pedido = reg.pedidos[waId]
  const reacoes = pedido ? await reacoesDa(waId, mensagens) : []
  return decidir(pedido, reacoes || [], { donoFone: dono(), commit, comando })
}

// usar a aprovação: só passa com 👍 válido, e marca como usada na mesma escrita (vale uma vez)
export async function consumir(waId, { commit, comando }) {
  const d = await consultar(waId, { commit, comando })
  if (d.estado !== 'sim') return d
  const reg = carregar()
  if (reg.pedidos[waId]?.estado !== 'pendente') return { estado: 'usado', motivo: 'esta aprovação já foi usada' }
  reg.pedidos[waId].estado = 'usado'
  reg.pedidos[waId].usadoEm = Date.now()
  guardar(reg)
  return { estado: 'sim', usado: true }
}

export async function explicar(waId, texto) {
  const reg = carregar()
  if (!reg.pedidos[waId]) throw new Error('pedido desconhecido')
  await enviarAoDono(`ℹ️ ${String(texto).trim()}\n\nSe ficou claro, troque a reação na mensagem do pedido: 👍 roda / 👎 não.`, waId)
  reg.pedidos[waId].explicadoEm = Date.now()
  guardar(reg)
}

// a ponte chama quando ele responde em texto citando o pedido; devolve true se era um pedido pendente
export function registrarResposta(waId, texto) {
  const reg = carregar()
  const p = reg.pedidos[waId]
  if (!p || p.estado !== 'pendente' || Date.now() > p.expiraEm) return false
  p.resposta = { texto: String(texto || '').slice(0, 2000), em: Date.now() }
  guardar(reg)
  return true
}

export const pendentes = () => Object.entries(carregar().pedidos).filter(([, p]) => p.estado === 'pendente' && Date.now() <= p.expiraEm).map(([waId, p]) => ({ waId, ...p }))
export const existe = () => existsSync(REGISTRO())
