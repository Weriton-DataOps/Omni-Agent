// Pacote da casa (§4.2, §5): retrato por tabela, exportação por VACUUM INTO e importação conferida.
// O pacote é uma pasta com nucleo.db, omni.db e manifesto.json. O cofre não entra: o blob DPAPI só
// abre na máquina que o cifrou, e o cofre já tem o próprio pacote cifrado (cofre.mjs exportar).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { BANCOS } from './esquemas.mjs'
import { ESPERA_OCUPADO_MS, agoraIso, carregarSqlite, comBancoDaCasa, maquinaAtual, sha256 } from './banco.mjs'

export const FORMATO_PACOTE = 'omni-casa-pacote'
export const BANCOS_DO_PACOTE = Object.freeze(['nucleo', 'omni'])
export const MANIFESTO = 'manifesto.json'

export class PacoteCasaError extends Error {
  constructor(codigo, mensagem, detalhes = {}) {
    super(mensagem)
    this.name = 'PacoteCasaError'
    this.code = codigo
    Object.assign(this, detalhes)
  }
}

const ident = (nome) => `"${String(nome).replaceAll('"', '""')}"`

// sha256 do cabeçalho de colunas e de uma linha por registro, na ordem da chave primária (ou de
// todas as colunas). O quote() escapa aspas e escreve blob em hexadecimal: sem ambiguidade.
export function retratoDaTabela(db, tabela) {
  const colunas = db.prepare(`PRAGMA table_info(${ident(tabela)})`).all()
  const chave = colunas.filter((coluna) => coluna.pk > 0).sort((a, b) => a.pk - b.pk)
  const ordem = (chave.length > 0 ? chave : colunas).map((coluna) => ident(coluna.name)).join(', ')
  const linha = colunas.map((coluna) => `quote(${ident(coluna.name)})`).join(` || ',' || `)
  const hash = createHash('sha256').update(`${colunas.map((coluna) => coluna.name).join(',')}\n`)
  const linhas = db.prepare(`SELECT ${linha} AS l FROM ${ident(tabela)} ORDER BY ${ordem}`).all()
  for (const { l } of linhas) hash.update(`${l}\n`)
  return { linhas: linhas.length, sha256: hash.digest('hex') }
}

// O retrato inteiro sai de uma leitura só, para o hook que escreve ao lado não partir a foto.
export function retratoDoBanco(db) {
  db.exec('BEGIN')
  try {
    const nomes = db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`)
      .all().map((linha) => linha.name)
    const tabelas = Object.fromEntries(nomes.map((nome) => [nome, retratoDaTabela(db, nome)]))
    const migracao = nomes.includes('_migracoes') ? db.prepare('SELECT MAX(versao) AS v FROM _migracoes').get().v ?? 0 : 0
    return { migracao, tabelas }
  } finally {
    db.exec('COMMIT')
  }
}

export function compararRetratos(esperado, real) {
  const nomes = [...new Set([...Object.keys(esperado.tabelas), ...Object.keys(real.tabelas)])].sort()
  return nomes.flatMap((tabela) => {
    const e = esperado.tabelas[tabela] ?? null
    const r = real.tabelas[tabela] ?? null
    return e && r && e.linhas === r.linhas && e.sha256 === r.sha256 ? [] : [{ tabela, esperado: e, real: r }]
  })
}

// Arquivo de pacote ou cópia recém-chegada: sem migração, só leitura.
function retratoDoArquivo(arquivo, env) {
  const { DatabaseSync } = carregarSqlite(env)
  const db = new DatabaseSync(arquivo)
  try {
    db.exec(`PRAGMA busy_timeout = ${ESPERA_OCUPADO_MS}`)
    return retratoDoBanco(db)
  } finally {
    db.close()
  }
}

export function resumirRetrato(retrato) {
  const tabelas = Object.values(retrato.tabelas)
  return { migracao: retrato.migracao, tabelas: tabelas.length, linhas: tabelas.reduce((soma, t) => soma + t.linhas, 0) }
}

// VACUUM INTO tira uma cópia consistente com a casa viva aberta (os hooks seguem escrevendo).
// A cópia já sai em rollback journal (cabeçalho 1/1), um arquivo só: o teste confere.
export function exportarCasa(casa, saida, { env = process.env, omni = null, agora = agoraIso(), maquina = maquinaAtual() } = {}) {
  const destino = resolve(saida)
  const pastaNova = !existsSync(destino)
  if (!pastaNova && readdirSync(destino).length > 0) {
    throw new PacoteCasaError('saida-existe', 'A pasta de saída já tem arquivos; o pacote não sobrescreve.')
  }
  mkdirSync(destino, { recursive: true })
  const gravados = []
  try {
    const bancos = {}
    for (const nome of BANCOS_DO_PACOTE) {
      const arquivo = join(destino, BANCOS[nome].arquivo)
      gravados.push(arquivo)
      comBancoDaCasa(casa, nome, (db) => { db.prepare('VACUUM INTO ?').run(arquivo) }, env)
      bancos[nome] = { arquivo: BANCOS[nome].arquivo, ...retratoDoArquivo(arquivo, env), sha256: sha256(readFileSync(arquivo)) }
    }
    const manifesto = { formato: FORMATO_PACOTE, versao: 1, criado_em: agora, maquina, omni, bancos }
    const caminhoManifesto = join(destino, MANIFESTO)
    gravados.push(caminhoManifesto)
    writeFileSync(caminhoManifesto, `${JSON.stringify(manifesto, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { saida: destino, bancos: Object.fromEntries(BANCOS_DO_PACOTE.map((nome) => [nome, resumirRetrato(bancos[nome])])) }
  } catch (erro) {
    for (const arquivo of gravados) rmSync(arquivo, { force: true })
    if (pastaNova) rmSync(destino, { recursive: true, force: true })
    throw erro
  }
}