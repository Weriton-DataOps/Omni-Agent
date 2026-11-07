// A mão do cofre na ilha (F1, plano 5, T5). As nove primeiras provas usam um spawn falso: nenhum
// processo nasce, nenhum Node é procurado, nenhum valor real passa. A décima roda a CLI de verdade
// numa casa temporária, com o Node desta suíte no OMNI_NODE, e só com nomes que não existem.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { criarMaoCofre, versaoServe, LIMITES } = require('../apps/omni-ilha/cofre.js')

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(RAIZ, 'runtime', 'cofre.mjs')
const AVISO = '--disable-warning=ExperimentalWarning'
const proximo = () => new Promise((r) => setImmediate(r))
const zerado = (b) => b.every((x) => x === 0)

// Os fluxos são EventEmitters puros: o pedaço que a prova emite é o mesmo objeto que a mão recebe.
function filhoFalso(stdio) {
  const filho = new EventEmitter()
  filho.mortes = 0
  filho.fechado = false
  filho.stdin = stdio[0] === 'pipe'
    ? Object.assign(new EventEmitter(), { pedacos: [], end(b) { this.pedacos.push(b); this.recebido = Buffer.from(b) } })
    : null
  filho.stdout = new EventEmitter()
  filho.stderr = new EventEmitter()
  filho.stdio = [filho.stdin, filho.stdout, filho.stderr]
  if (stdio[3] === 'pipe') filho.stdio.push(new EventEmitter())
  filho.kill = () => {
    filho.mortes += 1
    if (!filho.fechado) { filho.fechado = true; setImmediate(() => filho.emit('close', null, 'SIGTERM')) }
    return true
  }
  return filho
}

async function responder(filho, { saida, erro, canal = [], codigo = 0 } = {}) {
  if (saida !== undefined) filho.stdout.emit('data', Buffer.from(saida))
  if (erro !== undefined) filho.stderr.emit('data', Buffer.from(erro))
  for (const pedaco of canal) {
    if (filho.stdio[3]) filho.stdio[3].emit('data', pedaco)
    await proximo()
  }
  setImmediate(() => { if (!filho.fechado) { filho.fechado = true; filho.emit('close', codigo, null) } })
}

const SONDA_BOA = { saida: JSON.stringify({ node: '22.13.0', electron: null }) }

function spawnFalso({ cli = (c) => responder(c.filho, { saida: '[]' }), sonda = (c) => responder(c.filho, SONDA_BOA) } = {}) {
  const chamadas = []
  function spawn(comando, args, opcoes) {
    const filho = filhoFalso(opcoes.stdio)
    const chamada = { comando, args, opcoes, filho }
    chamadas.push(chamada)
    setImmediate(() => (args[0] === '-e' ? sonda : cli)(chamada))
    return filho
  }
  return { spawn, chamadas, cli: () => chamadas.filter((c) => c.args[0] !== '-e'), sondas: () => chamadas.filter((c) => c.args[0] === '-e') }
}

function aUnicaChamada(f) {
  assert.equal(f.cli().length, 1, 'a CLI devia ter sido chamada uma vez')
  return f.cli()[0]
}

