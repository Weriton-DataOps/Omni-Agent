// Omni — pareamento: mantém %APPDATA%\omni\whatsapp\pareamento.html com o QR sempre atual (o QR do
// WhatsApp expira em ~20 s) e encerra quando a sessão chega a 'ready'.
//   node omni/parear.mjs         → sessão pessoal (sessao.id), para parear de novo se o celular desconectar
//   node omni/parear.mjs --bot   → sessão do bot (cria "omni-bot" se não existir e grava sessao-bot.id)
// Abrir a página no navegador e escanear com o celular do número correspondente.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { lerSegredo, NOMES } from './cofre.mjs'
import { BASE, arquivo } from './config.mjs'

const QR = createRequire(new URL('../package.json', import.meta.url))('qrcode')
const admin = lerSegredo(NOMES.admin)
const bot = process.argv.includes('--bot')
const pagina = arquivo('pareamento.html')

const api = async (metodo, caminho, corpo) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'X-API-Key': admin, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = { bruto: t } }
  return { ok: r.ok, status: r.status, dados: j && typeof j === 'object' && 'data' in j ? j.data : j }
}

// Sessão alvo.
let sessao
if (bot) {
  if (existsSync(arquivo('sessao-bot.id'))) sessao = readFileSync(arquivo('sessao-bot.id'), 'utf8').trim()
  else {
    const { dados: lista } = await api('GET', '/api/sessions')
    const existente = (Array.isArray(lista) ? lista : lista?.items || []).find(s => s.name === 'omni-bot')
    sessao = existente?.id ?? (await api('POST', '/api/sessions', { name: 'omni-bot' })).dados.id
    writeFileSync(arquivo('sessao-bot.id'), sessao)
  }
} else sessao = readFileSync(arquivo('sessao.id'), 'utf8').trim()
const rotulo = bot ? 'o número do bot do Omni' : 'o seu WhatsApp pessoal'
console.log(`sessão ${bot ? 'bot' : 'pessoal'}: ${sessao}`)

const html = corpo => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Omni · parear WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8e8;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center;max-width:420px;padding:16px}img{width:320px;height:320px;background:#fff;padding:12px;border-radius:12px}
p{color:#b5b9c2;line-height:1.5}h1{font-size:20px}</style></head><body><main>${corpo}</main></body></html>`

// Estados reais (session.entity.ts): created, initializing, qr_ready, authenticating, ready,
// disconnected, action_required, failed. Conectado é exatamente 'ready'.
let ultimo = '', reinicios = 0, pareado = false
const inicio = Date.now()
const { dados: atual } = await api('GET', `/api/sessions/${sessao}`)
if (atual.status !== 'ready') await api('POST', `/api/sessions/${sessao}/start`)
while (Date.now() - inicio < 10 * 60_000) {
  const { dados: s } = await api('GET', `/api/sessions/${sessao}`)
  const estado = String(s?.status || '')
  if (estado === 'ready') {
    writeFileSync(pagina, html(`<h1>✅ Pareado</h1><p>${rotulo} está conectado (${String(s.phone).slice(0, 4)}…${String(s.phone).slice(-2)}). Pode fechar esta janela.</p>`))
    console.log(`PAREADO status=ready fone=${String(s.phone).slice(0, 4)}…${String(s.phone).slice(-2)}`)
    pareado = true
    break
  }
  if (['disconnected', 'failed'].includes(estado) && reinicios < 3) {
    reinicios++; ultimo = ''
    console.log(`sessão ${estado}; reiniciando (${reinicios}/3) → ${(await api('POST', `/api/sessions/${sessao}/start`)).status}`)
    await new Promise(r => setTimeout(r, 3000)); continue
  }
  if (estado === 'action_required') { console.log(`AÇÃO NECESSÁRIA: ${s.lastError || 'ver log do serviço'}`); break }
  const { dados: q } = await api('GET', `/api/sessions/${sessao}/qr`)
  const codigo = q?.qrCode
  if (codigo && codigo !== ultimo) {
    ultimo = codigo
    const img = codigo.startsWith('data:image') ? codigo : await QR.toDataURL(codigo, { margin: 1, width: 640 })
    writeFileSync(pagina, html(`<h1>Parear ${rotulo}</h1><img src="${img}" alt="QR de pareamento"><p>No celular de ${rotulo}: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para este código.</p><p>O código se renova sozinho. Estado: ${estado || 'aguardando'}</p>`))
    console.log(`QR novo · estado=${estado} · ${new Date().toLocaleTimeString('pt-BR')}`)
  } else if (!codigo && !ultimo) {
    writeFileSync(pagina, html(`<h1>Preparando o código…</h1><p>Estado: ${estado || 'iniciando'}</p>`))
  }
  await new Promise(r => setTimeout(r, 3000))
}
if (!pareado) console.log('ENCERRADO sem pareamento')
process.exitCode = pareado ? 0 : 2
