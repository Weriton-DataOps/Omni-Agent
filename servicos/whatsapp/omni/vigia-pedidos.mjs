// Omni — vigia de pedidos parados (relatório "pedido que morre no caminho", 04/11/2026).
//
// Pedido do Weriton mora dentro da sessão; quando a sessão morre, o pedido morre junto e ninguém
// avisa. Esta vigia roda FORA do Claude (Agendador do Windows, a cada 15 min), só lê e avisa:
//
//   1. registro: lê as transcrições (.jsonl) e acrescenta cada prompt do Weriton ao registro
//      append-only (C:\tmp\pedidos-abertos.jsonl) como `nao_classificado`, com sessão, hora e ramo;
//   2. dona morta: sem processo e transcrição parada há mais de 20 min, com trabalho REAL pendurado
//      (pedido classificado aberto, ou a trava no nome dela). Tarefa em segundo plano sem "retorno"
//      NÃO conta: sessão que encerrou o expediente deixa marcador de subagente pendurado e isso é o
//      normal, não um pedido abandonado — era a fonte de falso-incidente que metralhava o Weriton (07/11).
//   3. sem progresso: pedido classificado com dona viva e nenhum commit/push/evento em 60 min;
//   4. trava de morta: lock presente, dona sem processo e transcrição parada há mais de 15 min.
//
// Cada achado vira UMA mensagem curta ao Weriton pelo bot (qual pedido, desde quando, uma pergunta),
// repetida no máximo a cada hora enquanto o achado continuar de pé. Nunca mexe em código ou produção.
//
// ÚNICA ação além de avisar — QUEDA AUTOMÁTICA DA TRAVA, aprovada pelo Weriton em 04/11/2026 13:44Z
// ("3 - sim" à pergunta da -13: "se a dona da trava some da lista de sessões e fica 15 min sem
// processo, a trava cai sozinha, com registro e aviso a você"). Só para as travas em
// config.quedaAutomatica (padrão: C:\tmp\suite-pesada.lock), só com a dona identificada e provada
// morta, e só se a trava não mudou desde a leitura. Ordem: linha na fila (fsync) → apaga → WhatsApp
// dizendo de quem era e quem é a próxima da fila.
//
//   node vigia-pedidos.mjs                      → confere e avisa (uso do agendador)
//   node vigia-pedidos.mjs --teste              → mostra o que faria, sem enviar e sem gravar estado
//   node vigia-pedidos.mjs listar               → pedidos abertos (estado atual de cada um)
//   node vigia-pedidos.mjs classificar <id> <estado> [--ramo R] [--worktree W]
//   node vigia-pedidos.mjs progresso <id> "<sinal>"
//   node vigia-pedidos.mjs dispensar <id> "<motivo>"   → era conversa / não é pedido
//   node vigia-pedidos.mjs fechar <id> --sha <sha> --run <dono/repo>:<runId>
//                                                → só fecha com o run verde no GitHub para aquele sha
//   node vigia-pedidos.mjs registrar            → entrada por hook UserPromptSubmit (JSON no stdin)
//
// Caminhos podem ser trocados por flag (--registro, --projetos, --sessoes, --estado, --config,
// --envio arquivo:<path>) — é assim que o teste roda sem tocar na trava e no registro reais.
import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync, fsyncSync, writeSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export const ESTADOS = ['nao_classificado', 'aberto', 'em_prova', 'pr', 'homolog', 'producao', 'fechado', 'conversa']
const ABERTOS_CLASSIFICADOS = new Set(['aberto', 'em_prova', 'pr', 'homolog', 'producao'])
const MIN = 60_000
export const LIMITES = { donaViva: 20 * MIN, travaMorta: 15 * MIN, semProgresso: 60 * MIN, repeticao: 60 * MIN, janela: 48 * 60 * MIN }

// Janela de silêncio (madrugada): dentro dela o vigia continua lendo, registrando e guardando
// estado, mas não manda nada ao WhatsApp. config.silencio = { de:'HH:MM', ate:'HH:MM', tz? }.
// Cruza a meia-noite quando de > ate. O que estiver de pé sai uma vez só quando a janela acaba.
export function emSilencio(silencio, agora = Date.now()) {
  if (!silencio || !silencio.de || !silencio.ate) return false
  const tz = silencio.tz || 'America/Sao_Paulo'
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Number(agora)))
  const min = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m }
  const [de, ate, ag] = [min(silencio.de), min(silencio.ate), min(hhmm)]
  return de <= ate ? (ag >= de && ag < ate) : (ag >= de || ag < ate)
}

