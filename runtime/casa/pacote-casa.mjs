// Pacote da casa (§4.2, §5): retrato por tabela, exportação por VACUUM INTO e importação conferida.
// O pacote é uma pasta com nucleo.db, omni.db e manifesto.json. O cofre não entra: o blob DPAPI só
// abre na máquina que o cifrou, e o cofre já tem o próprio pacote cifrado (cofre.mjs exportar).
import { createHash } from 'node:crypto'

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
