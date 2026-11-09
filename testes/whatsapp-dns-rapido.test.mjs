// Pré-carregamento de DNS do serviço do WhatsApp (07/11/2026): com o DNS da VPN mudo, o Windows levava ~11 s
// para resolver mmg.whatsapp.net e o download de mídia desistia em 10 s. Aqui o lookup do sistema e o resolvedor
// público são falsos; nada sai para a rede.
import assert from 'node:assert/strict'
import dns from 'node:dns'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const MODULO = fileURLToPath(new URL('../servicos/whatsapp/omni/ipv4-primeiro.cjs', import.meta.url))

// Carrega o módulo sobre um lookup e um resolvedor falsos; devolve o lookup instalado e o que foi chamado.
function carregar({ sistema, publico }) {
  const lookupReal = dns.lookup
  const ResolverReal = dns.Resolver
  const chamadas = { sistema: [], publico: [], servidores: null }
  dns.lookup = (host, opcoes, cb) => { chamadas.sistema.push({ host, opcoes }); sistema(host, opcoes, cb) }
  dns.Resolver = class { setServers(s) { chamadas.servidores = s } resolve4(host, cb) { chamadas.publico.push(host); publico(host, cb) } }
  delete require.cache[MODULO]
  require(MODULO)
  const instalado = dns.lookup
  dns.lookup = lookupReal
  dns.Resolver = ResolverReal
  return { lookup: instalado, chamadas }
}

const depois = (ms, fn) => setTimeout(fn, ms)
const resolver = (lookup, host, opcoes) => new Promise(ok => {
  const t = Date.now()
  lookup(host, opcoes, (erro, ...resto) => ok({ erro, resto, ms: Date.now() - t }))
})

test('nome fora do WhatsApp segue o lookup do sistema com as opções intactas', async () => {
  const { lookup, chamadas } = carregar({ sistema: (h, o, cb) => cb(null, '10.0.0.1', 4), publico: () => assert.fail('não devia') })
  const r = await resolver(lookup, 'srv.gr.corp', { all: false })
  assert.equal(r.resto[0], '10.0.0.1')
  assert.deepEqual(chamadas.sistema[0].opcoes, { all: false })
  assert.equal(chamadas.publico.length, 0)
})

test('DNS do sistema rápido: vale a resposta dele, pedida só em IPv4, sem consultar o público', async () => {
  const { lookup, chamadas } = carregar({ sistema: (h, o, cb) => depois(5, () => cb(null, [{ address: '157.240.226.60', family: 4 }])), publico: () => assert.fail('não devia') })
  const r = await resolver(lookup, 'mmg.whatsapp.net', { all: true, hints: 0 })
  assert.deepEqual(r.resto[0], [{ address: '157.240.226.60', family: 4 }])
  assert.equal(chamadas.sistema[0].opcoes.family, 4)
  await new Promise(ok => depois(800, ok))
  assert.equal(chamadas.publico.length, 0, 'o público não pode ser consultado depois que o sistema respondeu')
})

test('DNS do sistema mudo (11 s): o público responde em menos de 2 s, no formato que o net espera', async () => {
  const { lookup, chamadas } = carregar({
    sistema: (h, o, cb) => depois(11_000, () => cb(null, [{ address: '1.1.1.1', family: 4 }])).unref(),
    publico: (h, cb) => depois(20, () => cb(null, ['57.144.171.32', '57.144.89.32'])),
  })
  const todos = await resolver(lookup, 'mmg.whatsapp.net', { all: true })
  assert.ok(todos.ms < 2000, `levou ${todos.ms} ms`)
  assert.deepEqual(todos.resto[0], [{ address: '57.144.171.32', family: 4 }, { address: '57.144.89.32', family: 4 }])
  assert.deepEqual(chamadas.servidores, ['1.1.1.1', '8.8.8.8'])
  const um = await resolver(lookup, 'media.fgru5-1.fna.whatsapp.net', {})
  assert.deepEqual(um.resto, ['57.144.171.32', 4])
})

test('família explícita (IPv6) é respeitada e não passa pelo atalho', async () => {
  const { lookup, chamadas } = carregar({ sistema: (h, o, cb) => cb(null, '2a03::167', 6), publico: () => assert.fail('não devia') })
  const r = await resolver(lookup, 'mmg.whatsapp.net', { family: 6 })
  assert.equal(r.resto[0], '2a03::167')
  assert.equal(chamadas.sistema[0].opcoes.family, 6)
})

test('sistema falha rápido: o público é consultado na hora; os dois falhando devolve erro uma vez só', async () => {
  const ok = carregar({ sistema: (h, o, cb) => cb(Object.assign(new Error('x'), { code: 'ETIMEOUT' })), publico: (h, cb) => cb(null, ['57.144.67.32']) })
  const r1 = await resolver(ok.lookup, 'mmg.whatsapp.net', {})
  assert.deepEqual(r1.resto, ['57.144.67.32', 4])

  let respostas = 0
  const ruim = carregar({ sistema: (h, o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), publico: (h, cb) => depois(5, () => cb(Object.assign(new Error('y'), { code: 'ENOTFOUND' }))) })
  const r2 = await new Promise(fim => ruim.lookup('nao-existe.whatsapp.net', {}, (erro) => { respostas++; fim({ erro }) }))
  assert.equal(r2.erro.code, 'ENOTFOUND')
  await new Promise(fim => depois(50, fim))
  assert.equal(respostas, 1)
})