// ───────────────────────────── utilidades ─────────────────────────────
function flag(args, nome, padrao) {
  const i = args.indexOf(nome)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : padrao
}
const curto = (t, n = 140) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n)
const hhmm = ms => new Date(ms).toISOString().slice(11, 16) + 'Z'
const dia = ms => new Date(ms).toISOString().slice(8, 10) + '/' + new Date(ms).toISOString().slice(5, 7)
const quando = (ms, agora) => (agora - ms < 20 * 3600e3 ? hhmm(ms) : `${hhmm(ms)} de ${dia(ms)}`)
const duracao = ms => { const m = Math.round(ms / MIN); return m < 90 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h` }

// Gravação durável: o store do Omni morreu em 27/10 justamente por rename sem fsync numa queda de luz.
function gravaDuravel(caminho, texto) {
  mkdirSync(dirname(caminho), { recursive: true })
  const tmp = `${caminho}.${process.pid}.tmp`
  const fd = openSync(tmp, 'w')
  try { writeSync(fd, texto); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, caminho)
}
function acrescentaDuravel(caminho, linha) {
  mkdirSync(dirname(caminho), { recursive: true })
  const fd = openSync(caminho, 'a')
  try { writeSync(fd, linha + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}

// ───────────────────────────── registro ─────────────────────────────
export function lerRegistro(caminho) {
  const pedidos = new Map()
  if (!existsSync(caminho)) return pedidos
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    if (!linha.trim()) continue
    let e; try { e = JSON.parse(linha) } catch { continue }   // linha parcial: ignora, não derruba
    if (!e?.id) continue
    const at = typeof e.at === 'number' ? e.at : Date.parse(e.at) || 0
    const atual = pedidos.get(e.id)
    if (e.ev === 'novo') { if (!atual) pedidos.set(e.id, { ...e, at, eventos: [e], ultimoSinal: at }); continue }
    if (!atual) continue
    atual.eventos.push(e)
    if (e.ev === 'estado') { atual.estado = e.estado; atual.ultimoSinal = at; if (e.ramo) atual.ramo = e.ramo; if (e.worktree) atual.worktree = e.worktree; if (e.prova) atual.prova = e.prova }
    if (e.ev === 'progresso') atual.ultimoSinal = at
  }
  return pedidos
}
const idDoPrompt = (sessionId, promptId, texto) => 'p-' + createHash('sha1').update(`${sessionId}|${promptId || texto}`).digest('hex').slice(0, 8)

// O que é prompt do Weriton e o que é ruído que também chega como "user" na transcrição.
const NAO_E_DELE = /^(Another Claude session sent a message|<cross-session-message|<task-notification|<system-reminder>|<command-|<local-command|Caveat:|\[Request interrupted|This session is being continued|Base directory for this skill)/
export function textoDoPrompt(registro) {
  if (registro?.type !== 'user' || registro.isMeta || registro.isCompactSummary || registro.isSidechain) return null
  const c = registro.message?.content
  let texto = null
  if (typeof c === 'string') texto = c
  else if (Array.isArray(c)) {
    if (c.some(p => p?.type === 'tool_result')) return null
    texto = c.filter(p => p?.type === 'text').map(p => p.text).join('\n')
  }
  texto = (texto || '').trim()
  if (!texto || NAO_E_DELE.test(texto)) return null
  // remove blocos <system-reminder> e <ide_*> anexados; sobra o que ele digitou
  const limpo = texto.replace(/<(system-reminder|ide_selection|ide_opened_file)>[\s\S]*?<\/\1>/g, '').trim()
  return limpo || null
}

// ───────────────────────────── transcrições ─────────────────────────────
// Lê só o que cresceu desde a última passada (há transcrição de 120 MB). Devolve o resumo da sessão.
export function lerTranscricao(caminho, memoria = {}) {
  const st = statSync(caminho)
  let offset = memoria.offset || 0
  if (offset > st.size) offset = 0                      // arquivo trocado: relê
  const m = { offset, sessionId: memoria.sessionId || basename(caminho, '.jsonl'), cwd: memoria.cwd || null, ramo: memoria.ramo || null,
    pendentes: new Set(memoria.pendentes || []), prompts: [], ultimoPrompt: memoria.ultimoPrompt || null, mtime: st.mtimeMs }
  const fd = openSync(caminho, 'r')
  try {
    const BLOCO = 4 * 1024 * 1024
    let resto = ''
    let pos = offset
    while (pos < st.size) {
      const n = Math.min(BLOCO, st.size - pos)
      const buf = Buffer.alloc(n)
      readSync(fd, buf, 0, n, pos)
      pos += n
      const txt = resto + buf.toString('utf8')
      const corte = txt.lastIndexOf('\n')
      if (corte < 0) { resto = txt; continue }
      resto = txt.slice(corte + 1)
      for (const linha of txt.slice(0, corte).split('\n')) processaLinha(linha, m)
    }
    m.offset = st.size - Buffer.byteLength(resto, 'utf8')   // linha incompleta fica para a próxima
  } finally { closeSync(fd) }
  return m
}
function processaLinha(linha, m) {
  if (!linha || linha.length < 2) return
  let r; try { r = JSON.parse(linha) } catch { return }
  if (r.cwd) m.cwd = r.cwd
  if (r.gitBranch) m.ramo = r.gitBranch
  // tarefa em segundo plano lançada …
  const c = r.message?.content
  if (r.type === 'user' && Array.isArray(c)) {
    for (const p of c) {
      if (p?.type !== 'tool_result') continue
      const t = typeof p.content === 'string' ? p.content : Array.isArray(p.content) ? p.content.map(x => x?.text || '').join(' ') : ''
      const a = /running in background with ID: ([A-Za-z0-9_-]+)/.exec(t)
      if (a) m.pendentes.add(a[1])
    }
  }
  // … e o retorno dela (a notificação chega como "user" ou como queue-operation)
  const bruto = typeof c === 'string' ? c : (r.type === 'queue-operation' ? r.content || '' : '')
  if (bruto && bruto.includes('<task-notification>')) {
    for (const t of bruto.matchAll(/<task-id>([A-Za-z0-9_-]+)<\/task-id>/g)) m.pendentes.delete(t[1])
  }
  const texto = textoDoPrompt(r)
  const par = !texto ? delegacaoDePar(r) : null
  if (texto || par) {
    const at = Date.parse(r.timestamp) || Date.now()
    const corpo = texto || par.texto
    const p = { id: idDoPrompt(m.sessionId, r.promptId || r.uuid, corpo), texto: curto(corpo, 200), at, promptId: r.promptId || r.uuid || null, origem: par ? 'par' : 'weriton', ...(par ? { de: par.de } : {}) }
    m.prompts.push(p)
    m.ultimoPrompt = p
  }
}
// Trabalho que chega por outra sessão (a coordenadora delegando) também é pedido: foi assim que a
// tela da lista chegou à -b9 em 03/11, e ela morreu com ele na mão.
export function delegacaoDePar(r) {
  if (r?.type !== 'user' || r.isSidechain) return null
  const c = r.message?.content
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p?.type === 'text').map(p => p.text).join('\n') : ''
  const m = /<cross-session-message[^>]*from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/.exec(t || '')
  if (!m || !m[2].trim()) return null
  return { de: m[1], texto: m[2].trim() }
}

// ───────────────────────────── sessões vivas ─────────────────────────────
export function processosVivos() {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
    const vivos = new Set()
    for (const l of out.split(/\r?\n/)) { const m = /^"[^"]*","(\d+)"/.exec(l); if (m) vivos.add(Number(m[1])) }
    return vivos
  } catch { return null }   // sem tasklist: não dá para afirmar morte por processo
}
export function lerSessoes(dir) {
  const porId = new Map()
  if (!existsSync(dir)) return porId
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      if (!j?.sessionId) continue
      const anterior = porId.get(j.sessionId)
      if (!anterior || (j.updatedAt || 0) > (anterior.updatedAt || 0)) porId.set(j.sessionId, j)
    } catch { /* arquivo sendo escrito */ }
  }
  return porId
}
const etiqueta = nome => (/-([0-9a-z]{2,4})$/i.exec(String(nome || '')) || [])[1]?.toLowerCase() || null

// ───────────────────────────── trava ─────────────────────────────
export function lerTrava(caminho) {
  if (!existsSync(caminho)) return null
  const texto = readFileSync(caminho, 'utf8').replace(/^\uFEFF/, '').trim()
  const tag = (/^\s*-([0-9a-z]{2,4})\b/i.exec(texto) || [])[1]?.toLowerCase() || null
  const tarefa = (/^\s*-[0-9a-z]{2,4}\/([^\s:(),;]+)/i.exec(texto) || [])[1] || null
  return { caminho, texto: curto(texto, 200), tag, tarefa, mtime: statSync(caminho).mtimeMs, hash: createHash('sha1').update(texto).digest('hex').slice(0, 8) }
}

// Fila (C:\tmp\fila-da-trava.txt, texto livre das sessões): a próxima é a 1ª entrada "NA FILA" que
// não teve INICIO/FIM/ANULADO/QUEDA depois, e que não é a dona que acabou de cair.
export function proximaDaFila(textoFila, tagMorta) {
  const linhas = String(textoFila || '').split(/\r?\n/).filter(l => l.trim())
  const chave = l => { const m = /(?:^|\s)-([0-9a-z]{2,4})\/([^\s:(),;]+)/i.exec(l); return m ? `${m[1].toLowerCase()}/${m[2]}` : null }
  for (let i = 0; i < linhas.length; i++) {
    if (!/NA FILA/i.test(linhas[i])) continue
    const k = chave(linhas[i])
    if (!k || k.split('/')[0] === tagMorta) continue
    const andou = linhas.slice(i + 1).some(l => chave(l) === k && /INICIO|FIM|ANULAD|QUEDA|DESIST|SAIU/i.test(l))
    if (!andou) return { chave: `-${k}`, linha: curto(linhas[i], 160) }
  }
  return null
}

// Derruba a trava aprovada para queda automática. Devolve o texto do aviso, ou null se não derrubou.
export function derrubarTrava(achado, { fila, agora, teste = false }) {
  const tr = achado.trava
  const atual = lerTrava(tr.caminho)
  if (!atual || atual.hash !== tr.hash || atual.mtime !== tr.mtime) return null   // mudou desde a leitura: não toca
  const dona = `-${tr.tag || '?'}${tr.tarefa ? `/${tr.tarefa}` : ''}`
  const iso = new Date(agora).toISOString()
  const linha = `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z vigia: QUEDA AUTOMATICA da trava de ${dona} (motivo: ${achado.motivoQueda}; regra aprovada pelo Weriton em 04/11)`
  const proxima = proximaDaFila(existsSync(fila) ? readFileSync(fila, 'utf8') : '', tr.tag)
  if (!teste) {
    acrescentaDuravel(fila, linha)
    rmSync(tr.caminho)
  }
  return `Trava ${tr.caminho} ${teste ? 'SERIA derrubada' : 'derrubada'} sozinha (queda automática). Era da ${dona}: ${achado.motivoQueda}.\n` +
    `Linha gravada em ${fila}.\n` +
    `Próxima da fila: ${proxima ? `${proxima.chave} — "${proxima.linha}"` : 'ninguém esperando'}.` +
    (achado.ultimoPedido ? `\n\nPedido ${achado.ultimoPedido.id} da dona: "${curto(achado.ultimoPedido.texto, 120)}". Passo para outra sessão?` : '')
}

// ───────────────────────────── progresso no git ─────────────────────────────
function git(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}
export function ultimoSinalGit(cwd, ramo) {
  if (!cwd || !existsSync(cwd)) return 0
  let t = 0
  const commit = Number(git(cwd, ['log', '-1', '--format=%ct', ramo || 'HEAD'])) * 1000
  if (commit) t = Math.max(t, commit)
  const comum = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (comum && ramo) {
    for (const ref of [`logs/refs/remotes/origin/${ramo}`, `logs/refs/heads/${ramo}`]) {
      try { t = Math.max(t, statSync(join(comum, ref)).mtimeMs) } catch {}
    }
  }
  return t
}

// ───────────────────────────── avaliação (pura, testável) ─────────────────────────────
// Entrada: o que foi lido do disco. Saída: lista de achados {chave, tipo, texto, desde, pedidos}.
export function avaliar({ agora, pedidos, sessoes, transcricoes, vivos, travas, sinalGit = () => 0 }) {
  const achados = []
  const porSessao = new Map()   // sessionId → { pedidos abertos }
  for (const p of pedidos.values()) {
    if (p.estado === 'fechado' || p.estado === 'conversa') continue
    if (!porSessao.has(p.sessao)) porSessao.set(p.sessao, [])
    porSessao.get(p.sessao).push(p)
  }
  const resumo = sid => {
    const t = transcricoes.get(sid)
    const s = sessoes.get(sid)
    const nome = s?.name || [...pedidos.values()].find(p => p.sessao === sid && p.nomeSessao)?.nomeSessao || null
    const mtime = t?.mtime ?? 0
    // sem lista de processos (tasklist falhou) não dá para afirmar morte: na dúvida, viva
    const processo = vivos === null ? true : s?.pid ? vivos.has(Number(s.pid)) : false
    const viva = processo || (mtime && agora - mtime < LIMITES.donaViva)
    return { sid, nome, mtime, processo, viva, pendentes: t ? [...t.pendentes] : [], t }
  }
  const rotulo = r => r.nome ? `-${etiqueta(r.nome) || r.nome}` : `sessão ${String(r.sid).slice(0, 8)}`

  // travas: quem é a dona?
  const travaDaSessao = new Map()
  for (const tr of travas) {
    if (!tr) continue
    let dona = null
    // Lock sem etiqueta "-xx" (ex.: "dw-7-b0/..."): sem dona identificável, só avisa e nunca derruba.
    // Antes, null === null casava com qualquer sessão sem nome e morta, e derrubou a trava viva da dw-7-b0 (04/11 16:49Z).
    if (tr.tag) for (const [sid, s] of sessoes) if (etiqueta(s.name) === tr.tag) { if (!dona || (s.updatedAt || 0) > (sessoes.get(dona)?.updatedAt || 0)) dona = sid }
    if (!dona && tr.tag) for (const p of pedidos.values()) if (etiqueta(p.nomeSessao) === tr.tag) dona = p.sessao
    const r = dona ? resumo(dona) : null
    const parada = r ? (r.mtime ? agora - r.mtime : agora - tr.mtime) : agora - tr.mtime
    const morta = r ? (!r.processo && parada > LIMITES.travaMorta) : parada > LIMITES.semProgresso
    if (dona) travaDaSessao.set(dona, tr)
    if (!morta) continue
    const pedidosDela = dona ? (porSessao.get(dona) || []) : []
    const ultimo = pedidosDela.sort((a, b) => b.at - a.at)[0]
    achados.push({
      chave: `trava:${tr.caminho}:${tr.hash}`, tipo: 'trava-de-morta', desde: tr.mtime, pedidos: pedidosDela.map(p => p.id), sessao: dona,
      trava: tr, ultimoPedido: ultimo || null,
      // queda automática só com dona identificada e provada morta (sem processo E transcrição parada)
      podeDerrubar: !!r && !r.processo && parada > LIMITES.travaMorta,
      motivoQueda: r ? `sem processo vivo e transcrição parada há ${duracao(parada)}` : null,
      texto: `Trava ${tr.caminho} presa no nome de ${r ? rotulo(r) : `-${tr.tag || '?'}`} desde ${quando(tr.mtime, agora)}.\n` +
        `${r ? `Dona sem processo, transcrição parada há ${duracao(parada)}.` : 'Nenhuma sessão viva com esse nome.'}` +
        `${ultimo ? `\nPedido ${ultimo.id}: "${curto(ultimo.texto, 120)}"` : ''}\n\n` +
        `Posso anular a trava${tr.tag ? ` da -${tr.tag}` : ''}?`,
    })
  }

  for (const [sid, lista] of porSessao) {
    const r = resumo(sid)
    const ultimo = lista.sort((a, b) => b.at - a.at)[0]
    const classificados = lista.filter(p => ABERTOS_CLASSIFICADOS.has(p.estado))
    if (!r.viva) {
      if (r.mtime && agora - r.mtime > LIMITES.janela && !classificados.length) continue   // morte antiga sem pedido aberto: fora da janela
      const motivo = classificados.length ? `pedido classificado como ${classificados[0].estado}`
        : travaDaSessao.has(sid) ? 'trava no nome dela' : null
      if (!motivo) continue                                   // morreu com o turno fechado e nada REAL pendurado: conversa encerrada
      if (travaDaSessao.has(sid) && !classificados.length) continue   // só trava: já coberto pelo aviso da trava
      const alvo = classificados[0] || ultimo
      achados.push({
        chave: `morta:${sid}:${alvo.id}`, tipo: 'dona-morta', desde: r.mtime || alvo.at, pedidos: [alvo.id], sessao: sid,
        texto: `Pedido ${alvo.id} parado desde ${quando(r.mtime || alvo.at, agora)}: "${curto(alvo.texto, 120)}"\n` +
          `Dona ${rotulo(r)} morta (sem processo, transcrição parada há ${duracao(agora - (r.mtime || alvo.at))}); ${motivo}.\n\n` +
          `Passo o pedido ${alvo.id} para outra sessão?`,
      })
      continue
    }
    for (const p of classificados) {
      const sinais = [p.at, p.ultimoSinal || 0, sinalGit(p.worktree || r.t?.cwd, p.ramo || r.t?.ramo)]
      const ultimoSinal = Math.max(...sinais.map(Number).filter(Boolean))
      if (agora - ultimoSinal <= LIMITES.semProgresso) continue
      achados.push({
        chave: `parado:${sid}:${p.id}`, tipo: 'sem-progresso', desde: ultimoSinal, pedidos: [p.id], sessao: sid,
        texto: `Pedido ${p.id} (${p.estado}) sem progresso desde ${quando(ultimoSinal, agora)}: "${curto(p.texto, 120)}"\n` +
          `Dona ${rotulo(r)} viva, mas sem commit, push ou evento há ${duracao(agora - ultimoSinal)}.\n\n` +
          `O pedido ${p.id} ainda vale, ou fecho?`,
      })
    }
  }
  return achados
}

// Quais achados mandar agora: novo, ou o mesmo de pé há mais de 1 h desde o último aviso.
export function filtrarRepeticao(achados, avisos, agora) {
  return achados.filter(a => !avisos[a.chave] || agora - avisos[a.chave].ultimo >= LIMITES.repeticao)
}

// ───────────────────────────── execução ─────────────────────────────
async function principal(args) {
  const RUN = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'omni', 'whatsapp')
  const REGISTRO = flag(args, '--registro', 'C:\\tmp\\pedidos-abertos.jsonl')
  const PROJETOS = flag(args, '--projetos', join(homedir(), '.claude', 'projects'))
  const SESSOES = flag(args, '--sessoes', join(homedir(), '.claude', 'sessions'))
  const ESTADO = flag(args, '--estado', join(RUN, 'vigia-pedidos.json'))
  const CONFIG = flag(args, '--config', join(RUN, 'vigia-pedidos.config.json'))
  const FEED = flag(args, '--feed', 'C:\\tmp\\vigia-pedidos-avisos.jsonl')
  const ENVIO = flag(args, '--envio', 'whatsapp')
  const teste = args.includes('--teste')
  const agora = Number(flag(args, '--agora', Date.now()))
  const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'vigiar'

  const evento = e => acrescentaDuravel(REGISTRO, JSON.stringify({ ...e, at: e.at ?? new Date(agora).toISOString() }))

  if (cmd === 'listar') {
    const pedidos = lerRegistro(REGISTRO)
    for (const p of pedidos.values()) if (p.estado !== 'fechado' && p.estado !== 'conversa')
      console.log(`${p.id}  ${p.estado.padEnd(16)} ${new Date(p.at).toISOString().slice(0, 16)}Z  ${p.nomeSessao || p.sessao?.slice(0, 8)}  ${curto(p.texto, 80)}`)
    return
  }
  if (cmd === 'classificar' || cmd === 'progresso' || cmd === 'dispensar' || cmd === 'fechar') {
    const id = args[1]
    const pedidos = lerRegistro(REGISTRO)
    if (!pedidos.has(id)) throw new Error(`pedido ${id} não está no registro`)
    if (cmd === 'classificar') {
      const estado = args[2]
      if (!ESTADOS.includes(estado) || estado === 'fechado') throw new Error(`estado inválido: ${estado} (fechar só com "fechar", que exige prova)`)
      evento({ ev: 'estado', id, estado, ramo: flag(args, '--ramo'), worktree: flag(args, '--worktree') })
    } else if (cmd === 'progresso') evento({ ev: 'progresso', id, sinal: curto(args[2], 200) })
    else if (cmd === 'dispensar') evento({ ev: 'estado', id, estado: 'conversa', motivo: curto(args[2], 200) })
    else {
      const sha = flag(args, '--sha'); const run = flag(args, '--run')
      if (!sha || !run || !/^[^:]+\/[^:]+:\d+$/.test(run)) throw new Error('fechar exige --sha <sha> e --run <dono/repo>:<runId>')
      const [repo, runId] = run.split(':')
      const j = JSON.parse(execFileSync('gh', ['run', 'view', runId, '-R', repo, '--json', 'conclusion,headSha,status,url,workflowName'], { encoding: 'utf8', windowsHide: true, timeout: 30000 }))
      if (j.status !== 'completed' || j.conclusion !== 'success') throw new Error(`run ${runId} não está verde (${j.status}/${j.conclusion})`)
      if (!j.headSha.startsWith(sha) && !sha.startsWith(j.headSha.slice(0, sha.length))) throw new Error(`run ${runId} é do sha ${j.headSha.slice(0, 12)}, não de ${sha}`)
      evento({ ev: 'estado', id, estado: 'fechado', prova: { sha: j.headSha, run: j.url, workflow: j.workflowName, conclusao: j.conclusion } })
    }
    console.log(`${id}: ${cmd} gravado`)
    return
  }
  if (cmd === 'registrar') {
    const h = JSON.parse(readFileSync(0, 'utf8') || '{}')
    const texto = textoDoPrompt({ type: 'user', message: { content: h.prompt } })
    if (!texto || !h.session_id) return
    const pedidos = lerRegistro(REGISTRO)
    const id = idDoPrompt(h.session_id, null, texto + '|' + agora)
    if (!pedidos.has(id)) evento({ ev: 'novo', id, texto: curto(texto, 200), at: agora, sessao: h.session_id, cwd: h.cwd, transcript: h.transcript_path, estado: 'nao_classificado', origem: 'hook' })
    return
  }

  // ── vigiar ──
  const config = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {}
  const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { arquivos: {}, avisos: {} }
  const sessoes = lerSessoes(SESSOES)
  const vivos = processosVivos()
  const pedidos = lerRegistro(REGISTRO)
  const transcricoes = new Map()
  const novos = []

  // transcrições da janela de 48 h (só o nível de cima de cada projeto: subagente não é pedido dele)
  const caminhosExtras = new Set([...pedidos.values()].map(p => p.transcript).filter(Boolean))
  const candidatas = []
  if (existsSync(PROJETOS)) for (const d of readdirSync(PROJETOS)) {
    const dir = join(PROJETOS, d)
    let itens; try { itens = readdirSync(dir) } catch { continue }
    for (const f of itens) if (f.endsWith('.jsonl')) candidatas.push(join(dir, f))
  }
  for (const c of caminhosExtras) if (!candidatas.includes(c)) candidatas.push(c)
  for (const caminho of candidatas) {
    let st; try { st = statSync(caminho) } catch { continue }
    if (agora - st.mtimeMs > LIMITES.janela && !caminhosExtras.has(caminho)) continue
    const m = lerTranscricao(caminho, estado.arquivos[caminho])
    transcricoes.set(m.sessionId, m)
    const s = sessoes.get(m.sessionId)
    for (const p of m.prompts) {
      if (pedidos.has(p.id)) continue
      const e = { ev: 'novo', id: p.id, texto: p.texto, at: p.at, sessao: m.sessionId, nomeSessao: s?.name || null, cwd: m.cwd, ramo: m.ramo, transcript: caminho, estado: 'nao_classificado', origem: p.origem, ...(p.de ? { de: p.de } : {}) }
      novos.push(e)
      pedidos.set(p.id, { ...e, eventos: [e], ultimoSinal: e.at })
    }
    estado.arquivos[caminho] = { offset: m.offset, sessionId: m.sessionId, cwd: m.cwd, ramo: m.ramo, pendentes: [...m.pendentes], ultimoPrompt: m.ultimoPrompt }
  }
  // nome atual das sessões vivas: guarda para resolver a etiqueta da trava depois que o .json some
  estado.nomes = estado.nomes || {}
  for (const [sid, s] of sessoes) if (s.name) estado.nomes[sid] = s.name
  for (const p of pedidos.values()) if (!p.nomeSessao && estado.nomes[p.sessao]) p.nomeSessao = estado.nomes[p.sessao]
  // primeira passada de uma sessão grande: só os prompts das últimas 48 h entram no registro
  const recentes = novos.filter(e => agora - e.at <= LIMITES.janela)
  for (const p of novos) if (agora - p.at > LIMITES.janela) pedidos.delete(p.id)

  const travas = [...new Set([...(config.travas || ['C:\\tmp\\suite-pesada.lock'])])].map(lerTrava)
  const achados = avaliar({ agora, pedidos, sessoes, transcricoes, vivos, travas, sinalGit: ultimoSinalGit })
  // queda automática (aprovada 04/11): troca o aviso-pergunta pelo aviso-fato, uma vez só
  const quedaOk = new Set((config.quedaAutomatica ?? ['C:\\tmp\\suite-pesada.lock']).map(c => c.toLowerCase()))
  const FILA = config.fila || 'C:\\tmp\\fila-da-trava.txt'
  for (const a of achados) {
    if (a.tipo !== 'trava-de-morta' || !a.podeDerrubar || !quedaOk.has(a.trava.caminho.toLowerCase())) continue
    const texto = derrubarTrava(a, { fila: FILA, agora, teste })
    if (!texto) continue
    a.tipo = 'queda-automatica'; a.chave = `queda:${a.trava.caminho}:${a.trava.hash}`; a.texto = texto
  }
  const enviar = filtrarRepeticao(achados, estado.avisos, agora)
  // silêncio noturno: não envia nada ao WhatsApp dentro da janela; o que ficar de pé sai quando ela acaba
  const calado = emSilencio(config.silencio, agora)
  const aEnviar = calado ? [] : enviar

  if (teste) {
    console.log(JSON.stringify({ novosNoRegistro: recentes.length, achados: achados.length, enviaria: aEnviar.length, calado }, null, 1))
    for (const a of enviar) console.log(`\n── ${a.tipo} (${a.chave})\n${a.texto}`)
    return
  }
  for (const e of recentes) acrescentaDuravel(REGISTRO, JSON.stringify({ ...e, at: new Date(e.at).toISOString() }))
  if (recentes.length) for (const e of recentes) { const p = pedidos.get(e.id); if (p) p.at = e.at }

  const resultado = []
  for (const a of aEnviar.slice(0, 4)) {
    const texto = `🤖 *Omni · vigia de pedidos*\n\n${a.texto}`
    let waId
    if (ENVIO.startsWith('arquivo:')) {
      waId = `arquivo-${createHash('sha1').update(a.chave + agora).digest('hex').slice(0, 10)}`
      appendFileSync(ENVIO.slice(8), JSON.stringify({ waId, texto, at: new Date(agora).toISOString() }) + '\n')
    } else {
      const { enviarAoDono, anotar } = await import('./config.mjs')
      waId = await enviarAoDono(texto)
      // resposta citando este aviso volta para a coordenadora configurada (se houver), não para a morta
      const coord = config.coordenadora ? [...sessoes.values()].find(s => s.name === config.coordenadora) : null
      anotar({ waMessageId: waId, origem: 'vigia-pedidos', tipo: a.tipo, pedidos: a.pedidos, ...(coord ? { sessionId: coord.sessionId, cwd: coord.cwd, identidade: 'Omni · vigia de pedidos' } : {}) })
    }
    const anterior = estado.avisos[a.chave]
    estado.avisos[a.chave] = { primeiro: anterior?.primeiro ?? agora, ultimo: agora, vezes: (anterior?.vezes || 0) + 1, waIds: [...(anterior?.waIds || []), waId].slice(-5), tipo: a.tipo, pedidos: a.pedidos }
    acrescentaDuravel(FEED, JSON.stringify({ at: new Date(agora).toISOString(), waId, tipo: a.tipo, pedidos: a.pedidos, sessao: a.sessao, texto: a.texto }))
    resultado.push({ waId, tipo: a.tipo, pedidos: a.pedidos })
  }
  // achado que sumiu (alguém agiu): sai do estado, para voltar a avisar se reaparecer
  const vivosAgora = new Set(achados.map(a => a.chave))
  for (const k of Object.keys(estado.avisos)) if (!vivosAgora.has(k)) delete estado.avisos[k]
  gravaDuravel(ESTADO, JSON.stringify(estado))
  console.log(JSON.stringify({ at: new Date(agora).toISOString(), novosNoRegistro: recentes.length, achados: achados.length, calado, avisos: resultado }))
}

const direto = process.argv[1] && import.meta.url.toLowerCase().endsWith(basename(process.argv[1]).toLowerCase())
if (direto) principal(process.argv.slice(2)).catch(e => { console.error(`vigia-pedidos: ${e.message}`); process.exit(1) })
