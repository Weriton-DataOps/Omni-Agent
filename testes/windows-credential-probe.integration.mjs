// Explicit, read-only Windows integration check. No credential is created or changed.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

assert.equal(process.platform, 'win32', 'This integration check requires Windows.')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = `Omni/Diagnostics/absent-${randomUUID()}`
const result = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', join(root, 'scripts', 'probe-windows-credential.ps1'), '-Target', target
], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
assert.ifError(result.error)
assert.equal(result.status, 2, 'A missing credential must fail with the documented exit code.')
assert.equal(result.stderr.trim(), '')
const report = JSON.parse(result.stdout)
assert.equal(report.target, target)
assert.equal(report.status, 'credential-not-found')
assert.equal(report.win32Error, 1168)
assert.equal(report.found, false)
assert.equal(report.databaseAuthenticationVerified, false)
assert.equal(report.bootstrapReady, false)
assert.equal(report.secretDecoded, false)
assert.equal(report.secretEmitted, false)
assert.deepEqual(Object.keys(report).sort(), [
  'bootstrapReady', 'checkedAt', 'databaseAuthenticationVerified', 'found', 'secretDecoded',
  'secretEmitted', 'status', 'target', 'win32Error', 'windowsIdentity', 'windowsSid'
].sort())
console.log(JSON.stringify({ ok: true, kind: 'missing-credential-fails-closed', credentialWrites: 0, secretEmitted: false }))
