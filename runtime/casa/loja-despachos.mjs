// Campainha dos agentes (contrato de 05/11): o agente avisa que há execução nova na fila dele com
// POST /v1/despachos {agente, execucao}. A fila do agente é a verdade; aqui fica só o recibo,
// idempotente pelo id agente/execucao. Quem entrega a execução a uma sessão (o carteiro) é do plano 4.
import { agoraIso, maquinaAtual } from './banco.mjs'

export const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
export const EXECUCAO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
export const ESTADOS = Object.freeze(['recebido', 'assumido', 'recusado', 'falhou'])
export const LIMITE_LISTA = 100

export class DespachoError extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'DespachoError'
    this.code = 'dados-invalidos'
  }
}

const objeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)

export function validarDespacho(corpo) {
  if (!objeto(corpo)) throw new DespachoError('O corpo precisa ser um objeto JSON.')
  const { agente, execucao } = corpo
  if (typeof agente !== 'string' || !AGENTE.test(agente)) {
    throw new DespachoError('agente: minúsculas, dígitos e hífen, começando por letra, até 40.')
  }
  if (typeof execucao !== 'string' || !EXECUCAO.test(execucao)) {
    throw new DespachoError('execucao: até 128 caracteres entre letras, dígitos, ponto, dois-pontos, sublinhado e hífen.')
  }
  return { agente, execucao, id: `${agente}/${execucao}` }
}

export function registrarDespacho(db, corpo, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { agente, execucao, id } = validarDespacho(corpo)
  const r = db.prepare(`INSERT INTO despachos (id, agente, execucao, recebido_em, atualizado_em, origem_maquina)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`).run(id, agente, execucao, agora, agora, maquina)
  return { id, novo: Number(r.changes) === 1 }
}

// O carteiro anota no recibo o que fez (assumido, recusado por outra mão, falhou). Se a execução veio
// da varredura e não da campainha, o recibo nasce aqui. Cada marca soma uma tentativa.
export function marcarDespacho(db, { agente, execucao, estado, detalhe = null }, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { id } = validarDespacho({ agente, execucao })
  if (!ESTADOS.includes(estado)) throw new DespachoError(`estado: ${ESTADOS.join(', ')}.`)
  const nota = detalhe === null || detalhe === undefined ? null : String(detalhe).slice(0, 300)
  db.prepare(`INSERT INTO despachos (id, agente, execucao, estado, tentativas, detalhe, recebido_em, atualizado_em, origem_maquina)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET estado = excluded.estado, detalhe = excluded.detalhe, tentativas = tentativas + 1, atualizado_em = excluded.atualizado_em`)
    .run(id, agente, execucao, estado, nota, agora, agora, maquina)
  return { ...db.prepare('SELECT id, agente, execucao, estado, tentativas, detalhe, recebido_em, atualizado_em FROM despachos WHERE id = ?').get(id) }
}

export function listarDespachos(db, { estado = 'recebido', limite = LIMITE_LISTA } = {}) {
  if (!ESTADOS.includes(estado)) throw new DespachoError(`estado: ${ESTADOS.join(', ')}.`)
  const n = Number.isInteger(limite) ? Math.min(Math.max(limite, 1), LIMITE_LISTA) : LIMITE_LISTA
  return db.prepare(`SELECT id, agente, execucao, estado, tentativas, detalhe, recebido_em, atualizado_em
    FROM despachos WHERE estado = ? ORDER BY recebido_em, id LIMIT ?`).all(estado, n).map((linha) => ({ ...linha }))
}
