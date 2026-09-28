// Omni — qualquer sessão fala com o Weriton pelo WhatsApp, mesmo sem o MCP do WhatsApp carregado
// (janelas do VS Code abertas antes do MCP existir). Roda na pasta do projeto:
//   node avisar.mjs "texto"        (ou o texto por stdin)
// Sai pelo número do bot, só para ele, assinado com o projeto e a sessão; se ele responder citando,
// a ponte encaminha a resposta para esta mesma sessão.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { enviarAoDono, anotar } from './config.mjs'

let texto = process.argv.slice(2).join(' ').trim()
if (!texto) texto = readFileSync(0, 'utf8').trim()
if (!texto) { console.error('uso: node avisar.mjs "texto"'); process.exit(1) }
if (texto.length > 4000) texto = texto.slice(0, 4000)

// Qual sessão chamou: a transcrição dela contém este comando. Sem achar, a mais recente do projeto.
function sessaoClaude() {
  const raiz = join(homedir(), '.claude', 'projects')
  const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const pasta = readdirSync(raiz).find(d => d.toLowerCase() === slug)
  if (!pasta) return null
  const candidatos = readdirSync(join(raiz, pasta)).filter(n => n.endsWith('.jsonl'))
    .map(n => ({ id: n.slice(0, -6), caminho: join(raiz, pasta, n), mtime: statSync(join(raiz, pasta, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  const agulha = texto.replace(/["'\\\r\n`$]/g, '').slice(0, 40)
  for (const c of candidatos.slice(0, 8)) {
    const conteudo = readFileSync(c.caminho, 'utf8')
    if (conteudo.slice(-600_000).includes(agulha)) return c.id
  }
  return candidatos[0]?.id ?? null
}

const sid = sessaoClaude()
const projeto = basename(process.cwd())
const identidade = `Omni · ${projeto}`
const waId = await enviarAoDono(`🤖 *${identidade}* · sessão ${sid ? sid.slice(0, 8) : '?'}\n\n${texto}`)
if (sid) anotar({ waMessageId: waId, sessionId: sid, cwd: process.cwd(), projeto, identidade, origem: 'sessao' })
console.log(`Enviado ao Weriton pelo WhatsApp, assinado como ${identidade}${sid ? ` (sessão ${sid.slice(0, 8)})` : ''}.`)
