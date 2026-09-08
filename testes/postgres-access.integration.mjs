// Explicit integration test: creates only a disposable, loopback-only PostgreSQL cluster with synthetic credentials.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bin = process.argv[2]
assert.ok(bin, 'PostgreSQL bin directory is required')
const executable = name => join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`)
const out = join(root, 'out', 'implementation')
await mkdir(out, { recursive: true })
const temporary = await mkdtemp(join(out, 'pg-access-test-'))
const data = join(temporary, 'data')
const password = randomBytes(32).toString('hex')
const passwordFile = join(temporary, 'synthetic-password')
await writeFile(passwordFile, `${password}\n`, { mode: 0o600, flag: 'wx' })
const server = createServer()
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
const port = server.address().port
await new Promise(done => server.close(done))
const env = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' }
// A daemon must not inherit the parent's captured pipe handles on Windows: that keeps execFileSync waiting after pg_ctl exited.
const run = (name, args, input) => execFileSync(executable(name), args, { env, input, encoding: 'utf8', windowsHide: true, timeout: 30_000, stdio: name === 'pg_ctl' ? 'ignore' : ['pipe', 'pipe', 'pipe'], maxBuffer: 2_000_000 })
const sql = (input, database = 'omni', user = 'omni_test_admin') => run('psql', ['-X', '-w', '-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], input).replaceAll('\r\n', '\n').trim()
const sqlAs = (user, input) => sql(input, 'omni', user)
const source = join(root, 'adaptadores', 'postgresql', 'migrations', '001-access-foundation.sql')
const checksum = createHash('sha256').update(await readFile(source)).digest('hex')
const migrate = (hash = checksum) => run('psql', ['-X', '-w', '-h', '127.0.0.1', '-p', String(port), '-U', 'omni_test_admin', '-d', 'omni', '-v', 'ON_ERROR_STOP=1', '-v', `migration_checksum=${hash}`, '-f', source])
const checks = []
let started = false
let startAttempted = false
let failure = null
try {
  run('initdb', ['-D', data, '--username=omni_test_admin', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C'])
  startAttempted = true
  run('pg_ctl', ['-D', data, '-l', join(temporary, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '10', 'start'])
  started = true
  sql('CREATE DATABASE omni;', 'postgres')
  migrate()
  migrate()
  assert.equal(sql('SELECT count(*) FROM omni_meta.schema_migrations;'), '1')
  assert.throws(() => migrate('0'.repeat(64)))
  checks.push('migration-idempotent-and-checksum-locked')
  assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'omni_%' AND rolname <> 'omni_test_admin' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcanlogin);"), '0')
  checks.push('application-roles-no-login-no-superuser-no-bypassrls')
  const ownerA = '00000000-0000-4000-8000-000000000001'
  const ownerB = '00000000-0000-4000-8000-000000000002'
  sql(`CREATE ROLE omni_test_a LOGIN PASSWORD '${password}'; GRANT omni_access_admin TO omni_test_a;
CREATE ROLE omni_test_b LOGIN PASSWORD '${password}'; GRANT omni_access_admin TO omni_test_b;
CREATE ROLE omni_test_unmapped LOGIN PASSWORD '${password}'; GRANT omni_access_runtime TO omni_test_unmapped;
INSERT INTO identity.login_owners VALUES ('omni_test_a', '${ownerA}'), ('omni_test_b', '${ownerB}');`)
  const insert = owner => `INSERT INTO access.credential_versions (owner_id, credential_id, version, provider_ref, account_ref, environment_ref, secret_ref, expiry_kind, expiry_source, status, status_changed_at, renewal_mode) VALUES ('${owner}', 'synthetic', 1, 'fixture', 'fixture', 'test', 'credential-ref:synthetic', 'unknown', 'unknown', 'unverified', now(), 'none');`
  sqlAs('omni_test_a', insert(ownerA))
  sqlAs('omni_test_b', insert(ownerB))
  assert.equal(sqlAs('omni_test_a', 'SELECT count(*) FROM access.credential_versions;'), '1')
  assert.throws(() => sqlAs('omni_test_a', `UPDATE access.credential_versions SET owner_id = '${ownerB}';`))
  assert.throws(() => sqlAs('omni_test_a', 'SET SESSION AUTHORIZATION omni_test_b;'))
  assert.equal(sqlAs('omni_test_unmapped', 'SELECT count(*) FROM access.credential_versions;'), '0')
  checks.push('rls-owner-isolation-write-check-no-login-binding-denies')
  assert.throws(() => sql('SET SESSION AUTHORIZATION omni_memory_runtime; SELECT * FROM access.credential_versions;'))
  assert.throws(() => sql('SET SESSION AUTHORIZATION omni_operations_runtime; SELECT * FROM access.credential_versions;'))
  assert.throws(() => sql('SET SESSION AUTHORIZATION omni_access_runtime; SELECT * FROM identity.login_owners;'))
  checks.push('memory-operations-cannot-read-access-or-authentication-bindings')
  assert.throws(() => sqlAs('omni_test_a', "UPDATE access.credential_versions SET expiry_kind = 'known';"))
  assert.throws(() => sqlAs('omni_test_a', "UPDATE access.credential_versions SET status = 'active';"))
  assert.throws(() => sqlAs('omni_test_a', "UPDATE access.credential_versions SET status = 'revoked';"))
  checks.push('database-validates-expiration-and-verification')
  const event = `INSERT INTO audit.credential_events VALUES ('${ownerA}', '00000000-0000-4000-8000-000000000003', 'synthetic', 1, now(), 'timeout', 'evidence:synthetic', 'applied');`
  sqlAs('omni_test_a', event)
  assert.throws(() => sqlAs('omni_test_a', event))
  assert.throws(() => sqlAs('omni_test_a', 'DELETE FROM audit.credential_events;'))
  assert.throws(() => sqlAs('omni_test_a', "UPDATE audit.credential_events SET kind = 'authenticated';"))
  assert.throws(() => sqlAs('omni_test_a', 'TRUNCATE audit.credential_events;'))
  checks.push('event-deduplication-and-append-only-audit')
} catch (error) {
  failure = { name: error.name, code: error.code ?? null, message: String(error.message).replaceAll(password, '[synthetic-redacted]').slice(0, 3000) }
  process.exitCode = 1
} finally {
  let stopped = !startAttempted
  if (startAttempted && !started) {
    try { run('pg_ctl', ['-D', data, 'status']); started = true } catch (error) { stopped = error.status === 3 }
  }
  if (started) {
    try { run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); stopped = true } catch { stopped = false; process.exitCode = 1 }
  }
  const serverDiagnostics = failure ? await readFile(join(temporary, 'server.log'), 'utf8').then(value => value.replaceAll(password, '[synthetic-redacted]').slice(-4000)).catch(() => null) : null
  const report = { schemaVersion: 1, kind: 'disposable-postgresql-integration-not-production', checksum, checks, failure, stopped, productionDatabaseTouched: false, serverDiagnostics }
  await writeFile(join(out, `${temporary.split(/[\\/]/u).at(-1)}-report.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify(report))
  // Remove only the exact newly created test cluster, after proving the server stopped and the target stays inside out.
  const actual = await realpath(temporary)
  const boundary = relative(await realpath(out), actual)
  if (stopped && /^pg-access-test-[^\\/]+$/u.test(boundary)) await rm(actual, { recursive: true, force: true })
}
