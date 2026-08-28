import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  calcularFingerprintPayload,
  lerIdentidadeRelease,
  verificarIntegridadeRelease,
  verificarIntegridadePayload
} from '../runtime/integridade-release.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'omni-integrity-'))
  for (const area of ['contratos', 'hooks', 'runtime', 'scripts', 'skills']) {
    await mkdir(join(path, area), { recursive: true })
    await writeFile(join(path, area, 'arquivo.txt'), `${area}\n`, 'utf8')
  }
  return path
}

test('fingerprint é determinístico e detecta qualquer drift do payload', async () => {
  const path = await fixture()
  try {
    const first = await calcularFingerprintPayload(path)
    const second = await calcularFingerprintPayload(path)
    assert.equal(first.fingerprint, second.fingerprint)
    assert.equal((await verificarIntegridadePayload(path, first.fingerprint)).status, 'verified')

    await writeFile(join(path, 'runtime', 'arquivo.txt'), 'alterado\n', 'utf8')
    const drift = await verificarIntegridadePayload(path, first.fingerprint)
    assert.equal(drift.status, 'drifted')
    assert.notEqual(drift.fingerprint, first.fingerprint)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
})

test('identidade canônica verifica payload e detecta divergência da versão pública', async () => {
  const path = await fixture()
  try {
    const actual = await calcularFingerprintPayload(path)
    await mkdir(join(path, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(path, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'omni', version: '1.2.3' }, null, 2)}\n`,
      'utf8'
    )
    await mkdir(join(path, 'contratos', 'atualizacao'), { recursive: true })
    await writeFile(
      join(path, 'contratos', 'atualizacao', 'integridade.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        contract: 'omni-release-integrity-v1',
        identity: { version: '1.2.3', releaseFingerprint: actual.fingerprint }
      }, null, 2)}\n`,
      'utf8'
    )
    assert.equal((await verificarIntegridadeRelease(path)).status, 'verified')

    await writeFile(
      join(path, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'omni', version: '1.2.4' }, null, 2)}\n`,
      'utf8'
    )
    const mismatch = await verificarIntegridadeRelease(path)
    assert.equal(mismatch.status, 'drifted')
    assert.equal(mismatch.versionMatchesManifest, false)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
})

test('contrato canônico declara a versão e exatamente o fingerprint do payload', async () => {
  const manifest = JSON.parse(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  const contract = JSON.parse(await readFile(join(root, 'contratos', 'atualizacao', 'integridade.json'), 'utf8'))
  const actual = await calcularFingerprintPayload(root)
  assert.equal(Object.hasOwn(manifest, 'releaseFingerprint'), false)
  assert.equal(contract.identity.version, manifest.version)
  assert.match(contract.identity.releaseFingerprint ?? '', /^[a-f0-9]{64}$/)
  assert.equal(contract.identity.releaseFingerprint, actual.fingerprint)
})

test('bundle sem contrato continua legível, mas fica marcado como legado não verificável', async () => {
  const path = await fixture()
  try {
    await mkdir(join(path, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(path, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'omni', version: '1.2.3' }, null, 2)}\n`,
      'utf8'
    )
    const identity = await lerIdentidadeRelease(path)
    const integrity = await verificarIntegridadeRelease(path)
    assert.equal(identity.source, 'legacy-plugin-manifest')
    assert.equal(identity.releaseFingerprint, null)
    assert.equal(integrity.status, 'legacy-unverifiable')
  } finally {
    await rm(path, { recursive: true, force: true })
  }
})
