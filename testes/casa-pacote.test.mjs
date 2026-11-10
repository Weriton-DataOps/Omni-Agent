import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { carregarSqlite } from '../runtime/casa/banco.mjs'
import { compararRetratos, retratoDoBanco, retratoDaTabela } from '../runtime/casa/pacote-casa.mjs'

const { DatabaseSync } = carregarSqlite()
function comPasta(uso) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-pacote-'))
  try { return uso(pasta) } finally { rmSync(pasta, { recursive: true, force: true }) }
}
function banco(sql) { const db = new DatabaseSync(':memory:'); db.exec(sql); return db }

test('retrato não depende da ordem de inserção', () => {
  const a = banco("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT); INSERT INTO t VALUES ('b', 'dois'), ('a', 'um')")
  const b = banco("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT); INSERT INTO t VALUES ('a', 'um'), ('b', 'dois')")
  assert.deepEqual(retratoDaTabela(a, 't'), retratoDaTabela(b, 't'))
  assert.equal(retratoDaTabela(a, 't').linhas, 2)
})

test('retrato muda com um valor só, com a mesma contagem', () => {
  const a = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'x')")
  const b = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'y')")
  assert.equal(retratoDaTabela(a, 't').linhas, retratoDaTabela(b, 't').linhas)
  assert.notEqual(retratoDaTabela(a, 't').sha256, retratoDaTabela(b, 't').sha256)
})

test('retrato separa NULL de texto, blob de texto e vírgula dentro do valor', () => {
  const casos = ['(1, NULL)', "(1, 'NULL')", "(1, X'6869')", "(1, 'hi')", "(1, 'a,b')"]
  const hashes = casos.map((valores) => retratoDaTabela(banco(`CREATE TABLE t (id INTEGER PRIMARY KEY, v); INSERT INTO t VALUES ${valores}`), 't').sha256)
  assert.equal(new Set(hashes).size, casos.length)
})

test('retrato muda quando a coluna muda de nome com os mesmos valores', () => {
  const a = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT); INSERT INTO t VALUES (1, 'x')")
  const b = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, b TEXT); INSERT INTO t VALUES (1, 'x')")
  assert.notEqual(retratoDaTabela(a, 't').sha256, retratoDaTabela(b, 't').sha256)
})

test('tabela sem chave primária ordena por todas as colunas', () => {
  const a = banco("CREATE TABLE t (x, y); INSERT INTO t VALUES (2, 'b'), (1, 'a')")
  const b = banco("CREATE TABLE t (x, y); INSERT INTO t VALUES (1, 'a'), (2, 'b')")
  assert.deepEqual(retratoDaTabela(a, 't'), retratoDaTabela(b, 't'))
})

test('retrato do banco cobre as tabelas do usuário e a última migração', () => {
  const db = banco(`CREATE TABLE _migracoes (versao INTEGER PRIMARY KEY, nome TEXT, sha256 TEXT, aplicada_em TEXT);
    INSERT INTO _migracoes VALUES (1, 'a', 'x', 'y'), (3, 'b', 'x', 'y');
    CREATE TABLE "nome com ""aspas""" (seq INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT); INSERT INTO "nome com ""aspas""" (v) VALUES ('z')`)
  const r = retratoDoBanco(db)
  assert.equal(r.migracao, 3)
  assert.deepEqual(Object.keys(r.tabelas), ['_migracoes', 'nome com "aspas"'])
  assert.equal(r.tabelas['nome com "aspas"'].linhas, 1)
})

test('comparar aponta tabela faltando, sobrando e diferente', () => {
  const esperado = { tabelas: { a: { linhas: 1, sha256: '1' }, b: { linhas: 2, sha256: '2' }, c: { linhas: 0, sha256: '3' } } }
  const real = { tabelas: { a: { linhas: 1, sha256: '1' }, b: { linhas: 2, sha256: 'x' }, d: { linhas: 0, sha256: '4' } } }
  assert.deepEqual(compararRetratos(esperado, real), [
    { tabela: 'b', esperado: { linhas: 2, sha256: '2' }, real: { linhas: 2, sha256: 'x' } },
    { tabela: 'c', esperado: { linhas: 0, sha256: '3' }, real: null },
    { tabela: 'd', esperado: null, real: { linhas: 0, sha256: '4' } }
  ])
  assert.deepEqual(compararRetratos(esperado, esperado), [])
})
