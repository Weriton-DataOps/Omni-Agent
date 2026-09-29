// Omni — relatórios para o WhatsApp do Weriton. Um HTML vira imagem (PNG) ou PDF pelo Edge em modo sem
// janela (perfil isolado, não mexe no navegador dele), ou vai como o próprio HTML. Imagem, PDF e HTML
// prontos também seguem direto. Destino: só o dono, pela chave de envio (bot → dono).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, extname, join } from 'node:path'
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
export function renderizar(html, formato, { largura = 540, altura = 960, nome } = {}) {
  const navegador = NAVEGADORES.find(existsSync)
  if (!navegador) throw new Error('nenhum navegador (Edge ou Chrome) para renderizar o relatório')
  mkdirSync(PASTA, { recursive: true })
  const saida = join(PASTA, `${nome || basename(html, extname(html))}-${Date.now()}.${formato === 'pdf' ? 'pdf' : 'png'}`)
  // Sem --virtual-time-budget: no headless novo ele faz o navegador sair antes de gravar a captura.
  const base = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${join(PASTA, '.perfil-navegador')}`]
  const alvo = formato === 'pdf'
    ? [`--print-to-pdf=${saida}`, '--no-pdf-header-footer']
    : [`--screenshot=${saida}`, `--window-size=${largura},${altura}`, '--force-device-scale-factor=2']
  const r = spawnSync(navegador, [...base, ...alvo, pathToFileURL(html).href], { timeout: 90_000, windowsHide: true })
  if (!existsSync(saida) || statSync(saida).size < 100) throw new Error(`o navegador não gerou o ${formato === 'pdf' ? 'PDF' : 'PNG'} (exit ${r.status})`)
  return saida
}

// Relatório comprido numa imagem só vira uma tira fina e ilegível no celular (Weriton, 29/09/2026:
// "assim fica ruim, não consigo enxergar"). Então a imagem sai em páginas do tamanho da tela, cortadas
// entre os blocos de primeiro nível do <body> (seções), nunca no meio de uma linha.
export const ALTURA_PAGINA = 1100
const MEDIR = `<script>addEventListener('load',()=>{const b=document.body,y=scrollY,blocos=[...b.children].map((el,i)=>{if(el.tagName==='SCRIPT')return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{i:i+1,topo:r.top+y-parseFloat(s.marginTop),base:r.bottom+y+parseFloat(s.marginBottom)}}).filter(Boolean);const m=document.createElement('script');m.type='omni/medidas';m.textContent=JSON.stringify({altura:document.documentElement.scrollHeight,blocos});b.appendChild(m)})</script>`

// Cópia do HTML na mesma pasta (caminhos relativos continuam valendo) com um trecho injetado antes do </body>.
function copiaCom(html, trecho, sufixo) {
  const texto = readFileSync(html, 'utf8')
  const copia = join(dirname(html), `.${basename(html, extname(html))}-${sufixo}-${Date.now()}.html`)
  writeFileSync(copia, /<\/body>/i.test(texto) ? texto.replace(/<\/body>/i, `${trecho}</body>`) : texto + trecho)
  return copia
}

function medir(html, largura) {
  const navegador = NAVEGADORES.find(existsSync)
  if (!navegador) throw new Error('nenhum navegador (Edge ou Chrome) para renderizar o relatório')
  const copia = copiaCom(html, MEDIR, 'medida')
  try {
    const r = spawnSync(navegador, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${join(PASTA, '.perfil-navegador')}`,
      `--window-size=${largura},${ALTURA_PAGINA}`, '--dump-dom', pathToFileURL(copia).href], { timeout: 60_000, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const achado = /<script type="omni\/medidas">([\s\S]*?)<\/script>/.exec(r.stdout || '')
    if (!achado) throw new Error(`não consegui medir o relatório (exit ${r.status})`)
    return JSON.parse(achado[1])
  } finally { rmSync(copia, { force: true }) }
}

