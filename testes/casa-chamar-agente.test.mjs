// chamar (F2, plano 4a, T2): a ilha fala com o agente pelo Omni, e o Omni só põe o token numa rota que
// o agente.json declarou, no método e no escopo dela. Recusa volta com status 0, sem tocar no agente.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { criarChamador, rotaDeclarada } from '../runtime/casa/chamar-agente.mjs'

const ID = '20261109-120000-abcd'
const ROTAS = [
  { metodo: 'GET', padrao: '^/v1/actions/execucoes$', escopo: 'qualquer' },
  { metodo: 'GET', padrao: '^/v1/actions/execucoes/(\\d{8}-\\d{6}-[0-9a-f]{4})$', escopo: 'qualquer' },
  { metodo: 'POST', padrao: '^/v1/actions/execucoes/(\\d{8}-\\d{6}-[0-9a-f]{4})/assumir$', escopo: 'visita' },
  { metodo: 'POST', padrao: '^/v1/actions/execucoes/(\\d{8}-\\d{6}-[0-9a-f]{4})/responder$', escopo: 'tela' },
  // Padrão largo de propósito: o Omni recusa .. e // mesmo quando o manifesto deixaria passar.
  { metodo: 'GET', padrao: '^/v1/arquivos/.+$', escopo: 'qualquer' }
]
const TOKENS = { tela: 'token-tela-de-teste', visita: 'token-visita-de-teste' }

// Agente de mentira: anota cada pedido e responde conforme o modo.
async function agente(t, modo = 'normal') {
  const recebidos = []
  const servidor = createServer((req, res) => {
    let corpo = ''
    req.setEncoding('utf8').on('data', (p) => { corpo += p }).on('end', () => {
      recebidos.push({ metodo: req.method, url: req.url, host: req.headers.host, auth: req.headers.authorization, tipo: req.headers['content-type'] ?? null, corpo })
      if (modo === 'mudo') return
      if (modo === 'grande') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ x: 'y'.repeat(5000) })); return }
      if (modo === 'texto') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('não é json'); return }
      res.writeHead(req.method === 'POST' ? 202 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, eco: req.url }))
    })
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  t.after(() => { servidor.closeAllConnections(); servidor.close() })
  return { porta: servidor.address().port, recebidos }
}
function chamador(porta, extra = {}) {
  return criarChamador({
    servidores: () => (porta === null ? [] : [{ agente: 'oraculo', porta, rotas: ROTAS }]),
    token: (agente, papel) => { assert.equal(agente, 'oraculo'); return TOKENS[papel] },
    ...extra
  })
}

test('rotaDeclarada casa método e padrão no caminho, sem a query', () => {
  assert.equal(rotaDeclarada(ROTAS, 'GET', '/v1/actions/execucoes').escopo, 'qualquer')
  assert.equal(rotaDeclarada(ROTAS, 'POST', `/v1/actions/execucoes/${ID}/assumir`).escopo, 'visita')
  assert.equal(rotaDeclarada(ROTAS, 'GET', `/v1/actions/execucoes/${ID}/assumir`), null)
  assert.equal(rotaDeclarada(ROTAS, 'POST', '/v1/actions/execucoes/abc/assumir'), null)
  assert.equal(rotaDeclarada(undefined, 'GET', '/v1/actions/execucoes'), null)
})

test('GET qualquer vai com o token tela e a query passa', async (t) => {
  const a = await agente(t)
  const r = await chamador(a.porta)('oraculo', 'GET', '/v1/actions/execucoes?estado=pendente')
  assert.deepEqual(r, { status: 200, corpo: { ok: true, eco: '/v1/actions/execucoes?estado=pendente' } })
  assert.equal(a.recebidos.length, 1)
  assert.equal(a.recebidos[0].auth, `Bearer ${TOKENS.tela}`)
  assert.equal(a.recebidos[0].host, `127.0.0.1:${a.porta}`)
  assert.equal(a.recebidos[0].corpo, '')
})

test('POST visita com papel visita leva o token visita e o corpo em JSON', async (t) => {
  const a = await agente(t)
  const r = await chamador(a.porta)('oraculo', 'POST', `/v1/actions/execucoes/${ID}/assumir`, { sessao: 's1' }, { papel: 'visita' })
  assert.equal(r.status, 202)
  assert.equal(a.recebidos[0].auth, `Bearer ${TOKENS.visita}`)
  assert.equal(a.recebidos[0].tipo, 'application/json')
  assert.deepEqual(JSON.parse(a.recebidos[0].corpo), { sessao: 's1' })
})

