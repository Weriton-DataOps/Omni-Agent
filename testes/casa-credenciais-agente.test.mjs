// Tokens tela e visita de cada agente (F2, plano 4a, T1): nascem no cofre.db do Omni, o agente recebe
// só o sha256 e quem abre o valor é o Omni, com cada abertura registrada em usos.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { garantirTokensDoAgente, nomeDoToken, PAPEIS, tokenDoAgente } from '../runtime/casa/credenciais-agente.mjs'
import { credencialPorNome, usarCredencial } from '../runtime/casa/loja-cofre.mjs'

const QUANDO = { maquina: 'maquina-a', agora: '2026-11-09T20:00:00.000Z' }

function ponteFalsa(marca = 'FALSO:') {
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    selar(valores) { return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}
function comCofre(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-cred-agente-'))
  try { return comBancoDaCasa(casa, 'cofre', uso, {}) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const sha = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')
const usos = (db) => db.prepare('SELECT nome, agente, resultado FROM usos ORDER BY rowid').all().map((l) => ({ ...l }))

test('nomes e papéis', () => {
  assert.deepEqual(PAPEIS, ['tela', 'visita'])
  assert.equal(nomeDoToken('oraculo', 'tela'), 'api/oraculo/tela')
  assert.equal(nomeDoToken('overcore', 'visita'), 'api/overcore/visita')
})

test('cria os dois na 1ª vez e devolve os mesmos sha256 depois, sem criar de novo', () => comCofre((db) => {
  const ponte = ponteFalsa()
  let n = 0
  const gerar = () => `token-${++n}-${'x'.repeat(30)}`
  const primeiro = garantirTokensDoAgente(db, ponte, 'oraculo', { gerar, ...QUANDO })
  assert.deepEqual(primeiro.novos, ['tela', 'visita'])
  assert.match(primeiro.tela, /^[0-9a-f]{64}$/)
  assert.match(primeiro.visita, /^[0-9a-f]{64}$/)
  assert.notEqual(primeiro.tela, primeiro.visita)
  assert.equal(primeiro.tela, sha(`token-1-${'x'.repeat(30)}`))
  const segundo = garantirTokensDoAgente(db, ponte, 'oraculo', { gerar, ...QUANDO })
  assert.deepEqual(segundo, { tela: primeiro.tela, visita: primeiro.visita, novos: [] })
  assert.equal(n, 2)
  const guardada = credencialPorNome(db, 'api/oraculo/visita')
  assert.equal(guardada.tipo, 'token')
  assert.deepEqual(guardada.agentes, ['omni'])
}))

test('o gerador padrão dá 32 bytes aleatórios em base64url', () => comCofre((db) => {
  const ponte = ponteFalsa()
  const { tela } = garantirTokensDoAgente(db, ponte, 'oraculo', QUANDO)
  const valor = tokenDoAgente(db, ponte, 'oraculo', 'tela', 'teste', QUANDO)
  assert.match(valor, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(sha(valor), tela)
}))

test('o token aberto é o do sha256 devolvido, e cada abertura vira uso entregue ao omni', () => comCofre((db) => {
  const ponte = ponteFalsa()
  const shas = garantirTokensDoAgente(db, ponte, 'oraculo', QUANDO)
  const antes = usos(db).length
  const visita = tokenDoAgente(db, ponte, 'oraculo', 'visita', 'carteiro', QUANDO)
  assert.equal(typeof visita, 'string')
  assert.equal(sha(visita), shas.visita)
  assert.deepEqual(usos(db).slice(antes), [{ nome: 'api/oraculo/visita', agente: 'omni', resultado: 'entregue' }])
}))

test('o buffer aberto pela ponte é zerado depois de virar texto', () => comCofre((db) => {
  const ponte = ponteFalsa()
  garantirTokensDoAgente(db, ponte, 'oraculo', QUANDO)
  const abertos = []
  const abrir = ponte.abrir
  ponte.abrir = (blobs) => { const r = abrir(blobs); for (const item of r) if (item.ok) abertos.push(item.valor); return r }
  const valor = tokenDoAgente(db, ponte, 'oraculo', 'tela', 'teste', QUANDO)
  assert.equal(abertos.length, 1)
  assert.ok(valor.length > 0)
  assert.ok(abertos[0].every((b) => b === 0))
}))

test('a credencial do token não autoriza o próprio agente nem outro', () => comCofre((db) => {
  const ponte = ponteFalsa()
  garantirTokensDoAgente(db, ponte, 'oraculo', QUANDO)
  assert.throws(() => usarCredencial(db, ponte, { nome: 'api/oraculo/tela', agente: 'oraculo', motivo: 'tentativa' }, QUANDO), { code: 'agente-sem-acesso' })
}))

test('agente reservado ou fora do formato e papel desconhecido são recusados', () => comCofre((db) => {
  const ponte = ponteFalsa()
  for (const agente of ['omni', 'dono', 'Oráculo', '', 'nucleo']) {
    assert.throws(() => garantirTokensDoAgente(db, ponte, agente, QUANDO), TypeError, agente)
  }
  assert.throws(() => tokenDoAgente(db, ponte, 'oraculo', 'admin', 'x', QUANDO), TypeError)
  assert.throws(() => nomeDoToken('oraculo', 'admin'), TypeError)
}))
