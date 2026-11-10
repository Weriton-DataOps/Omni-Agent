// O carteiro (F2, plano 4a, T7): tira da fila do agente, escolhe a sessão, assume, grava o pedido e
// entrega. Aqui a fila é um Oráculo falso em memória que imita o contrato do E3 (leitura devolve o dado
// cru; assumir dá 409 fora da fila; estado aceita destino).
import assert from 'node:assert/strict'
import test from 'node:test'

import { criarCarteiro, temFila } from '../runtime/casa/carteiro.mjs'

const ID = '20261109-120000-abcd'
const ID2 = '20261109-120500-beef'
const SESSOES = [
  { nome: 'omni-24', cwd: 'C:\\U\\Omni', status: 'idle', startedAt: 5 },
  { nome: 'station-2', cwd: 'C:\\U\\Station', status: 'idle', startedAt: 1 }
]
const PROJETOS = [{ nome: 'Station', pasta: 'C:\\U\\Station', fase: 'go-live', dor: 'prazo', itens: [{ titulo: 'Fase 1', data: '05/11/2026' }] }]
const PONTOS = { 'card-novo': { slug: 'card-novo', titulo: 'Card novo', proximoPasso: 'desenhar', potencial: { nivel: 1, motivo: 'pedido dele' } } }

const execucao = (id, extra = {}) => ({
  id, slug: '', projeto: 'station', titulo: 'Station', instrucao: 'migra o card', estado: 'na fila', destino: null,
  eventos: [{ em: 1, estado: 'na fila', nota: 'mandada pela tela do Actions' }], ...extra
})

function oraculoFalso(execucoes, { mesa = { raiz: 'C:\\U\\Actions', projetos: PROJETOS } } = {}) {
  const fila = new Map(execucoes.map((e) => [e.id, structuredClone(e)]))
  const chamadas = []
  const naoAchou = { status: 404, corpo: { ok: false, erro: 'não encontrado' } }
  async function chamar(agente, metodo, rota, corpo, opcoes = {}) {
    chamadas.push({ agente, metodo, rota, corpo, papel: opcoes.papel })
    let m
    if (metodo === 'GET' && rota === '/v1/actions/execucoes?estado=pendente') {
      return { status: 200, corpo: { execucoes: [...fila.values()].filter((e) => e.estado === 'na fila').map((e) => structuredClone(e)) } }
    }
    if (metodo === 'GET' && rota === '/v1/actions/mesa') return mesa === null ? { status: 0, corpo: { ok: false, erro: 'fora do ar' } } : { status: 200, corpo: mesa }
    if (metodo === 'GET' && (m = /^\/v1\/actions\/pontos\/([a-z0-9-]+)$/.exec(rota))) return PONTOS[m[1]] ? { status: 200, corpo: PONTOS[m[1]] } : naoAchou
    if (metodo === 'GET' && (m = /^\/v1\/actions\/execucoes\/([\w-]+)$/.exec(rota))) return fila.has(m[1]) ? { status: 200, corpo: structuredClone(fila.get(m[1])) } : naoAchou
    if (metodo === 'POST' && (m = /^\/v1\/actions\/execucoes\/([\w-]+)\/assumir$/.exec(rota))) {
      const e = fila.get(m[1])
      if (!e) return naoAchou
      if (e.estado !== 'na fila') return { status: 409, corpo: { ok: false, erro: `execução não está na fila (${e.estado})` } }
      Object.assign(e, { estado: 'enviada', destino: { nome: corpo.sessao } })
      e.eventos.push({ estado: 'enviada', nota: `assumida por ${corpo.sessao}` })
      return { status: 200, corpo: { ok: true, dados: { id: e.id, estado: e.estado, destino: e.destino } } }
    }
    if (metodo === 'POST' && (m = /^\/v1\/actions\/execucoes\/([\w-]+)\/estado$/.exec(rota))) {
      const e = fila.get(m[1])
      e.estado = corpo.estado
      if (corpo.destino !== undefined) e.destino = corpo.destino
      e.eventos.push({ estado: corpo.estado, nota: corpo.nota })
      return { status: 200, corpo: { ok: true, dados: { id: e.id, estado: e.estado } } }
    }
    return naoAchou
  }
  return { chamar, chamadas, fila }
}

