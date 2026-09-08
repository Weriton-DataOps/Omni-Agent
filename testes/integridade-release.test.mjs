import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  calcularFingerprintPayload,
  lerIdentidadeRelease,
  listarArquivosDoPayload,
  listarEntrypointsReferenciados,
  verificarCoberturaEntrypoints,
  verificarIntegridadeRelease,
  verificarIntegridadePayload
} from '../runtime/integridade-release.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'omni-integrity-'))
  for (const area of ['contratos', 'dist', 'hooks', 'runtime', 'scripts', 'skills']) {
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

test('payload cobre executáveis em adaptadores e no emit TypeScript dist', async () => {
  const path = await fixture()
  try {
    await mkdir(join(path, 'adaptadores'), { recursive: true })
    await mkdir(join(path, 'dist', 'entrypoints'), { recursive: true })
    await writeFile(join(path, 'adaptadores', 'legacy.mjs'), 'export const legacy = true\n', 'utf8')
    await writeFile(join(path, 'dist', 'entrypoints', 'hook.js'), 'export const hook = true\n', 'utf8')
    const files = await listarArquivosDoPayload(path)
    assert.ok(files.includes('adaptadores/legacy.mjs'))
    assert.ok(files.includes('dist/entrypoints/hook.js'))
    await rm(join(path, 'dist'), { recursive: true, force: true })
    await assert.rejects(listarArquivosDoPayload(path), /Raiz obrigatoria do payload ausente: dist/)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
})

test('gate enumera entrypoints dos hooks, scripts, package e executáveis auto declarados', async () => {
  const path = await fixture()
  try {
    await mkdir(join(path, 'adaptadores'), { recursive: true })
    await mkdir(join(path, 'dist', 'entrypoints'), { recursive: true })
    await mkdir(join(path, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(path, 'runtime', 'cli.mjs'),
      "import '../dist/entrypoints/hook.js'\nexport const cli = true\n",
      'utf8'
    )
    await writeFile(
      join(path, 'adaptadores', 'authority.mjs'),
      "if (process.argv[1]) process.stdout.write('ready')\n",
      'utf8'
    )
    await writeFile(join(path, 'dist', 'entrypoints', 'hook.js'), 'export const hook = true\n', 'utf8')
    await writeFile(
      join(path, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{
            matcher: '',
            hooks: [{
              type: 'command',
              command: 'node',
              args: ['${CLAUDE_PLUGIN_ROOT}/dist/entrypoints/hook.js']
            }]
          }]
        }
      }),
      'utf8'
    )
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({ scripts: { check: 'node --check runtime/cli.mjs' } }),
      'utf8'
    )
    await writeFile(
      join(path, 'scripts', 'omni.ps1'),
      "$cli = Join-Path $raiz 'runtime\\cli.mjs'\n",
      'utf8'
    )
    const entrypoints = await listarEntrypointsReferenciados(path)
    assert.deepEqual(entrypoints.map((item) => item.path), [
      'adaptadores/authority.mjs',
      'dist/entrypoints/hook.js',
      'runtime/cli.mjs'
    ])
    assert.deepEqual(
      entrypoints.find((item) => item.path === 'dist/entrypoints/hook.js').sources,
      ['hooks/hooks.json', 'import:runtime/cli.mjs']
    )
    assert.equal((await verificarCoberturaEntrypoints(path)).ok, true)

    const hooks = JSON.parse(await readFile(join(path, 'hooks', 'hooks.json'), 'utf8'))
    hooks.hooks.SessionStart[0].hooks[0].args[0] = '${CLAUDE_PLUGIN_ROOT}/dist/entrypoints/missing.js'
    await writeFile(join(path, 'hooks', 'hooks.json'), JSON.stringify(hooks), 'utf8')
    const broken = await verificarCoberturaEntrypoints(path)
    assert.deepEqual(broken.missing, ['dist/entrypoints/missing.js'])
    assert.deepEqual(broken.outsidePayload, ['dist/entrypoints/missing.js'])
    assert.equal(broken.ok, false)
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
  assert.ok(Number.isFinite(Date.parse(contract.identity.releaseAuditScopeStartedAt)))
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
    assert.equal(identity.releaseAuditScopeStartedAt, null)
    assert.equal(integrity.status, 'legacy-unverifiable')
  } finally {
    await rm(path, { recursive: true, force: true })
  }
})
