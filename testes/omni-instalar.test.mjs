// O executor do Windows (F2, plano 5b-2): scripts/omni-instalar.ps1 de verdade, com pasta base, casa e
// programas de fora trocados por temporários e falsos. Só roda no Windows.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'

import { criarOrigem } from './fixtures/origem-selada.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const SCRIPT = join(RAIZ, 'scripts', 'omni-instalar.ps1')
const VERSAO = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version
const MAJOR = process.versions.node.split('.')[0]
const windows = process.platform === 'win32'

// Tudo que mexe no Windows de verdade fica desligado por padrão; cada teste liga o que examina.
const BASICO = ['-SemIlha', '-SemWhatsApp', '-SemTarefas', '-SemPlugin', '-NaoAbrir', '-SemWinget']

let origem
before(async () => { if (windows) origem = await criarOrigem() })
after(() => origem?.apagar())

function pastaTemp(t, prefixo) {
  const pasta = mkdtempSync(join(tmpdir(), prefixo))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  return pasta
}

function instalar(t, argumentos, { base = pastaTemp(t, 'omni-base-'), casa = pastaTemp(t, 'omni-casa-'), env = {} } = {}) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...argumentos, '-Base', base], {
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      OMNI_HOME: casa,
      OMNI_CASA_BANCO: join(casa, 'banco'),
      OMNI_INSTALAR_NODE: process.execPath,
      OMNI_INSTALAR_NODE_MINIMO: MAJOR, // o CI roda Node 22; o mínimo de produção (24) tem teste próprio abaixo
      ...env
    }
  })
  const ultima = r.stdout.trim().split(/\r?\n/).pop()
  let json = null
  try { json = ultima ? JSON.parse(ultima) : null } catch { /* saída sem JSON */ }
  return { status: r.status, json, saida: r.stdout, erro: r.stderr, base, casa }
}

const passo = (json, nome) => json?.passos?.find((p) => p.passo === nome)
const versoes = (base) => (existsSync(join(base, 'versoes')) ? readdirSync(join(base, 'versoes')) : [])

test('instalar busca o commit, confere a impressão digital e promove para versoes\\<sha>', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO])
  assert.equal(r.status, 0, r.erro)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.sha, origem.sha)
  assert.equal(r.json.versao, VERSAO)
  assert.equal(passo(r.json, 'versao').ok, true)
  assert.ok(existsSync(join(r.base, 'versoes', origem.sha, 'runtime', 'executor.mjs')))
  const atual = JSON.parse(readFileSync(join(r.base, 'versoes', 'atual.json'), 'utf8'))
  assert.equal(atual.sha, origem.sha)
  assert.equal(atual.versao, VERSAO)
  assert.deepEqual(versoes(r.base).sort(), [origem.sha, 'atual.json'].sort(), 'nenhuma pasta temporária sobra')
})

test('a mesma versão de novo não baixa nem reescreve', { skip: !windows }, (t) => {
  const primeira = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO])
  assert.equal(primeira.status, 0, primeira.erro)
  const arquivo = join(primeira.base, 'versoes', origem.sha, 'runtime', 'executor.mjs')
  const antes = statSync(arquivo).mtimeMs
  const segunda = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO], { base: primeira.base })
  assert.equal(segunda.status, 0, segunda.erro)
  assert.equal(passo(segunda.json, 'versao').detalhe, 'já instalada')
  assert.equal(statSync(arquivo).mtimeMs, antes)
})

test('commit com o payload adulterado não vira versão instalada', { skip: !windows }, async (t) => {
  const adulterado = await origem.commitar((repo) => appendFileSync(join(repo, 'runtime', 'servir.mjs'), '\n// adulterado\n'), { selar: false })
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', adulterado, ...BASICO])
  assert.equal(r.status, 1, r.erro)
  assert.equal(r.json.ok, false)
  assert.equal(passo(r.json, 'versao').ok, false)
  assert.match(passo(r.json, 'versao').detalhe, /integridade/)
  assert.deepEqual(versoes(r.base), [], 'nem a pasta da versão nem atual.json nem temporária')
})

test('commit que não existe na origem falha sem deixar rastro', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', 'f'.repeat(40), ...BASICO])
  assert.equal(r.status, 1, r.erro)
  assert.equal(passo(r.json, 'versao').ok, false)
  assert.deepEqual(versoes(r.base), [])
})

test('Node abaixo do mínimo para antes de baixar qualquer coisa', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO], { env: { OMNI_INSTALAR_NODE_MINIMO: '99' } })
  assert.equal(r.status, 1, r.erro)
  assert.equal(passo(r.json, 'prerequisitos').ok, false)
  assert.match(passo(r.json, 'prerequisitos').detalhe, /node/i)
  assert.equal(passo(r.json, 'versao'), undefined)
  assert.deepEqual(versoes(r.base), [])
})

test('o mínimo de produção é Node 24', { skip: !windows }, () => {
  assert.match(readFileSync(SCRIPT, 'utf8'), /OMNI_INSTALAR_NODE_MINIMO[^\n]*\b24\b/)
})

test('instalar sem -Sha é uso errado', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', ...BASICO])
  assert.equal(r.status, 2)
  assert.match(r.erro, /-Sha/)
})
