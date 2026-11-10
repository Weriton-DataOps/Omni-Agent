// O lançador das tarefas dos agentes (F2, plano 5c, T2). A tarefa do Windows chama
// `node runtime/tarefa-agente.mjs rodar <agente> <id>`; o lançador acha a tarefa no nucleo.db, preenche o
// roteiro, põe a porta e o token visita no ambiente e roda o claude (aqui, um falso) com trava, teto e log.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { arquivoServir } from '../runtime/casa/acesso-agente.mjs'
import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import { garantirTokensDoAgente } from '../runtime/casa/credenciais-agente.mjs'
import { registrarAgente } from '../runtime/casa/loja-nucleo.mjs'
import { rodarTarefa } from '../runtime/tarefa-agente.mjs'

const FALSO = resolve(import.meta.dirname, 'fixtures', 'claude-visita-falso.mjs')
const RAIZ_OMNI = resolve(import.meta.dirname, '..')
const AGORA = new Date(2026, 10, 10, 7, 5, 9)
const VISITA = '2026-11-10-0705'
const ROTEIRO = 'Motivo {{MOTIVO}}; visita {{VISITA}} de {{HOJE}}; Actions {{ACTIONS}}; oraculo {{ORACULO}}; omni {{OMNI}}; resto {{OUTRA}}.'
const VISITA_TAREFA = { id: 'actions-visita', lancador: 'omni', roteiro: 'roteiros/visita.md', variaveis: ['MOTIVO', 'VISITA', 'HOJE', 'ACTIONS', 'ORACULO', 'OMNI'], quando: { diaria: '07:00' }, seAtrasada: true }
// O comando grava o que viu do token: quem roda comando não entrega token.
const VIGIA_TAREFA = { id: 'vigia', comando: 'node -e "require(\'fs\').writeFileSync(\'feito.txt\', process.env.ORACULO_TOKEN || \'sem token\')"', quando: { acada: 'PT15M' }, seAtrasada: false }

function ponteFalsa() {
  const prefixo = Buffer.from('FALSO:')
  const xor = (bytes) => { const s = Buffer.from(bytes); for (let i = 0; i < s.length; i++) s[i] ^= 0x5a; return s }
  return {
    selar: (valores) => valores.map((v) => Buffer.concat([prefixo, xor(v)])),
    abrir: (blobs) => blobs.map((b) => ({ ok: true, valor: xor(Buffer.from(b).subarray(prefixo.length)) }))
  }
}

function texto() {
  let s = ''
  return { write: (p) => { s += p; return true }, lido: () => s }
}

function preparar(t, { tarefas = [VISITA_TAREFA, VIGIA_TAREFA], servir = true, roteiro = ROTEIRO } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-tarefa-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  const raiz = join(pasta, 'oraculo')
  mkdirSync(join(raiz, 'roteiros'), { recursive: true })
  writeFileSync(join(raiz, 'roteiros', 'visita.md'), roteiro)
  const actions = join(pasta, 'Actions')
  const registro = join(pasta, 'claude.json')
  const env = {
    ...process.env,
    OMNI_HOME: pasta,
    OMNI_CASA_BANCO: join(pasta, 'banco'),
    OMNI_ACTIONS: actions,
    OMNI_CLAUDE_EXE: 'CLAUDE-FALSO',
    CLAUDE_FALSO_REGISTRO: registro,
    CLAUDE_FALSO_MODO: 'ok',
    ELECTRON_RUN_AS_NODE: '1'
  }
  for (const n of ['ORACULO_TOKEN', 'ORACULO_API', 'OMNI_VISITA_ID', 'OMNI_VISITA_SECO']) delete env[n]
  const ponte = ponteFalsa()
  const manifesto = (versao) => JSON.stringify({ agente: 'oraculo', versao, banco: null, requer: { node: '>=24' }, executor: { comando: 'node executor/o.mjs', modos: ['servir'] }, tarefas, credenciais: [] })
  comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, manifesto('0.0.1'), { raiz }), env)
  const shas = comBancoDaCasa(pasta, 'cofre', (db) => garantirTokensDoAgente(db, ponte, 'oraculo'), env)
  if (servir) {
    mkdirSync(join(pasta, 'banco'), { recursive: true })
    writeFileSync(arquivoServir(pasta, env), JSON.stringify({ pid: process.pid, porta: 1234, agentes: [{ agente: 'oraculo', porta: 4567 }] }))
  }
  const chamadas = []
  const iniciar = (exe, args, opcoes) => {
    chamadas.push({ exe, args })
    return exe === 'CLAUDE-FALSO' ? spawn(process.execPath, [FALSO, ...args], opcoes) : spawn(exe, args, opcoes)
  }
  const saida = texto()
  const rodar = (argv, extra = {}) => rodarTarefa(argv, { env, ponte, saida, iniciar, raizOmni: RAIZ_OMNI, agora: () => AGORA, ...extra })
  const ultima = () => JSON.parse(saida.lido().trim().split('\n').pop())
  const visto = () => (existsSync(registro) ? JSON.parse(readFileSync(registro, 'utf8')) : null)
  const arquivoLog = join(pasta, 'banco', 'tarefas', 'tarefas.log')
  const log = () => (existsSync(arquivoLog) ? readFileSync(arquivoLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  const divergir = () => comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, manifesto('0.0.2'), { raiz, maquina: 'outra', nome: 'OUTRA', sistema: 'win32' }), env)
  return { pasta, raiz, actions, env, shas, chamadas, saida, rodar, ultima, visto, log, arquivoLog, divergir }
}

