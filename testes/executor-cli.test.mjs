import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { registrarMaquina } from '../runtime/casa/loja-nucleo.mjs'
import { rodarExecutor } from '../runtime/executor.mjs'

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comPasta(uso) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-executor-cli-'))
  try { return await uso(pasta) } finally { rmSync(pasta, { recursive: true, force: true }) }
}
const casaEm = (pasta, nome) => {
  const casa = join(pasta, nome)
  return { casa, env: { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') } }
}
async function rodar(env, argv) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  return { codigo: await rodarExecutor(argv, { saida, erro, env }), saida, erro }
}

test('uso errado sai com 2 e nunca ecoa o argumento', async () => comPasta(async (pasta) => {
  const { env } = casaEm(pasta, 'a')
  // O posicional solto vem com --saida válido: cai pelo posicional, não por falta de opção.
  const solto = ['exportar', '--saida', join(pasta, 'pacote'), 'solto']
  for (const argv of [[], ['sumir'], ['exportar'], ['importar'], ['verificar', '--segredo=valor-que-nao-volta'], solto]) {
    const r = await rodar(env, argv)
    assert.equal(r.codigo, 2, JSON.stringify(argv))
    assert.match(r.erro.texto, /uso: node runtime\/executor\.mjs/)
    assert.ok(!r.erro.texto.includes('valor-que-nao-volta'))
    assert.equal(r.saida.texto, '')
  }
}))

test('exportar, importar noutra casa e verificar contra o pacote: 100%', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'origem'); const b = casaEm(pasta, 'destino')
  comBancoDaCasa(a.casa, 'nucleo', (db) => registrarMaquina(db, { maquina: 'origem', nome: 'origem', sistema: 'teste' }), a.env)
  const pacote = join(pasta, 'pacote')
  const ex = await rodar(a.env, ['exportar', '--saida', pacote])
  assert.equal(ex.codigo, 0, ex.erro.texto); assert.equal(ultimaLinha(ex.saida).ok, true)
  const im = await rodar(b.env, ['importar', '--pacote', pacote])
  assert.equal(im.codigo, 0, im.erro.texto); assert.equal(ultimaLinha(im.saida).importado, true)
  const ve = await rodar(b.env, ['verificar', '--pacote', pacote])
  assert.equal(ve.codigo, 0, ve.erro.texto)
  const v = ultimaLinha(ve.saida)
  assert.equal(v.ok, true); assert.deepEqual(v.divergencias, [])
  assert.equal(v.bancos.omni.integridade, 'ok')
  assert.equal(v.bancos.nucleo.linhas, ultimaLinha(ex.saida).bancos.nucleo.linhas)
}))

test('verificar aponta divergência com saída 3', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'origem')
  const pacote = join(pasta, 'pacote')
  await rodar(a.env, ['exportar', '--saida', pacote])
  comBancoDaCasa(a.casa, 'nucleo', (db) => registrarMaquina(db, { maquina: 'nova', nome: 'nova', sistema: 'teste' }), a.env)
  const ve = await rodar(a.env, ['verificar', '--pacote', pacote])
  assert.equal(ve.codigo, 3)
  const v = ultimaLinha(ve.saida)
  assert.equal(v.ok, false); assert.ok(v.divergencias.some((d) => d.banco === 'nucleo' && d.tabela === 'maquinas'))
}))

test('verificar sem banco não cria banco e diz que falta', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'vazia')
  const ve = await rodar(a.env, ['verificar'])
  assert.equal(ve.codigo, 3)
  assert.equal(ultimaLinha(ve.saida).bancos.omni.existe, false)
  assert.ok(!existsSync(join(a.casa, 'casa', 'omni.db')))
}))

test('recusas do pacote saem com 3 e o código no JSON', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'origem')
  const r = await rodar(a.env, ['importar', '--pacote', join(pasta, 'nao-existe')])
  assert.equal(r.codigo, 3)
  assert.deepEqual([ultimaLinha(r.saida).ok, ultimaLinha(r.saida).codigo], [false, 'pacote-invalido'])
}))
