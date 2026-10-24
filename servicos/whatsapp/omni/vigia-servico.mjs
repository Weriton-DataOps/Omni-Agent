// Omni — vigia do serviço WhatsApp (24/10/2026). O Agendador chama a cada 5 min (pelo .vbs, sem janela);
// confere, age se precisar e sai.
//
// O atalho da pasta Inicializar sobe serviço e ponte no logon, e só. Quando o serviço morre no meio do dia
// ninguém percebe: a ponte só faz polling e fica perguntando ao vazio (08/10: 30 h fora). E religar sozinho
// não basta: em 22/10 o disco encheu de snapshots de eval, o serviço caiu e o creds.json do bot zerou; com o
// disco cheio ele cai de novo, e creds zerado só volta com QR (45 h mudo). Por isso, nesta ordem:
//   · disco: abaixo de 10 GB livres avisa pelo próprio WhatsApp, enquanto ele ainda funciona (rearma acima de
//     15 GB); abaixo de 2 GB não religa o serviço, que só gravaria estado pela metade;
//   · serviço e ponte: sem processo → guarda o log da queda e roda o iniciar.ps1 (idempotente). Processo vivo
//     e calado não é morto aqui: pode estar subindo, e a subida leva até ~3 min;
//   · bot: sessão fora de 'ready' é coisa que o WhatsApp não consegue contar, então vira aviso na tela do PC.
// Problema só vira aviso na tela depois de duas rodadas seguidas, e uma vez por queda.
//
//   node vigia-servico.mjs          → confere e age (uso do agendador)
//   node vigia-servico.mjs --teste  → diz o que faria, sem religar, avisar ou gravar estado
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BASE, RUN, arquivo, chave, enviarAoDono, sessaoBot } from './config.mjs'

const GB = 1024 ** 3
const AVISO_GB = 10, REARMA_GB = 15, CRITICO_GB = 2
const SUBINDO_MS = 6 * 60_000       // processo sem resposta há menos que isso ainda está subindo
const AVISO_QUEDA_MS = 60 * 60_000  // no máximo um aviso de queda por hora: laço de queda não vira spam
const QUEDAS_GUARDADAS = 10
const ESTADO = arquivo('vigia-servico.json')
const LOGS = join(RUN, 'logs')
const QUEDAS = join(LOGS, 'quedas')
const INICIAR = fileURLToPath(new URL('./iniciar.ps1', import.meta.url))
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const teste = process.argv.includes('--teste')

const estado = (() => { try { return JSON.parse(readFileSync(ESTADO, 'utf8')) } catch { return {} } })()
const hora = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const feito = []
function anotar(texto) {
  feito.push(texto)
  if (!teste) appendFileSync(join(LOGS, 'vigia-servico.log'), `${new Date().toISOString()} ${texto}\n`)
}

// Serviço, ponte e iniciar.ps1 em andamento, pela linha de comando: o .pid pode estar velho.
function processos() {
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'node.exe', 'powershell.exe' } | Select-Object ProcessId, CommandLine, @{ n = 'Inicio'; e = { if ($_.CreationDate) { $_.CreationDate.ToString('o') } } } | ConvertTo-Json -Compress"],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  if (r.status !== 0) throw new Error(`não consegui listar os processos: ${String(r.stderr).trim().slice(0, 200)}`)
  const lista = [].concat(JSON.parse(r.stdout || '[]')).filter(p => p?.CommandLine)
  const acha = re => lista.find(p => re.test(p.CommandLine))
  return {
    servico: acha(/servicos\\whatsapp\\dist\\main\.js/i),
    ponte: acha(/servicos\\whatsapp\\omni\\ponte\.mjs/i),
    iniciando: acha(/-File\s+"?[^"]*servicos\\whatsapp\\omni\\iniciar\.ps1/i),
  }
}

async function responde() {
  try { return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })).ok } catch { return false }
}

// null = sem resposta agora; a próxima rodada vê.
async function statusBot() {
  try {
    const r = await fetch(`${BASE}/api/sessions/${sessaoBot()}`, { headers: { 'X-API-Key': chave('leitura') }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return `HTTP ${r.status}`
    const j = await r.json()
    return (j && typeof j === 'object' && 'data' in j ? j.data : j)?.status || 'desconhecido'
  } catch { return null }
}

// Toast do Windows: para o que o WhatsApp não consegue contar, porque é ele que caiu.
function avisarNaTela(texto) {
  anotar(`aviso na tela: ${texto}`)
  if (teste) return
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    "$t = $x.GetElementsByTagName('text')",
    "[void]$t.Item(0).AppendChild($x.CreateTextNode('Omni · WhatsApp'))",
    '[void]$t.Item(1).AppendChild($x.CreateTextNode($env:OMNI_AVISO))',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
  ].join('; ')
  spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true, timeout: 30_000, env: { ...process.env, OMNI_AVISO: texto } })
}

// O iniciar.ps1 troca o log do serviço por .anterior a cada partida: num laço de queda, a primeira sumiria.
function guardarLogsDaQueda() {
  mkdirSync(QUEDAS, { recursive: true })
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
  for (const nome of ['servico.err.log', 'servico.out.log']) {
    const atual = join(LOGS, nome)
    if (existsSync(atual) && statSync(atual).size) copyFileSync(atual, join(QUEDAS, `${carimbo}.${nome}`))
  }
  const guardados = readdirSync(QUEDAS).sort()
  for (const velho of guardados.slice(0, Math.max(0, guardados.length - 2 * QUEDAS_GUARDADAS))) rmSync(join(QUEDAS, velho), { force: true })
}

