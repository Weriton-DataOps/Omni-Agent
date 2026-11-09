// Omni — sonda de saúde do WhatsApp para o card da ilha (21/10). Roda uma vez, grava saude.json e sai.
// O cofre e a API são abertos aqui, num processo à parte: a ilha só lê o JSON e nunca toca em chave.
// Nada de conteúdo de mensagem: só contagens, estados e horários.
//   · conexões do serviço (bot e pessoal) e o movimento do dia no bot, contado pela API (inclui o que as
//     sessões mandam pelo MCP, que o ponte.log não vê)
//   · chaves do serviço (leitura, envio, terceiros): ativa = o serviço reconhece (403 em rota de admin),
//     recusada = 401; a cada 5 min
//   · OpenAI: a chave abre /v1/models (não cobra; a cada 10 min). Crédito não tem consulta gratuita: vale o
//     último uso real da voz no ponte.log e a pausa de openai-sem-credito.json
//   · sessões do Claude com o MCP do WhatsApp ligado (mcp.mjs com o pai vivo)
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, fstatSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BASE, arquivo, sessaoBot, sessaoPessoal, vozSemCredito } from './config.mjs'
import { lerSegredo, NOMES } from './cofre.mjs'

const SAIDA = arquivo('saude.json')
const CHAVES_A_CADA = 5 * 60_000
const OPENAI_A_CADA = 10 * 60_000
const PAGINAS = 10 // 1000 mensagens no dia antes de desistir de contar tudo
const PYTHON_LOCAL = join(process.env.LOCALAPPDATA || '', 'omni', 'voz-local', 'venv', 'Scripts', 'python.exe')
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const anterior = (() => { try { return JSON.parse(readFileSync(SAIDA, 'utf8')) } catch { return {} } })()
const vencido = (em, ms) => !(Date.parse(em) > Date.now() - ms)
const meiaNoite = new Date()
meiaNoite.setHours(0, 0, 0, 0)

async function chamar(caminho, chave) {
  try {
    const r = await fetch(BASE + caminho, { headers: chave ? { 'X-API-Key': chave } : {}, signal: AbortSignal.timeout(8000) })
    const j = r.ok ? await r.json().catch(() => null) : null
    return { status: r.status, dados: j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j }
  } catch { return { status: 0, dados: null } }
}

// null = não está no cofre; undefined = o cofre não respondeu
function segredo(papel) {
  try { return lerSegredo(NOMES[papel]) } catch (e) { return /não está no cofre/.test(e.message) ? null : undefined }
}
async function estadoChave(papel) {
  const chave = segredo(papel)
  if (chave === null) return 'ausente'
  if (chave === undefined) return 'cofre fora'
  const { status } = await chamar('/api/auth/api-keys/me', chave)
  return status === 401 ? 'recusada' : status === 0 ? 'sem serviço' : 'ativa'
}

async function sessao(id, leitura) {
  const { status, dados } = await chamar(`/api/sessions/${id}`, leitura)
  if (status !== 200 || !dados) return { status: status === 401 ? 'sem acesso' : 'desconhecido' }
  // só os 4 últimos dígitos: a ilha diz qual número é qual sem gravar o número inteiro no saude.json
  const fone = String(dados.phone || '').replace(/\D/g, '').slice(-4) || null
  return { status: dados.status, fone, conectadaEm: dados.connectedAt || null, ativaEm: dados.lastActive || null }
}

// Mensagens do bot desde a meia-noite local, da mais nova para a mais antiga, de 100 em 100.
async function movimento(leitura) {
  let enviadas = 0, recebidas = 0, completo = false
  for (let pagina = 0; pagina < PAGINAS; pagina++) {
    const { status, dados } = await chamar(`/api/sessions/${sessaoBot()}/messages?limit=100&offset=${pagina * 100}&inlineMedia=false`, leitura)
    const lista = status === 200 ? dados?.messages : null
    if (!Array.isArray(lista)) return null
    for (const m of lista) {
      if (m.timestamp * 1000 < meiaNoite.getTime()) { completo = true; break }
      if (m.direction === 'outgoing') enviadas++; else if (m.direction === 'incoming') recebidas++
    }
    if (completo || lista.length < 100) { completo = true; break }
  }
  return { enviadas, recebidas, completo }
}

function terceirosHoje() {
  try {
    return readFileSync(arquivo('terceiros-ledger.jsonl'), 'utf8').split('\n').filter((l) => {
      try { const e = JSON.parse(l); return ['enviada', 'parcial'].includes(e.status) && Date.parse(e.at) >= meiaNoite.getTime() } catch { return false }
    }).length
  } catch { return 0 }
}

