// Omni — envio do bot para outras pessoas, com autorização pontual do Weriton (definido por ele em 28/09/2026).
// Regras conferidas aqui, no código, nunca pelo julgamento do modelo:
//   · a autorização é uma mensagem RECEBIDA no chat do bot, vinda do número do dono, fora de grupo;
//   · tem no máximo 2 h;
//   · pede o envio e nomeia o destinatário (nome da agenda ou número), ou responde com um "pode" a uma
//     mensagem do bot que nomeia o destinatário; áudio vale, pela transcrição;
//   · nome parcial ("o Marcos") vale se, pelas mesmas regras de agenda + conversa recente, apontar para a
//     mesma pessoa;
//   · vale para UM envio (uso único, registrado em terceiros-ledger.jsonl);
//   · se a conversa com o destinatário mudou depois da autorização, o envio para e pede um pedido novo.
// O envio sai do número do bot, com a chave `terceiros`, abrindo com a identificação do Omni.
// Nada sai pela sessão pessoal do Weriton.
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { api, arquivo, sessaoBot, sessaoPessoal, dono, usuario, voz, enviarAoDono } from './config.mjs'
import { turnosHumanosRecentes } from './sessao-pc.mjs'

export const JANELA_MS = 2 * 3600_000
export const ABERTURA = 'Aqui é o Omni, assistente do Weriton.'
const LIVRO = () => arquivo('terceiros-ledger.jsonl')
// "Yasmin" e "Iasmin" são a mesma pessoa escrita de dois jeitos: o y vira i dos dois lados da comparação,
// então a grafia dele nunca derruba o envio. Se a troca passar a casar duas pessoas diferentes, a resolução
// devolve as opções em vez de escolher — ambiguidade para, não erra.
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/y/g, 'i')
const digitos = s => String(s || '').replace(/\D/g, '')
const instante = m => (m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000)
const VERBO = /\b(manda|mande|mandar|envia|envie|enviar|encaminha|encaminhe|encaminhar|avisa|avise|avisar|fala|fale|falar|diz|diga|responde|responda|responder|retorna|retorne|repassa|repasse)\b/
const CONCORDA = /\b(pode|manda|envia|sim|ok|isso|beleza|fechado|bora|vai)\b/
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
const palavras = s => norm(s).split(/[^a-z0-9]+/).filter(p => p.length >= 2 && !VAZIAS.has(p))

// Envio recusado por regra (diferente de falha técnica).
export class Recusa extends Error {}

