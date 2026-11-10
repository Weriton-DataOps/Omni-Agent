// Plano 4b, tarefa 3: a ilha sobe a casa (runtime/servir.mjs) com o Node do sistema e fala com ela
// por HTTP com um token que só o processo principal conhece.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { criarCasa } = require('../apps/omni-ilha/casa-servir.js')

const RAIZ = resolve(import.meta.dirname, '..')
const SONDA_BOA = JSON.stringify({ node: '24.1.0', electron: null })

function pastaTemporaria(t) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-ilha-casa-'))
  t.after(() => { try { rmSync(pasta, { recursive: true, force: true }) } catch { /* sobra temporária */ } })
  return pasta
}

// Filho falso: a sonda responde e fecha; o servir responde a 1ª linha e fica (ou fecha, se pedirem).
function spawnFalso({ sonda = SONDA_BOA, servir = (filho) => { filho.stdout.emit('data', Buffer.from('{"ok":true,"porta":1}\n')) } } = {}) {
  const chamadas = []
  function spawn(comando, args, opcoes) {
    const filho = new EventEmitter()
    filho.pid = 4242
    filho.exitCode = null
    filho.stdout = new EventEmitter()
    filho.stderr = new EventEmitter()
    const fechar = (codigo) => { if (filho.exitCode === null) { filho.exitCode = codigo; filho.emit('close', codigo, null) } }
    filho.stdin = Object.assign(new EventEmitter(), { end: () => setImmediate(() => fechar(0)) })
    filho.mortes = 0
    filho.kill = () => { filho.mortes += 1; fechar(null) }
    filho.fechar = fechar
    const sondando = args[0] === '-e'
    chamadas.push({ comando, args, opcoes, filho, sondando })
    setImmediate(() => {
      if (sondando) { filho.stdout.emit('data', Buffer.from(sonda)); fechar(0) } else servir(filho)
    })
    return filho
  }
  return { spawn, chamadas, servirs: () => chamadas.filter((c) => !c.sondando), sondas: () => chamadas.filter((c) => c.sondando) }
}

test('casa de verdade: o chamar sobe sozinho, a saúde volta 200, o estado não traz token e o parar sai 0', async (t) => {
  const pasta = pastaTemporaria(t)
  const env = { ...process.env, OMNI_NODE: process.execPath, OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), OMNI_CARTEIRO: 'seco' }
  delete env.OMNI_API_TOKEN
  const casa = criarCasa({ env, raiz: RAIZ })
  t.after(() => casa.parar())
  const saude = await casa.chamar('GET', '/v1/saude')
  assert.equal(saude.status, 200)
  assert.equal(saude.corpo.agente, 'omni')
  const estado = casa.estado()
  assert.ok(Number.isInteger(estado.porta) && estado.porta > 0)
  assert.ok(Number.isInteger(estado.pid))
  assert.equal(estado.erro, null)
  assert.deepEqual(Object.keys(estado).sort(), ['erro', 'pid', 'porta'])
  assert.equal((await casa.chamar('GET', '/v1/agentes')).corpo.ok, true)
  assert.equal((await casa.chamar('GET', '/v1/inexistente')).status, 404)
  assert.equal(await casa.parar(), 0)
  assert.equal(casa.estado().porta, null)
})

test('sonda que responde Electron: a casa não sobe e o chamar volta status 0', async () => {
  const f = spawnFalso({ sonda: JSON.stringify({ node: '20.18.1', electron: '33.4.11' }) })
  const casa = criarCasa({ spawn: f.spawn, env: { OMNI_NODE: 'C:\\falso\\electron.exe' }, raiz: RAIZ })
  const r = await casa.iniciar()
  assert.equal(r.ok, false)
  assert.match(r.erro, /Electron/)
  assert.match(r.erro, /a casa pede/)
  assert.equal(f.servirs().length, 0)
  const pedido = await casa.chamar('GET', '/v1/saude')
  assert.equal(pedido.status, 0)
  assert.equal(pedido.corpo.ok, false)
  assert.equal(f.sondas().length, 2, 'a sonda que falha é refeita no pedido seguinte')
})

test('1ª linha de recusa: iniciar devolve o erro do servir e a próxima chamada sobe de novo', async () => {
  const f = spawnFalso({
    servir: (filho) => { filho.stdout.emit('data', Buffer.from('{"ok":false,"erro":"omni.db indisponível"}\n')); filho.fechar(1) }
  })
  const casa = criarCasa({ spawn: f.spawn, env: {}, raiz: RAIZ })
  assert.deepEqual(await casa.iniciar(), { ok: false, erro: 'omni.db indisponível' })
  assert.equal(casa.estado().erro, 'omni.db indisponível')
  assert.deepEqual(await casa.iniciar(), { ok: false, erro: 'omni.db indisponível' })
  assert.equal(f.servirs().length, 2)
  assert.equal(f.sondas().length, 1, 'a sonda boa vale para a sessão')
})

test('iniciar é memoizado; a saída do servir limpa a memória e o seguinte sobe outro', async () => {
  const f = spawnFalso()
  const casa = criarCasa({ spawn: f.spawn, env: {}, raiz: RAIZ })
  const [a, b] = await Promise.all([casa.iniciar(), casa.iniciar()])
  assert.deepEqual(a, { ok: true, porta: 1 })
  assert.deepEqual(b, { ok: true, porta: 1 })
  assert.equal(f.servirs().length, 1)
  f.servirs()[0].filho.fechar(1)
  assert.match(casa.estado().erro, /saiu com 1/)
  assert.deepEqual(await casa.iniciar(), { ok: true, porta: 1 })
  assert.equal(f.servirs().length, 2)
})

test('servir que não responde no prazo é morto e vira erro', async () => {
  const f = spawnFalso({ servir: () => {} })
  const casa = criarCasa({ spawn: f.spawn, env: {}, raiz: RAIZ, limiteMs: 50 })
  const r = await casa.iniciar()
  assert.equal(r.ok, false)
  assert.match(r.erro, /não respondeu/)
  assert.equal(f.servirs()[0].filho.mortes, 1)
  assert.equal(casa.estado().porta, null)
})

test('o servir sobe sem ELECTRON_RUN_AS_NODE e com o token; a sonda leva a flag e não leva o token', async () => {
  const f = spawnFalso()
  const casa = criarCasa({ spawn: f.spawn, env: { ELECTRON_RUN_AS_NODE: '1', OMNI_API_TOKEN: 'velho', OUTRA: 'x' }, raiz: RAIZ })
  await casa.iniciar()
  const [sonda] = f.sondas()
  const [servir] = f.servirs()
  assert.equal(sonda.opcoes.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(sonda.opcoes.env.OMNI_API_TOKEN, undefined)
  assert.equal('ELECTRON_RUN_AS_NODE' in servir.opcoes.env, false)
  assert.match(servir.opcoes.env.OMNI_API_TOKEN, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(servir.opcoes.env.OMNI_API_TOKEN, 'velho')
  assert.equal(servir.opcoes.env.OUTRA, 'x')
  assert.equal(servir.comando, 'node')
  assert.deepEqual(servir.args, ['--disable-warning=ExperimentalWarning', join(RAIZ, 'runtime', 'servir.mjs'), '--porta', '0'])
  assert.deepEqual(servir.opcoes.stdio, ['pipe', 'pipe', 'pipe'])
  assert.equal(servir.opcoes.windowsHide, true)
  assert.equal(servir.opcoes.shell, false)
  assert.ok(!JSON.stringify(casa.estado()).includes(servir.opcoes.env.OMNI_API_TOKEN))
})
