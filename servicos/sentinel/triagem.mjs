// Omni — regras puras da checagem do Sentinel (05/11/2026): janela de horário, o que é novo, a validação da
// decisão que a sessão escondida devolve, as guardas determinísticas e o texto do pedido ao Weriton.
// Nada aqui chama rede: é a parte que os testes provam.

// Checagem só em dia útil, às 9h, 13h e 17h (horário do PC). PC ligado depois da hora: roda a janela que
// passou, uma vez. Antes das 9h ou fim de semana: nada.
export const HORAS = [9, 13, 17]
export function janela(agora = new Date()) {
  const dia = agora.getDay()
  if (dia === 0 || dia === 6) return null
  const hora = [...HORAS].reverse().find(h => agora.getHours() >= h)
  if (hora === undefined) return null
  const d = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
  return `${d}@${hora}`
}

// Novo = ainda não tratado no Sentinel e sem decisão nossa registrada. "parado" (resposta recusada, ex.:
// política de responder sozinho desligada) volta para nova tentativa sem nova triagem.
export function novos(recados, vistos = {}) {
  return (recados || []).filter(r => r && Number.isInteger(r.id) && !r.jaTratado && !vistos[r.id])
}
export function parados(recados, vistos = {}) {
  return (recados || []).filter(r => r && !r.jaTratado && vistos[r.id]?.situacao === 'parado')
}

// Segredo na resposta: a sessão lê repositórios, e texto de recado é de terceiro. Qualquer cara de
// credencial, conexão ou endereço interno tira a resposta do automático.
const SEGREDO = [
  /\bsk_[a-z]{2,}_[A-Za-z0-9_-]{8,}/i,
  /\b(senha|password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
  /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|sqlserver):\/\/\S+/i,
  /\b172\.20\.13\.\d{1,3}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
]
export const pareceSegredo = texto => SEGREDO.some(re => re.test(String(texto || '')))

export const CLASSES = ['rotina', 'invasivo', 'nada']
const TETO = 2000

// A sessão escondida devolve { decisoes: [{ id, classe, resposta, motivo, resumo }] }. Tudo o que vier fora
// do combinado vira "invasivo" (pede a ele) — nunca vira envio automático.
export function validar(saida, recados) {
  const porId = new Map((recados || []).map(r => [r.id, r]))
  const lista = Array.isArray(saida?.decisoes) ? saida.decisoes : []
  const vistas = new Set()
  const decisoes = []
  for (const d of lista) {
    const id = Number(d?.id)
    if (!porId.has(id) || vistas.has(id)) continue
    vistas.add(id)
    decisoes.push(guardar({ id, classe: String(d.classe || ''), resposta: String(d.resposta || '').trim(), motivo: String(d.motivo || '').trim(), resumo: String(d.resumo || '').trim() }, porId.get(id)))
  }
  // recado que a sessão esqueceu: pede a ele, sem rascunho
  for (const r of recados || []) if (!vistas.has(r.id)) decisoes.push({ id: r.id, classe: 'invasivo', resposta: '', motivo: 'a triagem não decidiu este recado', resumo: '' })
  return decisoes
}

// As guardas mandam mais que a sessão: elas só tiram do automático, nunca põem nele.
export function guardar(d, recado) {
  const sobe = motivo => ({ ...d, classe: 'invasivo', motivo: d.motivo ? `${d.motivo} · ${motivo}` : motivo })
  if (!CLASSES.includes(d.classe)) return sobe('classe fora do combinado')
  if (recado?.missaoId != null && d.classe !== 'invasivo') return sobe('é sobre uma missão: aceitar ou recusar é dele')
  if (d.classe === 'rotina') {
    if (!d.resposta) return sobe('rotina sem resposta')
    if (d.resposta.length > TETO) return sobe('resposta passou de 2000 caracteres')
    if (pareceSegredo(d.resposta)) return sobe('a resposta tinha cara de credencial ou endereço interno')
  }
  if (d.classe === 'invasivo' && d.resposta && (d.resposta.length > TETO || pareceSegredo(d.resposta))) return { ...d, resposta: '', motivo: `${d.motivo} · rascunho descartado (segredo ou tamanho)` }
  return d
}

// Tira o JSON do texto final da sessão (pode vir com cerca de código ou frase em volta).
export function extrairJson(texto) {
  const t = String(texto || '')
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidato = cerca ? cerca[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)
  try { return JSON.parse(candidato) } catch { return null }
}

const corta = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

// A mensagem ao Weriton para o que é dele decidir. Resposta dele em texto citando esta mensagem a ponte
// anota (pedidos.registrarResposta) e a próxima rodada manda literal.
export function textoDoPedido(recado, d) {
  return [
    '🛰️ *Sentinel · recado pra você decidir*',
    '',
    `*De:* ${recado.de?.agente || '?'} (${recado.de?.login || '?'})${recado.urgente ? ' · URGENTE' : ''}`,
    `*Pede:* ${corta(d.resumo || recado.texto, 400)}`,
    `*Por que é seu:* ${corta(d.motivo, 200)}`,
    '',
    d.resposta ? `*Rascunho da resposta:*\n${d.resposta}` : '*Sem rascunho:* não tenho como responder isso por você.',
    '',
    d.resposta
      ? 'Reaja: 👍 mando o rascunho · 👎 não respondo (fica com você) · ou responda citando esta mensagem com o texto que deve ir.'
      : 'Responda citando esta mensagem com o texto que deve ir, ou 👎 pra deixar com você.',
    `ref sentinel#${recado.id}`,
  ].join('\n')
}

// Reação dele no pedido. reacoes: [{ fone, emoji }] já resolvidas para telefone; só a do dono conta.
const SIM = /^👍(?:[\u{1F3FB}-\u{1F3FF}])?$/u
const NAO = /^👎(?:[\u{1F3FB}-\u{1F3FF}])?$/u
export const VALIDADE_MS = 48 * 3600_000
export function decidirPedido(pedido, reacoes, { donoFone, agora = Date.now() } = {}) {
  if (!pedido) return 'invalido'
  if (pedido.estado !== 'pendente') return pedido.estado
  if (agora > pedido.expiraEm) return 'expirado'
  // texto dele citando o pedido é a resposta mais específica que existe: vai literal
  if (String(pedido.respostaDele?.texto || '').trim()) return 'texto'
  const dele = (reacoes || []).filter(r => r?.fone && r.fone === donoFone && r.emoji)
  const emoji = dele.length ? dele[dele.length - 1].emoji : ''
  if (SIM.test(emoji) && pedido.rascunho) return 'sim'
  if (NAO.test(emoji)) return 'nao'
  return 'pendente'
}
