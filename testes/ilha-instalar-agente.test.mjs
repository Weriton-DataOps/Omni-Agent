// O botão INSTALAR do card apagado (F2, plano 5c, T5). Spawn falso: nenhum processo nasce, nenhum
// agente é instalado de verdade. A pasta do agente é temporária e só tem o executor/agente.json.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { instalarAgente } = require('../apps/omni-ilha/instalar-agente.js')

const RAIZ_OMNI = 'C:\\omni\\versoes\\abc'
const EXECUTOR = join(RAIZ_OMNI, 'runtime', 'executor.mjs')
const TAREFAS = join(RAIZ_OMNI, 'scripts', 'omni-tarefas.ps1')

function pastaDoAgente(t, manifesto) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-ilha-instalar-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  if (manifesto !== undefined) {
    mkdirSync(join(pasta, 'executor'))
    writeFileSync(join(pasta, 'executor', 'agente.json'), typeof manifesto === 'string' ? manifesto : JSON.stringify(manifesto))
  }
  return pasta
}

// Cada filho responde pelo que a prova manda: { saida, erro, codigo } do executor e das tarefas.
function spawnFalso({ executor = { saida: '{"ok":true,"agente":"oraculo","versao":"0.3.0"}\n', codigo: 0 }, tarefas = { saida: '{"ok":true,"modo":"registrar","registradas":["Omni - oraculo - actions-visita"],"podadas":[],"puladas":[],"divergencias":[]}\n', codigo: 0 } } = {}) {
  const chamadas = []
  function spawn(comando, args, opcoes) {
    const filho = new EventEmitter()
    filho.stdout = new EventEmitter()
    filho.stderr = new EventEmitter()
    filho.kill = () => true
    chamadas.push({ comando, args, opcoes })
    const r = comando === 'powershell.exe' ? tarefas : executor
    setImmediate(() => {
      if (r.saida) filho.stdout.emit('data', Buffer.from(r.saida))
      if (r.erro) filho.stderr.emit('data', Buffer.from(r.erro))
      filho.emit('close', r.codigo, null)
    })
    return filho
  }
  return { spawn, chamadas }
}

const ENV = { OMNI_NODE: 'C:\\falso\\node.exe', ELECTRON_RUN_AS_NODE: '1', OUTRA: 'x' }

test('caminho feliz: o executor instala e depois as tarefas são registradas, nessa ordem', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'oraculo', versao: '0.3.0' })
  const f = spawnFalso()
  const r = await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'OmniProva' })
  assert.deepEqual(r, { ok: true, agente: 'oraculo', versao: '0.3.0', tarefas: ['Omni - oraculo - actions-visita'] })
  assert.equal(f.chamadas.length, 2)
  const [ex, tr] = f.chamadas
  assert.equal(ex.comando, 'C:\\falso\\node.exe')
  assert.deepEqual(ex.args, [EXECUTOR, 'instalar-agente', '--raiz', pasta])
  assert.equal(tr.comando, 'powershell.exe')
  assert.deepEqual(tr.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TAREFAS, '-Modo', 'registrar', '-Prefixo', 'OmniProva', '-Raiz', RAIZ_OMNI])
  for (const c of f.chamadas) {
    assert.equal(c.opcoes.windowsHide, true)
    assert.equal(c.opcoes.shell, false)
  }
})

test('pasta de outro agente: recusa sem rodar nada', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'overcore', versao: '1.0.0' })
  const f = spawnFalso()
  const r = await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
  assert.equal(r.ok, false)
  assert.match(r.erro, /overcore/)
  assert.equal(f.chamadas.length, 0)
})

test('pasta sem executor/agente.json, ou com ele ilegível: recusa sem rodar nada', async (t) => {
  for (const manifesto of [undefined, '{ isto não é json']) {
    const pasta = pastaDoAgente(t, manifesto)
    const f = spawnFalso()
    const r = await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
    assert.equal(r.ok, false)
    assert.match(r.erro, /agente\.json/)
    assert.equal(f.chamadas.length, 0)
  }
})

test('nenhuma pasta escolhida: recusa sem rodar nada', async () => {
  const f = spawnFalso()
  const r = await instalarAgente({ agente: 'oraculo', pasta: undefined, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
  assert.deepEqual(r, { ok: false, erro: 'nenhuma pasta escolhida' })
  assert.equal(f.chamadas.length, 0)
})

test('o executor recusou: devolve o erro dele e não registra tarefas', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'oraculo', versao: '0.3.0' })
  const f = spawnFalso({ executor: { saida: 'linha de log\n{"ok":false,"codigo":"requisito","erro":"Requisito não atendido: node>=24."}\n', codigo: 3 } })
  const r = await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
  assert.deepEqual(r, { ok: false, erro: 'Requisito não atendido: node>=24.' })
  assert.equal(f.chamadas.length, 1)
})

test('o executor caiu sem JSON: o erro é a primeira linha do stderr', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'oraculo', versao: '0.3.0' })
  const f = spawnFalso({ executor: { erro: 'falha inesperada no executor: disco\nmais\n', codigo: 1 } })
  const r = await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
  assert.deepEqual(r, { ok: false, erro: 'falha inesperada no executor: disco' })
  assert.equal(f.chamadas.length, 1)
})

test('o agente instalou mas as tarefas não: ok falso, com o que divergiu', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'oraculo', versao: '0.3.0' })
  const f = spawnFalso({ tarefas: { saida: '{"ok":false,"modo":"registrar","registradas":[],"podadas":[],"puladas":[],"divergencias":[],"erro":"o listar recusou: casa"}\n', codigo: 1 } })
  const r = await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
  assert.equal(r.ok, false)
  assert.equal(r.instalado, true)
  assert.match(r.erro, /tarefas/)
  assert.match(r.erro, /o listar recusou: casa/)
})

test('ELECTRON_RUN_AS_NODE não vai para os filhos; o resto do ambiente vai', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'oraculo', versao: '0.3.0' })
  const f = spawnFalso()
  await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: ENV, spawn: f.spawn, prefixo: 'Omni' })
  assert.equal(f.chamadas.length, 2)
  for (const c of f.chamadas) {
    assert.equal('ELECTRON_RUN_AS_NODE' in c.opcoes.env, false)
    assert.equal(c.opcoes.env.OUTRA, 'x')
  }
  assert.equal(ENV.ELECTRON_RUN_AS_NODE, '1', 'o ambiente de quem chamou fica intacto')
})

test('sem OMNI_NODE, o node do PATH', async (t) => {
  const pasta = pastaDoAgente(t, { agente: 'oraculo', versao: '0.3.0' })
  const f = spawnFalso()
  await instalarAgente({ agente: 'oraculo', pasta, raizOmni: RAIZ_OMNI, env: { OUTRA: 'x' }, spawn: f.spawn, prefixo: 'Omni' })
  assert.equal(f.chamadas[0].comando, 'node')
})
