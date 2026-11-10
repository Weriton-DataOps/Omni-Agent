// Como alguém de fora da ilha fala com um agente servido pelo Omni (F2): a porta vem do servir.json do
// Omni (pid vivo) e o token visita do cofre.db (cada abertura vira uma linha em usos). Usado pelas mãos do
// Actions e pelo lançador das tarefas dos agentes. As mensagens nunca carregam o token nem o texto do cofre.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { comBancoDaCasa, pastaDoBanco } from './banco.mjs'
import { tokenDoAgente } from './credenciais-agente.mjs'

export class ErroDeAcesso extends Error {}

export const arquivoServir = (casa, env = process.env) => join(pastaDoBanco(casa, env), 'servir.json')

export function portaDoAgente(casa, env, vivo, agente) {
  let servir
  try {
    servir = JSON.parse(readFileSync(arquivoServir(casa, env), 'utf8'))
  } catch {
    throw new ErroDeAcesso('o servir do Omni não está no ar (sem servir.json legível)')
  }
  if (!Number.isInteger(servir?.pid) || !vivo(servir.pid)) throw new ErroDeAcesso('o servir do Omni não está no ar (o pid do servir.json morreu)')
  const porta = Array.isArray(servir.agentes) ? servir.agentes.find((a) => a?.agente === agente)?.porta : undefined
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) throw new ErroDeAcesso(`o ${agente} não está no ar pelo servir do Omni`)
  return porta
}

export function tokenVisita(casa, env, ponte, agente, motivo) {
  try {
    return comBancoDaCasa(casa, 'cofre', (db) => tokenDoAgente(db, ponte(), agente, 'visita', motivo), env)
  } catch (falha) {
    // Só o código da recusa: a mensagem do cofre não sai daqui.
    throw new ErroDeAcesso(`token visita do ${agente} indisponível (${falha?.codigo ?? falha?.name ?? 'erro'})`)
  }
}
