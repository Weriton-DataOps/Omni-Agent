// Plano 4b, tarefa 5: os cards da ilha e as janelas dos agentes leem tudo pela casa. A lista de painéis
// vem do GET /v1/agentes; o resumo de cada card vai ao agente pelo mesmo porteiro do agente:api.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { criarPaineis } = require('../apps/omni-ilha/paineis.js')

const RAIZ = join('C:\\', 'agentes', 'oraculo')
const MODULO = join(RAIZ, 'interface', 'index.html')
const PRELOAD = join(RAIZ, 'interface', 'actions', 'actions-preload.js')
const ORACULO = { agente: 'oraculo', versao: '0.3.0', raiz: RAIZ, modulo: 'interface/index.html', preload: 'interface/actions/actions-preload.js', painel: 'Oráculo', divergente: false, estado: 'no-ar' }
const existe = (caminho) => [MODULO, PRELOAD].includes(caminho)

function casaFalsa(rotas) {
  const pedidos = []
  const chamar = async (metodo, rota, corpo) => {
    pedidos.push({ metodo, rota, corpo })
    const r = rotas[`${metodo} ${rota}`]
    if (typeof r === 'function') return r(corpo)
    return r ?? { status: 404, corpo: { ok: false, erro: 'rota desconhecida' } }
  }
  return { chamar, pedidos }
}

const RESUMO_ORACULO = { ok: true, vigiando: true, ultimaVigia: 5, total: 2, projetos: [{ nome: 'a', alteradoEm: 1 }] }
const RESUMO_ACTIONS = { total: 3, praVoce: 1, pedidos: [{ tipo: 'veredito', titulo: 't', texto: 'x' }], recentes: [] }

function casaComOraculo() {
  return casaFalsa({
    'GET /v1/agentes': { status: 200, corpo: { ok: true, agentes: [ORACULO] } },
    'POST /v1/agentes/oraculo/chamar': (corpo) => {
      if (corpo.rota === '/v1/oraculo/resumo') return { status: 200, corpo: { status: 200, corpo: RESUMO_ORACULO } }
      if (corpo.rota === '/v1/actions/resumo') return { status: 200, corpo: { status: 200, corpo: RESUMO_ACTIONS } }
      return { status: 200, corpo: { status: 404, corpo: { ok: false, erro: 'sem rota' } } }
    }
  })
}

test('o agente instalado aparece montado, e o resumo de cada card vem do agente pela casa', async () => {
  const casa = casaComOraculo()
  const p = criarPaineis({ chamar: casa.chamar, existe })
  const oraculo = await p.agente('oraculo')
  assert.equal(oraculo.instalado, true)
  assert.equal(oraculo.modulo, MODULO)
  assert.deepEqual(await p.resumo('oraculo', '/v1/oraculo/resumo'), RESUMO_ORACULO)
  assert.deepEqual(await p.resumo('oraculo', '/v1/actions/resumo'), RESUMO_ACTIONS)
  assert.deepEqual(casa.pedidos.filter((x) => x.metodo === 'POST').map((x) => x.corpo), [
    { metodo: 'GET', rota: '/v1/oraculo/resumo' },
    { metodo: 'GET', rota: '/v1/actions/resumo' }
  ])
})

test('cada agente é pedido em nome dele mesmo', async () => {
  const OUTRO = { ...ORACULO, agente: 'outro', painel: 'Outro', preload: null }
  const casa = casaFalsa({
    'GET /v1/agentes': { status: 200, corpo: { ok: true, agentes: [ORACULO, OUTRO] } },
    'POST /v1/agentes/outro/chamar': { status: 200, corpo: { status: 200, corpo: { ok: true, de: 'outro' } } }
  })
  const p = criarPaineis({ chamar: casa.chamar, existe })
  assert.deepEqual(await p.resumo('outro', '/v1/resumo'), { ok: true, de: 'outro' })
})

