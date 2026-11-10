// O executor confere a própria versão (F2, plano 5b-2): o omni-instalar.ps1 só promove uma pasta baixada
// para versoes\<sha> depois que `executor.mjs release` dela sai 0 com a impressão digital batendo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { calcularFingerprintPayload } from '../runtime/integridade-release.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const VERSAO = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version
const PASTAS = ['.claude-plugin', 'adaptadores', 'contratos', 'dist', 'executor', 'hooks', 'runtime', 'scripts', 'skills']

// Cópia do payload com o contrato selado para a própria cópia: o teste não depende de o ramo estar
// com a impressão digital em dia (ela só é carimbada no bump da release).
async function copiarPayload(t) {
  const copia = mkdtempSync(join(tmpdir(), 'omni-release-'))
  t.after(() => rmSync(copia, { recursive: true, force: true }))
  for (const pasta of PASTAS) {
    if (existsSync(join(RAIZ, pasta))) cpSync(join(RAIZ, pasta), join(copia, pasta), { recursive: true, filter: (o) => !o.includes('postgresql-5433') })
  }
  cpSync(join(RAIZ, 'package.json'), join(copia, 'package.json'))
  const contrato = join(copia, 'contratos', 'atualizacao', 'integridade.json')
  const json = JSON.parse(readFileSync(contrato, 'utf8'))
  json.identity.releaseFingerprint = (await calcularFingerprintPayload(copia)).fingerprint
  writeFileSync(contrato, `${JSON.stringify(json, null, 2)}\n`)
  return copia
}

function rodar(raiz, argv) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-release-casa-'))
  try {
    const r = spawnSync(process.execPath, [join(raiz, 'runtime', 'executor.mjs'), ...argv], {
      encoding: 'utf8', env: { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'banco') }
    })
    const ultima = r.stdout.trim().split('\n').pop()
    return { status: r.status, json: ultima ? JSON.parse(ultima) : null, erro: r.stderr }
  } finally { rmSync(casa, { recursive: true, force: true }) }
}

test('release confere a impressão digital da própria raiz', async (t) => {
  const copia = await copiarPayload(t)
  const boa = rodar(copia, ['release'])
  assert.equal(boa.status, 0, boa.erro)
  assert.deepEqual(Object.keys(boa.json).sort(), ['fingerprint', 'ok', 'versao'])
  assert.equal(boa.json.ok, true)
  assert.equal(boa.json.versao, VERSAO)
  assert.match(boa.json.fingerprint, /^[a-f0-9]{64}$/)

  appendFileSync(join(copia, 'runtime', 'servir.mjs'), '\n// adulterado\n')
  const ruim = rodar(copia, ['release'])
  assert.equal(ruim.status, 3, ruim.erro)
  assert.equal(ruim.json.ok, false)
  assert.equal(ruim.json.codigo, 'integridade')
  assert.equal(ruim.json.estado, 'drifted')
})

test('release não aceita opção', async (t) => {
  const copia = await copiarPayload(t)
  const r = rodar(copia, ['release', '--qualquer'])
  assert.equal(r.status, 2)
  assert.match(r.erro, /opções inválidas/)
})
