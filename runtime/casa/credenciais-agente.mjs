// Tokens da API de cada agente (§3.4, §8.3). O Omni gera o token tela (o que a ilha usa pelo chamar)
// e o visita (o do carteiro e das mãos do Actions), guarda os dois no cofre.db, autorizados só ao
// agente omni, e entrega ao agente apenas o sha256, que ele grava pelo próprio instalar --stdin.
// O valor só sai do cofre por tokenDoAgente, e cada abertura vira uma linha em usos.
import { createHash, randomBytes } from 'node:crypto'

import { cadastrarCredencial, credencialPorNome, usarCredencial } from './loja-cofre.mjs'

export const PAPEIS = Object.freeze(['tela', 'visita'])
const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
const RESERVADOS = new Set(['omni', 'dono', 'nucleo', 'cofre', 'casa'])

function exigirAgente(agente) {
  if (typeof agente !== 'string' || !AGENTE.test(agente) || RESERVADOS.has(agente)) throw new TypeError('Agente inválido para token de API.')
}
function exigirPapel(papel) {
  if (!PAPEIS.includes(papel)) throw new TypeError('Papel de token desconhecido.')
}

export function nomeDoToken(agente, papel) {
  exigirAgente(agente)
  exigirPapel(papel)
  return `api/${agente}/${papel}`
}

const gerarPadrao = () => randomBytes(32).toString('base64url')
const sha256Texto = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')

export function tokenDoAgente(db, ponte, agente, papel, motivo, opcoes = {}) {
  const nome = nomeDoToken(agente, papel)
  const { valor } = usarCredencial(db, ponte, { nome, agente: 'omni', motivo }, opcoes)
  try { return valor.toString('utf8') } finally { valor.fill(0) }
}

// Garante os dois tokens e devolve só os sha256 (o que o agente precisa para conferir o Bearer).
export function garantirTokensDoAgente(db, ponte, agente, { gerar = gerarPadrao, maquina, agora } = {}) {
  exigirAgente(agente)
  const opcoes = { ...(maquina ? { maquina } : {}), ...(agora ? { agora } : {}) }
  const saida = { novos: [] }
  for (const papel of PAPEIS) {
    const nome = nomeDoToken(agente, papel)
    if (credencialPorNome(db, nome)) {
      saida[papel] = sha256Texto(tokenDoAgente(db, ponte, agente, papel, 'conferir o sha256 do token do agente', opcoes))
      continue
    }
    const valor = gerar()
    cadastrarCredencial(db, ponte, { nome, tipo: 'token', servico: `API do ${agente}`, notas: `Token ${papel} da API do agente ${agente}; o agente guarda só o sha256.`, agentes: ['omni'] }, valor, opcoes)
    saida[papel] = sha256Texto(valor)
    saida.novos.push(papel)
  }
  return { tela: saida.tela, visita: saida.visita, novos: saida.novos }
}
