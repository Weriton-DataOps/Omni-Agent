// Plano 4c, T1: o laço de um pareamento do WhatsApp, puro e com eventos.
// Nenhum teste toca o serviço real (127.0.0.1:2785) nem o cofre: a API é um roteiro em memória.
import test from 'node:test'
import assert from 'node:assert/strict'

const { parearSessao } = await import(new URL('../servicos/whatsapp/omni/pareamento.mjs', import.meta.url))

const FONE_PESSOAL = '5562999991234'
const FONE_BOT = '5562988885678'
const todosEventos = []

// Roteiro: estados por id de sessão (o último se repete), fones quando 'ready', QR por id.
function apiFalsa({ sessoes = {}, lista = [], criar = 'novo-id', fones = {}, qr = null, servicoFora = false, lastError = 'motivo do serviço' } = {}) {
  const chamadas = []
  const roteiro = Object.fromEntries(Object.entries(sessoes).map(([id, estados]) => [id, [...estados]]))
  let nQr = 0
  const api = async (metodo, caminho, corpo) => {
    chamadas.push(`${metodo} ${caminho}`)
    if (servicoFora) return { ok: false, status: 0, dados: null }
    if (metodo === 'GET' && caminho === '/api/sessions') return { ok: true, status: 200, dados: lista }
    if (metodo === 'POST' && caminho === '/api/sessions') {
      roteiro[criar] ??= ['qr_ready', 'ready']
      return { ok: true, status: 201, dados: { id: criar, name: corpo.name } }
    }
    const m = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(caminho)
    const id = m[1]; const resto = m[2] || ''
    const fila = roteiro[id]
    if (!fila) return { ok: false, status: 404, dados: null }
    if (metodo === 'GET' && !resto) {
      const status = fila.length > 1 ? fila.shift() : fila[0]
      return { ok: true, status: 200, dados: { status, phone: status === 'ready' ? (fones[id] ?? null) : null, lastError } }
    }
    if (metodo === 'GET' && resto === '/qr') return { ok: true, status: 200, dados: { qrCode: qr ?? `codigo-${id}-${++nQr}` } }
    return { ok: true, status: 200, dados: {} } // start, logout
  }
  return { api, chamadas }
}

function montar({ ids = {}, donoAtual = null, ...opcoes } = {}) {
  const eventos = []; const gravados = {}; const estado = { dono: null }
  return {
    eventos, gravados, estado,
    opcoes: {
      ids: { ler: (p) => ids[p] ?? null, gravar: (p, id) => { gravados[p] = id } },
      dono: { ler: () => donoAtual, gravar: (n) => { estado.dono = n } },
      emitir: (e) => { eventos.push(e); todosEventos.push(e) },
      esperar: async () => {},
      agora: (() => { let t = 0; return () => (t += 3000) })(),
      qrImagem: async (c) => `data:image/png;base64,${Buffer.from(c).toString('base64')}`,
      prazoMs: 10 * 60_000,
      ...opcoes,
    },
  }
}

const tipos = (eventos) => eventos.map((e) => e.evento)

test('pessoal com id existente: QR em data URL, pareado com fone4 e dono gravado', async () => {
  const { api } = apiFalsa({ sessoes: { p1: ['initializing', 'qr_ready', 'qr_ready', 'ready'] }, fones: { p1: FONE_PESSOAL } })
  const m = montar({ ids: { pessoal: 'p1' } })
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.deepEqual(r, { ok: true, fone4: '1234' })
  assert.equal(m.eventos[0].evento, 'sessao')
  assert.equal(m.eventos[0].papel, 'pessoal')
  const qrs = m.eventos.filter((e) => e.evento === 'qr')
  assert.ok(qrs.length >= 1, 'pelo menos um QR')
  assert.ok(qrs.every((e) => e.qr.startsWith('data:image/png;base64,')))
  assert.deepEqual(m.eventos.find((e) => e.evento === 'pareado'), { evento: 'pareado', papel: 'pessoal', fone4: '1234' })
  assert.deepEqual(m.eventos.at(-1), { evento: 'fim', papel: 'pessoal', ok: true })
  assert.equal(m.estado.dono, FONE_PESSOAL)
})

