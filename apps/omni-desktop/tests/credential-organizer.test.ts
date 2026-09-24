import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingAccessHint, organizeCredentialText } from '../src/main/credential-organizer'
import { privateExecutionSources } from '../src/main/private-execution-sources'

// Credenciais exclusivamente fictícias.
const SSH_PASS = 'S3nh@-Ficticia!7'
const PG_PASS = 'pg-Ficticia#9'
const doc = (text: string) => {
  const result = organizeCredentialText(text)
  assert.ok(result && result.kind === 'document', 'esperava documento organizado')
  return JSON.parse(result.json)
}
const noLookup = async () => null

test('texto livre no formato pedido pelo Omni vira SSH + PostgreSQL via sudo, sem perguntar nada', async () => {
  const text = `DW .7 (SSH)\nhost: 192.168.110.7\nusuário: dados\nsenha: ${SSH_PASS}\nfingerprint: SHA256:abcFicticio`
  const value = doc(text)
  assert.deepEqual(value.ssh, { kind: 'ssh', host: '192.168.110.7', username: 'dados', password: SSH_PASS, port: '22', hostKeySha256: 'SHA256:abcFicticio' })
  assert.equal(value.mode, 'sudo-postgres')
  assert.equal(value.database.username, 'postgres')
  assert.equal(value.database.database, 'postgres')
  const { accesses } = await privateExecutionSources(JSON.stringify(value), noLookup)
  assert.equal(accesses.length, 1)
  assert.equal('ssh' in accesses[0].source, true)
})

test('rótulos informais (IP, user, pass) e porta no host são entendidos', () => {
  const value = doc(`servidor do dw\nIP: 10.0.0.7:2222\nuser: root\npass: ${SSH_PASS}`)
  assert.equal(value.ssh.host, '10.0.0.7')
  assert.equal(value.ssh.port, '2222')
  assert.equal(value.ssh.username, 'root')
  assert.equal(value.ssh.password, SSH_PASS)
})

test('user@host em linha solta e senha do PG7 com qualificador vão para os acessos certos', async () => {
  const value = doc(`ssh dados@192.168.110.7\nsenha: ${SSH_PASS}\nsenha do PG7: ${PG_PASS}`)
  assert.equal(value.ssh.username, 'dados')
  assert.equal(value.ssh.password, SSH_PASS)
  assert.equal(value.database.password, PG_PASS)
  assert.equal(value.mode, 'password')
  const { accesses } = await privateExecutionSources(JSON.stringify(value), noLookup)
  assert.equal(accesses.length, 1)
})

test('pares inline na mesma linha', () => {
  const value = doc(`acesso ssh host 192.168.110.7 usuario dados senha ${SSH_PASS} banco dw`)
  assert.equal(value.ssh.host, '192.168.110.7')
  assert.equal(value.ssh.password, SSH_PASS)
})

test('blocos SSH e PostgreSQL separados por cabeçalho', () => {
  const value = doc(`SSH\nhost: 192.168.110.7\nusuario: dados\nsenha: ${SSH_PASS}\nPostgreSQL\nusuario: dw_leitura\nsenha: ${PG_PASS}\nbanco: dw`)
  assert.equal(value.ssh.username, 'dados')
  assert.equal(value.database.username, 'dw_leitura')
  assert.equal(value.database.database, 'dw')
  assert.equal(value.database.password, PG_PASS)
  assert.equal(value.mode, 'password')
})

test('SSH sem relação com banco é cadastrado sozinho, com nome automático', () => {
  const result = organizeCredentialText(`host: 10.1.1.20\nuser: deploy\npass: ${SSH_PASS}`)
  assert.ok(result && result.kind === 'registration')
  assert.equal(result.registration.providerRef, 'ssh')
  assert.equal(result.registration.credentialId.includes(SSH_PASS), false)
  assert.equal(JSON.parse(result.registration.token).password, SSH_PASS)
})

test('PostgreSQL direto', () => {
  const value = doc(`PostgreSQL\nhost: db.local:5433\nusuario: app\nsenha: ${PG_PASS}\nbanco: vendas`)
  assert.deepEqual(value.credentials[0], { kind: 'database', engine: 'postgresql', host: 'db.local', port: '5433', database: 'vendas', username: 'app', password: PG_PASS })
})

