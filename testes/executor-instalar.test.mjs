// O executor instala (F2, plano 5b-1): a casa com os três bancos e o Omni registrado no núcleo, e os
// outros agentes com tokens no cofre, sha256 entregue ao instalar --stdin deles e registro só depois.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { arquivoDoBanco, comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { BANCOS } from '../runtime/casa/esquemas.mjs'
import { listarInstalados } from '../runtime/casa/loja-nucleo.mjs'
import { rodarExecutor } from '../runtime/executor.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const VERSAO = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version

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
