import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCredential } from '../src/main/credential-parser'

const now = new Date('2026-09-11T12:00:00.000Z')
const syntheticToken = 'vcp_SYNTHETIC_ONLY_12345678'
const parse = (text: string) => parseCredential(text, now)

test('reconhece JSON de conta de serviço Google sem projetar a chave privada', () => {
  const privateKey = '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-PRIVATE-KEY\n-----END PRIVATE KEY-----\n'
  const source = JSON.stringify({ type: 'service_account', project_id: 'my-first-project-123', private_key_id: 'synthetic-key-id', private_key: privateKey, client_email: 'ga4-omni@my-first-project-123.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' })
  const result = parse(source)
  assert.equal(result.kind, 'service-account')
  assert.equal(result.serviceLabel, 'Google Cloud')
  assert.equal(result.registration.providerRef, 'google-cloud')
  assert.equal(result.registration.accountRef, 'ga4-omni')
  assert.equal(result.registration.credentialId.startsWith('google-cloud-my-first-project-123-ga4-omni'), true)
  assert.deepEqual(result.missing, [])
  assert.equal(JSON.parse(result.registration.token).privateKey === privateKey, true)
  assert.equal(JSON.stringify({ ...result, registration: { ...result.registration, token: '' } }).includes('SYNTHETIC-PRIVATE-KEY'), false)
})

test('interpreta o exemplo Vercel, conta sem dois pontos e prazo relativo', () => {
  const result = parse(`token verecel ${syntheticToken} expira em 90 dias na conta teste@example.invalid`)
  assert.equal(result.kind, 'token')
  assert.equal(result.registration.providerRef, 'vercel')
  assert.equal(result.registration.accountRef, 'teste-example-invalid')
  assert.equal(result.registration.expiresAt, '2026-12-10T12:00:00.000Z')
  assert.equal(result.registration.environmentRef, 'unspecified')
  assert.equal(JSON.parse(result.registration.token).token === syntheticToken, true)
  assert.deepEqual(result.missing, [])
})

test('reconhece segredo antes do serviço e conserva a identidade sem conta do cadastro anterior', () => {
  const result = parse(`${syntheticToken} token da Vercel`)
  assert.equal(result.registration.credentialId, 'vercel-pessoal')
  assert.equal(JSON.parse(result.registration.token).token === syntheticToken, true)
  assert.deepEqual(result.missing, [])
})

test('não interpreta um token sem provedor como nome do serviço', () => {
  const result = parse(`token: ${syntheticToken}`)
  assert.equal(result.registration.providerRef, 'unspecified')
  assert.equal(result.serviceLabel, 'Serviço a informar')
  assert.equal(result.missing.some(message => message.includes('Como devo chamar este acesso')), true)
  assert.equal(JSON.stringify({ ...result, registration: { ...result.registration, token: '' } }).includes(syntheticToken), false)
})

test('aceita provedor desconhecido somente com nome explícito', () => {
  const result = parse(`serviço: Serviço Interno; token: ${syntheticToken}; conta: equipe; ambiente: homologacao`)
  assert.equal(result.registration.providerRef, 'servico-interno')
  assert.equal(result.registration.credentialId, 'servico-interno-equipe-homologacao')
  assert.deepEqual(result.missing, [])
})

test('entende complemento natural de serviço com URL sem gravar a URL como metadado', () => {
  const result = parse('o serviço é Portal > https://portal.grgroup.org/login; usuário: dono; senha: senha_sintetica_123')
  assert.equal(result.kind, 'login')
  assert.equal(result.serviceLabel, 'Portal')
  assert.equal(result.registration.providerRef, 'portal')
  assert.deepEqual(result.missing, [])
  assert.equal(JSON.parse(result.registration.token).url, 'https://portal.grgroup.org/login')
  assert.equal(JSON.stringify({ ...result.registration, token: '' }).includes('portal.grgroup.org'), false)
})

test('uma URL de login identifica o fluxo mesmo antes do usuário e da senha', () => {
  const result = parse('o serviço é Portal > https://portal.grgroup.org/login')
  assert.equal(result.kind, 'login')
  assert.equal(result.serviceLabel, 'Portal')
  assert.equal(result.registration.providerRef, 'portal')
  assert.deepEqual(result.missing, ['Qual é o usuário desse acesso?', 'Qual é a senha desse acesso?'])
  assert.equal(JSON.parse(result.registration.token).url, 'https://portal.grgroup.org/login')
})

test('GitHub com senha de token não vira login nem expõe o segredo no resumo', () => {
  const result = parse('GitHub token: ghp_SYNTHETIC1234567890; conta: equipe; expira: 2027-01-01')
  assert.equal(result.kind, 'token')
  assert.equal(result.serviceLabel, 'GitHub')
  assert.equal(result.registration.expiresAt, '2027-01-01T23:59:59.000Z')
  assert.deepEqual(result.missing, [])
})

