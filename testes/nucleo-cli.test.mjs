import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { casaDoOmni } from '../runtime/memoria.mjs'
import { casaDoNucleo, rodarNucleo } from '../runtime/nucleo.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const MAQUINA = hostname().toLowerCase()

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-nucleo-cli-'))
  const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
  try { return await uso(casa, env) } finally { rmSync(casa, { recursive: true, force: true }) }
}
async function rodar(env, argv) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  const codigo = await rodarNucleo(argv, { saida, erro, env })
  return { codigo, saida, erro }
}
// Um agente de mentira dentro da casa de teste: <casa>/agentes/<nome>/executor/agente.json.
function agente(casa, manifesto, nome = 'exemplo') {
  const raiz = join(casa, 'agentes', nome)
  mkdirSync(join(raiz, 'executor'), { recursive: true })
  writeFileSync(join(raiz, 'executor', 'agente.json'), typeof manifesto === 'string' ? manifesto : JSON.stringify(manifesto, null, 2))
  return raiz
}
const minimo = (versao = '0.1.0') => ({ agente: 'exemplo', versao, banco: null, requer: {}, tarefas: [], credenciais: [] })
const bancoDoNucleo = (casa) => join(casa, 'casa', 'nucleo.db')

test('uso errado sai com 2, mostra o uso e nunca ecoa o argumento', async () => comCasa(async (casa, env) => {
  for (const argv of [[], ['sumir'], ['registrar'], ['verificar', '--raiz', ''], ['retirar'], ['listar', '--segredo=valor-que-nao-volta'], ['listar', 'solto']]) {
    const r = await rodar(env, argv)
    assert.equal(r.codigo, 2, JSON.stringify(argv))
    assert.match(r.erro.texto, /uso: node runtime\/nucleo\.mjs/)
    assert.equal(r.saida.texto, '')
    assert.ok(!r.erro.texto.includes('valor-que-nao-volta'))
  }
  assert.match((await rodar(env, ['registrar'])).erro.texto, /^falta --raiz/)
  assert.match((await rodar(env, ['retirar'])).erro.texto, /^falta --agente/)
  assert.match((await rodar(env, [])).erro.texto, /^falta o comando/)
  assert.match((await rodar(env, ['sumir'])).erro.texto, /^comando desconhecido/)
  assert.ok(!existsSync(bancoDoNucleo(casa)))
}))

test('casaDoNucleo é a mesma casa do Omni', () => {
  for (const env of [{ OMNI_HOME: 'rel/x' }, { APPDATA: 'C:\\A' }, {}]) assert.equal(casaDoNucleo(env), casaDoOmni(env), JSON.stringify(env))
})

test('verificar confere o manifesto sem abrir o banco', async () => comCasa(async (casa, env) => {
  const raiz = agente(casa, minimo())
  const ok = await rodar(env, ['verificar', '--raiz', raiz])
  assert.equal(ok.codigo, 0, ok.erro.texto)
  const linha = ultimaLinha(ok.saida)
  assert.deepEqual({ ok: linha.ok, agente: linha.agente, versao: linha.versao }, { ok: true, agente: 'exemplo', versao: '0.1.0' })
  assert.match(linha.sha256, /^[0-9a-f]{64}$/)

  const ruim = await rodar(env, ['verificar', '--raiz', agente(casa, { ...minimo(), versao: 'um' }, 'ruim')])
  assert.equal(ruim.codigo, 3)
  const recusa = ultimaLinha(ruim.saida)
  assert.equal(recusa.ok, false)
  assert.equal(recusa.codigo, 'manifesto-invalido')
  assert.equal(recusa.erros?.length, 1)
  assert.match(recusa.erros[0], /^versao:/)

  const sem = await rodar(env, ['verificar', '--raiz', join(casa, 'nada')])
  assert.equal(sem.codigo, 3)
  assert.equal(ultimaLinha(sem.saida).codigo, 'sem-manifesto')
  assert.deepEqual(ultimaLinha(sem.saida).erros, [])
  assert.ok(!existsSync(bancoDoNucleo(casa)), 'verificar não cria o nucleo.db')
}))

