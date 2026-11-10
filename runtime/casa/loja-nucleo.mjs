// Loja do núcleo (§4.2): o catálogo de agentes, as instalações e as máquinas no nucleo.db.
// O manifesto de cada agente é o executor/agente.json do repo dele; aqui ele é validado (campo a mais
// é tolerado, campo errado é recusado com a lista dos problemas, sem ecoar o valor) e registrado.
// O catálogo é de todas as máquinas (o último registrado vence); a instalação é por máquina e cada
// máquina grava só as próprias linhas. Registrar o mesmo manifesto na mesma raiz não sobe versão.
import { readFileSync, statSync } from 'node:fs'
import { hostname, platform } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { agoraIso, maquinaAtual, sha256, transacao } from './banco.mjs'

export const MODOS = Object.freeze(['instalar', 'importar', 'exportar', 'atualizar', 'verificar', 'servir'])
export const LIMITE_MANIFESTO = 256 * 1024
export const ARQUIVO_MANIFESTO = join('executor', 'agente.json')

const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
const RESERVADOS = new Set(['dono', 'nucleo', 'cofre', 'casa'])
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
const VERSAO_MINIMA = '\\d+(\\.\\d+){0,2}'
const NODE = new RegExp(`^>=${VERSAO_MINIMA}$`)
const REQUER_AGENTE = new RegExp(`^([a-z][a-z0-9-]{0,39})>=${VERSAO_MINIMA}$`)
const VARIAVEL = /^[A-Z][A-Z0-9_]*$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const INTERVALO = /^PT[1-9]\d*[MH]$/
const NOME_CREDENCIAL = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/
const METODOS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const ESCOPOS = new Set(['qualquer', 'tela', 'visita'])
const API = 'http://127.0.0.1:{porta}/v1'
const LIMITE_TEXTO = 500
const LIMITE_PAINEL = 40

export class NucleoError extends Error {
  constructor(codigo, mensagem, erros = []) {
    super(mensagem)
    this.name = 'NucleoError'
    this.code = codigo
    this.erros = erros
  }
}

const objeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)
const texto = (valor, max = LIMITE_TEXTO) => typeof valor === 'string' && valor.length > 0 && valor.length <= max
const unicos = (lista) => new Set(lista).size === lista.length

// Caminho dentro do repo do agente: relativo, com barra normal, sem subir e sem unidade.
function relativo(valor) {
  return texto(valor, 260) && !valor.includes('\\') && !valor.startsWith('/') && !/^[A-Za-z]:/.test(valor) &&
    !valor.split('/').includes('..')
}

function compila(padrao) {
  try {
    new RegExp(padrao)
    return true
  } catch {
    return false
  }
}

function listaDe(valor, formato) {
  return Array.isArray(valor) && valor.every((item) => typeof item === 'string' && formato.test(item)) && unicos(valor)
}

function conferirInterface(i, erros) {
  if (!objeto(i)) { erros.push('interface: precisa ser um objeto'); return }
  if (!relativo(i.modulo) || !i.modulo.endsWith('.html')) erros.push('interface.modulo: caminho relativo de um .html')
  if (i.preload !== undefined && (!relativo(i.preload) || !i.preload.endsWith('.js'))) erros.push('interface.preload: caminho relativo de um .js')
  if (i.painel !== undefined && !texto(i.painel, LIMITE_PAINEL)) erros.push(`interface.painel: texto de 1 a ${LIMITE_PAINEL} caracteres`)
  if (i.api !== undefined && i.api !== API) erros.push(`interface.api: precisa ser ${API}`)
  if (i.rotas === undefined) return
  if (!Array.isArray(i.rotas)) { erros.push('interface.rotas: precisa ser uma lista'); return }
  if (i.api === undefined) erros.push('interface.api: obrigatoria quando ha rotas')
  i.rotas.forEach((rota, n) => {
    const onde = `interface.rotas[${n}]`
    if (!objeto(rota)) { erros.push(`${onde}: precisa ser um objeto`); return }
    if (!METODOS.has(rota.metodo)) erros.push(`${onde}.metodo: GET, POST, PATCH, PUT ou DELETE`)
    const padrao = rota.padrao
    if (!texto(padrao) || !padrao.startsWith('^/v1/') || !padrao.endsWith('$') || !compila(padrao)) {
      erros.push(`${onde}.padrao: expressao que compila, de ^/v1/ ate $`)
    }
    if (!ESCOPOS.has(rota.escopo)) erros.push(`${onde}.escopo: qualquer, tela ou visita`)
  })
}