function religar(motivo) {
  anotar(`religando: ${motivo}`)
  if (teste) return true
  guardarLogsDaQueda()
  // stdio 'ignore': o serviço que o iniciar.ps1 sobe herdaria os pipes, e o spawnSync esperaria por ele.
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', INICIAR], { stdio: 'ignore', windowsHide: true, timeout: 5 * 60_000 })
  if (r.status !== 0) anotar(`iniciar.ps1 terminou com ${r.status ?? r.error?.message} (detalhe em iniciar.log)`)
  return r.status === 0
}

async function mandar(texto) {
  if (teste) { anotar(`mandaria no WhatsApp: ${texto}`); return true }
  try { await enviarAoDono(texto); anotar('aviso mandado no WhatsApp'); return true } catch (e) { anotar(`WhatsApp não levou o aviso: ${e.message}`); return false }
}

let p
try { p = processos() } catch (e) { console.error(e.message); process.exit(1) }
const { bsize, bavail } = statfsSync(RUN)
const livre = (bavail * bsize) / GB
const vivo = await responde()
let problema = null // { chave, texto }: vira aviso na tela se durar duas rodadas
let religado = false

// 1) Disco
if (livre >= REARMA_GB) estado.discoAvisado = false
else if (livre < AVISO_GB && !estado.discoAvisado) {
  const texto = `O C: está com ${livre.toFixed(1)} GB livres. Em 22/10 foi assim que o WhatsApp morreu: disco cheio derruba o serviço e zera a sessão do bot.`
  if (vivo ? await mandar(`🤖 *Omni · vigia do WhatsApp*\n\n${texto} Me chama numa sessão que eu acho o que está crescendo antes que encha.`) : (avisarNaTela(texto), true)) estado.discoAvisado = true
}

// 2) Serviço e ponte
if (p.iniciando) {
  // outro iniciar.ps1 (logon, sessão) está subindo as coisas; esta rodada não se mete
} else if (!vivo && p.servico) {
  if (Date.now() - Date.parse(p.servico.Inicio) > SUBINDO_MS) problema = { chave: 'calado', texto: `O serviço do WhatsApp está de pé (PID ${p.servico.ProcessId}) mas não responde. Não matei o processo.` }
} else if (!vivo || (!p.ponte && existsSync(arquivo('sessao-bot.id')))) {
  if (!vivo && livre < CRITICO_GB) {
    problema = { chave: 'disco', texto: `O serviço do WhatsApp caiu e o C: está com ${livre.toFixed(1)} GB livres; não religuei para não corromper a sessão do bot.` }
  } else {
    // O iniciar.ps1 confia no ponte.pid: velho, com a ponte viva, ele subiria uma segunda ponte.
    if (p.ponte && !teste) writeFileSync(arquivo('ponte.pid'), String(p.ponte.ProcessId))
    religado = true
    if (!religar(vivo ? 'ponte sem processo' : 'serviço sem processo e sem resposta')) {
      problema = { chave: 'religar', texto: 'O serviço do WhatsApp caiu e não subiu de novo. Os logs da queda ficaram em %APPDATA%\\omni\\whatsapp\\logs\\quedas.' }
    } else if (!vivo) {
      const pendente = estado.avisoDeQueda
      estado.avisoDeQueda = { vivoAte: pendente ? pendente.vivoAte : estado.vistoVivo ?? null, religadoEm: Date.now(), vezes: (pendente?.vezes || 0) + 1 }
    }
  }
}
if (vivo) estado.vistoVivo = Date.now()

// 3) Bot, e o aviso da queda depois que ele voltou
if (vivo && !religado) {
  const status = await statusBot()
  if (status && status !== 'ready') {
    problema ??= { chave: 'bot', texto: `O número do bot está "${status}", fora do ar. Se pedir QR, me chama numa sessão para parear de novo.` }
  } else if (status === 'ready' && estado.avisoDeQueda && Date.now() - (estado.ultimoAvisoDeQueda || 0) > AVISO_QUEDA_MS) {
    const { vivoAte, religadoEm, vezes } = estado.avisoDeQueda
    const quando = `${vivoAte ? `vivo pela última vez às ${hora(vivoAte)}` : 'sem hora conhecida da queda'}, religado às ${hora(religadoEm)}`
    const texto = `🤖 *Omni · vigia do WhatsApp*\n\nO serviço caiu${vezes > 1 ? ` ${vezes} vezes` : ''} (${quando}). Texto que você mandou nesse intervalo chega com atraso; áudio, foto e documento chegam sem o arquivo, então reenvie se mandou algum. Os logs da queda estão guardados.`
    if (await mandar(texto)) { estado.ultimoAvisoDeQueda = Date.now(); estado.avisoDeQueda = null }
  }
}

if (problema && problema.chave === estado.problema) estado.rodadas = (estado.rodadas || 1) + 1
else { estado.problema = problema?.chave ?? null; estado.rodadas = problema ? 1 : 0; estado.avisadoNaTela = false }
if (problema && estado.rodadas >= 2 && !estado.avisadoNaTela) { avisarNaTela(problema.texto); estado.avisadoNaTela = true }

if (!teste) writeFileSync(ESTADO, JSON.stringify(estado, null, 2))
console.log(JSON.stringify({
  livreGB: Number(livre.toFixed(1)),
  servico: vivo ? 'responde' : p.servico ? 'calado' : 'fora',
  ponte: p.ponte ? 'viva' : 'fora',
  iniciando: Boolean(p.iniciando),
  problema: problema?.chave ?? null,
  rodadas: estado.rodadas,
  feito,
}))