test('o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron', async () => {
  const f = spawnFalso()
  const mao = criarMaoCofre({ spawn: f.spawn, env: { OMNI_NODE: 'C:/falso/node.exe', ELECTRON_RUN_AS_NODE: '1', OUTRA: 'x' } })
  assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
  assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
  assert.equal(f.sondas().length, 1)
  const [sonda] = f.sondas()
  assert.equal(sonda.comando, 'C:/falso/node.exe')
  assert.equal(sonda.args[0], '-e')
  assert.equal(sonda.opcoes.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(sonda.opcoes.env.OUTRA, 'x')
  assert.equal(f.cli().length, 2)
  for (const c of f.cli()) {
    assert.equal(c.comando, 'C:/falso/node.exe')
    assert.deepEqual(c.args, [AVISO, CLI, 'listar'])
    assert.equal('ELECTRON_RUN_AS_NODE' in c.opcoes.env, false)
    assert.equal(c.opcoes.env.OUTRA, 'x')
    assert.deepEqual(c.opcoes.stdio, ['ignore', 'pipe', 'pipe'])
    assert.equal(c.opcoes.windowsHide, true)
    assert.equal(c.opcoes.shell, false)
  }
  const g = spawnFalso()
  assert.deepEqual(await criarMaoCofre({ spawn: g.spawn, env: {} }).listar(), { ok: true, dados: [] })
  assert.deepEqual(g.chamadas.map((c) => c.comando), ['node', 'node'])
})

test('a sonda recusa o Node antigo e o Electron, sem chamar a CLI', async () => {
  for (const v of ['22.13.0', '22.23.4', '23.0.0', '24.11.1']) assert.equal(versaoServe(v), true, v)
  for (const v of ['22.12.9', '20.18.1', '21.99.0', '22.13', 'v22.13.0']) assert.equal(versaoServe(v), false, v)
  const casos = [
    [{ node: '20.18.1', electron: '33.2.0' }, 'o OMNI_NODE é um Electron; o cofre pede o Node do sistema, 22.13 ou mais novo'],
    [{ node: '22.12.0', electron: null }, 'o cofre pede o Node 22.13 ou mais novo; o OMNI_NODE é o 22.12.0'],
  ]
  for (const [versoes, erro] of casos) {
    const f = spawnFalso({ sonda: (c) => responder(c.filho, { saida: JSON.stringify(versoes) }) })
    const mao = criarMaoCofre({ spawn: f.spawn, env: { OMNI_NODE: 'C:/falso/node.exe' } })
    assert.deepEqual(await mao.listar(), { ok: false, codigo: 'sem-node', erro })
    assert.equal(f.cli().length, 0)
  }
})

test('a sonda que falha não fica guardada, e cada falha tem a sua mensagem', async () => {
  let vez = 0
  const f = spawnFalso({
    sonda: (c) => {
      vez += 1
      if (vez === 1) c.filho.emit('error', Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }))
      else responder(c.filho, SONDA_BOA)
    },
  })
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  assert.deepEqual(await mao.listar(), { ok: false, codigo: 'sem-node', erro: 'não achei o Node do sistema (o node do PATH)' })
  assert.equal(f.cli().length, 0)
  assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
  assert.equal(f.sondas().length, 2)

  const lanca = criarMaoCofre({ spawn: () => { throw new Error('EINVAL') }, env: {} })
  assert.deepEqual(await lanca.listar(), { ok: false, codigo: 'sem-node', erro: 'não achei o Node do sistema (o node do PATH)' })

  const saiu = spawnFalso({ sonda: (c) => responder(c.filho, { codigo: 1 }) })
  assert.deepEqual(await criarMaoCofre({ spawn: saiu.spawn, env: {} }).listar(), { ok: false, codigo: 'sem-node', erro: 'o Node do sistema não respondeu à sonda (o node do PATH)' })

  const ilegivel = spawnFalso({ sonda: (c) => responder(c.filho, { saida: 'nada' }) })
  assert.deepEqual(await criarMaoCofre({ spawn: ilegivel.spawn, env: {} }).listar(), { ok: false, codigo: 'sem-node', erro: 'a sonda do Node respondeu algo ilegível' })
})

test('cada saída da CLI vira a resposta certa', async () => {
  const ILEGIVEL = { ok: false, codigo: 'ilegivel', erro: 'a resposta do cofre veio ilegível' }
  const casos = [
    [{ saida: '[{"nome":"a"}]', codigo: 0 }, { ok: true, dados: [{ nome: 'a' }] }],
    [{ saida: JSON.stringify({ ok: false, codigo: 'inexistente', erro: 'Não há credencial com o nome a.' }), codigo: 3 }, { ok: false, codigo: 'inexistente', erro: 'Não há credencial com o nome a.' }],
    [{ saida: '{"ok":true}', codigo: 3 }, ILEGIVEL],
    [{ erro: 'falta --nome\nUSO: ...', codigo: 2 }, { ok: false, codigo: 'uso', erro: 'falta --nome' }],
    [{ erro: 'falha inesperada no cofre: disco\n    at x', codigo: 1 }, { ok: false, codigo: 'falha', erro: 'falha inesperada no cofre: disco' }],
    [{ saida: 'não é json', codigo: 0 }, ILEGIVEL],
    [{ saida: '', codigo: 0 }, ILEGIVEL],
    [{ codigo: 7 }, { ok: false, codigo: 'falha', erro: 'o cofre saiu com 7' }],
  ]
  for (const [roteiro, esperado] of casos) {
    const f = spawnFalso({ cli: (c) => responder(c.filho, roteiro) })
    assert.deepEqual(await criarMaoCofre({ spawn: f.spawn, env: {} }).listar(), esperado, JSON.stringify(roteiro))
  }
})