const igual = (a, b) => assert.equal(resolve(a).toLowerCase(), resolve(b).toLowerCase())

test('listar devolve as tarefas instaladas nesta máquina', async (t) => {
  const p = preparar(t)
  assert.equal(await p.rodar(['listar']), 0)
  const r = p.ultima()
  assert.equal(r.ok, true)
  assert.deepEqual(r.tarefas.map((x) => [x.agente, x.id, x.divergente]), [['oraculo', 'actions-visita', false], ['oraculo', 'vigia', false]])
  assert.equal(r.tarefas[0].raiz, p.raiz)
  assert.deepEqual(r.tarefas[0].quando, { diaria: '07:00' })
})

test('rodar preenche o roteiro, põe porta e token visita no ambiente e roda o claude no Actions', async (t) => {
  const p = preparar(t)
  const codigo = await p.rodar(['rodar', 'oraculo', 'actions-visita', '--motivo', 'agendada'])
  assert.equal(codigo, 0, p.saida.lido())
  const r = p.ultima()
  assert.deepEqual({ ok: r.ok, agente: r.agente, id: r.id, estado: r.estado, visita: r.visita }, { ok: true, agente: 'oraculo', id: 'actions-visita', estado: 'concluida', visita: VISITA })
  const v = p.visto()
  assert.equal(v.ordem, `Motivo agendada; visita ${VISITA} de 10/11/2026; Actions ${p.actions}; oraculo ${p.raiz}; omni ${RAIZ_OMNI}; resto {{OUTRA}}.`)
  assert.equal(v.env.ORACULO_API, 'http://127.0.0.1:4567/v1')
  const token = v.env.ORACULO_TOKEN
  assert.equal(sha256(token), p.shas.visita, 'o token visita, não o tela')
  assert.equal(v.env.OMNI_VISITA_ID, VISITA)
  igual(v.env.OMNI_ACTIONS, p.actions)
  assert.equal('OMNI_VISITA_SECO' in v.env, false)
  assert.equal('ELECTRON_RUN_AS_NODE' in v.env, false, 'o claude não herda o modo node do Electron')
  igual(v.cwd, p.actions)
  assert.deepEqual(v.argv.slice(0, 3), ['-p', '--output-format', 'json'])
  assert.deepEqual(v.argv.slice(v.argv.indexOf('--add-dir')), ['--add-dir', p.actions, '--add-dir', RAIZ_OMNI, '--add-dir', p.raiz])
  const usos = comBancoDaCasa(p.pasta, 'cofre', (db) => db.prepare("SELECT motivo FROM usos WHERE motivo LIKE 'tarefa%'").all().map((l) => l.motivo), p.env)
  assert.deepEqual(usos, ['tarefa oraculo/actions-visita'])
  const [linha] = p.log()
  assert.deepEqual({ agente: linha.agente, id: linha.id, motivo: linha.motivo, estado: linha.estado, visita: linha.visita }, { agente: 'oraculo', id: 'actions-visita', motivo: 'agendada', estado: 'concluida', visita: VISITA })
  assert.equal(p.saida.lido().includes(token), false, 'o token não sai no stdout')
  assert.equal(readFileSync(p.arquivoLog, 'utf8').includes(token), false, 'o token não vai ao log')
  assert.equal(existsSync(join(p.pasta, 'banco', 'tarefas', 'oraculo-actions-visita.trava')), false, 'a trava some no fim')
})