// Agrupa os blocos em páginas de até `limite` px CSS; bloco maior que a página vai sozinho, inteiro.
export function paginar(blocos, limite = ALTURA_PAGINA) {
  const paginas = []
  let atual = []
  for (const bloco of blocos) {
    if (atual.length && bloco.base - atual[0].topo > limite) { paginas.push(atual); atual = [] }
    atual.push(bloco)
  }
  if (atual.length) paginas.push(atual)
  return paginas
}

// Uma imagem por página, cada uma com a altura exata do que mostra.
export function renderizarPaginas(html, { largura = 540, altura = ALTURA_PAGINA } = {}) {
  const { altura: total, blocos } = medir(html, largura)
  if (total <= altura || blocos.length < 2) return [renderizar(html, 'png', { largura, altura: Math.ceil(total) })]
  return paginar(blocos, altura).map((pagina, n) => {
    const ficam = pagina.map(b => `:not(:nth-child(${b.i}))`).join('')
    const copia = copiaCom(html, `<style>body > *${ficam} { display: none !important; }</style>`, `pagina-${n + 1}`)
    const nome = `${basename(html, extname(html))}-pagina-${n + 1}`
    try { return renderizar(copia, 'png', { largura, altura: Math.ceil(medir(copia, largura).altura), nome }) }
    finally { rmSync(copia, { force: true }) }
  })
}

// formato: 'imagem' | 'pdf' | 'html' (vale para arquivo .html; padrão imagem, paginada em telas).
// altura: para imagem, a altura máxima de cada página em px CSS (padrão ALTURA_PAGINA).
// Devolve waId/final da primeira mensagem e waIds/finais de todas (uma por página).
export async function enviarArquivoAoDono(caminho, { formato, legenda, largura, altura } = {}, citarId) {
  if (!caminho || !existsSync(caminho)) throw new Error(`arquivo não encontrado: ${caminho}`)
  const ext = extname(caminho).toLowerCase()
  let finais = [caminho], rota, mime
  if (ext === '.html' || ext === '.htm') {
    const f = formato || 'imagem'
    if (f === 'html') { rota = 'send-document'; mime = 'text/html' }
    else if (f === 'pdf') { finais = [renderizar(caminho, 'pdf')]; rota = 'send-document'; mime = 'application/pdf' }
    else { finais = renderizarPaginas(caminho, { largura, altura }); rota = 'send-image'; mime = 'image/png' }
  } else if (IMAGENS[ext]) { rota = 'send-image'; mime = IMAGENS[ext] }
  else if (ext === '.pdf') { rota = 'send-document'; mime = 'application/pdf' }
  else throw new Error('formato não suportado: use .html, .png, .jpg, .webp ou .pdf')
  const caminhoApi = `/api/sessions/${sessaoBot()}/messages/${rota}`
  const waIds = []
  for (const [n, final] of finais.entries()) {
    const buffer = readFileSync(final)
    if (buffer.length > 15 * 1024 * 1024) throw new Error('arquivo maior que 15 MB')
    const pagina = finais.length > 1 ? `(${n + 1}/${finais.length})` : ''
    const texto = n === 0 ? [legenda, pagina].filter(Boolean).join(' ') : pagina
    const corpo = {
      chatId: donoJid(), base64: buffer.toString('base64'), mimetype: mime,
      ...(rota === 'send-document' ? { filename: basename(final) } : {}),
      ...(texto ? { caption: String(texto).slice(0, 1000) } : {}),
    }
    const citar = n === 0 ? citarId : null
    let r = await api(caminhoApi, { metodo: 'POST', corpo: citar ? { ...corpo, quotedMessageId: citar } : corpo, papel: 'envio' })
    if (!r.ok && citar) r = await api(caminhoApi, { metodo: 'POST', corpo, papel: 'envio' })
    if (!r.ok) throw new Error(`envio recusado pelo serviço (HTTP ${r.status})${n ? ` na página ${n + 1} de ${finais.length}` : ''}`)
    waIds.push(r.dados.waMessageId || r.dados.messageId || r.dados.id)
  }
  const tipo = rota === 'send-image' ? (finais.length > 1 ? `imagem em ${finais.length} páginas` : 'imagem') : mime === 'application/pdf' ? 'PDF' : 'HTML'
  return { waId: waIds[0], waIds, final: finais[0], finais, tipo }
}
