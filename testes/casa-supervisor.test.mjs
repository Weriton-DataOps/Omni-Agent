import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { criarSupervisor, esperaDoBackoff, partirComando } from '../runtime/casa/supervisor.mjs'
import { ate } from './fixtures/chamar-api.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const FALSO = 'node testes/fixtures/agente-falso.mjs'
const API = { url: 'http://127.0.0.1:9/v1', token: 'token-de-teste' }
const daquiA = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

function preparar(t, modo, { agente = {}, opcoes = {} } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-supervisor-'))
  const registro = join(pasta, 'registro.jsonl')
  const logs = []
  const supervisor = criarSupervisor({
    agentes: [{ agente: 'falso', raiz: RAIZ, comando: FALSO, divergente: false, ...agente }],
    omniApi: API,
    env: { ...process.env, AGENTE_FALSO_MODO: modo, AGENTE_FALSO_REGISTRO: registro },
    log: (linha) => logs.push(linha),
    baseMs: 40, tetoMs: 160, subidaMs: 5_000, paradaMs: 3_000,
    ...opcoes
  })
  t.after(async () => {
    await supervisor.parar()
    try { rmSync(pasta, { recursive: true, force: true }) } catch { /* sobra temporária */ }
  })
  const subidas = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return { supervisor, subidas, logs, unico: () => supervisor.estado()[0] }
}

test('backoff dobra até o teto e o comando troca node pelo executável atual', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map((n) => esperaDoBackoff(n, 40, 160)), [40, 80, 160, 160, 160])
  assert.deepEqual(partirComando('node executor/a.mjs', 'NODE'), { programa: 'NODE', argumentos: ['executor/a.mjs'] })
  assert.deepEqual(partirComando('  python   vigia.py ', 'NODE'), { programa: 'python', argumentos: ['vigia.py'] })
  assert.throws(() => partirComando('   '), TypeError)
})

test('sobe, lê a porta da 1ª linha, passa a API por env e para quando pedem', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'no-ar')
  supervisor.iniciar()
  await ate(() => unico().estado === 'no-ar')
  const no = unico()
  assert.ok(Number.isInteger(no.porta) && no.porta > 0)
  assert.ok(Number.isInteger(no.pid))
  const [subida] = subidas()
  assert.deepEqual(subida.argv, ['servir', '--porta', '0'])
  assert.equal(subida.api, API.url)
  assert.equal(subida.token, true)
  assert.equal(resolve(subida.cwd).toLowerCase(), RAIZ.toLowerCase())
  await supervisor.parar()
  assert.equal(unico().estado, 'parado')
  assert.equal(unico().pid, null)
})

test('saída 2 é recusa permanente: uma subida só', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'uso')
  supervisor.iniciar()
  await ate(() => unico().estado === 'recusado')
  assert.match(unico().erro, /saída 2/)
  await daquiA(400)
  assert.equal(subidas().length, 1)
})

test('recusa:true na 1ª linha é permanente e traz o erro do agente', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'recusa')
  supervisor.iniciar()
  await ate(() => unico().estado === 'recusado')
  assert.equal(unico().erro, 'sem credencial da api')
  await daquiA(400)
  assert.equal(subidas().length, 1)
})

test('queda volta com espera dobrada, e parar corta o ciclo', async (t) => {
  const { supervisor, subidas, logs, unico } = preparar(t, 'cai')
  supervisor.iniciar()
  await ate(() => subidas().length >= 3)
  assert.ok(unico().falhas >= 2)
  assert.ok(logs.some((l) => /nova tentativa em 80 ms/.test(l)), logs.join('\n'))
  assert.ok(logs.some((l) => /caiu de propósito/.test(l)), 'o stderr do agente vai para o log')
  await supervisor.parar()
  const depois = subidas().length
  supervisor.iniciar() // supervisor parado não ressuscita: quem quiser de novo cria outro
  await daquiA(400)
  assert.equal(subidas().length, depois)
  assert.equal(unico().estado, 'parado')
})

test('sem a 1ª linha no prazo, mata e tenta de novo', async (t) => {
  const { supervisor, subidas, logs } = preparar(t, 'mudo', { opcoes: { subidaMs: 300 } })
  supervisor.iniciar()
  await ate(() => subidas().length >= 2)
  assert.ok(logs.some((l) => /sem a 1ª linha no prazo/.test(l)), logs.join('\n'))
})

test('manifesto divergente não sobe', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'no-ar', { agente: { divergente: true } })
  supervisor.iniciar()
  await daquiA(300)
  assert.equal(unico().estado, 'manifesto-divergente')
  assert.equal(subidas().length, 0)
})

test('comando que não existe é recusa permanente', async (t) => {
  const { supervisor, unico } = preparar(t, 'no-ar', { agente: { comando: 'programa-que-nao-existe-omni x.mjs' } })
  supervisor.iniciar()
  await ate(() => unico().estado === 'recusado')
  assert.match(unico().erro, /não encontrado/)
})