test('visita que já tem registro no mesmo minuto ganha os segundos no id', async (t) => {
  const p = preparar(t)
  mkdirSync(join(p.actions, 'visitas'), { recursive: true })
  writeFileSync(join(p.actions, 'visitas', `${VISITA}.md`), 'outra visita')
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita']), 0)
  assert.equal(p.ultima().visita, `${VISITA}-09`)
  assert.equal(p.visto().env.OMNI_VISITA_ID, `${VISITA}-09`)
  assert.match(p.visto().ordem, /^Motivo manual;/, 'sem --motivo, o motivo é manual')
})

test('--seco põe a visita numa cópia do Actions e avisa o roteiro', async (t) => {
  const p = preparar(t)
  const seca = join(p.pasta, 'copia')
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita', '--seco', seca]), 0)
  const v = p.visto()
  assert.ok(v.ordem.startsWith(`VISITA A SECO: trabalhe só em ${resolve(seca)} (cópia). Não use avisar nem risco.`), v.ordem.slice(0, 120))
  assert.ok(v.ordem.includes(`Actions ${resolve(seca)};`))
  assert.equal(v.env.OMNI_VISITA_SECO, '1')
  igual(v.env.OMNI_ACTIONS, seca)
  // o servir do agente está preso à raiz com que subiu (o Actions de verdade): a seco, a visita fica sem mãos
  assert.equal('ORACULO_API' in v.env, false, 'a seco, sem a porta do agente')
  assert.equal('ORACULO_TOKEN' in v.env, false, 'a seco, sem o token visita')
  assert.ok(v.ordem.includes('As mãos do oraculo ficam desligadas'), v.ordem.slice(0, 200))
  const usos = comBancoDaCasa(p.pasta, 'cofre', (db) => db.prepare("SELECT motivo FROM usos WHERE motivo LIKE 'tarefa%'").all(), p.env)
  assert.equal(usos.length, 0, 'a seco, o token visita nem é lido')
  assert.ok(existsSync(join(seca, 'visitas', `${VISITA}.md`)))
  assert.equal(existsSync(join(p.actions, 'visitas')), false, 'o Actions de verdade fica intocado')
})

test('trava com dono vivo: a rodada é pulada sem chamar o claude', async (t) => {
  const p = preparar(t)
  mkdirSync(join(p.pasta, 'banco', 'tarefas'), { recursive: true })
  const trava = join(p.pasta, 'banco', 'tarefas', 'oraculo-actions-visita.trava')
  writeFileSync(trava, '424242')
  const vivo = (pid) => pid === process.pid || pid === 424242
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita'], { vivo }), 0)
  assert.equal(p.ultima().estado, 'pulada')
  assert.deepEqual(p.chamadas, [])
  assert.equal(readFileSync(trava, 'utf8'), '424242', 'a trava do outro fica')
  assert.equal(p.log()[0].estado, 'pulada')
})

test('trava de dono morto é sobra: a rodada segue e a trava some', async (t) => {
  const p = preparar(t)
  mkdirSync(join(p.pasta, 'banco', 'tarefas'), { recursive: true })
  const trava = join(p.pasta, 'banco', 'tarefas', 'oraculo-actions-visita.trava')
  writeFileSync(trava, '424242')
  const vivo = (pid) => pid === process.pid
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita'], { vivo }), 0)
  assert.equal(p.ultima().estado, 'concluida')
  assert.equal(existsSync(trava), false)
})

