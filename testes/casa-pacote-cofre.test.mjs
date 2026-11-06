// Pacote do cofre (§8.4): ida e volta, frase errada, adulteração e limites do scrypt.
import assert from 'node:assert/strict'
import test from 'node:test'

import { abrirPacote, PARAMETROS_PADRAO, selarPacote } from '../runtime/casa/pacote-cofre.mjs'

// N=2**14 deixa a suíte rápida; o padrão (2**17) roda uma vez só, na ida e volta.
const RAPIDO = { N: 2 ** 14, r: 8, p: 1 }
const FRASE = 'frase-mestra de teste'
const CONTEUDO = { formato: 'teste', itens: [{ nome: 'x', valor_b64: Buffer.from('segredo-do-pacote').toString('base64') }] }

// Troca o cabeçalho do pacote e devolve o texto externo de novo.
function comCabecalho(texto, mudar) {
  const externo = JSON.parse(texto)
  externo.cabecalho = mudar(externo.cabecalho)
  return JSON.stringify(externo)
}
const erro = (code) => ({ name: 'PacoteCofreError', code })

test('ida e volta: o pacote abre com a mesma frase, no rápido e no padrão', () => {
  assert.deepEqual(abrirPacote(selarPacote(CONTEUDO, FRASE, RAPIDO), FRASE), CONTEUDO)
  const padrao = selarPacote(CONTEUDO, FRASE)
  assert.equal(JSON.parse(JSON.parse(padrao).cabecalho).kdf.N, PARAMETROS_PADRAO.N)
  assert.deepEqual(abrirPacote(padrao, FRASE), CONTEUDO)
})

test('nada em claro: nem o valor, nem o base64 dele, nem a frase', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  assert.ok(!texto.includes('segredo-do-pacote'), 'o valor não aparece')
  assert.ok(!texto.includes(CONTEUDO.itens[0].valor_b64), 'o base64 do valor não aparece')
  assert.ok(!texto.includes(FRASE), 'a frase não aparece')
})

test('frase errada não abre', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  assert.throws(() => abrirPacote(texto, 'outra frase-mestra qualquer'), erro('frase-ou-pacote'))
})

test('dados adulterados não abrem', () => {
  const externo = JSON.parse(selarPacote(CONTEUDO, FRASE, RAPIDO))
  const dados = Buffer.from(externo.dados, 'base64')
  dados[0] ^= 1
  externo.dados = dados.toString('base64')
  assert.throws(() => abrirPacote(JSON.stringify(externo), FRASE), erro('frase-ou-pacote'))
})

test('o cabeçalho é autenticado: um espaço a mais derruba a abertura', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  const mexido = comCabecalho(texto, (c) => c.replace('"versao":1', '"versao": 1'))
  assert.notEqual(JSON.parse(mexido).cabecalho, JSON.parse(texto).cabecalho)
  assert.throws(() => abrirPacote(mexido, FRASE), erro('frase-ou-pacote'))
})

test('os parâmetros do pacote são conferidos antes de derivar a chave (r antes de N)', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  // r=9 vem primeiro: sem a conferência, ele deriva rápido e cai em frase-ou-pacote, não em parametros.
  assert.throws(() => abrirPacote(comCabecalho(texto, (c) => c.replace('"r":8', '"r":9')), FRASE), erro('parametros'))
  assert.throws(() => abrirPacote(comCabecalho(texto, (c) => c.replace('"N":16384', '"N":524288')), FRASE), erro('parametros'))
})

test('frase-mestra: mínimo de 12 caracteres, contados depois do NFC', () => {
  assert.throws(() => selarPacote(CONTEUDO, 'a'.repeat(11), RAPIDO), erro('frase-curta'))
  assert.deepEqual(abrirPacote(selarPacote(CONTEUDO, 'a'.repeat(12), RAPIDO), 'a'.repeat(12)), CONTEUDO)
  // 'e' + acento combinante vira um caractere só no NFC: 11 deles ainda são curtos.
  assert.throws(() => selarPacote(CONTEUDO, 'e\u0301'.repeat(11), RAPIDO), erro('frase-curta'))
  // A mesma frase digitada composta ou decomposta abre o mesmo pacote.
  assert.deepEqual(abrirPacote(selarPacote(CONTEUDO, '\u00e9'.repeat(12), RAPIDO), 'e\u0301'.repeat(12)), CONTEUDO)
  assert.throws(() => selarPacote(CONTEUDO, null, RAPIDO), erro('frase-curta'))
})

test('selar recusa parâmetros fora dos limites', () => {
  for (const parametros of [{ N: 2 ** 13, r: 8, p: 1 }, { N: 2 ** 14 + 1, r: 8, p: 1 }, { N: 2 ** 14, r: 9, p: 1 }, { N: 2 ** 14, r: 8, p: 5 }]) {
    assert.throws(() => selarPacote(CONTEUDO, FRASE, parametros), erro('parametros'), JSON.stringify(parametros))
  }
})

test('o que não é pacote é recusado como formato', () => {
  assert.throws(() => abrirPacote('isso não é json', FRASE), erro('formato'))
  assert.throws(() => abrirPacote('{}', FRASE), erro('formato'))
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  const salCurto = comCabecalho(texto, (c) => { const cab = JSON.parse(c); cab.kdf.sal = Buffer.alloc(8).toString('base64'); return JSON.stringify(cab) })
  assert.throws(() => abrirPacote(salCurto, FRASE), erro('formato'))
})