function montar(oraculo, extra = {}) {
  const recibos = []
  const entregas = []
  const pedidos = new Map()
  const logs = []
  const carteiro = criarCarteiro({
    chamar: oraculo.chamar,
    agentes: () => ['oraculo'],
    sessoes: () => SESSOES,
    entregar: async (nome, arquivo) => { entregas.push({ nome, arquivo }); return { ok: true } },
    gravarPedido: (id, texto, n) => { const arquivo = `P:\\${id}-${n}.md`; pedidos.set(arquivo, texto); return arquivo },
    marcar: (recibo) => { recibos.push(recibo) },
    maos: 'M.mjs',
    pastaActions: 'C:\\U\\Reserva',
    pastaOmni: 'C:\\U\\Omni',
    log: (texto) => logs.push(texto),
    ...extra
  })
  return { carteiro, recibos, entregas, pedidos, logs }
}

const rotasDe = (oraculo) => oraculo.chamadas.map((c) => `${c.metodo} ${c.rota}`)

test('fila com uma: sessão da pasta do projeto, assume, entrega o pedido gravado, marca enviada e recibo assumido', async () => {
  const o = oraculoFalso([execucao(ID, { slug: 'card-novo' })])
  const { carteiro, recibos, entregas, pedidos } = montar(o)
  await carteiro.tocar('oraculo')
  assert.ok(o.chamadas.every((c) => c.papel === 'visita' && c.agente === 'oraculo'), 'tudo com o token visita')
  const assumir = o.chamadas.find((c) => c.rota.endsWith('/assumir'))
  assert.deepEqual(assumir.corpo, { sessao: 'station-2' })
  assert.deepEqual(entregas, [{ nome: 'station-2', arquivo: `P:\\${ID}-1.md` }])
  const pedido = pedidos.get(`P:\\${ID}-1.md`)
  for (const trecho of ['migra o card', '## Projeto: Station', 'Pasta: C:\\U\\Station', '- Fase 1 — 05/11/2026', '## Ponto do Actions: Card novo (card-novo)', `node "M.mjs" execucao ${ID} --estado concluida`]) {
    assert.ok(pedido.includes(trecho), trecho)
  }
  const ex = o.fila.get(ID)
  assert.equal(ex.estado, 'enviada')
  assert.deepEqual(ex.destino, { nome: 'station-2', cwd: 'C:\\U\\Station', motivo: 'sessão aberta na pasta do projeto' })
  assert.equal(ex.eventos.at(-1).nota, 'entregue a station-2 (sessão aberta na pasta do projeto)')
  assert.deepEqual(recibos, [{ agente: 'oraculo', execucao: ID, estado: 'assumido', detalhe: 'entregue a station-2' }])
})

test('sem sessão viva: "sem sessão" com a pasta a abrir, sem assumir, recibo falhou', async () => {
  const o = oraculoFalso([execucao(ID)])
  const { carteiro, recibos, entregas } = montar(o, { sessoes: () => [] })
  await carteiro.tocar('oraculo')
  assert.equal(rotasDe(o).some((r) => r.endsWith('/assumir')), false)
  assert.equal(entregas.length, 0)
  const ex = o.fila.get(ID)
  assert.equal(ex.estado, 'sem sessão')
  assert.match(ex.eventos.at(-1).nota, /abra uma em C:\\U\\Station/)
  assert.deepEqual(recibos, [{ agente: 'oraculo', execucao: ID, estado: 'falhou', detalhe: 'sem sessão' }])
})

test('sem projeto e sem mesa: cai na pasta do Actions de reserva e na ociosa do Omni', async () => {
  const o = oraculoFalso([execucao(ID, { projeto: '' })], { mesa: null })
  const { carteiro, entregas } = montar(o)
  await carteiro.tocar('oraculo')
  assert.deepEqual(entregas.map((e) => e.nome), ['omni-24'])
  const semNinguem = oraculoFalso([execucao(ID, { projeto: '' })], { mesa: null })
  await montar(semNinguem, { sessoes: () => [] }).carteiro.tocar('oraculo')
  assert.match(semNinguem.fila.get(ID).eventos.at(-1).nota, /abra uma em C:\\U\\Reserva/)
})

test('409 no assumir: nada é entregue, recibo recusado', async () => {
  const o = oraculoFalso([execucao(ID)])
  const original = o.chamar
  o.chamar = async (agente, metodo, rota, corpo, opcoes) => {
    if (rota.endsWith('/assumir')) o.fila.get(ID).estado = 'enviada' // outra mão levou entre a leitura e o assumir
    return original(agente, metodo, rota, corpo, opcoes)
  }
  const { carteiro, recibos, entregas } = montar(o)
  await carteiro.tocar('oraculo')
  assert.equal(entregas.length, 0)
  assert.deepEqual(recibos, [{ agente: 'oraculo', execucao: ID, estado: 'recusado', detalhe: 'execução não está na fila (enviada)' }])
})

