import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LIMITE_CORPO, criarApiOmni } from '../runtime/casa/api-omni.mjs'
import { chamar } from './fixtures/chamar-api.mjs'

const TOKEN = 'token-de-teste-123'
const EXECUCAO = '20261109-120000-abcd'

async function subir(t, { banco } = {}) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-api-'))
  const env = { ...process.env, OMNI_CASA_BANCO: banco?.(casa) ?? join(casa, 'banco') }
  const servidor = criarApiOmni({
    casa, token: TOKEN, versao: '9.9.9', iniciadoEm: '2026-11-09T12:00:00.000Z', env,
    agentes: () => [{ agente: 'exemplo', estado: 'no-ar' }]
  })
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  t.after(async () => {
    servidor.closeAllConnections()
    await new Promise((resolver) => servidor.close(resolver))
    try { rmSync(casa, { recursive: true, force: true }) } catch { /* sobra temporária */ }
  })
  return servidor.address().port
}

test('saúde responde com token: agente, versão, início e o estado dos agentes', async (t) => {
  const porta = await subir(t)
  const r = await chamar(porta, 'GET', '/v1/saude', { token: TOKEN })
  assert.equal(r.status, 200)
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.deepEqual(r.corpo, { ok: true, agente: 'omni', versao: '9.9.9', iniciado_em: '2026-11-09T12:00:00.000Z', agentes: [{ agente: 'exemplo', estado: 'no-ar' }] })
})

test('sem token, token errado ou de outro tamanho: 401', async (t) => {
  const porta = await subir(t)
  for (const token of [undefined, 'token-de-teste-124', 'x', `${TOKEN}${TOKEN}`]) {
    const r = await chamar(porta, 'GET', '/v1/saude', { token })
    assert.equal(r.status, 401, String(token))
    assert.equal(r.corpo.ok, false)
  }
})

test('localhost recebe 421 mesmo com o token certo', async (t) => {
  const porta = await subir(t)
  const r = await chamar(porta, 'GET', '/v1/saude', { token: TOKEN, host: `localhost:${porta}` })
  assert.equal(r.status, 421)
})

test('a campainha é idempotente: 202 novo, 202 repetido e um recibo só', async (t) => {
  const porta = await subir(t)
  const corpo = { agente: 'oraculo', execucao: EXECUCAO }
  const primeiro = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
  assert.equal(primeiro.status, 202)
  assert.deepEqual(primeiro.corpo, { ok: true, id: `oraculo/${EXECUCAO}`, novo: true })
  const repetido = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
  assert.equal(repetido.status, 202)
  assert.equal(repetido.corpo.novo, false)
  const lista = await chamar(porta, 'GET', '/v1/despachos?estado=recebido', { token: TOKEN })
  assert.equal(lista.status, 200)
  assert.deepEqual(lista.corpo.despachos.map((d) => d.id), [`oraculo/${EXECUCAO}`])
})

test('corpo inválido recebe 400 e não grava', async (t) => {
  const porta = await subir(t)
  for (const corpo of ['{', '[]', JSON.stringify({ agente: 'oraculo' }), JSON.stringify({ agente: 'oraculo', execucao: 'a/b' })]) {
    const r = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
    assert.equal(r.status, 400, corpo)
  }
  assert.equal((await chamar(porta, 'GET', '/v1/despachos?estado=bobagem', { token: TOKEN })).status, 400)
  assert.deepEqual((await chamar(porta, 'GET', '/v1/despachos', { token: TOKEN })).corpo.despachos, [])
})

test('corpo acima de 64 KB recebe 413', async (t) => {
  const porta = await subir(t)
  const corpo = JSON.stringify({ agente: 'oraculo', execucao: EXECUCAO, enchimento: 'x'.repeat(LIMITE_CORPO) })
  const r = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
  assert.equal(r.status, 413)
  assert.deepEqual((await chamar(porta, 'GET', '/v1/despachos', { token: TOKEN })).corpo.despachos, [])
})

test('rota desconhecida recebe 404 e método errado 405 com Allow', async (t) => {
  const porta = await subir(t)
  assert.equal((await chamar(porta, 'GET', '/v1/nada', { token: TOKEN })).status, 404)
  const r = await chamar(porta, 'DELETE', '/v1/saude', { token: TOKEN })
  assert.equal(r.status, 405)
  assert.equal(r.headers.allow, 'GET')
  assert.equal((await chamar(porta, 'PUT', '/v1/despachos', { token: TOKEN })).headers.allow, 'GET, POST')
})

test('banco fora do ar vira 500 sem pilha e sem caminho', async (t) => {
  // A pasta do banco aponta para um arquivo: abrir o omni.db falha de verdade.
  const porta = await subir(t, { banco: (casa) => { const arquivo = join(casa, 'nao-e-pasta'); writeFileSync(arquivo, 'x'); return arquivo } })
  const r = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo: { agente: 'oraculo', execucao: EXECUCAO } })
  assert.equal(r.status, 500)
  assert.deepEqual(r.corpo, { ok: false, erro: 'falha interna' })
})

test('criar a API com token fora do formato é recusado', () => {
  for (const token of [undefined, '', 'com espaço', 'x'.repeat(513)]) {
    assert.throws(() => criarApiOmni({ casa: tmpdir(), token, versao: null }), TypeError, String(token))
  }
})