function cauda(caminho, bytes) {
  let fd = null
  try {
    fd = openSync(caminho, 'r')
    const tamanho = fstatSync(fd).size
    const n = Math.min(bytes, tamanho)
    const buf = Buffer.alloc(n)
    readSync(fd, buf, 0, n, tamanho - n)
    return buf.toString('utf8')
  } catch { return '' } finally { if (fd !== null) try { closeSync(fd) } catch { /* já fechado */ } }
}

// ponte.log: voz (último sucesso, faltas de crédito depois dele), falhas do dia e a varredura.
// Na varredura só "HTTP N" é estado (a ponte guarda e avisa a volta); "fetch failed" é soluço sem aviso
// de volta, então só conta se for dos últimos 2 min.
function lerPonteLog() {
  let vozOk = null, semCreditoDesde = null, semCreditoUltima = null, falhasHoje = 0, cega = null, soluco = null
  for (const linha of cauda(arquivo(join('logs', 'ponte.log')), 256 * 1024).split('\n')) {
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/.exec(linha)
    if (!m) continue
    const t = Date.parse(m[1])
    const resto = m[2]
    if (/· resposta em audio/.test(resto)) { vozOk = t; semCreditoDesde = semCreditoUltima = null }
    else if (/voz sem crédito/.test(resto)) { semCreditoDesde ??= t; semCreditoUltima = t }
    else if (/^✘ /.test(resto) && t >= meiaNoite.getTime()) falhasHoje++
    else if (/^varredura: HTTP/.test(resto)) cega = t
    else if (/^varredura: voltou a ver/.test(resto)) cega = null
    else if (/^varredura: /.test(resto)) soluco = t
  }
  const cegaDesde = cega ?? (soluco > Date.now() - 2 * 60_000 ? soluco : null)
  return { vozOk, semCreditoDesde, semCreditoUltima, falhasHoje, cegaDesde }
}

function openai() {
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./saude-openai.ps1', import.meta.url))], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  try {
    const j = JSON.parse(String(r.stdout).trim().split('\n').pop())
    if (!j.ok) return j.erro || 'sem rede'
    return j.status === 401 ? 'recusada' : j.status === 200 ? 'ativa' : `HTTP ${j.status}`
  } catch { return 'sem rede' }
}

function sessoesComMcp() {
  const script = "$p = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CommandLine; $vivos = @{}; foreach ($x in $p) { $vivos[[int]$x.ProcessId] = 1 }; @($p | Where-Object { $_.CommandLine -match 'whatsapp[\\\\/]omni[\\\\/]mcp\\.mjs' -and $vivos.ContainsKey([int]$_.ParentProcessId) }).Count"
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  const n = Number(String(r.stdout).trim())
  return Number.isInteger(n) ? n : null
}

const agora = new Date().toISOString()
const servico = (await chamar('/api/health')).status === 200
const leitura = segredo('leitura')
const saude = { em: agora, servico }

if (servico && leitura) {
  try {
    const [bot, pessoal, mov] = await Promise.all([sessao(sessaoBot(), leitura), sessao(sessaoPessoal(), leitura), movimento(leitura)])
    saude.sessoes = { bot, pessoal }
    saude.mensagens = mov && { ...mov, terceiros: terceirosHoje() }
  } catch { /* bot ainda não pareado: fica sem conexões e sem contagem */ }
}

// chave com problema é refeita a cada rodada, para o card largar o aviso assim que ela voltar
const chaveRuim = ['leitura', 'envio', 'terceiros'].some((p) => anterior.chaves?.[p] !== 'ativa')
if (servico && (vencido(anterior.chaves?.em, CHAVES_A_CADA) || chaveRuim)) {
  saude.chaves = { em: agora }
  for (const papel of ['leitura', 'envio', 'terceiros']) saude.chaves[papel] = await estadoChave(papel)
} else saude.chaves = anterior.chaves || null

const log = lerPonteLog()
const chaveOpenai = vencido(anterior.openai?.chaveEm, OPENAI_A_CADA) ? { chave: openai(), chaveEm: agora } : { chave: anterior.openai.chave, chaveEm: anterior.openai.chaveEm }
const pausa = vozSemCredito()
saude.openai = {
  ...chaveOpenai,
  // sem = a última tentativa de voz bateu em crédito esgotado (ou a pausa de 30 min está correndo)
  credito: pausa || log.semCreditoDesde ? 'sem' : log.vozOk ? 'ok' : 'desconhecido',
  semCreditoDesde: log.semCreditoDesde,
  semCreditoUltima: log.semCreditoUltima,
  vozOkEm: log.vozOk,
  transcricaoLocal: existsSync(PYTHON_LOCAL),
}
saude.ponte = { falhasHoje: log.falhasHoje, cegaDesde: log.cegaDesde }
saude.mcp = sessoesComMcp()

writeFileSync(SAIDA + '.tmp', JSON.stringify(saude, null, 1))
renameSync(SAIDA + '.tmp', SAIDA)