test('execução que já saiu da fila na leitura: recibo recusado, sem sem-sessão nem assumir', async () => {
  const o = oraculoFalso([execucao(ID)])
  const original = o.chamar
  o.chamar = async (agente, metodo, rota, corpo, opcoes) => {
    if (rota === `/v1/actions/execucoes/${ID}`) o.fila.get(ID).estado = 'andando'
    return original(agente, metodo, rota, corpo, opcoes)
  }
  const { carteiro, recibos } = montar(o, { sessoes: () => [] })
  await carteiro.tocar('oraculo')
  assert.equal(rotasDe(o).some((r) => r.startsWith('POST')), false)
  assert.deepEqual(recibos, [{ agente: 'oraculo', execucao: ID, estado: 'recusado', detalhe: 'fora da fila (andando)' }])
})

test('entrega falha: estado falhou com o motivo e recibo falhou', async () => {
  const o = oraculoFalso([execucao(ID)])
  const { carteiro, recibos } = montar(o, { entregar: async () => ({ ok: false, motivo: 'FALHOU: sessão sumiu' }) })
  await carteiro.tocar('oraculo')
  const ex = o.fila.get(ID)
  assert.equal(ex.estado, 'falhou')
  assert.equal(ex.eventos.at(-1).nota, 'a entrega para station-2 falhou: FALHOU: sessão sumiu')
  assert.deepEqual(recibos, [{ agente: 'oraculo', execucao: ID, estado: 'falhou', detalhe: 'FALHOU: sessão sumiu' }])
})

test('resposta a execução já entregue volta para a mesma sessão com o pedido "Resposta do Weriton"', async () => {
  const o = oraculoFalso([execucao(ID, {
    destino: { nome: 'omni-24', cwd: 'C:\\U\\Omni' },
    eventos: [{ estado: 'bloqueada', nota: 'qual banco?' }, { estado: 'na fila', nota: 'resposta do Weriton: homolog', resposta: 'homolog' }]
  })])
  const { carteiro, entregas, pedidos } = montar(o)
  await carteiro.tocar('oraculo')
  assert.deepEqual(entregas.map((e) => e.nome), ['omni-24'], 'a mesma sessão, não a da pasta do projeto')
  const pedido = pedidos.get(entregas[0].arquivo)
  assert.match(pedido, /^Resposta do Weriton à execução/)
  assert.match(pedido, /homolog/)
  assert.equal(o.fila.get(ID).destino.motivo, 'a mesma sessão que já está no trabalho')
})

test('resposta cuja sessão fechou vai para outra, ainda como resposta', async () => {
  const o = oraculoFalso([execucao(ID, {
    destino: { nome: 'fechada-1' },
    eventos: [{ estado: 'na fila', nota: 'resposta do Weriton: x', resposta: 'usa a homolog' }]
  })])
  const { carteiro, entregas, pedidos } = montar(o)
  await carteiro.tocar('oraculo')
  assert.deepEqual(entregas.map((e) => e.nome), ['station-2'])
  assert.match(pedidos.get(entregas[0].arquivo), /^Resposta do Weriton/)
})

test('resposta em execução que nunca foi entregue não vira pedido de resposta', async () => {
  const o = oraculoFalso([execucao(ID, { eventos: [{ estado: 'na fila', nota: 'x', resposta: 'perdida' }] })])
  const { carteiro, entregas, pedidos } = montar(o)
  await carteiro.tocar('oraculo')
  const pedido = pedidos.get(entregas[0].arquivo)
  assert.doesNotMatch(pedido, /Resposta do Weriton/)
  assert.doesNotMatch(pedido, /perdida/)
})

test('assumir que falha sem ser 409: nada é entregue, recibo falhou com o erro', async () => {
  const o = oraculoFalso([execucao(ID)])
  const original = o.chamar
  o.chamar = async (...args) => (args[2].endsWith('/assumir') ? { status: 0, corpo: { ok: false, erro: 'agente fora do ar' } } : original(...args))
  const { carteiro, recibos, entregas } = montar(o)
  await carteiro.tocar('oraculo')
  assert.equal(entregas.length, 0)
  assert.deepEqual(recibos, [{ agente: 'oraculo', execucao: ID, estado: 'falhou', detalhe: 'assumir: agente fora do ar' }])
})