test('registrar, listar, maquinas e retirar fazem o ciclo da instalação', async () => comCasa(async (casa, env) => {
  const raiz = agente(casa, minimo())
  const primeiro = await rodar(env, ['registrar', '--raiz', raiz])
  assert.equal(primeiro.codigo, 0, primeiro.erro.texto)
  assert.deepEqual(ultimaLinha(primeiro.saida), { ok: true, agente: 'exemplo', versao: '0.1.0', maquina: MAQUINA, mudou: { agente: true, instalacao: true } })
  const de_novo = await rodar(env, ['registrar', '--raiz', raiz])
  assert.deepEqual(ultimaLinha(de_novo.saida).mudou, { agente: false, instalacao: false })

  const lista = await rodar(env, ['listar'])
  assert.equal(lista.codigo, 0)
  const instalados = ultimaLinha(lista.saida)
  assert.equal(instalados.length, 1)
  assert.deepEqual({ agente: instalados[0].agente, raiz: instalados[0].raiz, versao: instalados[0].versao, diverge: instalados[0].catalogoDiverge },
    { agente: 'exemplo', raiz, versao: '0.1.0', diverge: false })
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar', '--maquina', 'outra-maquina'])).saida), [])

  const maquinas = ultimaLinha((await rodar(env, ['maquinas'])).saida)
  assert.deepEqual(maquinas.map((m) => [m.id, m.agentes]), [[MAQUINA, 1]])

  const retirado = await rodar(env, ['retirar', '--agente', 'exemplo'])
  assert.equal(retirado.codigo, 0)
  assert.deepEqual(ultimaLinha(retirado.saida), { ok: true, agente: 'exemplo', maquina: MAQUINA, retirado: true })
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar'])).saida), [])
  const outra_vez = await rodar(env, ['retirar', '--agente', 'exemplo'])
  assert.equal(outra_vez.codigo, 3)
  assert.equal(ultimaLinha(outra_vez.saida).codigo, 'inexistente')
}))

test('registrar recusa manifesto inválido sem gravar nada', async () => comCasa(async (casa, env) => {
  const r = await rodar(env, ['registrar', '--raiz', agente(casa, '[1, 2]')])
  assert.equal(r.codigo, 3)
  assert.deepEqual(ultimaLinha(r.saida).erros, ['manifesto: precisa ser um objeto JSON'])
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar'])).saida), [])
  assert.deepEqual(ultimaLinha((await rodar(env, ['maquinas'])).saida), [])
}))

test('maquina registra esta máquina e só muda na primeira vez', async () => comCasa(async (casa, env) => {
  const primeira = await rodar(env, ['maquina'])
  assert.equal(primeira.codigo, 0)
  assert.deepEqual(ultimaLinha(primeira.saida), { ok: true, maquina: MAQUINA, mudou: true })
  assert.deepEqual(ultimaLinha((await rodar(env, ['maquina'])).saida), { ok: true, maquina: MAQUINA, mudou: false })
}))

test('falha inesperada sai com 1 e fica anotada nas degradações', async () => comCasa(async (casa, env) => {
  mkdirSync(bancoDoNucleo(casa), { recursive: true })   // uma pasta no lugar do arquivo: o banco não abre
  const r = await rodar(env, ['listar'])
  assert.equal(r.codigo, 1)
  assert.match(r.erro.texto, /^falha inesperada no núcleo:/)
  const anotadas = join(casa, 'casa', 'degradacoes.jsonl')
  assert.ok(existsSync(anotadas), 'a falha inesperada fica anotada')
  const linhas = readFileSync(anotadas, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(linhas.map((l) => l.operacao), ['nucleo.cli'])
}))

test('roda direto pela linha de comando', async () => comCasa(async (casa, env) => {
  const raiz = agente(casa, minimo('1.2.3'))
  const r = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'nucleo.mjs'), 'registrar', '--raiz', raiz], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /"versao":"1\.2\.3"/)
  assert.equal(JSON.parse(r.stdout.trim()).versao, '1.2.3')
  const uso = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'nucleo.mjs')], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(uso.status, 2)
}))

test('a raiz relativa vale a partir da pasta atual', async () => comCasa(async (casa, env) => {
  agente(casa, minimo('2.0.0'), 'relativa')
  const r = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'nucleo.mjs'), 'registrar', '--raiz', join('agentes', 'relativa')], { cwd: casa, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /"ok":true/)
  const [instalado] = ultimaLinha((await rodar(env, ['listar'])).saida)
  assert.equal(instalado.raiz.toLowerCase(), join(casa, 'agentes', 'relativa').toLowerCase())
}))
