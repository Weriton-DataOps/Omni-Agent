// Omni — estado local da integração com o Sentinel (05/11/2026). Sem rede: a ponte do WhatsApp importa daqui
// para anotar a resposta em texto do Weriton a um pedido, e a checagem lê e grava o resto.
//   %APPDATA%\omni\sentinel\estado.json   janela já checada, decisão por recado, cutucadas vistas
//   %APPDATA%\omni\sentinel\pedidos.json  recado que foi a ele no WhatsApp, por waMessageId
//   %APPDATA%\omni\sentinel\livro.jsonl   tudo o que foi respondido, pedido ou parado (o ledger)
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PASTA = process.env.OMNI_SENTINEL_PASTA || join(process.env.APPDATA || '', 'omni', 'sentinel')
const caminho = nome => join(PASTA, nome)

function ler(nome, padrao) {
  try { return JSON.parse(readFileSync(caminho(nome), 'utf8')) } catch { return padrao }
}
function gravar(nome, valor) {
  mkdirSync(PASTA, { recursive: true })
  const tmp = `${caminho(nome)}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(valor, null, 2))
  renameSync(tmp, caminho(nome))
}

export const lerEstado = () => ler('estado.json', { vistos: {}, cutucadas: [] })
export const gravarEstado = e => gravar('estado.json', e)
export const lerPedidos = () => ler('pedidos.json', {})
export const gravarPedidos = p => gravar('pedidos.json', p)

export function anotarNoLivro(entrada) {
  mkdirSync(PASTA, { recursive: true })
  appendFileSync(caminho('livro.jsonl'), JSON.stringify({ em: new Date().toISOString(), ...entrada }) + '\n')
}

// A ponte chama quando ele responde em texto citando uma mensagem. Devolve o id do recado se a citada era
// um pedido do Sentinel ainda aberto; o texto dele vai literal na próxima rodada da checagem.
export function registrarResposta(waId, texto, agora = Date.now()) {
  const pedidos = lerPedidos()
  const p = pedidos[waId]
  const corpo = String(texto || '').trim()
  if (!p || p.estado !== 'pendente' || agora > p.expiraEm || !corpo) return null
  p.respostaDele = { texto: corpo.slice(0, 2000), em: agora }
  gravarPedidos(pedidos)
  return p.recadoId
}
