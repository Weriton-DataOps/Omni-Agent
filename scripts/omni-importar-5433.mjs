#!/usr/bin/env node
// Importa o dump do PostgreSQL 5433 (missões e livro de aprendizado) para o omni.db da casa
// e confere linha a linha. A saída é só contagem: nada do conteúdo nem caminhos.
// Uso: node scripts/omni-importar-5433.mjs --arquivo <dump.json> [--casa <casa>]
//      node scripts/omni-importar-5433.mjs --recibo [--casa <casa>]
// Sai com 0 se a conferência fecha, 1 se falta ou está atrasada alguma linha, 2 se faltou argumento;
// no --recibo, 0 com recibo e 3 sem.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import { importarDoPostgres, verificarImportacao } from '../runtime/casa/loja-operacao.mjs'
import { casaDoOmni } from '../runtime/memoria.mjs'

function argumento(nome) {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const casa = argumento('--casa') ?? casaDoOmni()

// --recibo: só leitura, diz se o omni.db já tem a importação do 5433 (sai 0) ou não (sai 3).
// O omni-desligar-5433.ps1 não desliga o PG sem esse recibo.
if (process.argv.includes('--recibo')) {
  const recibo = comBancoDaCasa(casa, 'omni', (db) =>
    db.prepare("SELECT feita_em, fonte_sha256, contagens FROM _importacoes WHERE tipo = 'postgres-5433' ORDER BY feita_em DESC LIMIT 1").get())
  console.log(JSON.stringify(recibo ? { recibo: true, feitaEm: recibo.feita_em, fonteSha256: recibo.fonte_sha256, contagens: JSON.parse(recibo.contagens) } : { recibo: false }))
  process.exit(recibo ? 0 : 3)
}

const arquivo = argumento('--arquivo')
if (!arquivo) {
  console.error('Uso: node scripts/omni-importar-5433.mjs --arquivo <dump.json> [--casa <casa>] | --recibo [--casa <casa>]')
  process.exit(2)
}

const bruto = readFileSync(arquivo)
const dump = JSON.parse(bruto.toString('utf8').replace(/^﻿/, ''))
const resultado = comBancoDaCasa(casa, 'omni', (db) => {
  const importacao = importarDoPostgres(db, dump, { fonte: basename(arquivo), fonteSha256: sha256(bruto) })
  return { importacao, verificacao: verificarImportacao(db, dump) }
})
console.log(JSON.stringify(resultado, null, 2))
if (!resultado.verificacao.ok) process.exitCode = 1
