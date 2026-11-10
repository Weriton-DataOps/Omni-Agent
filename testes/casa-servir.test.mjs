import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { PassThrough } from 'node:stream'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { garantirTokensDoAgente } from '../runtime/casa/credenciais-agente.mjs'
import { registrarAgente } from '../runtime/casa/loja-nucleo.mjs'
import { arquivoServir } from '../runtime/maos-actions.mjs'
import { criarGravadorDePedidos, rodarServir } from '../runtime/servir.mjs'
import { ate, chamar } from './fixtures/chamar-api.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const SERVIR = join(RAIZ, 'runtime', 'servir.mjs')
const TOKEN = 'token-de-teste-servir'
const VERSAO = JSON.parse(readFileSync(join(RAIZ, '.claude-plugin', 'plugin.json'), 'utf8')).version

function pastaTemporaria(t) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-servir-'))
  t.after(() => { try { rmSync(pasta, { recursive: true, force: true }) } catch { /* sobra temporária */ } })
  return { pasta, env: { ...process.env, OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), OMNI_API_TOKEN: TOKEN } }
}

function subirServir(t, env, args = ['--porta', '0']) {
  const filho = spawn(process.execPath, [SERVIR, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let saida = ''
  let erros = ''
  filho.stdout.setEncoding('utf8').on('data', (p) => { saida += p })
  filho.stderr.setEncoding('utf8').on('data', (p) => { erros += p })
  const fim = new Promise((resolver) => filho.on('close', (codigo) => resolver(codigo)))
  t.after(async () => {
    if (filho.exitCode === null) filho.stdin.end()
    const prazo = setTimeout(() => filho.kill(), 5_000)
    await fim
    clearTimeout(prazo)
  })
  const primeira = async () => {
    await ate(() => saida.includes('\n'), 10_000)
    return JSON.parse(saida.slice(0, saida.indexOf('\n')))
  }
  return { filho, fim, primeira, erros: () => erros }
}

test('sobe, anuncia a porta só na 1ª linha, serve a saúde e sai 0 quando o stdin fecha', async (t) => {
  const { pasta, env } = pastaTemporaria(t)
  const s = subirServir(t, env)
  const linha = await s.primeira()
  assert.equal(linha.ok, true)
  assert.ok(Number.isInteger(linha.porta) && linha.porta > 0)
  const saude = await chamar(linha.porta, 'GET', '/v1/saude', { token: TOKEN })
  assert.equal(saude.status, 200)
  assert.equal(saude.corpo.versao, VERSAO)
  assert.deepEqual(saude.corpo.agentes, [])
  assert.equal((await chamar(linha.porta, 'GET', '/v1/saude')).status, 401)
  // Sem agente nenhum, o servir.json já existe: as mãos sabem que o servir está de pé.
  const arquivo = arquivoServir(pasta, env)
  assert.ok(existsSync(arquivo), 'o servir.json nasce junto com a API')
  assert.deepEqual(JSON.parse(readFileSync(arquivo, 'utf8')), { pid: s.filho.pid, porta: linha.porta, agentes: [] })
  s.filho.stdin.end()
  assert.equal(await s.fim, 0)
  assert.match(s.erros(), /stdin fechou/)
  assert.equal(existsSync(arquivo), false)
})

test('--porta inválida sai 2 com a linha de erro', async (t) => {
  const { env } = pastaTemporaria(t)
  for (const args of [['--porta', 'abc'], ['--porta', '70000'], [], ['--porta', '0', '--outra', 'x']]) {
    const s = subirServir(t, env, args)
    assert.equal(await s.fim, 2, args.join(' '))
    assert.equal((await s.primeira()).ok, false)
  }
})

test('token fora do formato sai 2', async (t) => {
  const { env } = pastaTemporaria(t)
  const s = subirServir(t, { ...env, OMNI_API_TOKEN: 'com espaço' })
  assert.equal(await s.fim, 2)
})

test('porta ocupada sai 1 com recusa:true', async (t) => {
  const { env } = pastaTemporaria(t)
  const ocupante = createServer()
  await new Promise((resolver) => ocupante.listen(0, '127.0.0.1', resolver))
  t.after(() => new Promise((resolver) => ocupante.close(resolver)))
  const s = subirServir(t, env, ['--porta', String(ocupante.address().port)])
  assert.equal(await s.fim, 1)
  const linha = await s.primeira()
  assert.equal(linha.ok, false)
  assert.equal(linha.recusa, true)
})

test('supervisiona o agente do nucleo.db e o agente toca a campainha pela API', async (t) => {
  const { pasta, env } = pastaTemporaria(t)
  const manifesto = {
    agente: 'falso', versao: '0.0.1', banco: null, requer: { node: '>=24' },
    executor: { comando: 'node testes/fixtures/agente-falso.mjs', modos: ['servir'] }, tarefas: [], credenciais: []
  }
  comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, JSON.stringify(manifesto), { raiz: RAIZ }), env)
  const execucao = '20261109-120000-abcd'
  const s = subirServir(t, { ...env, AGENTE_FALSO_MODO: 'no-ar', AGENTE_FALSO_CAMPAINHA: execucao })
  const { porta } = await s.primeira()
  let agentes = []
  await ate(async () => {
    agentes = (await chamar(porta, 'GET', '/v1/saude', { token: TOKEN })).corpo.agentes
    return agentes[0]?.estado === 'no-ar'
  }, 15_000)
  assert.equal(agentes[0].agente, 'falso')
  const lista = await chamar(porta, 'GET', '/v1/despachos', { token: TOKEN })
  assert.deepEqual(lista.corpo.despachos.map((d) => d.id), [`falso/${execucao}`])
  assert.match(s.erros(), /falso: campainha 202/)
  s.filho.stdin.end()
  assert.equal(await s.fim, 0)
})

