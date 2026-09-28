// Omni — cria as chaves com escopo do serviço WhatsApp, grava no cofre e prova cada uma pelos dois lados.
//   leitura : papel viewer, presa às duas sessões (pessoal e bot). A API recusa envio a viewer.
//   envio   : papel operator, presa à sessão do BOT e à conversa com o dono. O bot só fala com o dono,
//             e nada sai pela sessão pessoal do Weriton.
// Revoga as chaves anteriores com os mesmos nomes. Nunca imprime chave. Admin vem do cofre.
import { gravarSegredo, lerSegredo, NOMES } from './cofre.mjs'
import { BASE, sessaoPessoal, sessaoBot, donoJid } from './config.mjs'

const admin = lerSegredo(NOMES.admin)
const pessoal = sessaoPessoal()
const bot = sessaoBot()
const api = async (metodo, caminho, corpo, chave = admin) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'X-API-Key': chave, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, j: j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j }
}
const falha = msg => { console.log(`FALHA: ${msg}`); process.exit(1) }

for (const [nome, id] of [['pessoal', pessoal], ['bot', bot]]) {
  const { j } = await api('GET', `/api/sessions/${id}`)
  if (j.status !== 'ready') falha(`sessão ${nome} não está pronta (${j.status})`)
  console.log(`sessão ${nome}: ready · ${String(j.phone).slice(0, 4)}…${String(j.phone).slice(-2)}`)
}
const dono = donoJid()

const { j: existentes } = await api('GET', '/api/auth/api-keys')
for (const k of (Array.isArray(existentes) ? existentes : existentes?.items || []).filter(k => ['omni-mcp', 'omni-leitura', 'omni-envio-proprio', 'omni-envio-dono'].includes(k.name) && k.isActive !== false)) {
  console.log(`revogada: ${k.name} (${k.role}) → HTTP ${(await api('POST', `/api/auth/api-keys/${k.id}/revoke`)).status}`)
}

const criar = async corpo => { const r = await api('POST', '/api/auth/api-keys', corpo); if (r.status >= 300) falha(`criar ${corpo.name}: ${JSON.stringify(r.j).slice(0, 200)}`); return r.j }
const leitura = await criar({ name: 'omni-leitura', role: 'viewer', allowedSessions: [pessoal, bot] })
const envio = await criar({ name: 'omni-envio-dono', role: 'operator', allowedSessions: [bot], allowedChats: [dono] })
gravarSegredo(NOMES.leitura, leitura.apiKey)
gravarSegredo(NOMES.envio, envio.apiKey)
console.log(`criada no cofre: omni-leitura papel=${leitura.role} sessões=2`)
console.log(`criada no cofre: omni-envio-dono papel=${envio.role} sessões=bot conversas=dono`)

// Provas, com as chaves lidas de volta do cofre.
const k = { leitura: lerSegredo(NOMES.leitura), envio: lerSegredo(NOMES.envio) }
// Recusa pode vir como 401 (chave não vale para aquela sessão) ou 403 (vale, sem permissão): ambas bastam.
const RECUSA = [401, 403]
const linha = (rotulo, status, esperado) => {
  const ok = Array.isArray(esperado) ? esperado.includes(status) : status === esperado
  console.log(`${rotulo.padEnd(34)} HTTP ${status} ${ok ? (Array.isArray(esperado) ? '✔ recusado' : '✔') : '✘ esperado ' + esperado}`)
}
linha('[leitura lê a sessão pessoal]', (await api('GET', `/api/sessions/${pessoal}/messages?limit=1`, null, k.leitura)).status, 200)
linha('[leitura lê a sessão do bot]', (await api('GET', `/api/sessions/${bot}/messages?limit=1`, null, k.leitura)).status, 200)
linha('[leitura tenta enviar]', (await api('POST', `/api/sessions/${bot}/messages/send-text`, { chatId: dono, text: 'isto não deveria sair (chave de leitura)' }, k.leitura)).status, RECUSA)
linha('[envio: bot → dono]', (await api('POST', `/api/sessions/${bot}/messages/send-text`, { chatId: dono, text: '🔐 Omni: este é o número do bot. É por aqui que a gente conversa.' }, k.envio)).status, 201)
linha('[envio: bot → outro destino]', (await api('POST', `/api/sessions/${bot}/messages/send-text`, { chatId: '0@c.us', text: 'isto não deveria sair (fora do escopo)' }, k.envio)).status, RECUSA)
linha('[envio pela sessão pessoal]', (await api('POST', `/api/sessions/${pessoal}/messages/send-text`, { chatId: dono, text: 'isto não deveria sair (sessão pessoal)' }, k.envio)).status, RECUSA)