function conferirTarefa(tarefa, n, ids, erros) {
  const onde = `tarefas[${n}]`
  if (!objeto(tarefa)) { erros.push(`${onde}: precisa ser um objeto`); return }
  if (typeof tarefa.id !== 'string' || !AGENTE.test(tarefa.id)) erros.push(`${onde}.id: minusculas, digitos e hifen, comecando por letra`)
  else if (ids.has(tarefa.id)) erros.push(`${onde}.id: repetido`)
  else ids.add(tarefa.id)
  const quando = tarefa.quando
  const diaria = objeto(quando) && quando.diaria !== undefined
  const acada = objeto(quando) && quando.acada !== undefined
  if (diaria === acada || (diaria && !HORA.test(String(quando.diaria))) || (acada && !INTERVALO.test(String(quando.acada)))) {
    erros.push(`${onde}.quando: exatamente um entre diaria (HH:MM) e acada (PT<n>M ou PT<n>H)`)
  }
  if (typeof tarefa.seAtrasada !== 'boolean') erros.push(`${onde}.seAtrasada: precisa ser booleano`)
  const temComando = tarefa.comando !== undefined
  const temLancador = tarefa.lancador !== undefined
  if (temComando === temLancador) { erros.push(`${onde}: exatamente um entre comando e lancador`); return }
  if (temComando) {
    if (!texto(tarefa.comando)) erros.push(`${onde}.comando: texto nao vazio`)
    return
  }
  if (tarefa.lancador !== 'omni') erros.push(`${onde}.lancador: so o omni lanca roteiro`)
  if (!relativo(tarefa.roteiro)) erros.push(`${onde}.roteiro: caminho relativo`)
  if (tarefa.variaveis !== undefined && !listaDe(tarefa.variaveis, VARIAVEL)) erros.push(`${onde}.variaveis: nomes em MAIUSCULAS, sem repetir`)
}

function conferir(m) {
  const erros = []
  const agenteValido = typeof m.agente === 'string' && AGENTE.test(m.agente) && !RESERVADOS.has(m.agente)
  if (!agenteValido) erros.push('agente: minusculas, digitos e hifen, comecando por letra, ate 40, fora dos nomes reservados')
  if (typeof m.versao !== 'string' || !SEMVER.test(m.versao)) erros.push('versao: precisa ser semver')
  if (m.banco === undefined) erros.push('banco: obrigatorio (null quando o agente nao tem banco)')
  else if (m.banco !== null && agenteValido && m.banco !== `${m.agente}.db`) erros.push('banco: precisa ser <agente>.db')
  if (m.banco === null && m.migracoes !== undefined) erros.push('migracoes: so existe quando ha banco')
  if (typeof m.banco === 'string' && !relativo(m.migracoes)) erros.push('migracoes: caminho relativo, obrigatorio quando ha banco')

  if (!objeto(m.requer)) erros.push('requer: precisa ser um objeto')
  else {
    if (m.requer.node !== undefined && (typeof m.requer.node !== 'string' || !NODE.test(m.requer.node))) erros.push('requer.node: no formato >=N[.N[.N]]')
    const agentes = m.requer.agentes
    if (agentes !== undefined && (!listaDe(agentes, REQUER_AGENTE) || !unicos(agentes.map((a) => REQUER_AGENTE.exec(a)[1])))) {
      erros.push('requer.agentes: lista de <agente>>=N[.N[.N]], um por agente')
    }
  }

  if (m.executor !== undefined) {
    if (!objeto(m.executor)) erros.push('executor: precisa ser um objeto')
    else {
      if (!texto(m.executor.comando)) erros.push('executor.comando: texto nao vazio')
      const modos = m.executor.modos
      if (!Array.isArray(modos) || modos.length === 0 || !modos.every((modo) => MODOS.includes(modo)) || !unicos(modos)) {
        erros.push(`executor.modos: lista sem repetir dentre ${MODOS.join(', ')}`)
      }
    }
  }
  if (m.interface !== undefined) conferirInterface(m.interface, erros)

  if (!Array.isArray(m.tarefas)) erros.push('tarefas: precisa ser uma lista')
  else {
    const ids = new Set()
    m.tarefas.forEach((tarefa, n) => conferirTarefa(tarefa, n, ids, erros))
  }
  if (!listaDe(m.credenciais, NOME_CREDENCIAL)) erros.push('credenciais: lista de nomes do cofre, sem repetir')
  return erros
}