test('teto estourado: o claude morre, a rodada sai interrompida (3) e fica um registro mínimo', async (t) => {
  const p = preparar(t)
  p.env.CLAUDE_FALSO_MODO = 'dorme'
  const inicio = Date.now()
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita'], { tetoMs: 1500 }), 3)
  assert.ok(Date.now() - inicio < 30_000, 'o teto cortou antes do sono do falso')
  assert.equal(p.ultima().estado, 'interrompida')
  const registro = readFileSync(join(p.actions, 'visitas', `${VISITA}.md`), 'utf8')
  assert.match(registro, /interrompida/)
  assert.equal(p.log()[0].estado, 'interrompida')
})

test('o roteiro que não gravou registro ganha o mínimo, com o resumo do claude', async (t) => {
  const p = preparar(t)
  p.env.CLAUDE_FALSO_MODO = 'sem-registro'
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita']), 0)
  assert.equal(p.ultima().estado, 'concluida')
  const registro = readFileSync(join(p.actions, 'visitas', `${VISITA}.md`), 'utf8')
  assert.match(registro, /sem registro/)
  assert.match(registro, /Resumo: feito pelo falso/)
})

test('claude que sai com erro: a rodada falha (1)', async (t) => {
  const p = preparar(t)
  p.env.CLAUDE_FALSO_MODO = 'erro'
  assert.equal(await p.rodar(['rodar', 'oraculo', 'actions-visita']), 1)
  const r = p.ultima()
  assert.equal(r.estado, 'falhou')
  assert.equal(r.ok, false)
  assert.match(r.resumo, /credencial expirada/)
})

async function recusa(p, argv, padrao, extra = {}) {
  const codigo = await p.rodar(argv, extra).catch((e) => `lançou ${e?.code ?? e?.name}: ${e?.message}`)
  assert.equal(codigo, 1, String(codigo))
  const r = p.ultima()
  assert.equal(r.ok, false)
  assert.match(r.erro, padrao)
  assert.deepEqual(p.chamadas, [], 'recusa não chama ninguém')
}

test('recusas: tarefa que não existe, agente divergente, roteiro fora da raiz, servir fora do ar, argumento torto', async (t) => {
  await recusa(preparar(t), ['rodar', 'oraculo', 'nao-tem'], /oraculo\/nao-tem não está instalada/)
  const divergente = preparar(t)
  divergente.divergir()
  await recusa(divergente, ['rodar', 'oraculo', 'actions-visita'], /diverge do catálogo/)
  // O validador do manifesto já barra ../ no registro; aqui o catálogo foi adulterado depois dele.
  const adulterado = preparar(t)
  comBancoDaCasa(adulterado.pasta, 'nucleo', (db) => {
    const m = JSON.parse(db.prepare("SELECT manifesto FROM agentes WHERE id = 'oraculo'").get().manifesto)
    m.tarefas[0].roteiro = '../fora.md'
    db.prepare("UPDATE agentes SET manifesto = ? WHERE id = 'oraculo'").run(JSON.stringify(m))
  }, adulterado.env)
  await recusa(adulterado, ['rodar', 'oraculo', 'actions-visita'], /roteiro sai da raiz/)
  const semServir = preparar(t, { servir: false })
  await recusa(semServir, ['rodar', 'oraculo', 'actions-visita'], /servir do Omni não está no ar/, { esperaMs: 0 })
  assert.equal(semServir.log()[0].estado, 'falhou')
  await recusa(preparar(t), ['rodar', 'oraculo', 'actions-visita', '--de-novo'], /uso:/)
  await recusa(preparar(t), ['apagar'], /uso:/)
  await recusa(preparar(t), ['rodar', 'oraculo', 'actions-visita', '--teto-min', '0'], /uso:/)
})

test('tarefa de comando roda na raiz do agente, sem token, e conclui', async (t) => {
  const p = preparar(t)
  assert.equal(await p.rodar(['rodar', 'oraculo', 'vigia']), 0, p.saida.lido())
  assert.equal(p.ultima().estado, 'concluida')
  assert.equal(readFileSync(join(p.raiz, 'feito.txt'), 'utf8'), 'sem token')
  assert.equal(p.chamadas.some((c) => c.exe === 'CLAUDE-FALSO'), false)
  const usos = comBancoDaCasa(p.pasta, 'cofre', (db) => db.prepare("SELECT count(*) AS n FROM usos WHERE motivo LIKE 'tarefa%'").get().n, p.env)
  assert.equal(usos, 0, 'comando não abre o cofre')
})
