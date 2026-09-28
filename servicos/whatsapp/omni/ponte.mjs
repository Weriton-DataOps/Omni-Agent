// Omni — ponte WhatsApp ↔ sessões do Claude.
// O número do bot é a sessão pareada; o dono (Weriton) conversa com ele como com um contato.
//   · mensagem do dono, sem citação       → sessão central do Omni responde
//   · resposta citando mensagem de sessão → a sessão que assinou aquela mensagem responde
// Travas:
//   · só mensagens RECEBIDAS e vindas do número do dono acordam sessões (qualquer outro contato é ignorado)
//   · sessão que não foi criada pela ponte (ex.: VS Code) responde numa cópia (--fork-session)
//   · pelo celular nada que exija aprovação roda: a sessão é headless e recusa o que pediria permissão
//   · "/pausa" suspende a ponte, "/volta" retoma
// O log não guarda conteúdo de mensagem, só ids e tamanhos.
// Teste sem WhatsApp de entrada:  node ponte.mjs --simular "texto" [--citar <waMessageId>]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { arquivo, sessaoBot, dono, donoJid, api, usuario, livro, anotar, enviarAoDono } from './config.mjs'

const CLAUDE = process.env.OMNI_CLAUDE_EXE || arquivoNpm('@anthropic-ai/claude-code/bin/claude.exe')
const CENTRAL_CWD = process.env.OMNI_CENTRAL_CWD || fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '')
const SISTEMA = 'Canal: WhatsApp do Weriton, pelo número do bot do Omni. Responda curto e direto, em texto simples de WhatsApp (sem tabelas, sem títulos markdown, sem blocos longos de código). Neste canal ninguém consegue aprovar permissões: se a tarefa exigir alterar arquivos ou rodar comandos que precisem de aprovação, diga o que faria e peça para ele confirmar no computador.'
const INTERVALO_MS = 3000
function arquivoNpm(relativo) { return `${process.env.APPDATA}\\npm\\node_modules\\${relativo.replace(/\//g, '\\')}` }

mkdirSync(arquivo('logs'), { recursive: true })
const log = (...partes) => appendFileSync(arquivo('logs/ponte.log'), `${new Date().toISOString()} ${partes.join(' ')}\n`)

// Estado: sessão central, pausa e mensagens já tratadas (sobrevive a reinício sem reprocessar).
const ESTADO = arquivo('ponte.json')
const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { central: null, centralCriada: false, pausada: false, processados: [] }
const processados = new Set(estado.processados || [])
const salvar = () => { estado.processados = [...processados].slice(-500); writeFileSync(ESTADO, JSON.stringify(estado, null, 2)) }
const inicioMs = Date.now() - 5000 // histórico anterior à ponte não é tratado

// @lid → telefone, com cache: o WhatsApp novo às vezes identifica o contato pelo lid.
const lids = new Map()
async function telefoneDe(jid) {
  if (!String(jid).endsWith('@lid')) return usuario(jid)
  if (lids.has(jid)) return lids.get(jid)
  const { ok, dados } = await api(`/api/sessions/${sessaoBot()}/contacts/${encodeURIComponent(jid)}/phone`)
  const fone = ok ? usuario(dados?.phone || dados?.phoneNumber || dados?.number || '') : ''
  lids.set(jid, fone)
  return fone
}
const instante = m => (m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000)

function claude(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE, args, { cwd, windowsHide: true })
    let saida = '', erro = ''
    const limite = setTimeout(() => { p.kill(); reject(new Error('a sessão passou de 10 minutos sem responder')) }, 10 * 60_000)
    p.stdout.on('data', d => { saida += d })
    p.stderr.on('data', d => { erro += d })
    p.on('error', e => { clearTimeout(limite); reject(e) })
    p.on('close', codigo => {
      clearTimeout(limite)
      try { resolve(JSON.parse(saida.trim().split('\n').filter(Boolean).pop())) }
      catch { reject(new Error(`saída inesperada da sessão (exit ${codigo}): ${erro.trim().slice(-300)}`)) }
    })
  })
}