// Recebe os bytes do agente.json (ou o texto). O sha é dos bytes crus; o texto gravado é o objeto lido.
export function validarManifesto(conteudo) {
  const crus = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8')
  let manifesto
  try {
    manifesto = JSON.parse(crus.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    manifesto = undefined
  }
  const erros = objeto(manifesto) ? conferir(manifesto) : ['manifesto: precisa ser um objeto JSON']
  if (erros.length > 0) throw new NucleoError('manifesto-invalido', `Manifesto recusado: ${erros.length} problema(s).`, erros)
  return { manifesto, sha256: sha256(crus), texto: JSON.stringify(manifesto) }
}

export function lerManifesto(raiz) {
  if (typeof raiz !== 'string' || !isAbsolute(raiz)) throw new NucleoError('dados-invalidos', 'A raiz do agente precisa ser um caminho absoluto.')
  const arquivo = join(raiz, ARQUIVO_MANIFESTO)
  let tamanho
  try {
    tamanho = statSync(arquivo).size
  } catch {
    throw new NucleoError('sem-manifesto', `Não há ${ARQUIVO_MANIFESTO} na raiz informada.`)
  }
  if (tamanho > LIMITE_MANIFESTO) throw new NucleoError('manifesto-grande', `O manifesto passa de ${LIMITE_MANIFESTO} bytes.`)
  return readFileSync(arquivo)
}

function conferirMaquina(maquina) {
  if (typeof maquina !== 'string' || maquina.length === 0 || maquina.length > 253 || maquina !== maquina.toLowerCase() || maquina.includes('/')) {
    throw new NucleoError('dados-invalidos', 'Nome de máquina inválido.')
  }
}

// Sem transação própria: roda dentro da de quem chama.
function tocarMaquina(db, { maquina, nome, sistema, agora }) {
  const atual = db.prepare('SELECT nome, sistema, apagado_em FROM maquinas WHERE id = ?').get(maquina)
  if (!atual) {
    db.prepare(`INSERT INTO maquinas (id, nome, sistema, visto_em, origem_maquina, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(maquina, nome, sistema, agora, maquina, agora, agora)
    return true
  }
  if (atual.nome !== nome || atual.sistema !== sistema || atual.apagado_em !== null) {
    db.prepare(`UPDATE maquinas SET nome = ?, sistema = ?, visto_em = ?, origem_maquina = ?, atualizado_em = ?, apagado_em = NULL,
      versao = versao + 1 WHERE id = ?`).run(nome, sistema, agora, maquina, agora, maquina)
    return true
  }
  db.prepare('UPDATE maquinas SET visto_em = ? WHERE id = ?').run(agora, maquina)
  return false
}

const daMaquina = ({ maquina = maquinaAtual(), nome = hostname(), sistema = platform(), agora = agoraIso() } = {}) =>
  ({ maquina, nome, sistema, agora })

export function registrarMaquina(db, opcoes = {}) {
  const m = daMaquina(opcoes)
  conferirMaquina(m.maquina)
  return { maquina: m.maquina, mudou: transacao(db, () => tocarMaquina(db, m)) }
}

export function registrarAgente(db, conteudo, opcoes = {}) {
  const m = daMaquina(opcoes)
  conferirMaquina(m.maquina)
  if (typeof opcoes.raiz !== 'string' || !isAbsolute(opcoes.raiz)) throw new NucleoError('dados-invalidos', 'A raiz do agente precisa ser um caminho absoluto.')
  const raiz = resolve(opcoes.raiz)
  const { manifesto, sha256: sha, texto: json } = validarManifesto(conteudo)
  const { agente, versao } = manifesto
  const { maquina, agora } = m
  const mudou = transacao(db, () => {
    tocarMaquina(db, m)
    let catalogo = false
    const noCatalogo = db.prepare('SELECT manifesto_sha256, apagado_em FROM agentes WHERE id = ?').get(agente)
    if (!noCatalogo) {
      db.prepare(`INSERT INTO agentes (id, versao_agente, banco, manifesto, manifesto_sha256, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(agente, versao, manifesto.banco, json, sha, maquina, agora, agora)
      catalogo = true
    } else if (noCatalogo.manifesto_sha256 !== sha || noCatalogo.apagado_em !== null) {
      db.prepare(`UPDATE agentes SET versao_agente = ?, banco = ?, manifesto = ?, manifesto_sha256 = ?, origem_maquina = ?, atualizado_em = ?,
        apagado_em = NULL, versao = versao + 1 WHERE id = ?`).run(versao, manifesto.banco, json, sha, maquina, agora, agente)
      catalogo = true
    }
    let instalacao = false
    const id = `${maquina}/${agente}`
    // O sha dos bytes já muda com a versão: comparar a versão à parte seria redundante.
    const instalada = db.prepare('SELECT raiz, manifesto_sha256, apagado_em FROM instalacoes WHERE id = ?').get(id)
    if (!instalada) {
      db.prepare(`INSERT INTO instalacoes (id, maquina, agente, raiz, versao_agente, manifesto_sha256, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, maquina, agente, raiz, versao, sha, maquina, agora, agora)
      instalacao = true
    } else if (instalada.raiz !== raiz || instalada.manifesto_sha256 !== sha || instalada.apagado_em !== null) {
      db.prepare(`UPDATE instalacoes SET raiz = ?, versao_agente = ?, manifesto_sha256 = ?, origem_maquina = ?, atualizado_em = ?,
        apagado_em = NULL, versao = versao + 1 WHERE id = ?`).run(raiz, versao, sha, maquina, agora, id)
      instalacao = true
    }
    return { agente: catalogo, instalacao }
  })
  return { agente, versao, maquina, mudou }
}

export function retirarAgente(db, agente, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  if (typeof agente !== 'string' || !AGENTE.test(agente)) throw new NucleoError('dados-invalidos', 'Nome de agente inválido.')
  conferirMaquina(maquina)
  const id = `${maquina}/${agente}`
  transacao(db, () => {
    const r = db.prepare(`UPDATE instalacoes SET apagado_em = ?, origem_maquina = ?, atualizado_em = ?, versao = versao + 1
      WHERE id = ? AND apagado_em IS NULL`).run(agora, maquina, agora, id)
    if (r.changes !== 1) throw new NucleoError('inexistente', 'O agente não está instalado nesta máquina.')
  })
  return { agente, maquina, retirado: true }
}

export function listarInstalados(db, { maquina = maquinaAtual() } = {}) {
  return db.prepare(`SELECT i.agente, i.raiz, i.versao_agente, i.manifesto_sha256, i.atualizado_em,
      a.banco, a.versao_agente AS versao_catalogo, a.manifesto_sha256 AS sha_catalogo
    FROM instalacoes i LEFT JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
    WHERE i.maquina = ? AND i.apagado_em IS NULL ORDER BY i.agente`).all(maquina).map((l) => ({
    agente: l.agente,
    raiz: l.raiz,
    versao: l.versao_agente,
    banco: l.banco ?? null,
    versaoNoCatalogo: l.versao_catalogo ?? null,
    catalogoDiverge: l.sha_catalogo !== l.manifesto_sha256,
    atualizado_em: l.atualizado_em
  }))
}

export function listarMaquinas(db) {
  return db.prepare(`SELECT m.id, m.nome, m.sistema, m.visto_em,
      (SELECT count(*) FROM instalacoes i WHERE i.maquina = m.id AND i.apagado_em IS NULL) AS agentes
    FROM maquinas m WHERE m.apagado_em IS NULL ORDER BY m.id`).all().map((l) => ({ ...l }))
}

// Quem o supervisor do Omni sobe nesta máquina: instalado aqui, com o modo servir no manifesto do
// catálogo. Instalação com manifesto diferente do catálogo sai marcada (divergente) e não sobe:
// o comando que o catálogo diz pode não ser o que está no disco. O Omni não supervisiona a si mesmo.
export function listarServidores(db, { maquina = maquinaAtual() } = {}) {
  return db.prepare(`SELECT i.agente, i.raiz, i.manifesto_sha256, a.manifesto, a.manifesto_sha256 AS sha_catalogo
    FROM instalacoes i JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
    WHERE i.maquina = ? AND i.apagado_em IS NULL AND i.agente <> 'omni' ORDER BY i.agente`).all(maquina).flatMap((l) => {
    const manifesto = JSON.parse(l.manifesto)
    const executor = manifesto.executor
    if (!executor?.modos?.includes('servir')) return []
    // rotas: o que a ilha e o carteiro podem pedir a esse agente pelo chamar (método, padrão, escopo).
    return [{ agente: l.agente, raiz: l.raiz, comando: executor.comando, divergente: l.sha_catalogo !== l.manifesto_sha256, rotas: manifesto.interface?.rotas ?? [] }]
  })
}

// O que o agendador do Windows registra nesta máquina (plano 5c): as tarefas do manifesto do catálogo de
// cada instalado aqui, com a raiz da instalação. Agente, raiz e divergência vêm da linha, nunca da tarefa.
// Divergente sai marcado: quem registra pula e quem roda recusa.
export function listarTarefas(db, { maquina = maquinaAtual() } = {}) {
  return db.prepare(`SELECT i.agente, i.raiz, i.manifesto_sha256, a.manifesto, a.manifesto_sha256 AS sha_catalogo
    FROM instalacoes i JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
    WHERE i.maquina = ? AND i.apagado_em IS NULL ORDER BY i.agente`).all(maquina).flatMap((l) => {
    const tarefas = JSON.parse(l.manifesto).tarefas
    return (Array.isArray(tarefas) ? tarefas : []).map((t) => ({ ...t, agente: l.agente, raiz: l.raiz, divergente: l.sha_catalogo !== l.manifesto_sha256 }))
  })
}

// Quem a ilha monta como painel (plano 4b): instalado aqui, com interface no manifesto do catálogo. Os
// caminhos saem relativos como o manifesto diz; quem resolve e confere que ficam dentro da raiz é a ilha.
// Divergente sai marcado: a tela no disco pode não ser a que o catálogo descreve.
export function listarInterfaces(db, { maquina = maquinaAtual() } = {}) {
  return db.prepare(`SELECT i.agente, i.raiz, i.versao_agente, i.manifesto_sha256, a.manifesto, a.manifesto_sha256 AS sha_catalogo
    FROM instalacoes i JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
    WHERE i.maquina = ? AND i.apagado_em IS NULL AND i.agente <> 'omni' ORDER BY i.agente`).all(maquina).flatMap((l) => {
    const tela = JSON.parse(l.manifesto).interface
    if (!tela) return []
    return [{
      agente: l.agente,
      versao: l.versao_agente,
      raiz: l.raiz,
      modulo: tela.modulo,
      preload: tela.preload ?? null,
      painel: tela.painel ?? null,
      divergente: l.sha_catalogo !== l.manifesto_sha256
    }]
  })
}