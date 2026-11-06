// Testadores do cofre (§8.5): OpenAI por GET /v1/models com fetch de mentira; Sentinel nunca testa;
// tipo sem testador nem abre o valor.
import assert from 'node:assert/strict'
import test from 'node:test'

import { SEM_TESTE_SENTINEL, testarCredencial } from '../runtime/casa/testadores-cofre.mjs'

function fetchFalso(resposta, chamadas) {
  return async (url, opcoes) => {
    chamadas.push({ url, opcoes })
    if (resposta instanceof Error) throw resposta
    return { ok: resposta.status >= 200 && resposta.status < 300, status: resposta.status, body: null }
  }
}

test('OpenAI: GET /v1/models com o Bearer aparado; 200 é ok e o valor é zerado', async () => {
  const chamadas = []
  const valor = Buffer.from(' sk-teste-123 \n')
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => { aberturas += 1; return valor }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: true, detalhe: 'HTTP 200' })
  assert.equal(aberturas, 1)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://api.openai.com/v1/models')
  assert.equal(chamadas[0].opcoes.headers.authorization, 'Bearer sk-teste-123')
  assert.ok(chamadas[0].opcoes.signal instanceof AbortSignal)
  assert.ok(valor.every((b) => b === 0), 'o valor foi zerado')
  assert.ok(!r.detalhe.includes('sk-teste'))
})

test('OpenAI: 401 e 403 são falha; 500 e rede caída ficam sem veredito', async () => {
  const testar = (resposta) => testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => Buffer.from('sk-x'), { fetch: fetchFalso(resposta, []) })
  assert.deepEqual(await testar({ status: 401 }), { ok: false, detalhe: 'HTTP 401' })
  assert.deepEqual(await testar({ status: 403 }), { ok: false, detalhe: 'HTTP 403' })
  assert.deepEqual(await testar({ status: 500 }), { ok: null, detalhe: 'HTTP 500' })
  assert.deepEqual(await testar(new TypeError('fetch failed')), { ok: null, detalhe: 'sem resposta (TypeError)' })
})

test('Sentinel nunca é testado: nem abre o valor, nem chama a rede', async () => {
  const chamadas = []
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'sentinel' }, () => { aberturas += 1; return Buffer.from('x') }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: null, detalhe: SEM_TESTE_SENTINEL })
  assert.deepEqual([aberturas, chamadas.length], [0, 0])
})

test('tipo sem testador não abre o valor', async () => {
  let aberturas = 0
  const obter = () => { aberturas += 1; return Buffer.from('x') }
  assert.deepEqual(await testarCredencial({ tipo: 'conexao', servico: 'postgres' }, obter), { ok: null, detalhe: 'sem testador para conexao/postgres' })
  assert.deepEqual(await testarCredencial({ tipo: 'senha', servico: null }, obter), { ok: null, detalhe: 'sem testador para senha/-' })
  assert.equal(aberturas, 0)
})