test('pessoal com dono já gravado: não regrava', async () => {
  const { api } = apiFalsa({ sessoes: { p1: ['qr_ready', 'ready'] }, fones: { p1: FONE_PESSOAL } })
  const m = montar({ ids: { pessoal: 'p1' }, donoAtual: '5511000000000' })
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.equal(r.ok, true)
  assert.equal(m.estado.dono, null)
})

test('o mesmo QR lido duas vezes sai uma vez só', async () => {
  const { api } = apiFalsa({ sessoes: { p1: ['qr_ready', 'qr_ready', 'qr_ready', 'ready'] }, fones: { p1: FONE_PESSOAL }, qr: 'mesmo-codigo' })
  const m = montar({ ids: { pessoal: 'p1' } })
  await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.equal(m.eventos.filter((e) => e.evento === 'qr').length, 1)
})

test('bot sem id e sem omni-bot na lista: cria a sessão e grava o id', async () => {
  const { api, chamadas } = apiFalsa({
    sessoes: { p1: ['ready'] }, fones: { p1: FONE_PESSOAL, b9: FONE_BOT }, criar: 'b9',
  })
  const m = montar({ ids: { pessoal: 'p1' } })
  const r = await parearSessao({ api, papel: 'bot', ...m.opcoes })
  assert.deepEqual(r, { ok: true, fone4: '5678' })
  assert.ok(chamadas.includes('POST /api/sessions'))
  assert.equal(m.gravados.bot, 'b9')
})

test('bot sem id com omni-bot já na lista: reaproveita e não cria', async () => {
  const { api, chamadas } = apiFalsa({
    sessoes: { p1: ['ready'], b7: ['qr_ready', 'ready'] }, fones: { p1: FONE_PESSOAL, b7: FONE_BOT },
    lista: [{ id: 'x1', name: 'outra' }, { id: 'b7', name: 'omni-bot' }],
  })
  const m = montar({ ids: { pessoal: 'p1' } })
  const r = await parearSessao({ api, papel: 'bot', ...m.opcoes })
  assert.equal(r.ok, true)
  assert.ok(!chamadas.includes('POST /api/sessions'))
  assert.equal(m.gravados.bot, 'b7')
})

test('pessoal sem id: cria omni-pessoal e grava o id', async () => {
  const nomes = []
  const { api: base } = apiFalsa({ fones: { p5: FONE_PESSOAL }, criar: 'p5' })
  const api = async (metodo, caminho, corpo) => { if (metodo === 'POST' && caminho === '/api/sessions') nomes.push(corpo.name); return base(metodo, caminho, corpo) }
  const m = montar()
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.equal(r.ok, true)
  assert.deepEqual(nomes, ['omni-pessoal'])
  assert.equal(m.gravados.pessoal, 'p5')
})

test('id gravado de sessão que sumiu do serviço (404): cria outra e regrava o id', async () => {
  const { api, chamadas } = apiFalsa({ fones: { p8: FONE_PESSOAL }, criar: 'p8' })
  const m = montar({ ids: { pessoal: 'velho' } })
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.equal(r.ok, true)
  assert.ok(chamadas.includes('POST /api/sessions'))
  assert.equal(m.gravados.pessoal, 'p8')
})

test('bot com o pessoal sem id ou fora de ready: sem-pessoal, sem tocar no bot', async () => {
  for (const cenario of [{ ids: {} }, { ids: { pessoal: 'p1' } }]) {
    const { api, chamadas } = apiFalsa({ sessoes: { p1: ['disconnected'], b1: ['qr_ready', 'ready'] }, fones: { b1: FONE_BOT } })
    const m = montar({ ids: { ...cenario.ids, bot: 'b1' } })
    const r = await parearSessao({ api, papel: 'bot', ...m.opcoes })
    assert.deepEqual(r, { ok: false, motivo: 'sem-pessoal' })
    assert.ok(!chamadas.some((c) => c.includes('/b1')), `nenhuma chamada ao bot: ${chamadas.join(', ')}`)
    assert.deepEqual(m.eventos.at(-1), { evento: 'fim', papel: 'bot', ok: false, motivo: 'sem-pessoal' })
  }
})