// --- T9: o servir liga o chamar, o carteiro e o servir.json (no mesmo processo, ponte falsa) ---

const EXECUCAO = '20261109-120000-abcd'
const sha = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')

function ponteFalsa() {
  const prefixo = Buffer.from('FALSO:')
  const xor = (bytes) => { const s = Buffer.from(bytes); for (let i = 0; i < s.length; i++) s[i] ^= 0x5a; return s }
  return {
    selar: (valores) => valores.map((v) => Buffer.concat([prefixo, xor(v)])),
    abrir: (blobs) => blobs.map((b) => ({ ok: true, valor: xor(Buffer.from(b).subarray(prefixo.length)) }))
  }
}

const ROTAS_ACTIONS = [
  { metodo: 'GET', padrao: '^/v1/actions/execucoes$', escopo: 'qualquer' },
  { metodo: 'POST', padrao: '^/v1/actions/execucoes$', escopo: 'tela' },
  { metodo: 'GET', padrao: '^/v1/actions/execucoes/[A-Za-z0-9-]+$', escopo: 'qualquer' },
  { metodo: 'POST', padrao: '^/v1/actions/execucoes/[A-Za-z0-9-]+/assumir$', escopo: 'visita' },
  { metodo: 'POST', padrao: '^/v1/actions/execucoes/[A-Za-z0-9-]+/estado$', escopo: 'qualquer' },
  { metodo: 'GET', padrao: '^/v1/actions/mesa$', escopo: 'qualquer' }
]