test('cada pedido tem o seu limite de tempo e mata o processo quando passa', async (t) => {
  assert.deepEqual(LIMITES, { curto: 15000, medio: 30000, longo: 90000 })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = spawnFalso({ cli: () => { /* nunca responde */ } })
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  const casos = [
    [() => mao.listar(), 15000],
    [() => mao.testar('a'), 30000],
    [() => mao.saude({ duplicatas: true }), 30000],
    [() => mao.revelar('a'), 90000],
    [() => mao.copiar('a'), 90000],
  ]
  for (const [pedir, limite] of casos) {
    const antes = f.cli().length
    const resposta = pedir()
    for (let i = 0; i < 50 && f.cli().length === antes; i += 1) await proximo()
    const chamada = f.cli()[antes]
    assert.ok(chamada, 'a CLI não foi chamada')
    t.mock.timers.tick(limite - 1)
    assert.equal(chamada.filho.mortes, 0)
    t.mock.timers.tick(1)
    assert.equal(chamada.filho.mortes, 1)
    assert.deepEqual(await resposta, { ok: false, codigo: 'tempo', erro: `o cofre não respondeu em ${limite / 1000} s` })
  }
})

test('cada função monta os seus argumentos e o seu stdio', async () => {
  const f = spawnFalso()
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  const SO_SAIDA = ['ignore', 'pipe', 'pipe']
  const COM_ENTRADA = ['pipe', 'pipe', 'pipe']
  await mao.listar()
  await mao.lixeira()
  await mao.esvaziarLixeira()
  await mao.saude()
  await mao.saude({ duplicatas: true })
  await mao.historico({ nome: '-x', limite: 5 })
  await mao.historico({ id: 'id-1' })
  await mao.testar('a')
  await mao.cadastrar({ nome: 'n', tipo: 'token', servico: 's', url: 'https://exemplo.invalid', usuario: 'u', notas: '--y', agentes: ['omni', 'oraculo'] }, Buffer.from('v'))
  await mao.cadastrar({ nome: 'm', tipo: 'senha', agentes: [] }, Buffer.from('v'))
  await mao.editar('n', { notas: 'x', agentes: ['omni'] })
  await mao.rotacionar('n', Buffer.from('v'))
  await mao.apagar('n')
  await mao.restaurar('id-1')
  await mao.revelar('n')
  await mao.copiar('n')
  for (const c of f.cli()) assert.deepEqual(c.args.slice(0, 2), [AVISO, CLI])
  assert.deepEqual(f.cli().map((c) => [c.args.slice(2), c.opcoes.stdio]), [
    [['listar'], SO_SAIDA],
    [['lixeira'], SO_SAIDA],
    [['esvaziar-lixeira'], SO_SAIDA],
    [['saude'], SO_SAIDA],
    [['saude', '--duplicatas'], SO_SAIDA],
    [['historico', '--nome=-x', '--limite=5'], SO_SAIDA],
    [['historico', '--id=id-1'], SO_SAIDA],
    [['testar', '--nome=a'], SO_SAIDA],
    [['cadastrar', '--nome=n', '--tipo=token', '--servico=s', '--url=https://exemplo.invalid', '--usuario=u', '--notas=--y', '--agentes=omni,oraculo'], COM_ENTRADA],
    [['cadastrar', '--nome=m', '--tipo=senha', '--agentes='], COM_ENTRADA],
    [['editar', '--nome=n', '--mudancas={"notas":"x","agentes":["omni"]}'], SO_SAIDA],
    [['rotacionar', '--nome=n'], COM_ENTRADA],
    [['apagar', '--nome=n'], SO_SAIDA],
    [['restaurar', '--id=id-1'], SO_SAIDA],
    [['revelar', '--nome=n'], ['ignore', 'pipe', 'pipe', 'pipe']],
    [['copiar', '--nome=n'], SO_SAIDA],
  ])
})

test('cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers', async () => {
  const f = spawnFalso({ cli: (c) => responder(c.filho, { saida: '{"ok":true}' }) })
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  const pedidos = [
    (valor) => mao.cadastrar({ nome: 'n', tipo: 'token' }, valor),
    (valor) => mao.rotacionar('n', valor),
  ]
  for (const pedir of pedidos) {
    const valor = Buffer.from('segredo-falso')
    assert.deepEqual(await pedir(valor), { ok: true, dados: { ok: true } })
    const c = f.cli().at(-1)
    assert.deepEqual(c.filho.stdin.recebido, Buffer.from('segredo-falso\n'))
    assert.equal(c.args.some((a) => a.includes('segredo-falso')), false)
    assert.ok(zerado(valor), 'o Buffer de quem chamou ficou com o valor')
    assert.equal(c.filho.stdin.pedacos.length, 1)
    assert.ok(zerado(c.filho.stdin.pedacos[0]), 'a cópia com a quebra de linha ficou com o valor')
  }
  const antes = f.chamadas.length
  const USO = { ok: false, codigo: 'uso', erro: 'o valor precisa chegar num Buffer de uma linha, não vazio' }
  for (const valor of [Buffer.alloc(0), Buffer.from('a\nb'), Buffer.from('a\rb'), 'texto', undefined]) {
    assert.deepEqual(await mao.cadastrar({ nome: 'n', tipo: 'token' }, valor), USO)
    if (Buffer.isBuffer(valor)) assert.ok(zerado(valor))
  }
  const rotacao = Buffer.from('a\nb')
  assert.deepEqual(await mao.rotacionar('n', rotacao), USO)
  assert.ok(zerado(rotacao))
  assert.equal(f.chamadas.length, antes)
})

