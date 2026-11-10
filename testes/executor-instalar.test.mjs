// O executor instala (F2, plano 5b-1): a casa com os três bancos e o Omni registrado no núcleo, e os
// outros agentes com tokens no cofre, sha256 entregue ao instalar --stdin deles e registro só depois.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { arquivoDoBanco, comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { tokenDoAgente } from '../runtime/casa/credenciais-agente.mjs'
import { BANCOS } from '../runtime/casa/esquemas.mjs'
import { credencialPorNome } from '../runtime/casa/loja-cofre.mjs'
import { listarInstalados } from '../runtime/casa/loja-nucleo.mjs'
import { rodarExecutor } from '../runtime/executor.mjs'
import { agenteFalso, NODE_ATUAL } from './fixtures/agente-falso.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const VERSAO = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version

function ponteFalsa(marca = 'FALSO:') {
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    selar(valores) { return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}

function casaTemporaria(t, extra = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-instalar-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  return { pasta, env: { ...process.env, OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), ...extra } }
}

async function rodar(argv, env, opcoes = {}) {
  let saida = ''
  let erro = ''
  const codigo = await rodarExecutor(argv, {
    env, saida: { write: (t) => { saida += t } }, erro: { write: (t) => { erro += t } }, ...opcoes
  })
  return { codigo, json: saida ? JSON.parse(saida) : null, erro }
}

const maxima = (nome) => Math.max(...BANCOS[nome].migracoes.map((m) => m.versao))

test('instalar cria os três bancos migrados e registra o Omni com a raiz da release', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const r = await rodar(['instalar'], env)
  assert.equal(r.codigo, 0, r.erro)
  assert.equal(r.json.ok, true)
  for (const nome of ['nucleo', 'omni', 'cofre']) {
    assert.ok(existsSync(arquivoDoBanco(pasta, nome, env)), `${nome}.db criado`)
    assert.equal(r.json.bancos[nome].migracao, maxima(nome))
  }
  assert.equal(r.json.omni.versao, VERSAO)
  assert.deepEqual(r.json.omni.mudou, { agente: true, instalacao: true })
  const instalados = comBancoDaCasa(pasta, 'nucleo', (db) => listarInstalados(db), env)
  assert.deepEqual(instalados.map((i) => [i.agente, i.raiz]), [['omni', RAIZ]])
})

test('instalar de novo não muda nada', async (t) => {
  const { env } = casaTemporaria(t)
  assert.equal((await rodar(['instalar'], env)).codigo, 0)
  const segunda = await rodar(['instalar'], env)
  assert.equal(segunda.codigo, 0)
  assert.deepEqual(segunda.json.omni.mudou, { agente: false, instalacao: false })
})

const recebido = (raiz) => JSON.parse(readFileSync(join(raiz, 'recebido.json'), 'utf8'))
const sha = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')
const instalados = (pasta, env) => comBancoDaCasa(pasta, 'nucleo', (db) => listarInstalados(db), env).map((i) => i.agente)
const tokenNoCofre = (pasta, env) => comBancoDaCasa(pasta, 'cofre', (db) => credencialPorNome(db, 'api/falso/tela'), env) ?? null

test('instalar-agente gera os tokens, entrega só os sha256 ao instalar --stdin e registra', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const raiz = agenteFalso(t)
  const ponte = ponteFalsa()
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte })
  assert.equal(r.codigo, 0, r.erro)
  assert.equal(r.json.agente, 'falso')
  assert.deepEqual(r.json.tokens, { novos: ['tela', 'visita'] })
  assert.deepEqual(r.json.mudou, { agente: true, instalacao: true })
  const { args, entrada } = recebido(raiz)
  assert.deepEqual(args, ['instalar', '--stdin'])
  const valores = comBancoDaCasa(pasta, 'cofre', (db) => ({
    tela: tokenDoAgente(db, ponte, 'falso', 'tela', 'teste'), visita: tokenDoAgente(db, ponte, 'falso', 'visita', 'teste')
  }), env)
  assert.deepEqual(JSON.parse(entrada), { tela: sha(valores.tela), visita: sha(valores.visita) })
  assert.ok(!entrada.includes(valores.tela) && !entrada.includes(valores.visita), 'o token em si nunca vai ao agente')
  assert.ok(!JSON.stringify(r.json).includes(sha(valores.tela)), 'nem o sha256 sai na saída do executor')
  assert.deepEqual(instalados(pasta, env), ['falso'])
})

