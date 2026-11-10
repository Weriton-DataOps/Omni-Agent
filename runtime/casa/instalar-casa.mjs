// Instalação da casa e dos agentes (§4 passos 3 e 6, §4.2, §8.3). O instalarCasa cria os três bancos
// (as migrações vêm do comBancoDaCasa) e registra o Omni pelo próprio executor/agente.json.
// O instalarAgente confere os requisitos, gera os tokens tela e visita no cofre, entrega só os sha256
// ao instalar --stdin do agente e só registra no núcleo depois que ele aceita: agente que recusa não
// entra na lista do supervisor.
import { comBancoDaCasa } from './banco.mjs'
import { BANCOS } from './esquemas.mjs'
import { lerManifesto, registrarAgente, validarManifesto } from './loja-nucleo.mjs'

export class InstalarError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'InstalarError'
    this.code = codigo
  }
}

const ultimaMigracao = (db) => db.prepare('SELECT max(versao) AS v FROM _migracoes').get().v
const daMaquina = ({ maquina, agora }) => ({ ...(maquina ? { maquina } : {}), ...(agora ? { agora } : {}) })

export function instalarCasa(casa, raizOmni, { env = process.env, maquina, agora } = {}) {
  const bancos = {}
  for (const nome of Object.keys(BANCOS)) bancos[nome] = { migracao: comBancoDaCasa(casa, nome, ultimaMigracao, env) }
  const bytes = lerManifesto(raizOmni)
  if (validarManifesto(bytes).manifesto.agente !== 'omni') throw new InstalarError('manifesto-alheio', 'O manifesto da raiz do Omni não é do agente omni.')
  const r = comBancoDaCasa(casa, 'nucleo', (db) => registrarAgente(db, bytes, { raiz: raizOmni, ...daMaquina({ maquina, agora }) }), env)
  return { bancos, omni: { versao: r.versao, mudou: r.mudou } }
}