test('agente que não está na casa vira { ausente: true } e nada vai a ele', async () => {
  const casa = casaFalsa({ 'GET /v1/agentes': { status: 200, corpo: { ok: true, agentes: [] } } })
  const p = criarPaineis({ chamar: casa.chamar, existe })
  assert.equal((await p.agente('oraculo')).instalado, false)
  assert.deepEqual(await p.resumo('oraculo', '/v1/oraculo/resumo'), { ausente: true })
  assert.equal(casa.pedidos.some((x) => x.metodo === 'POST'), false)
})

test('casa fora do ar não finge que o agente sumiu: o card cai com ok false e o motivo', async () => {
  const casa = casaFalsa({ 'GET /v1/agentes': { status: 0, corpo: { ok: false, erro: 'a casa não atendeu' } } })
  const p = criarPaineis({ chamar: casa.chamar, existe })
  assert.equal(await p.agente('oraculo'), null)
  const r = await p.resumo('oraculo', '/v1/oraculo/resumo')
  assert.equal(r.ok, false)
  assert.equal(r.erro, 'a casa não atendeu')
  assert.equal('ausente' in r, false)
})

test('agente que recusa ou cai: o card volta ok false com o erro dele, nunca o corpo de erro como resumo', async () => {
  const casa = casaFalsa({
    'GET /v1/agentes': { status: 200, corpo: { ok: true, agentes: [ORACULO] } },
    'POST /v1/agentes/oraculo/chamar': { status: 200, corpo: { status: 500, corpo: { ok: false, erro: 'banco travado', pilha: 'em algum lugar' } } }
  })
  const p = criarPaineis({ chamar: casa.chamar, existe })
  assert.deepEqual(await p.resumo('oraculo', '/v1/actions/resumo'), { ok: false, erro: 'banco travado' })

  const fora = casaFalsa({
    'GET /v1/agentes': { status: 200, corpo: { ok: true, agentes: [ORACULO] } },
    'POST /v1/agentes/oraculo/chamar': { status: 503, corpo: { ok: false, erro: 'o oraculo não está no ar' } }
  })
  assert.deepEqual(await criarPaineis({ chamar: fora.chamar, existe }).resumo('oraculo', '/v1/actions/resumo'), { ok: false, erro: 'o oraculo não está no ar' })

  const mudo = casaFalsa({
    'GET /v1/agentes': { status: 200, corpo: { ok: true, agentes: [ORACULO] } },
    'POST /v1/agentes/oraculo/chamar': { status: 200, corpo: { status: 200, corpo: 'texto' } }
  })
  assert.deepEqual(await criarPaineis({ chamar: mudo.chamar, existe }).resumo('oraculo', '/v1/actions/resumo'), { ok: false, erro: 'Oráculo fora do ar' })
})

test('lista torta da casa não monta nada além dos conhecidos ausentes', async () => {
  for (const corpo of [null, { ok: true }, { ok: true, agentes: 'x' }]) {
    const casa = casaFalsa({ 'GET /v1/agentes': { status: 200, corpo } })
    const p = criarPaineis({ chamar: casa.chamar, existe })
    assert.deepEqual(await p.resumo('oraculo', '/v1/oraculo/resumo'), { ausente: true }, JSON.stringify(corpo))
  }
})

test('a janela pede pelo porteiro com o agente dela; o pedido em nome de outro não sai', async () => {
  const casa = casaComOraculo()
  const p = criarPaineis({ chamar: casa.chamar, existe })
  const certo = await p.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/oraculo/resumo', corpo: null }, 'oraculo')
  assert.deepEqual(certo, { status: 200, corpo: RESUMO_ORACULO })
  const antes = casa.pedidos.length
  const outro = await p.pedir({ agente: 'overcore', metodo: 'GET', rota: '/v1/saude' }, 'oraculo')
  assert.equal(outro.status, 0)
  const semDono = await p.pedir({ agente: 'oraculo', metodo: 'GET', rota: '/v1/saude' }, undefined)
  assert.equal(semDono.status, 0)
  assert.equal(casa.pedidos.length, antes)
})
