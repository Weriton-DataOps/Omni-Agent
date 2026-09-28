// Omni — configuração comum do serviço WhatsApp: caminhos, dono, sessões, chaves (cofre) e chamadas à API.
// Duas sessões, cada uma com um papel:
//   · pessoal (sessao.id)     — o WhatsApp do Weriton. O Omni só LÊ.
//   · bot     (sessao-bot.id) — o número do Omni. Canal de conversa: recebe comandos e responde,
//                               falando só com o dono.
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { lerSegredo, NOMES } from './cofre.mjs'

export const BASE = 'http://127.0.0.1:2785'
export const RUN = join(process.env.APPDATA, 'omni', 'whatsapp')
export const arquivo = nome => join(RUN, nome)
export const sessaoPessoal = () => readFileSync(arquivo('sessao.id'), 'utf8').trim()
export const sessaoBot = () => {
  if (!existsSync(arquivo('sessao-bot.id'))) throw new Error('o número do bot ainda não foi pareado (node omni/parear.mjs --bot)')
  return readFileSync(arquivo('sessao-bot.id'), 'utf8').trim()
}
export const dono = () => readFileSync(arquivo('dono.txt'), 'utf8').trim().replace(/\D/g, '')
export const donoJid = () => `${dono()}@c.us`
export const chave = papel => lerSegredo(NOMES[papel])
export const usuario = jid => String(jid || '').split('@')[0].split(':')[0]

export async function api(caminho, { metodo = 'GET', corpo, papel = 'leitura' } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'X-API-Key': chave(papel), 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const t = await r.text()
  let j
  try { j = JSON.parse(t) } catch { j = t }
  return { ok: r.ok, status: r.status, dados: j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j }
}

// Livro da ponte: qual sessão assinou cada mensagem que o bot mandou ao dono.
const LIVRO = () => arquivo('ponte-ledger.jsonl')
export function anotar(entrada) {
  appendFileSync(LIVRO(), JSON.stringify({ ...entrada, at: new Date().toISOString() }) + '\n')
}
export function livro() {
  const mapa = new Map()
  if (!existsSync(LIVRO())) return mapa
  for (const linha of readFileSync(LIVRO(), 'utf8').split('\n')) {
    if (!linha.trim()) continue
    try { const e = JSON.parse(linha); if (e.waMessageId) mapa.set(e.waMessageId, e) } catch { /* linha parcial */ }
  }
  return mapa
}

// O bot envia ao dono (única conversa que a chave de envio alcança). Devolve o id WhatsApp da mensagem.
export async function enviarAoDono(texto, citarId) {
  const corpo = { chatId: donoJid(), text: texto, ...(citarId ? { quotedMessageId: citarId } : {}) }
  let r = await api(`/api/sessions/${sessaoBot()}/messages/send-text`, { metodo: 'POST', corpo, papel: 'envio' })
  if (!r.ok && citarId) r = await api(`/api/sessions/${sessaoBot()}/messages/send-text`, { metodo: 'POST', corpo: { chatId: donoJid(), text: texto }, papel: 'envio' })
  if (!r.ok) throw new Error(`envio recusado pelo serviço (HTTP ${r.status})`)
  return r.dados.waMessageId || r.dados.messageId || r.dados.id
}
