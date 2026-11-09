import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { registrarAgente } from '../runtime/casa/loja-nucleo.mjs'
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
  const { env } = pastaTemporaria(t)
  const s = subirServir(t, env)
  const linha = await s.primeira()
  assert.equal(linha.ok, true)
  assert.ok(Number.isInteger(linha.porta) && linha.porta > 0)
  const saude = await chamar(linha.porta, 'GET', '/v1/saude', { token: TOKEN })
  assert.equal(saude.status, 200)
  assert.equal(saude.corpo.versao, VERSAO)
  assert.deepEqual(saude.corpo.agentes, [])
  assert.equal((await chamar(linha.porta, 'GET', '/v1/saude')).status, 401)
  s.filho.stdin.end()
  assert.equal(await s.fim, 0)
  assert.match(s.erros(), /stdin fechou/)
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
