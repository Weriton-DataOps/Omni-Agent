// Plano 4b, tarefa 4: o porteiro do IPC agente:api. A janela fala só com o agente que carregou, e o
// pedido vai à casa como POST /v1/agentes/<agente>/chamar.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { criarAgenteApi, LIMITE_CORPO } = require('../apps/omni-ilha/agente-api.js')

function casaFalsa(resposta = { status: 200, corpo: { status: 200, corpo: { ok: true } } }) {
  const pedidos = []
  const chamar = async (metodo, rota, corpo) => {
    pedidos.push({ metodo, rota, corpo })
    if (typeof resposta === 'function') return resposta()
    return resposta
  }
  return { chamar, pedidos }
}

test('pedido certo vai como POST no chamar do agente, sem o corpo nulo, e volta o { status, corpo } do agente', async () => {
  const casa = casaFalsa({ status: 200, corpo: { status: 404, corpo: { ok: false, erro: 'sem ponto' } } })
  const api = criarAgenteApi({ chamar: casa.chamar })
  const lido = await api.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/actions/pontos/a%20b', corpo: null }, { permitido: 'oraculo' })
  assert.deepEqual(lido, { status: 404, corpo: { ok: false, erro: 'sem ponto' } })
  assert.deepEqual(casa.pedidos[0], { metodo: 'POST', rota: '/v1/agentes/oraculo/chamar', corpo: { metodo: 'GET', rota: '/v1/actions/pontos/a%20b' } })
  assert.equal('corpo' in casa.pedidos[0].corpo, false)

  await api.pedir({ agente: 'oraculo', metodo: 'POST', rota: '/v1/actions/execucoes', corpo: { slug: 'x' } }, { permitido: 'oraculo' })
  assert.deepEqual(casa.pedidos[1].corpo, { metodo: 'POST', rota: '/v1/actions/execucoes', corpo: { slug: 'x' } })
})

test('agente de outra janela, janela sem agente e entrada torta voltam status 0 sem tráfego', async () => {
  const casa = casaFalsa()
  const api = criarAgenteApi({ chamar: casa.chamar })
  const certo = { agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }
  const recusas = [
    [{ ...certo, agente: 'overcore' }, { permitido: 'oraculo' }],
    [certo, { permitido: null }],
    [certo, {}],
    [null, { permitido: 'oraculo' }],
    ['texto', { permitido: 'oraculo' }],
    [{ ...certo, agente: 'Oraculo' }, { permitido: 'Oraculo' }],
    [{ ...certo, agente: '../omni' }, { permitido: '../omni' }],
    [{ ...certo, metodo: 'HEAD' }, { permitido: 'oraculo' }],
    [{ ...certo, metodo: 'get' }, { permitido: 'oraculo' }],
    [{ ...certo, rota: 'v1/saude' }, { permitido: 'oraculo' }],
    [{ ...certo, rota: '//outro/host' }, { permitido: 'oraculo' }],
    [{ ...certo, rota: '/v1/com espaço' }, { permitido: 'oraculo' }],
    [{ ...certo, rota: `/${'a'.repeat(2048)}` }, { permitido: 'oraculo' }],
    [{ ...certo, rota: 7 }, { permitido: 'oraculo' }],
    [{ ...certo, corpo: 'texto' }, { permitido: 'oraculo' }],
    [{ ...certo, corpo: 12 }, { permitido: 'oraculo' }],
    [{ ...certo, metodo: 'POST', corpo: { grande: 'x'.repeat(LIMITE_CORPO) } }, { permitido: 'oraculo' }]
  ]
  for (const [entrada, opcoes] of recusas) {
    const r = await api.pedir(entrada, opcoes)
    assert.equal(r.status, 0, JSON.stringify(entrada)?.slice(0, 80))
    assert.equal(r.corpo.ok, false)
    assert.equal(typeof r.corpo.erro, 'string')
  }
  assert.equal(casa.pedidos.length, 0)
})

test('a rota de 2048 caracteres passa; a de 2049 não', async () => {
  const casa = casaFalsa()
  const api = criarAgenteApi({ chamar: casa.chamar })
  assert.equal((await api.pedir({ agente: 'oraculo', metodo: 'GET', rota: `/${'a'.repeat(2047)}` }, { permitido: 'oraculo' })).status, 200)
  assert.equal(casa.pedidos.length, 1)
})

test('a casa que não devolve 200 vira status 0 com o erro dela; exceção também', async () => {
  const erro = criarAgenteApi({ chamar: casaFalsa({ status: 503, corpo: { ok: false, erro: 'o oraculo não está no ar' } }).chamar })
  assert.deepEqual(await erro.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }, { permitido: 'oraculo' }),
    { status: 0, corpo: { ok: false, erro: 'o oraculo não está no ar' } })

  const fora = criarAgenteApi({ chamar: casaFalsa({ status: 0, corpo: { ok: false, erro: 'a casa não atendeu' } }).chamar })
  assert.deepEqual(await fora.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }, { permitido: 'oraculo' }),
    { status: 0, corpo: { ok: false, erro: 'a casa não atendeu' } })

  // Um 403 da casa nunca passa por resposta do agente, mesmo com corpo de cara boa.
  const disfarce = criarAgenteApi({ chamar: casaFalsa({ status: 403, corpo: { status: 200, corpo: { ok: true } } }).chamar })
  assert.equal((await disfarce.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }, { permitido: 'oraculo' })).status, 0)

  const torta = criarAgenteApi({ chamar: casaFalsa({ status: 200, corpo: { sem: 'status' } }).chamar })
  assert.equal((await torta.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }, { permitido: 'oraculo' })).status, 0)

  const lanca = criarAgenteApi({ chamar: casaFalsa(() => { throw new Error('boom') }).chamar })
  const r = await lanca.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }, { permitido: 'oraculo' })
  assert.equal(r.status, 0)
  assert.equal(r.corpo.ok, false)
})