test('bot pareado com o mesmo número do pessoal: mesmo-numero e logout do bot', async () => {
  const { api, chamadas } = apiFalsa({ sessoes: { p1: ['ready'], b1: ['qr_ready', 'ready'] }, fones: { p1: FONE_PESSOAL, b1: FONE_PESSOAL } })
  const m = montar({ ids: { pessoal: 'p1', bot: 'b1' } })
  const r = await parearSessao({ api, papel: 'bot', ...m.opcoes })
  assert.deepEqual(r, { ok: false, motivo: 'mesmo-numero' })
  assert.ok(chamadas.includes('POST /api/sessions/b1/logout'))
  assert.ok(!m.eventos.some((e) => e.evento === 'pareado'), 'número trocado não conta como pareado')
})

test('quedas: reinicia 3 vezes e na 4ª devolve caiu', async () => {
  const { api, chamadas } = apiFalsa({ sessoes: { p1: ['qr_ready', 'disconnected', 'failed', 'disconnected', 'disconnected'] } })
  const m = montar({ ids: { pessoal: 'p1' } })
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.deepEqual(r, { ok: false, motivo: 'caiu' })
  assert.equal(chamadas.filter((c) => c === 'POST /api/sessions/p1/start').length, 4, 'start inicial + 3 reinícios')
})

test('action_required: acao-necessaria com o detalhe do serviço cortado em 200', async () => {
  const longo = 'x'.repeat(500)
  const { api } = apiFalsa({ sessoes: { p1: ['qr_ready', 'action_required'] }, lastError: longo })
  const m = montar({ ids: { pessoal: 'p1' } })
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'acao-necessaria')
  const fim = m.eventos.at(-1)
  assert.equal(fim.motivo, 'acao-necessaria')
  assert.equal(fim.detalhe.length, 200)
})

test('detalhe do serviço com número de telefone sai mascarado', async () => {
  const { api } = apiFalsa({ sessoes: { p1: ['action_required'] }, lastError: `conflito com ${FONE_PESSOAL}@s.whatsapp.net` })
  const m = montar({ ids: { pessoal: 'p1' } })
  await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.ok(!/\d{8,}/.test(m.eventos.at(-1).detalhe), m.eventos.at(-1).detalhe)
})

test('prazo estourado sem ready: prazo', async () => {
  const { api } = apiFalsa({ sessoes: { p1: ['qr_ready'] } })
  const m = montar({ ids: { pessoal: 'p1' }, prazoMs: 30_000 })
  const r = await parearSessao({ api, papel: 'pessoal', ...m.opcoes })
  assert.deepEqual(r, { ok: false, motivo: 'prazo' })
})

test('serviço fora: servico-fora, sem exceção, inclusive quando a chamada lança', async () => {
  const { api } = apiFalsa({ servicoFora: true })
  const m = montar({ ids: { pessoal: 'p1' } })
  assert.deepEqual(await parearSessao({ api, papel: 'pessoal', ...m.opcoes }), { ok: false, motivo: 'servico-fora' })
  const lanca = async () => { throw new Error('ECONNREFUSED 127.0.0.1') }
  const m2 = montar({ ids: { pessoal: 'p1' } })
  assert.deepEqual(await parearSessao({ api: lanca, papel: 'pessoal', ...m2.opcoes }), { ok: false, motivo: 'servico-fora' })
  assert.deepEqual(m2.eventos.at(-1), { evento: 'fim', papel: 'pessoal', ok: false, motivo: 'servico-fora' })
})

test('varredura: nenhum evento de nenhum caso carrega 8 dígitos seguidos', () => {
  assert.ok(todosEventos.length > 20, `eventos varridos: ${todosEventos.length}`)
  const texto = JSON.stringify(todosEventos.map(({ qr, ...resto }) => resto))
  assert.ok(!/\d{8,}/.test(texto), texto.match(/\d{8,}/)?.[0])
})