test('sem dados suficientes ou texto que não é acesso devolve null (nada é inventado)', () => {
  assert.equal(organizeCredentialText('lembrar de revisar o painel amanhã'), null)
  assert.equal(organizeCredentialText('host: 192.168.110.7\nusuario: dados'), null)
  assert.equal(organizeCredentialText('{"ssh":{},"database":{}}'), null)
})

test('o rótulo público nunca contém segredo', () => {
  const result = organizeCredentialText(`host: 192.168.110.7\nusuario: dados\nsenha: ${SSH_PASS}\ndw`)
  assert.ok(result)
  assert.equal(result.label.includes(SSH_PASS), false)
})

test('arquivo .env com chaves PG* vira acesso PostgreSQL direto', () => {
  const result = organizeCredentialText(`# banco de leitura\nPGHOST=192.168.110.7\nPGPORT=5432\nPGUSER=leitor\nPGPASSWORD="${PG_PASS}"\nPGDATABASE=dw`)
  assert.ok(result && result.kind === 'document')
  assert.deepEqual(JSON.parse(result.json).credentials[0], { kind: 'database', engine: 'postgresql', host: '192.168.110.7', port: '5432', database: 'dw', username: 'leitor', password: PG_PASS })
})

test('arquivo .env com SSH_* e tarefa de banco vira SSH + PostgreSQL via sudo', () => {
  const result = organizeCredentialText(`SSH_HOST=192.168.110.7\nSSH_USER=dados\nSSH_PASSWORD=${SSH_PASS}`, 'medir atualização\npostgres')
  assert.ok(result && result.kind === 'document')
  const value = JSON.parse(result.json)
  assert.equal(value.ssh.host, '192.168.110.7')
  assert.equal(value.ssh.password, SSH_PASS)
  assert.equal(value.mode, 'sudo-postgres')
})

test('.env com URL de conexão fica para o parser (rota própria de URI)', () => {
  assert.equal(organizeCredentialText(`DATABASE_URL=postgresql://leitor:${PG_PASS}@192.168.110.7:5432/dw\nOUTRA=1`), null)
})

test('host que só veio na mensagem completa o anexo que trouxe usuário e senha', () => {
  const result = organizeCredentialText(`usuário: dados\nsenha: ${SSH_PASS}`, 'segue acesso ssh do servidor 192.168.110.7')
  assert.ok(result)
  const token = result.kind === 'registration' ? JSON.parse(result.registration.token) : JSON.parse(result.json).ssh
  assert.equal(token.host, '192.168.110.7')
  assert.equal(token.username, 'dados')
  assert.equal(token.password, SSH_PASS)
})

test('colagem sem rótulo, usuário e senha em duas linhas, usa o host do contexto', () => {
  const two = organizeCredentialText(`dados\n${SSH_PASS}`, 'acesso ssh em 192.168.110.7, banco de dados postgres')
  assert.ok(two && two.kind === 'document')
  assert.deepEqual([JSON.parse(two.json).ssh.host, JSON.parse(two.json).ssh.username, JSON.parse(two.json).ssh.password], ['192.168.110.7', 'dados', SSH_PASS])
})

test('sem host completo, colagem solta não vira palpite', () => {
  assert.equal(organizeCredentialText(`dados\n${SSH_PASS}`, 'segue acesso ssh no .7'), null)
})

test('a mensagem nunca fornece senha, só localizador', () => {
  assert.equal(organizeCredentialText('usuário: dados', `ssh 192.168.110.7 senha: ${SSH_PASS}`), null)
})

test('quando o acesso SSH não fecha, a dica diz o que falta — nunca pergunta por token', () => {
  const hint = missingAccessHint('valor1 valor2\nvalor3 valor4', 'segue acesso ssh no .7')
  assert.ok(hint)
  assert.match(hint, /SSH/)
  assert.match(hint, /endereço completo/)
  assert.doesNotMatch(hint, /token/i)
  assert.equal(hint.includes('valor'), false)
  // Com host no contexto, só falta usuário e senha.
  assert.doesNotMatch(missingAccessHint('valor1 valor2', 'ssh em 192.168.110.7')!, /endereço/)
})

test('dica não intercepta JSON, URI nem login de banco financeiro', () => {
  assert.equal(missingAccessHint('{"ssh":{}}', 'ssh'), null)
  assert.equal(missingAccessHint(`postgresql://a:${PG_PASS}@h/db`, 'postgres'), null)
  assert.equal(missingAccessHint('usuário: fulano\nsenha: x', 'acesso do banco do Brasil'), null)
})
