// Omni — vigia do pareamento: mantém %APPDATA%\omni\whatsapp\pareamento.html com o QR sempre atual
// (o QR do WhatsApp expira em ~20 s) e encerra quando a sessão chega a 'ready'.
// Uso: node servicos/whatsapp/omni/parear.mjs, e abrir a página no navegador.
// Só é preciso de novo se a sessão for desconectada pelo celular.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const QR = createRequire(new URL('../package.json', import.meta.url))('qrcode')
const base = 'http://127.0.0.1:2785'
const run = join(process.env.APPDATA, 'omni', 'whatsapp')
const bruto = readFileSync(join(run, 'data', '.api-key'), 'utf8').trim()
let admin = bruto
try { const j = JSON.parse(bruto); admin = j.key || j.apiKey || bruto } catch { admin = bruto.split(/\s+/).pop().replace(/^.*=/, '') }
const sessao = readFileSync(join(run, 'sessao.id'), 'utf8').trim()
const pagina = join(run, 'pareamento.html')

const get = async (caminho) => {
  const r = await fetch(base + caminho, { headers: { 'X-API-Key': admin } })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = { bruto: t } }
  return { ok: r.ok, status: r.status, dados: j && typeof j === 'object' && 'data' in j ? j.data : j }
}
const html = (corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Omni · parear WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8e8;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center;max-width:420px;padding:16px}img{width:320px;height:320px;background:#fff;padding:12px;border-radius:12px}
p{color:#b5b9c2;line-height:1.5}h1{font-size:20px}</style></head><body><main>${corpo}</main></body></html>`

// Estados reais (session.entity.ts): created, initializing, qr_ready, authenticating, ready,
// disconnected, action_required, failed. Conectado é exatamente 'ready'.
const post = async (caminho) => fetch(base + caminho, { method: 'POST', headers: { 'X-API-Key': admin } }).then(r => r.status)
let ultimo = ''
let reinicios = 0
let pareado = false
const inicio = Date.now()
while (Date.now() - inicio < 10 * 60_000) {
  const s = await get(`/api/sessions/${sessao}`)
  const estado = String(s.dados?.status || '')
  if (estado === 'ready') {
    writeFileSync(pagina, html(`<h1>✅ WhatsApp pareado</h1><p>Conectado como <b>${s.dados?.pushName || s.dados?.phone || 'sua conta'}</b>. Pode fechar esta janela.</p>`))
    console.log(`PAREADO status=${estado} nome=${s.dados?.pushName || '-'}`)
    pareado = true
    break
  }
  if (['disconnected', 'failed'].includes(estado) && reinicios < 3) {
    reinicios++; ultimo = ''
    console.log(`sessão ${estado}; reiniciando (${reinicios}/3) → ${await post(`/api/sessions/${sessao}/start`)}`)
    await new Promise(r => setTimeout(r, 3000)); continue
  }
  if (estado === 'action_required') { console.log(`AÇÃO NECESSÁRIA: ${s.dados?.lastError || 'ver log'}`); break }
  const q = await get(`/api/sessions/${sessao}/qr`)
  const codigo = q.dados?.qrCode
  if (codigo && codigo !== ultimo) {
    ultimo = codigo
    const img = codigo.startsWith('data:image') ? codigo : await QR.toDataURL(codigo, { margin: 1, width: 640 })
    writeFileSync(pagina, html(`<h1>Parear o WhatsApp com o Omni</h1><img src="${img}" alt="QR de pareamento"><p>No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para este código.</p><p>O código se renova sozinho. Estado: ${estado || 'aguardando'}</p>`))
    console.log(`QR novo · estado=${estado} · ${new Date().toLocaleTimeString('pt-BR')}`)
  } else if (!codigo && !ultimo) {
    writeFileSync(pagina, html(`<h1>Preparando o código…</h1><p>Estado: ${estado || 'iniciando'} (${q.status})</p>`))
  }
  await new Promise(r => setTimeout(r, 3000))
}
if (!pareado) console.log('ENCERRADO sem pareamento')
process.exitCode = pareado ? 0 : 2