test('instalar-agente de novo reaproveita os tokens e entrega os mesmos sha256', async (t) => {
  const { env } = casaTemporaria(t)
  const raiz = agenteFalso(t)
  const ponte = ponteFalsa()
  await rodar(['instalar-agente', '--raiz', raiz], env, { ponte })
  const primeira = recebido(raiz).entrada
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte })
  assert.equal(r.codigo, 0, r.erro)
  assert.deepEqual(r.json.tokens, { novos: [] })
  assert.deepEqual(r.json.mudou, { agente: false, instalacao: false })
  assert.equal(recebido(raiz).entrada, primeira)
})

test('agente sem servir não ganha token e o instalar dele vai sem --stdin', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const raiz = agenteFalso(t, (m) => ({ ...m, executor: { ...m.executor, modos: ['instalar'] } }))
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 0, r.erro)
  assert.equal(r.json.tokens, null)
  assert.deepEqual(recebido(raiz), { args: ['instalar'], entrada: null })
  assert.equal(tokenNoCofre(pasta, env), null)
})

test('agente que recusa o instalar não entra no núcleo', async (t) => {
  const { pasta, env } = casaTemporaria(t, { FALSO_SAIR: '3' })
  const raiz = agenteFalso(t)
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 3)
  assert.equal(r.json.codigo, 'agente-recusou')
  assert.match(r.json.erro, /saiu com 3/)
  assert.deepEqual(instalados(pasta, env), [])
})

test('requisito não atendido para antes de token, agente e registro', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const raiz = agenteFalso(t, (m) => ({ ...m, requer: { node: NODE_ATUAL, agentes: ['omni>=99'] } }))
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 3)
  assert.equal(r.json.codigo, 'requisito')
  assert.match(r.json.erro, /omni>=99/)
  assert.equal(existsSync(join(raiz, 'recebido.json')), false)
  assert.equal(tokenNoCofre(pasta, env), null)
  assert.deepEqual(instalados(pasta, env), [])
})

test('requer outro agente: só passa quando ele está instalado na versão pedida', async (t) => {
  const { env } = casaTemporaria(t)
  const base = agenteFalso(t)
  assert.equal((await rodar(['instalar-agente', '--raiz', base], env, { ponte: ponteFalsa() })).codigo, 0)
  const exige = (versao) => agenteFalso(t, (m) => ({ ...m, agente: 'dependente', requer: { agentes: [`falso>=${versao}`] } }))
  const recusado = await rodar(['instalar-agente', '--raiz', exige('2')], env, { ponte: ponteFalsa() })
  assert.equal(recusado.json.codigo, 'requisito')
  assert.equal((await rodar(['instalar-agente', '--raiz', exige('1.0')], env, { ponte: ponteFalsa() })).codigo, 0)
})

test('o Omni não se instala como agente, e manifesto inválido sai 3 com os erros', async (t) => {
  const { env } = casaTemporaria(t)
  const omni = await rodar(['instalar-agente', '--raiz', RAIZ], env, { ponte: ponteFalsa() })
  assert.equal(omni.codigo, 3)
  assert.equal(omni.json.codigo, 'agente-omni')
  const torto = agenteFalso(t, (m) => ({ ...m, versao: 'um' }))
  const r = await rodar(['instalar-agente', '--raiz', torto], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 3)
  assert.equal(r.json.codigo, 'manifesto-invalido')
  assert.ok(r.json.erros.some((e) => e.startsWith('versao')))
})

test('instalar-agente sem --raiz é uso errado', async (t) => {
  const { env } = casaTemporaria(t)
  const r = await rodar(['instalar-agente'], env)
  assert.equal(r.codigo, 2)
  assert.match(r.erro, /falta --raiz/)
})