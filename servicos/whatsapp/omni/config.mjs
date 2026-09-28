// Omni — configuração comum do serviço WhatsApp: caminhos, dono, sessões, chaves (cofre) e chamadas à API.
// Duas sessões, cada uma com um papel:
//   · pessoal (sessao.id)     — o WhatsApp do Weriton. O Omni só LÊ.
//   · bot     (sessao-bot.id) — o número do Omni. Canal de conversa: recebe comandos e responde,
//                               falando só com o dono.
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

const espera = ms => new Promise(r => setTimeout(r, ms))

// Chamada à API local, com paciência para dois estados passageiros:
//   429 (cota)                        → espera o Retry-After, até 3 vezes
//   409 (número ainda reconectando)   → espera 5 s, até ~1 min (acontece logo depois de reiniciar)
// `bruto` devolve os bytes (download de mídia) em vez de JSON.
export async function api(caminho, { metodo = 'GET', corpo, papel = 'leitura', bruto = false } = {}) {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(BASE + caminho, {
      method: metodo,
      headers: { 'X-API-Key': chave(papel), 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    if (r.status === 429 && tentativa < 3) {
      await espera(Math.min(Number(r.headers.get('retry-after')) || 2, 30) * 1000)
      continue
    }
    if (r.status === 409 && tentativa < 12) {
      await espera(5000)
      continue
    }
    if (bruto) return { ok: r.ok, status: r.status, buffer: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || '' }
    const t = await r.text()
    let j
    try { j = JSON.parse(t) } catch { j = t }
    return { ok: r.ok, status: r.status, dados: j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j }
  }
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

// Mensagem de voz (ogg/opus) do bot para o dono.
export async function enviarAudioAoDono(ogg, citarId) {
  const corpo = { chatId: donoJid(), base64: ogg.toString('base64'), mimetype: 'audio/ogg; codecs=opus', ptt: true }
  const caminho = `/api/sessions/${sessaoBot()}/messages/send-audio`
  let r = await api(caminho, { metodo: 'POST', corpo: citarId ? { ...corpo, quotedMessageId: citarId } : corpo, papel: 'envio' })
  if (!r.ok && citarId) r = await api(caminho, { metodo: 'POST', corpo, papel: 'envio' })
  if (!r.ok) throw new Error(`áudio recusado pelo serviço (HTTP ${r.status})`)
  return r.dados.waMessageId || r.dados.messageId || r.dados.id
}

// Voz pela OpenAI via omni/voz.ps1 (a chave fica no cofre DPAPI e não passa por aqui).
//   voz('transcrever', bufferDeAudio, mimetype) → texto
//   voz('falar', texto)                         → Buffer ogg/opus
// Falha passageira da OpenAI (demora, 429, 5xx) ganha uma segunda tentativa.
export async function voz(acao, entrada, tipo = 'audio/ogg') {
  try { return await vozUmaVez(acao, entrada, tipo) } catch (e) {
    if (!/a tempo|HTTP (429|5\d\d)/.test(e.message)) throw e
    return vozUmaVez(acao, entrada, tipo)
  }
}
function vozUmaVez(acao, entrada, tipo) {
  const script = fileURLToPath(new URL('./voz.ps1', import.meta.url))
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Acao', acao, '-Tipo', tipo], { windowsHide: true })
    let saida = ''
    const limite = setTimeout(() => { p.kill(); reject(new Error('a voz passou de 3 minutos')) }, 180_000)
    p.stdout.on('data', d => { saida += d })
    p.on('error', e => { clearTimeout(limite); reject(e) })
    p.on('close', () => {
      clearTimeout(limite)
      let j
      try { j = JSON.parse(saida.trim().split('\n').pop()) } catch { return reject(new Error('a voz devolveu uma saída inesperada')) }
      if (!j.ok) return reject(new Error(j.erro || 'voz indisponível'))
      resolve(acao === 'falar' ? Buffer.from(j.audio64, 'base64') : Buffer.from(j.texto64, 'base64').toString('utf8'))
    })
    p.stdin.end((Buffer.isBuffer(entrada) ? entrada : Buffer.from(String(entrada), 'utf8')).toString('base64'))
  })
}
