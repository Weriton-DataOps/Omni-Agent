// Conferência do Crachá (F2, plano 6a, T2): as versões de credencial que o PG 5433 guarda como
// metadado contra o Gerenciador de Credenciais (onde mora o segredo) e o cofre.db (onde a casa
// inventaria). Tudo aqui é falso: exportação, inventário e cofre numa casa temporária.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { registrarInventarioWindows } from '../runtime/casa/loja-cofre.mjs'
import { CONSULTA, alvoDoSecretRef, conferirCracha } from '../scripts/omni-conferir-cracha.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/omni-conferir-cracha.mjs', import.meta.url))

const versao = (id, ref, extra = {}) => ({ credential_id: id, version: 1, provider_ref: 'servico-' + id, secret_ref: ref, status: 'active', eventos: 0, ...extra })

test('o secret_ref do broker vira o alvo do Gerenciador; qualquer outro formato não vira alvo', () => {
  assert.equal(alvoDoSecretRef('credential-ref:windows-github.pessoal'), 'Omni/UserCredential/github.pessoal')
  assert.equal(alvoDoSecretRef('credential-ref:vault-github'), null)
  assert.equal(alvoDoSecretRef('credential-ref:windows-'), null)
  assert.equal(alvoDoSecretRef(undefined), null)
})

test('a versão viva que falta no Gerenciador reprova e é nomeada; a presente passa', () => {
  const r = conferirCracha({
    versoes: [versao('a', 'credential-ref:windows-a'), versao('b', 'credential-ref:windows-b')],
    inventario: [{ alvo: 'omni/usercredential/A', usuario: 'x' }],
    noCofre: ['Omni/UserCredential/a']
  })
  assert.equal(r.ok, false)
  assert.deepEqual(r.linhas.map((l) => [l.credencial, l.alvo, l.gerenciador, l.cofre]), [
    ['a', 'Omni/UserCredential/a', 'no-gerenciador', 'no-cofre.db'],
    ['b', 'Omni/UserCredential/b', 'ausente', 'fora']
  ])
  assert.deepEqual(r.reprovadas, ['b v1'])
})

test('secret_ref fora do formato vira formato-desconhecido e nunca passa', () => {
  const r = conferirCracha({ versoes: [versao('c', 'credential-ref:vault-c')], inventario: [{ alvo: 'Omni/UserCredential/c' }], noCofre: [] })
  assert.equal(r.ok, false)
  assert.equal(r.linhas[0].gerenciador, 'formato-desconhecido')
  assert.equal(r.linhas[0].alvo, null)
  assert.deepEqual(r.reprovadas, ['c v1'])
})

test('versão aposentada (revogada, substituída, desligada) pode faltar sem reprovar', () => {
  const r = conferirCracha({
    versoes: ['revoked', 'replaced', 'disabled'].map((status, i) => versao('d' + i, 'credential-ref:windows-d' + i, { status })),
    inventario: [],
    noCofre: []
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.linhas.map((l) => l.gerenciador), ['ausente', 'ausente', 'ausente'])
  assert.deepEqual(r.linhas.map((l) => l.aposentada), [true, true, true])
})

test('a consulta é só leitura e não pede coluna de conta nem de segredo além da referência', () => {
  assert.match(CONSULTA, /from access\.credential_versions/i)
  assert.match(CONSULTA, /audit\.credential_events/i)
  assert.doesNotMatch(CONSULTA, /\b(insert|update|delete|drop|alter|truncate|grant)\b/i)
  assert.doesNotMatch(CONSULTA, /account_ref/i)
})

function casaComCofre(t, alvos) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-cracha-'))
  t.after(() => rmSync(casa, { recursive: true, force: true }))
  comBancoDaCasa(casa, 'cofre', (db) => registrarInventarioWindows(db, alvos.map((alvo) => ({ alvo, usuario: null }))), { ...process.env, OMNI_CASA_BANCO: '' })
  return casa
}

function rodar(casa, args) {
  const env = { ...process.env, OMNI_HOME: casa }
  delete env.OMNI_CASA_BANCO
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 60_000 })
}

test('linha de comando: sai 1 nomeando a ausente, sai 0 quando tudo existe, e nunca ecoa a conta', (t) => {
  const casa = casaComCofre(t, ['Omni/UserCredential/a'])
  const exportacao = join(casa, 'cracha.json')
  const inventario = join(casa, 'inventario.json')
  const conta = 'conta-que-nao-pode-aparecer'
  writeFileSync(exportacao, JSON.stringify([versao('a', 'credential-ref:windows-a', { account_ref: conta }), versao('b', 'credential-ref:windows-b', { account_ref: conta })]))
  writeFileSync(inventario, JSON.stringify([{ alvo: 'Omni/UserCredential/a', usuario: conta }]))

  const falta = rodar(casa, ['--exportacao', exportacao, '--inventario', inventario])
  assert.equal(falta.status, 1, falta.stderr)
  const relatorio = JSON.parse(falta.stdout)
  assert.deepEqual(relatorio.reprovadas, ['b v1'])
  assert.equal(relatorio.linhas.find((l) => l.credencial === 'a').cofre, 'no-cofre.db')
  assert.doesNotMatch(falta.stdout + falta.stderr, new RegExp(conta))

  writeFileSync(inventario, JSON.stringify([{ alvo: 'Omni/UserCredential/a' }, { alvo: 'Omni/UserCredential/b' }]))
  const tudo = rodar(casa, ['--exportacao', exportacao, '--inventario', inventario])
  assert.equal(tudo.status, 0, tudo.stderr)
  assert.equal(JSON.parse(tudo.stdout).ok, true)
})

test('linha de comando: --consulta só imprime a consulta; sem exportação é uso errado', (t) => {
  const casa = casaComCofre(t, [])
  const consulta = rodar(casa, ['--consulta'])
  assert.equal(consulta.status, 0, consulta.stderr)
  assert.equal(consulta.stdout.trim(), CONSULTA.trim())
  assert.equal(rodar(casa, []).status, 2)
})