async function tratar(m) {
  const texto = String(m.body || '').trim()
  const citada = m.metadata?.quotedMessage
  const alvo = citada?.id ? livro().get(citada.id) : null
  let args, cwd, identidade
  if (alvo?.sessionId && alvo?.cwd) {
    cwd = alvo.cwd
    identidade = alvo.identidade || `Omni · ${basename(cwd)}`
    // Sessão criada pela ponte continua a mesma; sessão do Weriton (VS Code) responde numa cópia,
    // para não mexer no histórico da janela que ele pode estar usando.
    args = alvo.origem === 'ponte' ? ['--resume', alvo.sessionId] : ['--resume', alvo.sessionId, '--fork-session']
  } else {
    cwd = CENTRAL_CWD
    identidade = 'Omni'
    if (!estado.central) { estado.central = randomUUID(); estado.centralCriada = false; salvar() }
    args = estado.centralCriada ? ['--resume', estado.central] : ['--session-id', estado.central]
  }
  const prompt = `[WhatsApp · Weriton] ${texto}` + (citada?.body ? `\n\n(Ele está respondendo a esta mensagem: "${String(citada.body).slice(0, 500)}")` : '')
  log(`→ ${m.waMessageId} (${texto.length} chars) para ${identidade} ${alvo ? 'via citação' : 'central'}`)
  const extras = ['-p', prompt, '--output-format', 'json', '--append-system-prompt', SISTEMA]
  let resultado
  try {
    resultado = await claude([...args, ...extras], cwd)
  } catch (e) {
    if (alvo || !estado.centralCriada) throw e
    // A central sumiu (transcript apagado?): recria uma vez.
    estado.central = randomUUID(); estado.centralCriada = false; salvar()
    resultado = await claude(['--session-id', estado.central, ...extras], cwd)
  }
  if (!alvo) { estado.centralCriada = true; salvar() }
  const sid = resultado.session_id
  const resposta = String(resultado.result || '').trim() || '(a sessão não devolveu texto)'
  const rotulo = identidade === 'Omni' ? 'central' : `sessão ${String(sid).slice(0, 8)}`
  const waId = await enviarAoDono(`🤖 *${identidade}* · ${rotulo}\n\n${resposta.slice(0, 4000)}`, m.waMessageId)
  anotar({ waMessageId: waId, sessionId: sid, cwd, projeto: basename(cwd), identidade, origem: 'ponte' })
  log(`← ${waId} (${resposta.length} chars) de ${identidade} ${rotulo}${resultado.is_error ? ' [erro na sessão]' : ''}`)
  return { waId, sid, identidade, resposta }
}

async function comando(m) {
  const texto = String(m.body || '').trim().toLowerCase()
  if (texto === '/pausa') { estado.pausada = true; salvar(); await enviarAoDono('🤖 *Omni* · ponte\n\nPonte pausada: nenhuma mensagem aciona sessões até você mandar /volta.', m.waMessageId); return true }
  if (texto === '/volta') { estado.pausada = false; salvar(); await enviarAoDono('🤖 *Omni* · ponte\n\nPonte ativa de novo.', m.waMessageId); return true }
  return false
}

const fila = []
let ocupada = false
async function drenar() {
  if (ocupada) return
  ocupada = true
  try {
    while (fila.length) {
      const m = fila.shift()
      try {
        if (await comando(m)) continue
        if (estado.pausada) { log(`⏸ ${m.waMessageId} ignorada (pausada)`); continue }
        await tratar(m)
      } catch (e) {
        log(`✘ ${m.waMessageId}: ${e.message}`)
        try { await enviarAoDono(`🤖 *Omni* · ponte\n\nNão consegui levar sua mensagem até a sessão: ${e.message}`, m.waMessageId) } catch { /* sem canal */ }
      }
    }
  } finally { ocupada = false }
}

async function varrer() {
  const sessao = sessaoBot()
  const doChat = await api(`/api/sessions/${sessao}/messages?chatId=${encodeURIComponent(donoJid())}&limit=20`)
  const recentes = await api(`/api/sessions/${sessao}/messages?limit=50`)
  const novas = new Map()
  for (const m of [...(doChat.dados?.messages || []), ...(recentes.dados?.messages || [])]) {
    if (!m.waMessageId || processados.has(m.waMessageId) || novas.has(m.waMessageId)) continue
    if (m.direction !== 'incoming' || instante(m) < inicioMs) continue
    novas.set(m.waMessageId, m)
  }
  const meuDono = dono()
  for (const m of [...novas.values()].sort((a, b) => instante(a) - instante(b))) {
    processados.add(m.waMessageId)
    // Só o dono aciona. Em conversa individual o remetente é o chat; em grupo, o autor.
    const remetente = await telefoneDe(m.author || m.from || m.chatId)
    if (remetente !== meuDono || String(m.chatId).endsWith('@g.us')) continue
    if (!String(m.body || '').trim()) continue
    fila.push(m)
  }
  if (novas.size) salvar()
  drenar()
}

const i = process.argv.indexOf('--simular')
if (i > -1) {
  // Modo teste: trata UMA mensagem sintética como se viesse do dono, e sai.
  const c = process.argv.indexOf('--citar')
  const citarId = c > -1 ? process.argv[c + 1] : null
  const citada = citarId ? livro().get(citarId) : null
  const m = { waMessageId: `simulada-${randomUUID()}`, body: process.argv[i + 1] || 'teste', metadata: citarId ? { quotedMessage: { id: citarId, body: citada ? `(mensagem de ${citada.identidade})` : '' } } : null }
  const r = await tratar(m)
  console.log(JSON.stringify({ respondeu: r.identidade, sessao: String(r.sid).slice(0, 8), waId: r.waId, tamanho: r.resposta.length }))
} else {
  log(`ponte iniciada · dono ${dono().slice(0, 4)}…${dono().slice(-2)} · central em ${CENTRAL_CWD}`)
  setInterval(() => varrer().catch(e => log(`varredura: ${e.message}`)), INTERVALO_MS)
  varrer().catch(e => log(`varredura: ${e.message}`))
}
