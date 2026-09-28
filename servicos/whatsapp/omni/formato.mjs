// Omni — critérios de formato das respostas no WhatsApp: escrito ou áudio.
// Prioridade (o de cima vence):
//   1. pedido explícito   "em áudio", "falando", "por voz" → áudio · "por escrito", "em texto" → escrito
//   2. espelho            ele mandou áudio → volta áudio (provavelmente está com a mão ocupada)
//   3. padrão             escrito
// Numa resposta em áudio, o que é para copiar ou consultar (código, comando, link, caminho, número,
// lista longa, detalhe que não coube na fala) vai escrito logo depois do áudio.
// Avisos e erros da ponte são sempre escritos (tratados em ponte.mjs).

export const PEDE_AUDIO = /\b(em|por|num|no) (á|a)udio\b|\bpor voz\b|\bresponde(r)? falando\b|\b(manda|mande|envia|envie|grava|grave|responde|responda|fala|fale|explica|explique)\b[^.?!\n]{0,30}\b((á|a)udio|voz)\b/i
export const PEDE_TEXTO = /\b(por escrito|em texto|responde escrito|responda escrito|manda escrito|mande escrito|me escreve|escreve pra mim|sem (á|a)udio)\b/i

export function escolherFormato(texto, veioDeAudio) {
  if (PEDE_TEXTO.test(texto)) return { formato: 'texto', motivo: 'pedido' }
  if (PEDE_AUDIO.test(texto)) return { formato: 'audio', motivo: 'pedido' }
  if (veioDeAudio) return { formato: 'audio', motivo: 'espelho' }
  return { formato: 'texto', motivo: 'padrão' }
}

export function instrucaoAudio(motivo) {
  return (motivo === 'espelho' ? 'Ele mandou áudio, então a resposta volta em ÁUDIO.' : 'Ele pediu a resposta em ÁUDIO.')
    + ' A ponte converte o seu texto em mensagem de voz — não diga que não tem voz.'
    + ' Escreva como quem fala, não como quem escreve: frases curtas, jeito de conversa ("tá", "pra", "né"), sem listas, sem "primeiro/segundo", sem emoji, markdown ou links.'
    + ' Fale no máximo uns 1000 caracteres (cerca de 1 minuto); se tiver mais, resuma na fala.'
    + ' Tudo que for para copiar ou consultar — código, comando, link, caminho de arquivo, número (IP, id, valor), lista com vários itens ou o detalhe que não coube na fala — coloque depois de uma linha só com [TEXTO]; essa parte vai escrita logo depois do áudio.'
}

// Texto para ser falado: sem markdown, links nem emoji.
export const paraFala = t => String(t)
  .replace(/https?:\/\/\S+/g, '')
  .replace(/\p{Extended_Pictographic}|️/gu, '')
  .replace(/[*_`#>|~]/g, '')
  .replace(/[ \t]+/g, ' ')
  .trim()

const CODIGO = /```[\s\S]*?```/g
const LINK = /https?:\/\/\S+/g
// Divide a resposta de áudio em fala e parte escrita. Rede de segurança: código e links que
// escaparam para a fala vão para a parte escrita, em vez de sumirem no áudio.
export function separarResposta(resposta) {
  const texto = String(resposta || '')
  const i = texto.search(/\[TEXTO\]/i)
  let fala = i > -1 ? texto.slice(0, i) : texto
  let escrito = i > -1 ? texto.slice(i).replace(/^\[TEXTO\]/i, '').trim() : ''
  const extras = [...(fala.match(CODIGO) || []), ...(fala.replace(CODIGO, '').match(LINK) || [])]
  fala = fala.replace(CODIGO, '')
  if (extras.length) escrito = [escrito, ...extras].filter(Boolean).join('\n')
  return { fala: paraFala(fala), escrito }
}
