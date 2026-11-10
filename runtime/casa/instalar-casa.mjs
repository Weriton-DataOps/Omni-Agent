// Instalação da casa e dos agentes (§4 passos 3 e 6, §4.2, §8.3). O instalarCasa cria os três bancos
// (as migrações vêm do comBancoDaCasa) e registra o Omni pelo próprio executor/agente.json.
// O instalarAgente confere os requisitos, gera os tokens tela e visita no cofre, entrega só os sha256
// ao instalar --stdin do agente e só registra no núcleo depois que ele aceita: agente que recusa não
// entra na lista do supervisor.
import { spawnSync } from 'node:child_process'

import { comBancoDaCasa } from './banco.mjs'
import { garantirTokensDoAgente } from './credenciais-agente.mjs'
import { BANCOS } from './esquemas.mjs'
import { lerManifesto, listarInstalados, registrarAgente, validarManifesto } from './loja-nucleo.mjs'
import { partirComando } from './supervisor.mjs'

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

// ">=x.y[.z]" contra uma versão semver; o sufixo de pré-release não conta.
function atende(versao, minimo) {
  const a = String(versao).split('-')[0].split('.').map(Number)
  const b = minimo.replace(/^>=/, '').split('.').map(Number)
  for (let i = 0; i < b.length; i++) {
    const x = a[i] ?? 0
    if (x !== b[i]) return x > b[i]
  }
  return true
}

export function requisitosFaltando(requer = {}, { node, omni, instalados }) {
  const faltas = []
  if (requer.node && !atende(node, requer.node)) faltas.push(`node${requer.node}`)
  for (const pedido of requer.agentes ?? []) {
    const [, agente, minimo] = /^([a-z][a-z0-9-]*)(>=.+)$/.exec(pedido)
    const versao = agente === 'omni' ? omni : instalados.find((i) => i.agente === agente)?.versao
    if (!versao || !atende(versao, minimo)) faltas.push(pedido)
  }
  return faltas
}

const LIMITE_LOG = 300

export function instalarAgente(casa, raiz, {
  env = process.env, ponte, versaoOmni, versaoNode = process.versions.node, executar = spawnSync, log = () => {}, maquina, agora
} = {}) {
  const bytes = lerManifesto(raiz)
  const { manifesto } = validarManifesto(bytes)
  const { agente } = manifesto
  if (agente === 'omni') throw new InstalarError('agente-omni', 'O Omni se instala pelo instalar, não pelo instalar-agente.')
  const opcoes = daMaquina({ maquina, agora })
  const instalados = comBancoDaCasa(casa, 'nucleo', (db) => listarInstalados(db, opcoes), env)
  const faltas = requisitosFaltando(manifesto.requer, { node: versaoNode, omni: versaoOmni, instalados })
  if (faltas.length > 0) throw new InstalarError('requisito', `Requisito não atendido: ${faltas.join(', ')}.`)
  const modos = manifesto.executor?.modos ?? []
  // Só quem serve HTTP precisa de token; o agente recebe o sha256, nunca o valor (§8.3).
  const tokens = modos.includes('servir')
    ? comBancoDaCasa(casa, 'cofre', (db) => garantirTokensDoAgente(db, ponte(), agente, opcoes), env)
    : null
  if (modos.includes('instalar')) {
    const { programa, argumentos } = partirComando(manifesto.executor.comando)
    const r = executar(programa, [...argumentos, 'instalar', ...(tokens ? ['--stdin'] : [])], {
      cwd: raiz, env, encoding: 'utf8', timeout: 120_000, windowsHide: true,
      input: tokens ? JSON.stringify({ tela: tokens.tela, visita: tokens.visita }) : ''
    })
    if (r.error || r.status !== 0) {
      log(`instalar do ${agente}: ${String(r.stderr ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_LOG)}`)
      throw new InstalarError('agente-recusou', `O instalar do ${agente} saiu com ${r.error ? (r.error.code ?? 'erro') : r.status}.`)
    }
  }
  // Registro só depois do aceite: agente que recusou não entra na lista do supervisor.
  const registro = comBancoDaCasa(casa, 'nucleo', (db) => registrarAgente(db, bytes, { raiz, ...opcoes }), env)
  return { agente, versao: manifesto.versao, tokens: tokens ? { novos: tokens.novos } : null, mudou: registro.mudou }
}
