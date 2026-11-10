// Como a ponte acorda a visita do Actions (F2, plano 5c): pela tarefa actions-visita do Oráculo, rodada
// pelo tarefa-agente.mjs da mesma versão instalada — a trava, o teto e o registro moram lá. Módulo à parte
// porque a ponte tem efeito colateral no import e o teste precisa só do comando.
import { fileURLToPath } from 'node:url'

const TAREFA_AGENTE = fileURLToPath(new URL('../../../runtime/tarefa-agente.mjs', import.meta.url))

export function comandoDaVisita(motivo) {
  return [process.execPath, [TAREFA_AGENTE, 'rodar', 'oraculo', 'actions-visita', '--motivo', String(motivo)]]
}