test('o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados', async () => {
  const p1 = Buffer.from('valor-')
  const p2 = Buffer.from('falso')
  const f = spawnFalso({ cli: (c) => responder(c.filho, { saida: JSON.stringify({ ok: true, nome: 'x', usoId: 'u1' }), canal: [p1, p2] }) })
  const res = await criarMaoCofre({ spawn: f.spawn, env: {} }).revelar('x')
  assert.deepEqual(aUnicaChamada(f).opcoes.stdio, ['ignore', 'pipe', 'pipe', 'pipe'])
  const { valor, ...resto } = res
  assert.deepEqual(valor, Buffer.from('valor-falso'))
  assert.deepEqual(resto, { ok: true, dados: { ok: true, nome: 'x', usoId: 'u1' } })
  assert.ok(zerado(p1) && zerado(p2), 'os pedaços do fd 3 ficaram com o valor')

  const p3 = Buffer.from('nao-devia')
  const recusa = { ok: false, codigo: 'inexistente', erro: 'Não há credencial com o nome x.' }
  const g = spawnFalso({ cli: (c) => responder(c.filho, { saida: JSON.stringify(recusa), canal: [p3], codigo: 3 }) })
  assert.deepEqual(await criarMaoCofre({ spawn: g.spawn, env: {} }).revelar('x'), recusa)
  assert.ok(zerado(p3))
})

test('os tetos de stdout, do fd 3 e do stderr', async () => {
  // Confere o código e a ausência do valor antes do deepEqual: o diff de um Buffer de 1 MB esgota a memória.
  const TETO = { ok: false, codigo: 'teto', erro: 'a resposta do cofre passou do tamanho esperado' }
  const f = spawnFalso({ cli: (c) => responder(c.filho, { saida: 'x'.repeat(1024 * 1024 + 1) }) })
  const saida = await criarMaoCofre({ spawn: f.spawn, env: {} }).listar()
  assert.equal(saida.codigo, 'teto')
  assert.deepEqual(saida, TETO)
  assert.equal(aUnicaChamada(f).filho.mortes, 1)

  const grande = Buffer.alloc(1024 * 1024 + 1, 0x61)
  const g = spawnFalso({ cli: (c) => responder(c.filho, { saida: '{"ok":true}', canal: [grande] }) })
  const revelado = await criarMaoCofre({ spawn: g.spawn, env: {} }).revelar('x')
  assert.equal(revelado.codigo, 'teto')
  assert.equal('valor' in revelado, false)
  assert.deepEqual(revelado, TETO)
  assert.equal(aUnicaChamada(g).filho.mortes, 1)
  assert.ok(zerado(grande))

  const h = spawnFalso({ cli: (c) => responder(c.filho, { erro: 'e'.repeat(20000), codigo: 1 }) })
  const erro = await criarMaoCofre({ spawn: h.spawn, env: {} }).listar()
  assert.equal(erro.erro.length, 300)
  assert.deepEqual(erro, { ok: false, codigo: 'falha', erro: 'e'.repeat(300) })
  assert.equal(aUnicaChamada(h).filho.mortes, 0)
})

test('a CLI de verdade, numa casa temporária, responde pela mão', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'omni-ilha-cofre-'))
  try {
    const mao = criarMaoCofre({ env: { ...process.env, OMNI_NODE: process.execPath, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') } })
    assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
    assert.deepEqual(await mao.lixeira(), { ok: true, dados: [] })
    const saude = await mao.saude()
    assert.equal(saude.ok, true)
    assert.equal(saude.dados.total, 0)
    const revelado = await mao.revelar('nao-existe')
    assert.equal(revelado.codigo, 'inexistente')
    assert.equal('valor' in revelado, false)
    assert.equal((await mao.historico({ nome: '-x' })).codigo, 'inexistente')
    assert.equal((await mao.editar('nao-existe', { notas: 'com "aspas" e espaço' })).codigo, 'inexistente')
    assert.deepEqual(await mao.historico({}), { ok: false, codigo: 'uso', erro: 'use --id ou --nome, um dos dois' })
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
})
