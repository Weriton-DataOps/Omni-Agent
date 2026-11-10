// Mãos do Actions (F2, plano 4a, T8): a sessão executora devolve o estado por aqui, sem ver token. As
// mãos acham o Oráculo no nucleo.db, a porta dele no servir.json, o token visita no cofre, e rodam o
// script do Oráculo com o Node atual.
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { garantirTokensDoAgente, tokenDoAgente } from '../runtime/casa/credenciais-agente.mjs'
import { registrarAgente } from '../runtime/casa/loja-nucleo.mjs'
import { arquivoServir, rodarMaos } from '../runtime/maos-actions.mjs'

const FALSO = resolve(import.meta.dirname, 'fixtures', 'oraculo-actions-falso.mjs')
const ID = '20261109-120000-abcd'

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

function preparar(t, { tokens = true, servir = true, script = true, registrar = true, porta = 4567 } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-maos-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  const raiz = join(pasta, 'oraculo')
  mkdirSync(join(raiz, 'scripts', 'actions'), { recursive: true })
  if (script) copyFileSync(FALSO, join(raiz, 'scripts', 'actions', 'omni-actions.mjs'))
  const registro = join(pasta, 'registro.json')
  const env = { ...process.env, OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), MAOS_REGISTRO: registro, MAOS_SAIDA: '3' }
  delete env.ORACULO_TOKEN
  delete env.ORACULO_API
  const ponte = ponteFalsa()
  const manifesto = (agente) => JSON.stringify({ agente, versao: '0.0.1', banco: null, requer: { node: '>=24' }, executor: { comando: 'node executor/o.mjs', modos: ['servir'] }, tarefas: [], credenciais: [] })
  // Um vizinho que vem antes do oraculo na ordem: quem pega o primeiro da lista em vez do oraculo erra.
  const vizinho = join(pasta, 'alfa')
  mkdirSync(join(vizinho, 'scripts', 'actions'), { recursive: true })
  copyFileSync(FALSO, join(vizinho, 'scripts', 'actions', 'omni-actions.mjs'))
  comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, manifesto('alfa'), { raiz: vizinho }), env)
  if (registrar) comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, manifesto('oraculo'), { raiz }), env)
  const shas = tokens ? comBancoDaCasa(pasta, 'cofre', (db) => garantirTokensDoAgente(db, ponte, 'oraculo'), env) : null
  const valor = tokens ? comBancoDaCasa(pasta, 'cofre', (db) => tokenDoAgente(db, ponte, 'oraculo', 'visita', 'teste'), env) : null
  if (servir) {
    mkdirSync(join(pasta, 'banco'), { recursive: true })
    writeFileSync(arquivoServir(pasta, env), JSON.stringify({ pid: process.pid, porta: 1234, agentes: [{ agente: 'alfa', porta: 9999 }, ...(porta === null ? [] : [{ agente: 'oraculo', porta }])] }))
  }
  const saida = texto()
  const erro = texto()
  const rodar = (argv, extra = {}) => rodarMaos(argv, { env, ponte, saida, erro, ...extra })
  const visto = () => (existsSync(registro) ? JSON.parse(readFileSync(registro, 'utf8')) : null)
  return { pasta, raiz, env, shas, valor, saida, erro, rodar, visto }
}

test('roda o script do Oráculo com os argumentos, a porta do servir.json e o token visita; sai com o código dele', async (t) => {
  const p = preparar(t)
  const codigo = await p.rodar(['execucao', ID, '--estado', 'concluida', '--nota', 'feito'])
  assert.equal(codigo, 3)
  const v = p.visto()
  assert.deepEqual(v.argv, ['execucao', ID, '--estado', 'concluida', '--nota', 'feito'])
  assert.equal(v.api, 'http://127.0.0.1:4567/v1')
  assert.equal(v.token, p.shas.visita, 'o token visita, não o tela')
  assert.equal(resolve(v.cwd).toLowerCase(), resolve(p.raiz).toLowerCase())
  assert.equal(p.saida.lido() + p.erro.lido(), '', 'as mãos não falam quando dá certo')
  const usos = comBancoDaCasa(p.pasta, 'cofre', (db) => db.prepare("SELECT motivo FROM usos WHERE motivo LIKE 'mãos%'").all().map((l) => l.motivo), p.env)
  assert.deepEqual(usos, ['mãos do Actions: execucao'])
})

async function falha(p, argv, padrao) {
  // Exceção crua e saída que não é JSON também reprovam por asserção, não por estouro do teste.
  const codigo = await p.rodar(argv).catch((e) => `lançou ${e?.code ?? e?.name}`)
  assert.equal(codigo, 1)
  let linha = null
  try { linha = JSON.parse(p.saida.lido().trim()) } catch {}
  assert.ok(linha, 'as mãos dizem por que falharam, numa linha JSON')
  assert.equal(linha.ok, false)
  assert.match(linha.erro, padrao)
  assert.equal(p.visto(), null, 'o script não rodou')
  if (p.valor) assert.ok(!(p.saida.lido() + p.erro.lido()).includes(p.valor), 'o token nunca sai')
}

test('sem servir.json', async (t) => {
  await falha(preparar(t, { servir: false }), ['ponto', 'x'], /servir do Omni não está no ar/)
})

test('servir.json com pid morto', async (t) => {
  const p = preparar(t)
  const codigo = await p.rodar(['ponto', 'x'], { vivo: () => false })
  assert.equal(codigo, 1)
  assert.match(JSON.parse(p.saida.lido()).erro, /servir do Omni não está no ar/)
})

test('servir.json ilegível', async (t) => {
  const p = preparar(t)
  writeFileSync(arquivoServir(p.pasta, p.env), '{meio')
  await falha(p, ['ponto', 'x'], /servir do Omni não está no ar/)
})

test('Oráculo sem porta no servir.json', async (t) => {
  await falha(preparar(t, { porta: null }), ['ponto', 'x'], /oraculo não está no ar/)
})

test('Oráculo não instalado nesta máquina', async (t) => {
  await falha(preparar(t, { registrar: false }), ['ponto', 'x'], /oraculo não está instalado/)
})

test('script do Oráculo ausente', async (t) => {
  await falha(preparar(t, { script: false }), ['ponto', 'x'], /omni-actions\.mjs não existe/)
})

test('cofre sem o token visita', async (t) => {
  await falha(preparar(t, { tokens: false }), ['ponto', 'x'], /token visita do oraculo indisponível/)
})

test('comando fora do formato vai ao motivo como (outro), sem ecoar o argumento', async (t) => {
  const p = preparar(t)
  await p.rodar(['C:\\segredo qualquer', 'x'])
  const usos = comBancoDaCasa(p.pasta, 'cofre', (db) => db.prepare("SELECT motivo FROM usos WHERE motivo LIKE 'mãos%'").all().map((l) => l.motivo), p.env)
  assert.deepEqual(usos, ['mãos do Actions: (outro)'])
})
