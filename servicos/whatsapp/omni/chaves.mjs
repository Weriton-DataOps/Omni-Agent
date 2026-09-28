// Omni — cria as chaves com escopo do serviço WhatsApp e prova cada uma, inclusive pelo lado negativo.
//   leitura.key : papel viewer, presa à sessão. A API recusa envio para viewer (envio exige operator).
//   envio.key   : papel operator, presa à sessão E ao próprio número. Só consegue falar com o dono.
// Revoga a chave antiga "omni-mcp" (operator sem escopo de conversa). Nunca imprime chave.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const base = 'http://127.0.0.1:2785'
const run = join(process.env.APPDATA, 'omni', 'whatsapp')
const admin = readFileSync(join(run, 'data', '.api-key'), 'utf8').trim().split(/\s+/).pop().replace(/^.*=/, '')
const sessao = readFileSync(join(run, 'sessao.id'), 'utf8').trim()
const desembrulha = j => (j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j)
const api = async (metodo, caminho, corpo, chave = admin) => {
  const r = await fetch(base + caminho, { method: metodo, headers: { 'X-API-Key': chave, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  const t = await r.text(); let j; try { j = desembrulha(JSON.parse(t)) } catch { j = t }
  return { status: r.status, j }
}
const falha = msg => { console.log(`FALHA: ${msg}`); process.exit(1) }

const { j: sess } = await api('GET', `/api/sessions/${sessao}`)
if (sess.status !== 'ready') falha(`sessão não está pronta (${sess.status})`)
const proprio = `${sess.phone}@c.us`

// Chaves antigas com os mesmos nomes saem antes: nome é único por propósito.
const { j: existentes } = await api('GET', '/api/auth/api-keys')
const lista = Array.isArray(existentes) ? existentes : existentes?.items || []
for (const k of lista.filter(k => ['omni-mcp', 'omni-leitura', 'omni-envio-proprio'].includes(k.name) && k.isActive !== false)) {
  const r = await api('POST', `/api/auth/api-keys/${k.id}/revoke`)
  console.log(`revogada: ${k.name} (${k.role}) → HTTP ${r.status}`)
}

const criar = async (corpo) => { const r = await api('POST', '/api/auth/api-keys', corpo); if (r.status >= 300) falha(`criar ${corpo.name}: ${JSON.stringify(r.j).slice(0, 200)}`); return r.j }
const leitura = await criar({ name: 'omni-leitura', role: 'viewer', allowedSessions: [sessao] })
const envio = await criar({ name: 'omni-envio-proprio', role: 'operator', allowedSessions: [sessao], allowedChats: [proprio] })
writeFileSync(join(run, 'leitura.key'), leitura.apiKey, { mode: 0o600 })
writeFileSync(join(run, 'envio.key'), envio.apiKey, { mode: 0o600 })
if (existsSync(join(run, 'mcp.key'))) unlinkSync(join(run, 'mcp.key'))
console.log(`criada: omni-leitura papel=${leitura.role} sessões=${leitura.allowedSessions?.length}`)
console.log(`criada: omni-envio-proprio papel=${envio.role} conversas=${JSON.stringify(envio.allowedChats)}`)

// Provas.
const ler = await api('GET', `/api/sessions/${sessao}/messages?chatId=${encodeURIComponent(proprio)}&limit=1`, null, leitura.apiKey)
console.log(`[leitura lê]            HTTP ${ler.status} ${ler.status === 200 ? '✔' : '✘'}`)
const leituraEnvia = await api('POST', `/api/sessions/${sessao}/messages/send-text`, { chatId: proprio, text: 'isto não deveria sair (chave de leitura)' }, leitura.apiKey)
console.log(`[leitura tenta enviar]  HTTP ${leituraEnvia.status} ${leituraEnvia.status === 403 ? '✔ recusado' : '✘ NÃO recusou'}`)
const envioProprio = await api('POST', `/api/sessions/${sessao}/messages/send-text`, { chatId: proprio, text: '🔐 Teste do Omni: chave de envio presa ao seu número funcionando.' }, envio.apiKey)
console.log(`[envio → você]          HTTP ${envioProprio.status} ${envioProprio.status === 201 ? '✔' : '✘'}`)
const envioOutro = await api('POST', `/api/sessions/${sessao}/messages/send-text`, { chatId: '0@c.us', text: 'isto não deveria sair (fora do escopo)' }, envio.apiKey)
console.log(`[envio → outro destino] HTTP ${envioOutro.status} ${envioOutro.status === 403 ? '✔ recusado' : '✘ NÃO recusou'}`)