test('escopo diferente do papel é recusado sem tráfego', async (t) => {
  const a = await agente(t)
  const chamar = chamador(a.porta)
  const comTela = await chamar('oraculo', 'POST', `/v1/actions/execucoes/${ID}/assumir`, {})
  assert.equal(comTela.status, 0)
  assert.equal(comTela.corpo.ok, false)
  assert.match(comTela.corpo.erro, /escopo/)
  const comVisita = await chamar('oraculo', 'POST', `/v1/actions/execucoes/${ID}/responder`, {}, { papel: 'visita' })
  assert.equal(comVisita.status, 0)
  assert.equal(a.recebidos.length, 0)
})

test('rota não declarada, método errado ou caminho torto não saem do Omni', async (t) => {
  const a = await agente(t)
  const chamar = chamador(a.porta)
  const tortas = [
    ['GET', '/v1/actions/pontos'],
    ['DELETE', '/v1/actions/execucoes'],
    ['GET', '/v1/actions/../saude'],
    ['GET', '/v1//actions/execucoes'],
    ['GET', '/v1/arquivos/../../saude'],
    ['GET', '/v1/arquivos//x'],
    ['GET', '/v2/actions/execucoes'],
    ['GET', 'actions/execucoes'],
    ['GET', '/v1/actions/execucoes?estado=<x>'],
    ['GET', '/v1/actions/execucoes#x'],
    ['GET', 'http://outro/v1/actions/execucoes']
  ]
  for (const [metodo, rota] of tortas) {
    const r = await chamar('oraculo', metodo, rota)
    assert.equal(r.status, 0, `${metodo} ${rota}`)
    assert.equal(r.corpo.ok, false)
  }
  assert.equal(a.recebidos.length, 0)
})

test('papel desconhecido é recusado', async (t) => {
  const a = await agente(t)
  const r = await chamador(a.porta)('oraculo', 'GET', '/v1/actions/execucoes', undefined, { papel: 'admin' })
  assert.equal(r.status, 0)
  assert.match(r.corpo.erro, /papel desconhecido/)
  assert.equal(a.recebidos.length, 0)
})

test('agente fora do ar ou desconhecido dá status 0', async () => {
  const r = await chamador(null)('oraculo', 'GET', '/v1/actions/execucoes')
  assert.equal(r.status, 0)
  assert.match(r.corpo.erro, /no ar/)
})

test('token que não abre dá status 0 sem vazar a mensagem do cofre', async (t) => {
  const a = await agente(t)
  const chamar = criarChamador({
    servidores: () => [{ agente: 'oraculo', porta: a.porta, rotas: ROTAS }],
    token: () => { throw new Error('segredo-do-cofre-xyz') }
  })
  const r = await chamar('oraculo', 'GET', '/v1/actions/execucoes')
  assert.equal(r.status, 0)
  assert.doesNotMatch(JSON.stringify(r), /segredo-do-cofre-xyz/)
  assert.equal(a.recebidos.length, 0)
})

test('agente mudo cai no prazo; resposta grande demais é recusada; texto vira corpo null', async (t) => {
  const mudo = await agente(t, 'mudo')
  const r1 = await chamador(mudo.porta, { limiteMs: 150 })('oraculo', 'GET', '/v1/actions/execucoes')
  assert.equal(r1.status, 0)
  assert.match(r1.corpo.erro, /prazo/)
  const grande = await agente(t, 'grande')
  const r2 = await chamador(grande.porta, { limiteResposta: 1000 })('oraculo', 'GET', '/v1/actions/execucoes')
  assert.equal(r2.status, 0)
  assert.match(r2.corpo.erro, /grande/)
  const texto = await agente(t, 'texto')
  const r3 = await chamador(texto.porta)('oraculo', 'GET', '/v1/actions/execucoes')
  assert.deepEqual(r3, { status: 200, corpo: null })
})

test('porta que recusa conexão dá status 0', async (t) => {
  const a = await agente(t)
  const porta = a.porta
  await new Promise((r) => setTimeout(r, 0))
  const chamar = chamador(porta)
  // Fecha o agente e chama de novo: ninguém atende.
  const morto = createServer()
  await new Promise((r) => morto.listen(0, '127.0.0.1', r))
  const portaMorta = morto.address().port
  await new Promise((r) => morto.close(r))
  const r = await chamador(portaMorta)('oraculo', 'GET', '/v1/actions/execucoes')
  assert.equal(r.status, 0)
  assert.equal((await chamar('oraculo', 'GET', '/v1/actions/execucoes')).status, 200)
})