export function livroTerceiros() {
  const mapa = new Map()
  if (!existsSync(LIVRO())) return mapa
  for (const linha of readFileSync(LIVRO(), 'utf8').split('\n')) {
    try { const e = JSON.parse(linha); if (e.autorizacao) mapa.set(e.autorizacao, e) } catch { /* linha parcial */ }
  }
  return mapa
}
const anotarTerceiros = e => appendFileSync(LIVRO(), JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n')

async function contatosAgenda() {
  const r = await api(`/api/sessions/${sessaoPessoal()}/contacts?limit=5000`)
  if (!r.ok) throw new Error(`agenda indisponível (HTTP ${r.status}) — a sessão pessoal do WhatsApp provavelmente está desconectada`)
  return (Array.isArray(r.dados) ? r.dados : r.dados?.contacts || []).filter(c => c.name && !String(c.id).endsWith('@g.us'))
}
async function conversasRecentes(dias) {
  const r = await api(`/api/sessions/${sessaoPessoal()}/chats`)
  const corte = Date.now() / 1000 - dias * 86400
  return new Set((Array.isArray(r.dados) ? r.dados : r.dados?.chats || []).filter(c => !c.isGroup && c.timestamp >= corte).map(c => digitos(c.id)))
}
const numeroDe = c => digitos(c.number || c.id)

// Agenda fora do ar não pode apagar quem ele JÁ autorizou antes: cada envio confirmado gravou nome e número
// no ledger, resolvidos pela agenda quando ela estava de pé. É o único socorro — gente nova continua
// dependendo da agenda, porque adivinhar número de desconhecido é exatamente o erro que não tem Ctrl+Z.
function contatosDoLivro() {
  const vistos = new Map()
  for (const e of livroTerceiros().values()) {
    if (!['enviada', 'parcial'].includes(e.status)) continue
    const d = e.destinatario
    if (!d?.nome || !d?.numero) continue
    vistos.set(d.numero, { name: d.nome, id: d.chatPessoal || `${d.numero}@c.us`, number: d.numero, doLivro: true })
  }
  return [...vistos.values()]
}

// Destinatário: número (10+ dígitos) ou nome da agenda do Weriton. Nome que casa com vários é desempatado
// pela conversa dos últimos 3 dias; se ainda sobrar mais de um, nada sai e as opções voltam.
export async function resolverContato(destinatario) {
  const d = digitos(destinatario)
  if (d.length >= 10) {
    const numero = d.length <= 11 ? `55${d}` : d
    const chk = await api(`/api/sessions/${sessaoBot()}/contacts/check/${numero}`)
    if (chk.ok && chk.dados?.exists === false) throw new Recusa(`o número …${numero.slice(-4)} não está no WhatsApp`)
    // Número dado não depende da agenda: ela só serve para pôr o nome no recibo. Sessão pessoal caída não
    // pode barrar um envio que ele pediu com o número na mão — quem autoriza é a mensagem dele, não a agenda.
    const naAgenda = (await contatosAgenda().catch(() => [])).find(c => numeroDe(c).endsWith(numero.slice(-8)))
    return { nome: naAgenda?.name || null, numero, jid: `${numero}@c.us`, chatPessoal: naAgenda?.id || `${numero}@c.us` }
  }
  const contatos = await contatosAgenda().catch(e => {
    const conhecidos = contatosDoLivro()
    if (!conhecidos.length) throw e
    return conhecidos
  })
  const pedidas = palavras(destinatario)
  if (!pedidas.length) throw new Recusa('diga o nome ou o número de quem vai receber')
  let achados = contatos.filter(c => { const p = palavras(c.name); return pedidas.every(x => p.includes(x)) })
  // Socorro do ledger: ele costuma chamar a pessoa por um nome mais completo do que o gravado na agenda
  // ("Yasmin Franco" para um contato salvo como "Iasmin Gr Group"). Aqui o cruzamento parcial vale, mas só
  // se for único e se nenhuma palavra sobrando apontar para outra pessoa do ledger — na dúvida, devolve as
  // opções em vez de escolher. Na agenda de verdade a regra segue estrita.
  if (!achados.length && contatos.length && contatos.every(c => c.doLivro)) {
    const toca = c => palavras(c.name).filter(x => pedidas.includes(x)).length
    const candidatos = contatos.filter(c => toca(c) > 0)
    const conflito = p => contatos.some(c => toca(c) === 0 && palavras(c.name).includes(p))
    if (candidatos.length === 1 && !pedidas.some(conflito)) achados = candidatos
  }
  const exato = achados.filter(c => norm(c.name).trim() === norm(destinatario).trim())
  if (exato.length === 1) achados = exato
  if (achados.length > 1) {
    const recentes = await conversasRecentes(3)
    const ativos = achados.filter(c => recentes.has(numeroDe(c)))
    if (ativos.length === 1) achados = ativos
  }
  const rotulo = c => `${c.name} (…${numeroDe(c).slice(-4)})`
  if (!achados.length) throw new Recusa(`ninguém na agenda com "${destinatario}"`)
  if (achados.length > 1) throw new Recusa(`"${destinatario}" casa com ${achados.length} contatos: ${achados.slice(0, 10).map(rotulo).join('; ')}. Pergunte ao Weriton qual.`)
  const c = achados[0]
  return { nome: c.name, numero: numeroDe(c), jid: `${numeroDe(c)}@c.us`, chatPessoal: c.id, ...(c.doLivro ? { viaLivro: true } : {}) }
}

async function telefoneDe(jid) {
  if (!String(jid).endsWith('@lid')) return usuario(jid)
  const { ok, dados } = await api(`/api/sessions/${sessaoBot()}/contacts/${encodeURIComponent(jid)}/phone`)
  return ok ? usuario(dados?.phone || dados?.phoneNumber || dados?.number || '') : ''
}

// O texto nomeia o contato? Número (últimos 8 dígitos) ou palavras do nome que, resolvidas pelas mesmas
// regras de agenda, apontam para a mesma pessoa.
async function nomeia(texto, contato) {
  if (!texto) return false
  if (digitos(texto).includes(contato.numero.slice(-8))) return true
  const presentes = palavras(contato.nome).filter(x => new RegExp(`\\b${x}\\b`).test(texto))
  if (!presentes.length) return false
  const outro = await resolverContato(presentes.join(' ')).catch(() => null)
  return outro?.numero === contato.numero
}

export async function verificarAutorizacao(autorizacao, contato) {
  if (!autorizacao) throw new Recusa('falta a autorização: o id da mensagem do Weriton que pediu este envio')
  const r = await api(`/api/sessions/${sessaoBot()}/messages?limit=100&inlineMedia=false`)
  const m = (r.dados?.messages || []).find(x => x.waMessageId === autorizacao)
  if (!m) throw new Recusa('a autorização não está entre as mensagens recentes do chat do bot')
  if (m.direction !== 'incoming') throw new Recusa('a autorização tem que ser uma mensagem do Weriton, não do bot')
  if (String(m.chatId).endsWith('@g.us')) throw new Recusa('mensagem de grupo não autoriza envio')
  if (await telefoneDe(m.author || m.from || m.chatId) !== dono()) throw new Recusa('só mensagem do Weriton, no chat dele com o bot, autoriza envio')
  const quando = instante(m)
  if (Date.now() - quando > JANELA_MS) throw new Recusa('a autorização tem mais de 2 horas; peça ao Weriton de novo')
  const anterior = livroTerceiros().get(autorizacao)
  if (anterior && anterior.status !== 'falhou') throw new Recusa(`essa autorização já foi usada (${anterior.status}, para ${anterior.destinatario?.nome || anterior.destinatario?.numero}); cada pedido vale um envio`)

  // O que ele disse: texto, ou a transcrição do áudio que ELE gravou. Áudio encaminhado ou arquivo de áudio
  // (tipo 'audio') é voz de outra pessoa e nunca autoriza nada.
  if (m.type === 'audio') throw new Recusa('áudio encaminhado não vale como autorização; só texto ou áudio gravado pelo Weriton')
  let fala = String(m.body || '')
  if (['ptt', 'voice'].includes(m.type)) {
    const b = await api(`/api/sessions/${sessaoBot()}/messages/${encodeURIComponent(m.chatId)}/${encodeURIComponent(m.waMessageId)}/media`, { bruto: true })
    if (!b.ok) throw new Recusa('não consegui ouvir o áudio da autorização')
    fala = await voz('transcrever', b.buffer, b.tipo)
  }
  const t = norm(fala), citada = norm(m.metadata?.quotedMessage?.body)
  const direto = VERBO.test(t) && await nomeia(t, contato)
  const porCitacao = !direto && CONCORDA.test(t) && await nomeia(citada, contato)
  if (!direto && !porCitacao) throw new Recusa(`a mensagem do Weriton não pede envio para ${contato.nome || 'esse número'}`)

  // Conversa com a pessoa mudou depois do pedido? O contexto pode ter virado: pede um pedido novo.
  const conv = await api(`/api/sessions/${sessaoPessoal()}/messages?chatId=${encodeURIComponent(contato.chatPessoal)}&limit=30&inlineMedia=false`)
  const depois = (conv.dados?.messages || []).filter(x => instante(x) > quando)
  if (depois.length) throw new Recusa(`a conversa com ${contato.nome || 'essa pessoa'} teve ${depois.length} mensagem(ns) depois do pedido; o contexto pode ter mudado, confirme com o Weriton com um pedido novo`)
  return { quando, fala }
}

// Quem recebeu mensagem do bot e responde ganha um aviso fixo (no máximo 1 a cada 12 h por pessoa, para não
// virar pingue-pongue com outro robô); o que ela escreveu é repassado ao Weriton. Texto fixo: nada do modelo.
export const INFORMATIVO = 'Este número é só para avisos do Omni, assistente do Weriton, e não recebe respostas. Para qualquer assunto, fale direto com o Weriton. 🙂'
export function destinatarioConhecido(fone) {
  const fim = digitos(fone).slice(-8)
  return [...livroTerceiros().values()].find(e => ['enviada', 'parcial'].includes(e.status) && e.destinatario?.numero?.slice(-8) === fim)?.destinatario || null
}
export async function responderInformativo(chatId, citarId) {
  const r = await api(`/api/sessions/${sessaoBot()}/messages/send-text`, { metodo: 'POST', corpo: { chatId, text: INFORMATIVO, quotedMessageId: citarId }, papel: 'terceiros' })
  if (!r.ok) throw new Error(`aviso informativo recusado (HTTP ${r.status})`)
}

// Núcleo do envio, comum às duas vias (bot-chat e sessão do PC): reserva no ledger, manda texto e, se houver,
// áudio, e devolve o corpo e os ids. Cada via faz a sua checagem de autorização ANTES de chamar isto.
async function despachar(contato, { texto, audio }, autorizacao, meta = {}) {
  anotarTerceiros({ autorizacao, ...meta, status: 'reservada', destinatario: contato })
  const enviados = []
  const corpo = `${ABERTURA}\n\n${texto || 'Segue um áudio 👇'}`
  try {
    const r1 = await api(`/api/sessions/${sessaoBot()}/messages/send-text`, { metodo: 'POST', corpo: { chatId: contato.jid, text: corpo }, papel: 'terceiros' })
    if (!r1.ok) throw new Error(`texto recusado pelo serviço (HTTP ${r1.status})`)
    enviados.push(r1.dados.waMessageId || r1.dados.messageId)
    if (audio) {
      const ogg = await voz('falar', audio, undefined, 'terceiros')
      const r2 = await api(`/api/sessions/${sessaoBot()}/messages/send-audio`, { metodo: 'POST', corpo: { chatId: contato.jid, base64: ogg.toString('base64'), mimetype: 'audio/ogg; codecs=opus', ptt: true }, papel: 'terceiros' })
      if (!r2.ok) throw new Error(`áudio recusado pelo serviço (HTTP ${r2.status})`)
      enviados.push(r2.dados.waMessageId || r2.dados.messageId)
    }
  } catch (e) {
    // Parcial conta como usada: reenviar duplicaria o que já chegou.
    anotarTerceiros({ autorizacao, ...meta, status: enviados.length ? 'parcial' : 'falhou', destinatario: contato, erro: e.message, enviados })
    throw e
  }
  anotarTerceiros({ autorizacao, ...meta, status: 'enviada', destinatario: contato, texto, audio: audio || null, enviados })
  return { corpo, enviados }
}

function validarMensagem(texto, audio) {
  texto = String(texto || '').trim()
  audio = String(audio || '').trim()
  if (!texto && !audio) throw new Recusa('nada para enviar: informe texto e/ou áudio')
  if (texto.length > 3500 || audio.length > 2000) throw new Recusa('mensagem longa demais para WhatsApp')
  return { texto, audio }
}

// Via 1: autorizada por mensagem do Weriton no chat do bot (waMessageId). Trava anti-injeção intacta.
export async function enviarParaContato({ destinatario, texto, audio, autorizacao }) {
  ({ texto, audio } = validarMensagem(texto, audio))
  const contato = await resolverContato(destinatario)
  await verificarAutorizacao(autorizacao, contato)
  const { corpo, enviados } = await despachar(contato, { texto, audio }, autorizacao)
  const quem = `${contato.nome || 'número'} (…${contato.numero.slice(-4)})`
  const ressalva = contato.viaLivro ? '\n\n⚠️ Agenda fora do ar (sessão pessoal desconectada): o número veio do ledger de envios anteriores a essa pessoa.' : ''
  await enviarAoDono(`✅ Enviei para ${quem}${audio ? ', texto + áudio' : ''}:\n\n${corpo}${audio ? `\n\n🔊 No áudio: "${audio}"` : ''}${ressalva}`, autorizacao).catch(() => { /* a confirmação não desfaz o envio */ })
  return { contato, enviados }
}

// Chave de uso único da via do PC: nasce do CONTEÚDO do pedido + do destinatário, não do relógio. Mesmo
// pedido para a mesma pessoa = mesma chave = reenvio barrado. (A via antiga usava Date.now(), que tornava
// o "uso único" decorativo: cada chamada ganhava chave nova.)
const chaveSessaoPC = (pedido, contato) =>
  'pc:' + createHash('sha256').update(norm(pedido) + '|' + contato.numero).digest('hex').slice(0, 24)

// Autorização da via 2, conferida AQUI, no código — mesma trava anti-injeção do bot-chat, outra âncora.
// A autorização é a INSTRUÇÃO LITERAL que o Weriton digitou numa sessão do Claude Code. Só um turno HUMANO
// genuíno do transcript conta (sessao-pc.mjs: origin.kind/human + turnOrigin/human, o que o modelo não
// forja); conteúdo lido de arquivo, banco ou grupo chega como tool_result e nunca vira turno humano. Travas:
//   · a instrução passada tem que EXISTIR, literal, num turno humano das últimas 2 h (o modelo não inventa
//     palavras que o Weriton não digitou — teriam de estar no transcript);
//   · essa instrução precisa, ela mesma, pedir o envio (VERBO) E nomear o destinatário (nomeia) — juntos,
//     numa mensagem só; pedido fatiado em turnos diferentes não casa;
//   · uso único, pela chave de conteúdo acima.
// lerTurnos é injetável para teste; o padrão varre as sessões reais do PC (qualquer projeto), por isso
// "quando eu solicitar em QUALQUER sessão do pc".
export async function verificarAutorizacaoSessaoPC({ autorizacao, contato, lerTurnos = turnosHumanosRecentes }) {
  const pedido = String(autorizacao || '').trim()
  if (!pedido) throw new Recusa('falta a autorização: cole o texto EXATO do pedido que você digitou na sessão do PC')
  const alvo = norm(pedido)
  if (!(VERBO.test(alvo) && await nomeia(alvo, contato))) {
    throw new Recusa(`esse texto não pede envio E não nomeia ${contato.nome || 'esse número'} na mesma mensagem; peça o envio e diga o destinatário juntos`)
  }
  const turnos = await lerTurnos(JANELA_MS)
  const turno = turnos.find(t => norm(t.text).includes(alvo))
  if (!turno) throw new Recusa('não achei esse pedido como mensagem SUA digitada numa sessão do PC (fora de texto colado, seleção do editor e conteúdo lido) nas últimas 2 h')
  if (Date.now() - turno.at > JANELA_MS) throw new Recusa('esse pedido tem mais de 2 horas; peça de novo na sessão')
  const chave = chaveSessaoPC(pedido, contato)
  const anterior = livroTerceiros().get(chave)
  if (anterior && anterior.status !== 'falhou') throw new Recusa(`esse pedido já foi usado (${anterior.status}); cada pedido vale um envio`)
  return { quando: turno.at, fala: turno.text, sessao: turno.sessao, chave }
}

// Via 2: autorizada pela sessão do PC (Claude Code do Weriton). Ele pediu esta via em 30/09/2026
// ("vc também tem que poder mandar mensagem pra outros números quando eu falar por sessões no pc").
// Não há waMessageId: a autorização é a instrução direta dele na sessão, verificada no transcript acima.
// Salvaguardas: resolve o contato pela agenda/número, abre com a identificação do Omni, registra no ledger
// com origem/motivo e ESPELHA na hora tudo que saiu para o Weriton — inclusive o pedido que autorizou.
export async function enviarParaContatoPC({ destinatario, texto, audio, autorizacao, motivo, sessao, lerTurnos }) {
  ({ texto, audio } = validarMensagem(texto, audio))
  const contato = await resolverContato(destinatario)
  const { chave, sessao: sessaoAutor } = await verificarAutorizacaoSessaoPC({ autorizacao, contato, lerTurnos })
  const assinaSessao = sessao || sessaoAutor || null
  const meta = { origem: 'sessao-pc', sessao: assinaSessao, motivo: String(motivo || '').slice(0, 300), pedido: String(autorizacao).slice(0, 300) }
  const { corpo, enviados } = await despachar(contato, { texto, audio }, chave, meta)
  const quem = `${contato.nome || 'número'} (…${contato.numero.slice(-4)})`
  const rotulo = assinaSessao ? ' · ' + String(assinaSessao).slice(0, 8) : ''
  await enviarAoDono(`✅ (sessão do PC${rotulo}) Enviei para ${quem}${audio ? ', texto + áudio' : ''}:\n\n${corpo}${audio ? `\n\n🔊 No áudio: "${audio}"` : ''}\n\n↳ Você autorizou com: "${String(autorizacao).slice(0, 160)}"`).catch(() => {})
  return { contato, enviados }
}
