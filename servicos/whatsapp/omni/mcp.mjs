// Omni — servidor MCP "whatsapp" (stdio), um processo por sessão do Claude Code.
// - Repassa as ferramentas de LEITURA do serviço local com a chave viewer (não consegue enviar).
// - Acrescenta `enviar_para_weriton`: fala só com o Weriton (chave presa ao número dele) e assina
//   com a identidade da sessão que chamou.
// Nenhuma chave fica na configuração do Claude Code: são lidas de %APPDATA%\omni\whatsapp a cada uso.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'

const base = 'http://127.0.0.1:2785'
const run = join(process.env.APPDATA, 'omni', 'whatsapp')
const chave = nome => readFileSync(join(run, nome), 'utf8').trim()
const sessaoWhatsapp = () => readFileSync(join(run, 'sessao.id'), 'utf8').trim()
// Leituras que a API reserva ao papel operator: ficam fora da lista para não oferecer ferramenta que falha.
const SO_OPERATOR = new Set(['WebhooksList', 'WebhookFindBySession', 'WebhookFindOne', 'AutomationRuleFindAll', 'AutomationRuleFindOne', 'GroupGetInviteCode'])
const FERRAMENTA_ENVIO = {
  name: 'enviar_para_weriton',
  description: 'Envia uma mensagem de WhatsApp para o Weriton, e somente para ele. A mensagem sai assinada com a identidade desta sessão (projeto e id). É um aviso de mão única: a resposta dele no WhatsApp não volta para a sessão. Use para avisos ou resultados que ele precisa ver fora do computador.',
  inputSchema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Conteúdo da mensagem, em texto simples, até 4000 caracteres.' },
      identidade: { type: 'string', description: 'Opcional. Como a sessão se apresenta; padrão: "Omni · <projeto>".' },
    },
    required: ['texto'],
  },
}

let rpc = 0
async function upstream(method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave('leitura.key')}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method, params }),
  })
  const t = await r.text()
  const linha = t.split('\n').find(l => l.startsWith('data:'))
  const j = JSON.parse(linha ? linha.slice(5) : t)
  if (j.error) throw new Error(j.error.message || 'erro no serviço WhatsApp')
  return j.result
}

// Descobre qual sessão do Claude chamou: o transcript dela contém o texto desta chamada.
function cauda(caminho, bytes) {
  const fd = openSync(caminho, 'r')
  try {
    const tamanho = statSync(caminho).size, inicio = Math.max(0, tamanho - bytes)
    const buf = Buffer.alloc(tamanho - inicio)
    readSync(fd, buf, 0, buf.length, inicio)
    return buf.toString('utf8')
  } finally { closeSync(fd) }
}
function sessaoClaude(texto) {
  const raiz = join(homedir(), '.claude', 'projects')
  const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const candidatos = []
  let pastas = []
  try { pastas = readdirSync(raiz).filter(d => d.toLowerCase() === slug) } catch { /* sem transcripts */ }
  for (const pasta of pastas) {
    for (const arquivo of readdirSync(join(raiz, pasta))) {
      if (!arquivo.endsWith('.jsonl')) continue
      const caminho = join(raiz, pasta, arquivo)
      candidatos.push({ caminho, id: arquivo.slice(0, -6), mtime: statSync(caminho).mtimeMs })
    }
  }
  candidatos.sort((a, b) => b.mtime - a.mtime)
  const agulha = JSON.stringify(texto).slice(1, 61)
  for (const c of candidatos.slice(0, 8)) if (cauda(c.caminho, 400_000).includes(agulha)) return c.id
  return candidatos[0]?.id ?? null
}

async function enviarParaWeriton(texto, identidade) {
  texto = String(texto ?? '').trim()
  if (!texto) throw new Error('texto vazio')
  if (texto.length > 4000) throw new Error('texto acima de 4000 caracteres')
  const sid = sessaoClaude(texto)
  const projeto = basename(process.cwd())
  const quem = String(identidade ?? '').trim() || `Omni · ${projeto}`
  const corpo = `🤖 *${quem}* · sessão ${sid ? sid.slice(0, 8) : '?'}\n\n${texto}`
  const sessao = sessaoWhatsapp()
  const s = await (await fetch(`${base}/api/sessions/${sessao}`, { headers: { 'X-API-Key': chave('leitura.key') } })).json()
  const fone = (s.data ?? s).phone
  const r = await fetch(`${base}/api/sessions/${sessao}/messages/send-text`, {
    method: 'POST',
    headers: { 'X-API-Key': chave('envio.key'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${fone}@c.us`, text: corpo }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`envio recusado pelo serviço (HTTP ${r.status})`)
  const m = j.data ?? j
  return { waId: m.waMessageId || m.messageId || m.id, sid }
}

const responder = obj => process.stdout.write(JSON.stringify(obj) + '\n')
createInterface({ input: process.stdin }).on('line', async linha => {
  if (!linha.trim()) return
  let msg
  try { msg = JSON.parse(linha) } catch { return }
  const { id, method, params } = msg
  if (id === undefined || id === null) return // notificação: nada a responder
  try {
    if (method === 'initialize') {
      return responder({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'omni-whatsapp', version: '1.0.0' },
        instructions: 'WhatsApp do Weriton. Leitura de conversas, mensagens e contatos; envio só para o próprio Weriton, via enviar_para_weriton. A sessão do WhatsApp fica em %APPDATA%\\omni\\whatsapp\\sessao.id.',
      } })
    }
    if (method === 'ping') return responder({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') {
      const { tools } = await upstream('tools/list', {})
      return responder({ jsonrpc: '2.0', id, result: { tools: [...tools.filter(t => !SO_OPERATOR.has(t.name)), FERRAMENTA_ENVIO] } })
    }
    if (method === 'tools/call') {
      if (params?.name === 'enviar_para_weriton') {
        const { waId, sid } = await enviarParaWeriton(params.arguments?.texto, params.arguments?.identidade)
        return responder({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Enviado ao Weriton pelo WhatsApp (id ${waId}), assinado como esta sessão (${sid ? sid.slice(0, 8) : 'não identificada'}). A resposta dele não volta automaticamente para cá.` }] } })
      }
      if (SO_OPERATOR.has(params?.name)) return responder({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Ferramenta indisponível: a chave desta integração é somente leitura.' }] } })
      return responder({ jsonrpc: '2.0', id, result: await upstream('tools/call', params) })
    }
    responder({ jsonrpc: '2.0', id, error: { code: -32601, message: `método não suportado: ${method}` } })
  } catch (e) {
    responder({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e?.message || e).slice(0, 300) } })
  }
})