async function servirComActions(t, extra = {}) {
  const { pasta, env } = pastaTemporaria(t)
  const http = join(pasta, 'http.jsonl')
  const ponte = ponteFalsa()
  const manifesto = {
    agente: 'falso', versao: '0.0.1', banco: null, requer: { node: '>=24' },
    executor: { comando: 'node testes/fixtures/agente-falso.mjs', modos: ['servir'] }, tarefas: [], credenciais: [],
    interface: { modulo: 'tela.html', api: 'http://127.0.0.1:{porta}/v1', rotas: ROTAS_ACTIONS }
  }
  comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, JSON.stringify(manifesto), { raiz: RAIZ }), env)
  const shas = comBancoDaCasa(pasta, 'cofre', (db) => garantirTokensDoAgente(db, ponte, 'falso'), env)
  const ambiente = { ...env, OMNI_CARTEIRO: 'seco', AGENTE_FALSO_MODO: 'actions', AGENTE_FALSO_HTTP: http, ...extra }
  const entrada = new PassThrough()
  let saida = ''
  let erros = ''
  const coletor = (anexar) => ({ write: (p) => { anexar(String(p)); return true } })
  // A mesa do falso tem raiz no cwd dele (RAIZ): a sessão aberta ali é o destino do Actions.
  const sessoes = () => [{ nome: 'sessao-do-teste', cwd: RAIZ, status: 'idle', startedAt: 1 }]
  const fim = rodarServir(['--porta', '0'], {
    env: ambiente, saida: coletor((p) => { saida += p }), erro: coletor((p) => { erros += p }), entrada, ponte, sessoes
  })
  t.after(async () => { entrada.end(); await fim })
  await ate(() => saida.includes('\n'), 10_000)
  const { porta } = JSON.parse(saida.slice(0, saida.indexOf('\n')))
  await ate(async () => (await chamar(porta, 'GET', '/v1/saude', { token: TOKEN })).corpo.agentes[0]?.estado === 'no-ar', 15_000)
  const anotado = () => (existsSync(http) ? readFileSync(http, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const usos = (motivo) => comBancoDaCasa(pasta, 'cofre', (db) => db.prepare('SELECT COUNT(*) AS n FROM usos WHERE motivo = ?').get(motivo).n, env)
  const parar = async () => { entrada.end(); return fim }
  return { pasta, env: ambiente, porta, shas, anotado, usos, parar, erros: () => erros }
}

test('o agente sobe com o token dos agentes: a saúde abre, o chamar dá 403; o servir.json mostra a porta e some ao sair', async (t) => {
  const c = await servirComActions(t)
  const inicio = c.anotado().find((l) => l.inicio)?.inicio
  assert.ok(inicio, 'o falso anotou o que o token dele alcança')
  assert.notEqual(inicio.token, sha(TOKEN), 'o agente não recebe o token da ilha')
  assert.equal(inicio.saude, 200)
  assert.equal(inicio.chamar, 403)

  const arquivo = arquivoServir(c.pasta, c.env)
  const servir = JSON.parse(readFileSync(arquivo, 'utf8'))
  assert.equal(servir.pid, process.pid)
  assert.equal(servir.porta, c.porta)
  const saude = await chamar(c.porta, 'GET', '/v1/saude', { token: TOKEN })
  assert.deepEqual(servir.agentes, [{ agente: 'falso', porta: saude.corpo.agentes[0].porta }])
  assert.ok(!readFileSync(arquivo, 'utf8').includes(TOKEN), 'sem token no servir.json')

  assert.equal(await c.parar(), 0)
  assert.equal(existsSync(arquivo), false, 'o servir.json some ao sair')
})

test('a ilha lê a fila pelo chamar com o token tela, aberto do cofre uma vez só', async (t) => {
  const c = await servirComActions(t)
  for (let i = 0; i < 2; i++) {
    const r = await chamar(c.porta, 'POST', '/v1/agentes/falso/chamar', { token: TOKEN, corpo: { metodo: 'GET', rota: '/v1/actions/execucoes' } })
    assert.equal(r.status, 200)
    assert.deepEqual(r.corpo, { status: 200, corpo: { execucoes: [] } })
  }
  const lidas = c.anotado().filter((l) => l.metodo === 'GET' && l.rota === '/v1/actions/execucoes')
  assert.equal(lidas.length, 2)
  assert.deepEqual(lidas.map((l) => l.token), [c.shas.tela, c.shas.tela])
  assert.equal(c.usos('chamar do servir (tela)'), 1, 'o token tela sai do cofre uma vez e fica na memória')
})

test('a campainha faz o carteiro assumir com o token visita e gravar o pedido; no modo seco não entrega e o recibo fica assumido', async (t) => {
  const c = await servirComActions(t)
  const criada = await chamar(c.porta, 'POST', '/v1/agentes/falso/chamar', { token: TOKEN, corpo: { metodo: 'POST', rota: '/v1/actions/execucoes', corpo: { instrucao: 'arrumar a gaveta' } } })
  assert.equal(criada.corpo.status, 200)
  let recibos = []
  await ate(async () => {
    recibos = (await chamar(c.porta, 'GET', '/v1/despachos?estado=assumido', { token: TOKEN })).corpo.despachos
    return recibos.length === 1
  }, 15_000)
  assert.equal(recibos[0].id, `falso/${EXECUCAO}`)
  assert.equal(c.anotado().find((l) => 'campainha' in l)?.campainha, 202)

  const assumir = c.anotado().find((l) => l.rota === `/v1/actions/execucoes/${EXECUCAO}/assumir`)
  assert.equal(assumir?.token, c.shas.visita, 'o carteiro assume com o token visita')
  const pedidos = join(c.pasta, 'actions', 'pedidos')
  assert.ok(existsSync(pedidos), 'os pedidos moram em <OMNI_HOME>/actions/pedidos')
  const arquivos = readdirSync(pedidos)
  assert.equal(arquivos.length, 1)
  const texto = readFileSync(join(pedidos, arquivos[0]), 'utf8')
  assert.match(texto, /arrumar a gaveta/)
  assert.ok(texto.includes(join(RAIZ, 'runtime', 'maos-actions.mjs')), 'o pedido manda devolver pelas mãos do Omni')
  assert.match(c.erros(), /seco/, 'o modo seco se anuncia no log')
  const ex = await chamar(c.porta, 'POST', '/v1/agentes/falso/chamar', { token: TOKEN, corpo: { metodo: 'GET', rota: `/v1/actions/execucoes/${EXECUCAO}` } })
  assert.equal(ex.corpo.corpo.estado, 'enviada')
  assert.equal(ex.corpo.corpo.destino.nome, 'sessao-do-teste')
})

test('agente que entra no ar com fila parada: o carteiro assume sem campainha e sem esperar a varredura', async (t) => {
  const parada = '20261109-080000-fila'
  const c = await servirComActions(t, { AGENTE_FALSO_FILA: parada })
  let recibos = []
  await ate(async () => {
    recibos = (await chamar(c.porta, 'GET', '/v1/despachos?estado=assumido', { token: TOKEN })).corpo.despachos
    return recibos.length === 1
  }, 15_000)
  assert.equal(recibos[0].id, `falso/${parada}`)
  assert.equal(c.anotado().some((l) => 'campainha' in l), false)
})

test('o pedido vira arquivo só com id que não sai da pasta', async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-pedidos-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  const gravar = criarGravadorDePedidos(join(pasta, 'pedidos'))
  const arquivo = await gravar('20261109-120000-abcd', 'texto', 2)
  assert.equal(arquivo, join(pasta, 'pedidos', '20261109-120000-abcd-2.md'))
  assert.equal(readFileSync(arquivo, 'utf8'), 'texto')
  for (const id of ['../fora', 'a/b', 'a\\b', 'c:x', '.oculto', 'a..b']) {
    await assert.rejects(gravar(id, 'x', 0), /fora do formato/, id)
  }
  assert.deepEqual(readdirSync(join(pasta, 'pedidos')), ['20261109-120000-abcd-2.md'])
})