test('PostgreSQL URI decodifica login sem levar a URI aos metadados', () => {
  const result = parse('postgresql://omni:p%40ss-SYNTHETIC@db.example.invalid:5433/growth?sslmode=require ambiente: homologacao')
  const payload = JSON.parse(result.registration.token)
  assert.equal(result.kind, 'database')
  assert.equal(payload.engine, 'postgresql')
  assert.equal(payload.host, 'db.example.invalid')
  assert.equal(payload.password === 'p@ss-SYNTHETIC', true)
  assert.equal(payload.port, '5433')
  assert.equal(payload.database, 'growth')
  assert.equal(payload.sslmode, 'require')
  assert.deepEqual(result.missing, [])
})

test('hosts, bancos e ambientes distintos nunca colidem na identidade', () => {
  const ids = ['postgresql://omni:synthetic@one.invalid:5432/a', 'postgresql://omni:synthetic@two.invalid:5432/a', 'postgresql://omni:synthetic@one.invalid:5432/b', 'postgresql://omni:synthetic@one.invalid:5432/a ambiente: teste'].map(input => parse(input).registration.credentialId)
  assert.equal(new Set(ids).size, 4)
})

test('MySQL com campos naturais e SQL Server conservam parâmetros do alvo', () => {
  for (const [service, engine] of [['MySQL', 'mysql'], ['SQL Server', 'sqlserver']]) {
    const result = parse(`${service}; host db.example.invalid:3306 banco growth usuário omni senha "uma senha sintética"`)
    const payload = JSON.parse(result.registration.token)
    assert.equal(payload.engine, engine)
    assert.equal(payload.username, 'omni')
    assert.equal(payload.password === 'uma senha sintética', true)
    assert.equal(payload.port, '3306')
    assert.deepEqual(result.missing, [])
  }
})

test('Active Directory reconhece domínio\\usuário e senha com pontuação', () => {
  const result = parse('AD usuário GR\\dados senha "senha sintética, com; pontuação"')
  const payload = JSON.parse(result.registration.token)
  assert.equal(result.kind, 'active-directory')
  assert.equal(payload.domain, 'GR')
  assert.equal(payload.username, 'dados')
  assert.equal(payload.password === 'senha sintética, com; pontuação', true)
  assert.deepEqual(result.missing, [])
})

test('certificado PEM mantém as linhas, com senha opcional', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nSYNTHETIC-BASE64\n-----END CERTIFICATE-----'
  const result = parse(`serviço: intranet\n${pem}`)
  assert.equal(result.kind, 'certificate')
  assert.equal(JSON.parse(result.registration.token).certificatePem === pem, true)
  assert.equal(Object.hasOwn(JSON.parse(result.registration.token), 'password'), false)
  assert.deepEqual(result.missing, [])
})

test('dados ausentes geram perguntas fixas sem incluir o texto enviado', () => {
  const result = parse('PostgreSQL host: db.example.invalid')
  assert.deepEqual(result.missing, ['Qual é o nome do banco?', 'Qual é o usuário desse acesso?', 'Qual é a senha desse acesso?'])
  assert.equal(JSON.parse(result.registration.token).password, '')
})

test('limite do cofre considera bytes UTF-8, não apenas caracteres', () => {
  assert.throws(() => parse(`serviço: intranet; senha: "${'é'.repeat(1250)}"; usuário: teste`), /2\.400 bytes/)
})

test('datas inválidas e vencidas são rejeitadas sem erro bruto', () => {
  for (const date of ['2027-02-30', '01/01/2020', 'em 0 dias']) assert.throws(() => parse(`Vercel token: ${syntheticToken}; expira ${date}`), /vencimento/)
  assert.equal(parse(`Vercel token: ${syntheticToken}`).registration.expiresAt, null)
})

test('identidade longa fica limitada sem colisão de sufixos', () => {
  const base = `serviço: ${'servico'.repeat(12)}; conta: ${'conta'.repeat(12)}; token: ${syntheticToken}; ambiente: `
  const first = parse(`${base}desenvolvimento`), second = parse(`${base}homologacao`)
  assert.equal(first.registration.credentialId.length <= 80, true)
  assert.notEqual(first.registration.credentialId, second.registration.credentialId)
})

test('não permite que segredo seja repetido em metadados', () => {
  assert.throws(() => parse(`Vercel token: ${syntheticToken}; conta: ${syntheticToken}`), /Separe o nome/)
  assert.throws(() => parse(`PostgreSQL host: ${syntheticToken}; usuário: teste; banco: teste; senha: ${syntheticToken}`), /Separe o nome/)
})

test('senha e conta não definem o conector e serviço explícito prevalece', () => {
  const result = parse('serviço: intranet; usuário: teste; senha: "PostgreSQL AD Vercel"; conta: github-team')
  assert.equal(result.kind, 'login')
  assert.equal(result.registration.providerRef, 'intranet')
  assert.deepEqual(result.missing, [])
})
