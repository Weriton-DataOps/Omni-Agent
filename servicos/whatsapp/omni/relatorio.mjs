// Omni — relatórios para o WhatsApp do Weriton. Um HTML vira imagem (PNG) ou PDF pelo Edge em modo sem
// janela (perfil isolado, não mexe no navegador dele), ou vai como o próprio HTML. Imagem, PDF e HTML
// prontos também seguem direto. Destino: só o dono, pela chave de envio (bot → dono).
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { arquivo, api, sessaoBot, donoJid } from './config.mjs'

export const PASTA = arquivo('relatorios')
const NAVEGADORES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const IMAGENS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

// Imagem: a página é desenhada em `largura` px CSS e fotografada em dobro (1080 px de largura por padrão),
// nítida no celular. PDF: página inteira, sem cabeçalho nem rodapé do navegador.
export function renderizar(html, formato, { largura = 540, altura = 960 } = {}) {
  const navegador = NAVEGADORES.find(existsSync)
  if (!navegador) throw new Error('nenhum navegador (Edge ou Chrome) para renderizar o relatório')
  mkdirSync(PASTA, { recursive: true })
  const saida = join(PASTA, `${basename(html, extname(html))}-${Date.now()}.${formato === 'pdf' ? 'pdf' : 'png'}`)
  // Sem --virtual-time-budget: no headless novo ele faz o navegador sair antes de gravar a captura.
  const base = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${join(PASTA, '.perfil-navegador')}`]
  const alvo = formato === 'pdf'
    ? [`--print-to-pdf=${saida}`, '--no-pdf-header-footer']
    : [`--screenshot=${saida}`, `--window-size=${largura},${altura}`, '--force-device-scale-factor=2']
  const r = spawnSync(navegador, [...base, ...alvo, pathToFileURL(html).href], { timeout: 90_000, windowsHide: true })
  if (!existsSync(saida) || statSync(saida).size < 100) throw new Error(`o navegador não gerou o ${formato === 'pdf' ? 'PDF' : 'PNG'} (exit ${r.status})`)
  return saida
}

// formato: 'imagem' | 'pdf' | 'html' (vale para arquivo .html; padrão imagem).
export async function enviarArquivoAoDono(caminho, { formato, legenda, largura, altura } = {}, citarId) {
  if (!caminho || !existsSync(caminho)) throw new Error(`arquivo não encontrado: ${caminho}`)
  const ext = extname(caminho).toLowerCase()
  let final = caminho, rota, mime
  if (ext === '.html' || ext === '.htm') {
    const f = formato || 'imagem'
    if (f === 'html') { rota = 'send-document'; mime = 'text/html' }
    else if (f === 'pdf') { final = renderizar(caminho, 'pdf'); rota = 'send-document'; mime = 'application/pdf' }
    else { final = renderizar(caminho, 'png', { largura, altura }); rota = 'send-image'; mime = 'image/png' }
  } else if (IMAGENS[ext]) { rota = 'send-image'; mime = IMAGENS[ext] }
  else if (ext === '.pdf') { rota = 'send-document'; mime = 'application/pdf' }
  else throw new Error('formato não suportado: use .html, .png, .jpg, .webp ou .pdf')
  const buffer = readFileSync(final)
  if (buffer.length > 15 * 1024 * 1024) throw new Error('arquivo maior que 15 MB')
  const corpo = {
    chatId: donoJid(), base64: buffer.toString('base64'), mimetype: mime,
    ...(rota === 'send-document' ? { filename: basename(final) } : {}),
    ...(legenda ? { caption: String(legenda).slice(0, 1000) } : {}),
  }
  const caminhoApi = `/api/sessions/${sessaoBot()}/messages/${rota}`
  let r = await api(caminhoApi, { metodo: 'POST', corpo: citarId ? { ...corpo, quotedMessageId: citarId } : corpo, papel: 'envio' })
  if (!r.ok && citarId) r = await api(caminhoApi, { metodo: 'POST', corpo, papel: 'envio' })
  if (!r.ok) throw new Error(`envio recusado pelo serviço (HTTP ${r.status})`)
  return { waId: r.dados.waMessageId || r.dados.messageId || r.dados.id, final, tipo: rota === 'send-image' ? 'imagem' : mime === 'application/pdf' ? 'PDF' : 'HTML' }
}
