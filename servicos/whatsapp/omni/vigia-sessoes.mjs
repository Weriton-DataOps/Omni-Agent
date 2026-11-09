// Omni — vigia das sessões de trabalho dele.
//
// Uma sessão do Claude não avisa quando para: ela simplesmente fica quieta, igual sonda que sai do
// alcance. O sinal de vida é a transcrição (.jsonl) crescendo. Este vigia roda pelo Agendador do
// Windows, vê quanto tempo faz que cada transcrição parou de crescer e, passado o limite, manda UMA
// mensagem ao Weriton dizendo qual sessão parou e o que ela estava fazendo na última linha.
//
//   node vigia-sessoes.mjs            → confere e avisa (uso do agendador)
//   node vigia-sessoes.mjs --teste    → mostra o que faria, sem mandar nada e sem gravar estado
//   node vigia-sessoes.mjs --rearmar  → esquece os avisos já dados (volta a avisar das mesmas sessões)
//
// Regras para não virar spam:
//   · um aviso por parada: só volta a avisar daquela sessão se ela voltar a trabalhar e parar de novo;
//   · na primeira execução, tudo que já está parado nasce "já avisado" (não dispara enxurrada);
//   · transcrição velha (sem toque hoje) é ignorada.
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { arquivo, enviarAoDono } from './config.mjs'

const PROJETOS = [
  { pasta: 'c--Users-wp-santos-Documents-Reengenharia-station-growth', nome: 'Reengenharia (Station/Growth)' },
  { pasta: 'C--Users-wp-santos-Documents-GR-Workspace-Growth', nome: 'Growth antigo' },
]
const RAIZ = join(process.env.USERPROFILE, '.claude', 'projects')
const QUIETO_MIN = 12          // parada de verdade; abaixo disso é só a sessão pensando
const RECENTE_H = 10           // transcrição sem toque nas últimas 10 h não interessa
const ESTADO = arquivo('vigia-sessoes.json')
const teste = process.argv.includes('--teste')

const minutos = ms => Math.round(ms / 60000)

// Últimas linhas da transcrição: o arquivo chega a dezenas de MB, então lê só o rabo.
function ultimaFala(caminho) {
  const tamanho = statSync(caminho).size
  const pedaco = Math.min(tamanho, 256 * 1024)
  const buffer = Buffer.alloc(pedaco)
  const fd = openSync(caminho, 'r')
  try { readSync(fd, buffer, 0, pedaco, tamanho - pedaco) } finally { closeSync(fd) }
  const linhas = buffer.toString('utf8').split('\n')
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (!linhas[i].trim()) continue
    let j
    try { j = JSON.parse(linhas[i]) } catch { continue }
    const conteudo = j?.message?.content
    const texto = Array.isArray(conteudo)
      ? conteudo.filter(p => p?.type === 'text').map(p => p.text).join(' ').trim()
      : typeof conteudo === 'string' ? conteudo.trim() : ''
    if (j?.type === 'assistant' && texto) return texto.replace(/\s+/g, ' ').slice(0, 220)
  }
  return ''
}

function paradas() {
  const agora = Date.now()
  const fora = []
  for (const { pasta, nome } of PROJETOS) {
    const dir = join(RAIZ, pasta)
    if (!existsSync(dir)) continue
    for (const arq of readdirSync(dir)) {
      if (!arq.endsWith('.jsonl')) continue
      const caminho = join(dir, arq)
      const mtime = statSync(caminho).mtimeMs
      const paradaMin = minutos(agora - mtime)
      if (paradaMin > RECENTE_H * 60 || paradaMin < QUIETO_MIN) continue
      fora.push({ id: arq.replace(/\.jsonl$/, ''), projeto: nome, mtime, paradaMin, caminho })
    }
  }
  return fora
}

const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : null
if (process.argv.includes('--rearmar')) { writeFileSync(ESTADO, JSON.stringify({ avisados: {} }, null, 2)); console.log('vigia rearmado'); process.exit(0) }
const avisados = estado?.avisados || {}
const paradasAgora = paradas()

// Primeira execução: só arma. O que já estava parado antes do vigia existir não é novidade para ele.
if (!estado) {
  for (const p of paradasAgora) avisados[p.id] = p.mtime
  if (!teste) writeFileSync(ESTADO, JSON.stringify({ avisados }, null, 2))
  console.log(JSON.stringify({ armado: paradasAgora.length, avisos: 0 }))
  process.exit(0)
}

const novas = paradasAgora.filter(p => avisados[p.id] !== p.mtime)
if (!novas.length) { console.log(JSON.stringify({ avisos: 0, observadas: paradasAgora.length })); process.exit(0) }

const linhas = novas.map(p => {
  const fala = ultimaFala(p.caminho)
  return `· ${p.projeto} — parada há ${p.paradaMin} min${fala ? `\n  última linha dela: "${fala}"` : ''}`
})
const texto = `🤖 *Omni · vigia de sessões*\n\n${novas.length === 1 ? 'Uma sessão parou' : `${novas.length} sessões pararam`} e deve estar esperando você:\n\n${linhas.join('\n')}`

if (teste) { console.log(texto); process.exit(0) }
try {
  await enviarAoDono(texto)
  for (const p of novas) avisados[p.id] = p.mtime
  writeFileSync(ESTADO, JSON.stringify({ avisados }, null, 2))
  console.log(JSON.stringify({ avisos: novas.length }))
} catch (e) {
  console.error(`vigia não conseguiu avisar: ${e.message}`)
  process.exit(1)
}
