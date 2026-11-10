// Guarda do T4 da F2: o Crachá (apps/omni-desktop), o broker de acesso e o PG 5433 saíram do código em 10/11/2026.
// Ficam só as peças que o 6b usa para importar, conferir e desligar o 5433. Se alguém trouxer de volta um caminho
// aposentado, ou um arquivo vivo voltar a apontar para ele, esta guarda fica vermelha e diz qual.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

const APOSENTADOS = [
  'apps/omni-desktop',
  'adaptadores/postgresql',
  'scripts/omni-access-broker.ps1',
  'scripts/start-omni-access-broker.ps1',
  'scripts/start-user-omni-access-broker.ps1',
  'scripts/stop-omni-access-broker.ps1',
  'scripts/install-omni-access-broker-service.ps1',
  'scripts/elevate-install-omni-access-broker-service.ps1',
  'scripts/interactive-install-omni-access-broker-service.ps1',
  'scripts/start-install-omni-access-broker-service.ps1',
  'scripts/protect-omni-access-broker-credential.ps1',
  'scripts/start-omni-private-executor.ps1',
  'scripts/start-user-omni-runtime.ps1',
  'scripts/start-user-omni-runtime-hidden.vbs',
  'scripts/install-user-omni-startup.ps1',
  'scripts/install-user-omni-runtime-tasks.ps1',
  'scripts/provision-omni-postgresql.ps1',
  'scripts/initialize-dedicated-omni-postgresql.ps1',
  'scripts/start-dedicated-omni-postgresql.ps1',
  'scripts/apply-omni-postgresql-migration.ps1',
  'scripts/probe-postgresql-admin-elevated.ps1',
  'scripts/read-omni-database.ps1',
  'scripts/new-omni-database-observer.ps1',
  'scripts/omni-credential-execution.ps1',
  'scripts/omni-credential-verification.ps1',
  'scripts/omni-credential-write-ops.ps1',
  'scripts/omni-realtime-token.ps1',
  'scripts/start-omni-desktop-hidden.vbs',
  'scripts/install-omni-desktop-shortcut.ps1',
  'src/adapters/windows',
  'src/adapters/postgresql',
  'src/ports/access-broker-client.ts',
  'src/ports/credential-metadata-repository.ts',
  'src/ports/durable-memory-client.ts',
  'src/ports/durable-mission-client.ts',
  'src/ports/durable-operational-learning-client.ts',
  'src/contracts/credential-execution.ts',
  'src/contracts/credential-metadata.ts',
  'src/core/access',
  'dist/adapters/windows',
  'dist/adapters/postgresql',
  'dist/ports/access-broker-client.js',
  'dist/ports/credential-metadata-repository.js',
  'dist/ports/durable-memory-client.js',
  'dist/ports/durable-mission-client.js',
  'dist/ports/durable-operational-learning-client.js',
  'dist/contracts/credential-execution.js',
  'dist/contracts/credential-metadata.js',
  'dist/core/access',
  'testes/access-broker.typescript.test.ts',
  'testes/credential-lifecycle.typescript.test.ts',
  'testes/private-executor-integration.test.mjs',
  'testes/ssh-executor.test.mjs',
  'testes/postgres-access.integration.mjs',
  'testes/credential-execution-broker.test.ps1',
  'testes/credential-verification-broker.test.ps1',
  'testes/credential-verification-transaction.rollback.ps1',
  'testes/credential-write-ops.test.ps1',
  'contratos/interface/omni-desktop.json'
]

// Rastros que só o código aposentado tinha: o app, o nome do pipe do broker, o logon do runtime e o executor do Crachá.
const RASTROS = [/apps[\\/]omni-desktop/, /omni-access-broker-v\d/, /start-user-omni-runtime/, /omni-credential-execution/]
const PASTAS_VIVAS = ['runtime/', 'src/', 'scripts/', 'hooks/', 'executor/', 'apps/omni-ilha/', 'contratos/']
const ARQUIVOS_VIVOS = ['package.json']
// As peças do 6b citam o mundo antigo de propósito, para achá-lo e desligá-lo; o histórico de releases também.
const FICAM = new Set(['contratos/atualizacao/releases.json'])

function rastreados() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' }).split('\0').filter(Boolean)
}

test('os caminhos aposentados do Crachá, do broker e do PG não existem mais', () => {
  const sobrou = APOSENTADOS.filter((caminho) => existsSync(join(RAIZ, caminho)))
  assert.deepEqual(sobrou, [])
})

test('nenhum arquivo vivo aponta para o Crachá, o pipe do broker ou o logon do runtime', () => {
  const vivos = rastreados().filter((caminho) =>
    (ARQUIVOS_VIVOS.includes(caminho) || PASTAS_VIVAS.some((pasta) => caminho.startsWith(pasta))) &&
    !FICAM.has(caminho) && existsSync(join(RAIZ, caminho)) && !/\.(png|jpe?g|ico|gif|webp|db)$/i.test(caminho))
  const achados = []
  for (const caminho of vivos) {
    const texto = readFileSync(join(RAIZ, caminho), 'utf8')
    for (const rastro of RASTROS) if (rastro.test(texto)) achados.push(`${caminho} -> ${rastro.source}`)
  }
  assert.deepEqual(achados, [])
})

test('os contratos de arquitetura não dizem mais que o desktop está ativo', () => {
  const escopo = readFileSync(join(RAIZ, 'contratos/arquitetura/escopo.json'), 'utf8')
  const invariantes = readFileSync(join(RAIZ, 'contratos/arquitetura/invariantes.json'), 'utf8')
  for (const texto of [escopo, invariantes]) {
    assert.doesNotMatch(texto, /omni-desktop-body-contract-active|omni-desktop-interface-active|omni-desktop-active/)
  }
  assert.equal(JSON.parse(escopo).sections['35'], 'omni-desktop-body-contract-retired')
  assert.equal(JSON.parse(invariantes).availability.continuousPresence, 'omni-ilha')
})