test('parar no meio da fila: termina a execução em curso e não começa a próxima', async () => {
  const o = oraculoFalso([execucao(ID), execucao(ID2)])
  let carteiro
  const montado = montar(o, { entregar: async (nome, arquivo) => { carteiro.parar(); return { ok: true } } })
  carteiro = montado.carteiro
  await carteiro.tocar('oraculo')
  assert.deepEqual(montado.recibos.map((r) => r.execucao), [ID])
  assert.equal(o.fila.get(ID2).estado, 'na fila')
})

test('exceção numa execução não derruba a rodada: vira falhou e a próxima segue', async () => {
  const o = oraculoFalso([execucao(ID), execucao(ID2)])
  let vez = 0
  const { carteiro, recibos, logs } = montar(o, { gravarPedido: (id) => { vez += 1; if (vez === 1) throw new Error('disco cheio'); return `P:\\${id}.md` } })
  await carteiro.tocar('oraculo')
  assert.equal(o.fila.get(ID).estado, 'falhou')
  assert.match(o.fila.get(ID).eventos.at(-1).nota, /carteiro: disco cheio/)
  assert.equal(o.fila.get(ID2).estado, 'enviada')
  assert.deepEqual(recibos.map((r) => [r.execucao, r.estado]), [[ID, 'falhou'], [ID2, 'assumido']])
  assert.ok(logs.some((l) => l.includes('disco cheio')))
})

test('fila que não abre vira log, sem recibo', async () => {
  const { carteiro, recibos, logs } = montar({ chamar: async () => ({ status: 0, corpo: { ok: false, erro: 'agente fora do ar' } }) })
  await carteiro.tocar('oraculo')
  assert.deepEqual(recibos, [])
  assert.ok(logs.some((l) => l.includes('agente fora do ar')))
})

test('dois toques durante a rodada viram uma repetição só; parar espera a rodada', async () => {
  const o = oraculoFalso([])
  let soltar
  let presa = new Promise((r) => { soltar = r })
  const chamar = async (...args) => { if (args[2].includes('estado=pendente')) await presa; return o.chamar(...args) }
  const { carteiro } = montar({ chamar })
  const primeira = carteiro.tocar('oraculo')
  carteiro.tocar('oraculo')
  carteiro.tocar('oraculo')
  await new Promise((r) => setImmediate(r))
  const filas = () => o.chamadas.filter((c) => c.rota.includes('estado=pendente')).length
  soltar()
  await primeira
  assert.equal(filas(), 2, 'uma rodada e uma repetição')

  presa = new Promise((r) => { soltar = r })
  carteiro.tocar('oraculo')
  let parou = false
  const parada = carteiro.parar().then(() => { parou = true })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(parou, false, 'parar espera a rodada em curso')
  soltar()
  await parada
  assert.equal(parou, true)
  await carteiro.tocar('oraculo')
  assert.equal(filas(), 3, 'depois de parado, o toque não roda')
})

test('toque de agente fora da lista é ignorado; iniciar varre todos e o timer roda de novo', async () => {
  const o = oraculoFalso([])
  const { carteiro, logs } = montar(o, { intervaloMs: 20 })
  await carteiro.tocar('intruso')
  assert.equal(o.chamadas.length, 0)
  assert.ok(logs.some((l) => l.includes('intruso')))
  carteiro.iniciar()
  await new Promise((r) => setTimeout(r, 90))
  await carteiro.parar()
  const filas = o.chamadas.filter((c) => c.rota.includes('estado=pendente')).length
  assert.ok(filas >= 2, `varreu ao iniciar e pelo timer (${filas})`)
  assert.equal(o.chamadas.length, filas, 'fila vazia não lê a mesa')
})

test('iniciar varre na hora, sem esperar o primeiro intervalo', async () => {
  const o = oraculoFalso([])
  const { carteiro } = montar(o, { intervaloMs: 60_000 })
  carteiro.iniciar()
  await new Promise((r) => setTimeout(r, 20))
  await carteiro.parar()
  assert.equal(o.chamadas.filter((c) => c.rota.includes('estado=pendente')).length, 1)
})

test('temFila: só o agente que declara o assumir com escopo visita', () => {
  const assumir = { metodo: 'POST', padrao: '^/v1/actions/execucoes/(\\d{8}-\\d{6}-[0-9a-f]{4})/assumir$', escopo: 'visita' }
  assert.equal(temFila([assumir]), true)
  assert.equal(temFila([{ ...assumir, escopo: 'tela' }]), false)
  assert.equal(temFila([{ ...assumir, metodo: 'GET' }]), false)
  assert.equal(temFila([]), false)
  assert.equal(temFila(undefined), false)
})
