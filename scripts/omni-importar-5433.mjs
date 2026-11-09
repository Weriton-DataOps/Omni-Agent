#!/usr/bin/env node
// Importa o dump do PostgreSQL 5433 (missões e livro de aprendizado) para o omni.db da casa
// e confere linha a linha. A saída é só contagem: nada do conteúdo nem caminhos.
// Uso: node scripts/omni-importar-5433.mjs --arquivo <dump.json> [--casa <casa>]
// Sai com 0 se a conferência fecha, 1 se falta ou está atrasada alguma linha, 2 se faltou argumento.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import { importarDoPostgres, verificarImportacao } from '../runtime/casa/loja-operacao.mjs'
import { casaDoOmni } from '../runtime/memoria.mjs'

function argumento(nome) {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const arquivo = argumento('--arquivo')
if (!arquivo) {
  console.error('Uso: node scripts/omni-importar-5433.mjs --arquivo <dump.json> [--casa <casa>]')
  process.exit(2)
}
const casa = argumento('--casa') ?? casaDoOmni()

const bruto = readFileSync(arquivo)
const dump = JSON.parse(bruto.toString('utf8').replace(/^﻿/, ''))
const resultado = comBancoDaCasa(casa, 'omni', (db) => {
  const importacao = importarDoPostgres(db, dump, { fonte: basename(arquivo), fonteSha256: sha256(bruto) })
  return { importacao, verificacao: verificarImportacao(db, dump) }
})
console.log(JSON.stringify(resultado, null, 2))
if (!resultado.verificacao.ok) process.exitCode = 1
