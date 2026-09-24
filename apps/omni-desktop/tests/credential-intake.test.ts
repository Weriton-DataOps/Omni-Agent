import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CredentialIntake } from '../src/main/credential-intake'
import type { CredentialInventoryItem, CredentialReceipt, CredentialRegistrationInput, CredentialVerification } from '../src/shared/contracts'

const raw = 'serviço: vercel; token: synthetic_test_key_123456789; conta: pessoal; ambiente: production'
const authenticated: CredentialVerification = { outcome: 'authenticated', checkedAt: '2026-09-11T12:00:00.000Z', method: 'vercel-user', summary: 'Consulta autenticada concluída.' }
const credential: CredentialReceipt = { credentialId: 'vercel-pessoal', version: 1, providerRef: 'vercel', accountRef: 'pessoal', environmentRef: 'production', expiresAt: null, status: 'active', secretRef: 'credential-ref:test-only' }
const inventory: CredentialInventoryItem = { credentialId: 'github-pessoa-example-invalid', version: 3, providerRef: 'github', accountRef: 'pessoa-example-invalid', environmentRef: 'production', expiresAt: null, status: 'active' }

test('inspeciona JSON de conta de serviço no Crachá sem guardar ou devolver a chave', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-cracha-service-account-'))
  const privateKey = '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-PRIVATE-KEY\n-----END PRIVATE KEY-----\n'
  const path = join(dir, 'service-account.json')
  try {
    await writeFile(path, JSON.stringify({ type: 'service_account', project_id: 'my-first-project-123', private_key_id: 'synthetic-key-id', private_key: privateKey, client_email: 'ga4-omni@my-first-project-123.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' }), 'utf8')
    let brokerCalls = 0
    const intake = new CredentialIntake(async () => { brokerCalls++; throw new Error('não deve acessar o cofre') })
    const inspection = await intake.inspectDocumentPath(path)
    assert.deepEqual(inspection, { kind: 'google-service-account', service: 'Google Cloud', providerRef: 'google-cloud', accountRef: 'ga4-omni', projectRef: 'my-first-project-123', hasPrivateKey: true, canStore: true, missing: [] })
    assert.equal(JSON.stringify(inspection).includes('SYNTHETIC-PRIVATE-KEY'), false)
    assert.equal(brokerCalls, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('anexo privado apenas cria contexto seguro; não prepara, testa nem guarda acesso', () => {
  let brokerCalls = 0
  const intake = new CredentialIntake(async () => { brokerCalls++; throw new Error('o cofre não deve ser aberto') })
  const id = 'a91a7998-c946-4c75-8feb-a60d877ffc82'
  const privateKey = 'SYNTHETIC-PRIVATE-KEY-MUST-NOT-LEAK'
  const attachment = intake.stageAttachment(id, JSON.stringify({ type: 'service_account', project_id: 'private-project', client_email: 'omni@private-project.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' }))
  const context = intake.attachmentContext(id)
  assert.equal(attachment.size > 0, true)
  assert.match(context, /conta de serviço/)
  assert.match(context, /project_id/)
  assert.doesNotMatch(context, /private-project/)
  assert.equal(context.includes(privateKey), false)
  assert.equal(intake.attachment(id).includes(privateKey), true, 'o original fica somente na memória privada do Crachá')
  assert.equal(brokerCalls, 0)
  intake.discardAttachment(id)
  assert.equal(intake.attachmentInfo(id), null)
})

test('ordem explícita promove anexo privado pelo ciclo do Crachá sem VS Code', async () => {
  const id = 'f787b070-4e8f-49d9-b992-661e2544ba5d'
  let verified = 0, stored = 0, tokenAtWrite = ''
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    verifyCredential: async () => { verified++; return { ...authenticated, outcome: 'unsupported' as const, summary: 'Este conector ainda não possui teste seguro.' } },
    registerCredential: async input => { stored++; tokenAtWrite = input.token; return { ...credential, status: 'unverified' } },
    registerVerifiedCredential: async () => { throw new Error('não deve salvar como ativo') }
  }))
  intake.stageAttachment(id, 'serviço: vercel; token: synthetic_private_attachment_123456; conta: pessoal; ambiente: production')
  const result = await intake.commitAttachment(id)
  assert.equal(result.state, 'pending')
  assert.match(result.message, /guardado no Crachá como pendente/)
  assert.equal(verified, 1); assert.equal(stored, 1)
  assert.match(tokenAtWrite, /synthetic_private_attachment/)
  assert.equal(intake.attachmentInfo(id), null)
})

test('envio toma o anexo exato; rascunho novo não altera a mensagem na fila', () => {
  const intake = new CredentialIntake(async () => { throw Error('Não validar nem cadastrar') })
  try {
    const first = intake.stageAttachment('chat', 'Conteúdo privado primeiro sem rótulo')
    assert.deepEqual(intake.claimAttachment('chat', 'turn-a', first.id), first)
    assert.equal(intake.attachmentInfo('chat'), null)
    const second = intake.stageAttachment('chat', 'Conteúdo privado segundo')
    assert.equal(intake.attachment('chat', 'turn-a'), 'Conteúdo privado primeiro sem rótulo')
    assert.equal(intake.attachmentInfo('chat')?.id, second.id)
    assert.equal(intake.attachment('outro-chat', 'turn-a'), '')
    assert.throws(() => intake.claimAttachment('chat', 'turn-b', first.id), /mudou ou expirou/)
    assert.equal(intake.attachmentInfo('chat')?.id, second.id)
    assert.doesNotMatch(intake.attachmentContext('chat', 'turn-a'), /primeiro sem rótulo/)
    assert.equal(intake.reuseAttachment('outro-chat', 'turn-b', 'turn-a'), null)
    assert.deepEqual(intake.reuseAttachment('chat', 'turn-b', 'turn-a'), first)
    assert.equal(intake.attachment('chat', 'turn-b'), 'Conteúdo privado primeiro sem rótulo')
    intake.discardDrafts()
    assert.equal(intake.attachmentInfo('chat'), null)
    assert.equal(intake.attachment('chat', 'turn-a'), 'Conteúdo privado primeiro sem rótulo')
    intake.discard()
    assert.equal(intake.attachment('chat', 'turn-a'), '')
  } finally { intake.discard() }
})

test('falha antes de persistir devolve o mesmo anexo para o rascunho', () => {
  const intake = new CredentialIntake(async () => { throw Error('Não abrir cofre') })
  try {
    const info = intake.stageAttachment('chat', 'Dado privado')
    intake.claimAttachment('chat', 'turn', info.id)
    intake.restoreAttachment('chat', 'turn')
    assert.deepEqual(intake.attachmentInfo('chat'), info)
    assert.equal(intake.attachment('chat', 'turn'), '')
    assert.equal(intake.attachment('chat'), 'Dado privado')
  } finally { intake.discard() }
})

test('intake never projects raw credentials and requires a verified test before save', async () => {
  let writes = 0
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    verifyCredential: async () => authenticated,
    registerVerifiedCredential: async (_input, version) => { writes++; assert.equal(version, null); return { credential, verification: authenticated, disposition: 'created' } }
  }))
  try {
    const draft = await intake.prepare(raw)
    assert.equal(JSON.stringify(draft).includes('synthetic_test_key'), false)
    assert.equal('registration' in draft, false)
    await assert.rejects(intake.save(draft.id), /Teste o acesso/)
    assert.equal(writes, 0)
    await intake.test(draft.id)
    const saved = await intake.save(draft.id)
    assert.equal(saved.status, 'active'); assert.equal(writes, 1)
    assert.equal('secretRef' in saved, false)
    await assert.rejects(intake.save(draft.id), /expiraram/)
  } finally { intake.discard() }
})

test('campos enviados em mensagens protegidas separadas formam um único acesso temporário', async () => {
  let verified: CredentialRegistrationInput | undefined
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    verifyCredential: async input => { verified = input; return authenticated },
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'created' as const })
  }))
  try {
    const first = await intake.prepare('login: pessoa@example.invalid; senha: senha_sintetica_123')
    assert.deepEqual(first.missing, ['Como devo chamar este acesso? Ex.: “Vercel”. Não preciso do projeto, site ou ação agora.'])
    const second = await intake.prepare('serviço: GitHub')
    assert.deepEqual(second.missing, [])
    await intake.test(second.id)
    assert.equal(verified?.providerRef, 'github')
    assert.equal(verified?.accountRef, 'pessoa-example-invalid')
    assert.equal(verified?.token.includes('senha_sintetica_123'), true)
    assert.equal(JSON.stringify(second).includes('senha_sintetica_123'), false)
  } finally { intake.discard() }
})

test('failed verification cannot store, and raw provider exceptions are not exposed', async () => {
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    verifyCredential: async () => { throw new Error(raw) },
    registerVerifiedCredential: async () => { throw new Error('unexpected write') }
  }))
  try {
    const draft = await intake.prepare(raw)
    await assert.rejects(intake.test(draft.id), error => { assert.equal(String(error).includes('synthetic_test_key'), false); return true })
    await assert.rejects(intake.save(draft.id), /Teste o acesso/)
  } finally { intake.discard() }
})

test('closing intake invalidates handles and late lookups cannot resurrect secrets', async () => {
  let resolveLookup!: (value: null) => void
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: () => new Promise(resolve => { resolveLookup = resolve }),
    verifyCredential: async () => authenticated,
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'reused' })
  }))
  const promise = intake.prepare(raw)
  await new Promise(resolve => setImmediate(resolve))
  intake.discard(); resolveLookup(null)
  await assert.rejects(promise, /encerrada/)
})

test('handles expire and existing version is carried to the guarded write', async () => {
  let now = Date.parse('2026-09-11T12:00:00Z')
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => credential,
    verifyCredential: async () => authenticated,
    registerVerifiedCredential: async (_input, version) => { assert.equal(version, 1); return { credential, verification: authenticated, disposition: 'reused' } }
  }), () => now)
  try {
    const first = await intake.prepare(raw)
    now += 11 * 60_000
    await assert.rejects(intake.test(first.id), /expiraram/)
    const second = await intake.prepare(raw)
    await intake.test(second.id)
    assert.equal((await intake.save(second.id)).disposition, 'reused')
  } finally { intake.discard() }
})

test('legacy provider/account identity preserves existing environment without duplicating production', async () => {
  let verifiedEnvironment = '', verifiedId = ''
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async id => id === 'vercel-pessoal' ? credential : null,
    verifyCredential: async input => { verifiedId = input.credentialId; verifiedEnvironment = input.environmentRef; return authenticated },
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'reused' })
  }))
  try {
    for (const text of [raw, raw.replace('; ambiente: production', '')]) {
      const draft = await intake.prepare(text)
      assert.equal(draft.existing?.version, 1)
      await intake.test(draft.id)
      assert.equal(verifiedId, 'vercel-pessoal'); assert.equal(verifiedEnvironment, 'production')
    }
  } finally { intake.discard() }
})

test('discard while broker opens prevents starting a write', async () => {
  let hold = false, writes = 0
  let release!: () => void
  const broker = {
    findLatestCredential: async () => null,
    verifyCredential: async () => authenticated,
    registerVerifiedCredential: async () => { writes++; return { credential, verification: authenticated, disposition: 'created' as const } }
  }
  const intake = new CredentialIntake(async () => { if (hold) await new Promise<void>(resolve => { release = resolve }); return broker })
  const draft = await intake.prepare(raw)
  await intake.test(draft.id)
  hold = true
  const promise = intake.save(draft.id)
  intake.discard(); release()
  await assert.rejects(promise)
  assert.equal(writes, 0)
})

test('known legacy provider typo is matched only for the same account and environment', async () => {
  const legacy = { ...credential, credentialId: 'verecel-pessoal', providerRef: 'verecel' }
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async id => id === legacy.credentialId ? legacy : null,
    verifyCredential: async input => { assert.equal(input.credentialId, legacy.credentialId); assert.equal(input.providerRef, 'verecel'); return authenticated },
    registerVerifiedCredential: async () => ({ credential: legacy, verification: authenticated, disposition: 'reused' })
  }))
  try {
    const draft = await intake.prepare(raw)
    assert.equal(draft.existing?.version, 1)
    assert.equal(draft.service, 'Vercel')
    await intake.test(draft.id)
  } finally { intake.discard() }
})

test('private lookup returns only bounded safe metadata and never a secret reference', async () => {
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    listCredentialMetadata: async query => query === 'conecta' ? [inventory] : [],
    verifyCredential: async () => authenticated,
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'created' as const })
  }))
  try {
    const result = await intake.lookup('tem acesso para Conecta no Crachá?')
    assert.deepEqual(result, [inventory])
    assert.equal(JSON.stringify(result).includes('secretRef'), false)
    await assert.rejects(intake.lookup('tem token para conecta?'), /consulta não recebe segredos/)
  } finally { intake.discard() }
})

test('similar registrations are shown safely while private raw values remain hidden', async () => {
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    listCredentialMetadata: async query => query === 'github' ? [inventory] : [],
    verifyCredential: async () => authenticated,
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'created' as const })
  }))
  try {
    const draft = await intake.prepare('serviço: GitHub; login: pessoa@example.invalid; senha: senha_sintetica_123')
    assert.deepEqual(draft.matches, [inventory])
    assert.equal(JSON.stringify(draft).includes('senha_sintetica_123'), false)
  } finally { intake.discard() }
})

test('unsupported test can be explicitly stored as pending, but failed tests cannot', async () => {
  const unsupported: CredentialVerification = { outcome: 'unsupported', checkedAt: '2026-09-11T12:00:00.000Z', method: 'manual', summary: 'Ainda não há teste seguro para este tipo de acesso.' }
  let registered: CredentialRegistrationInput | undefined, registeredToken = ''
  const intake = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    verifyCredential: async () => unsupported,
    registerCredential: async input => { registered = input; registeredToken = input.token; return { ...credential, status: 'unverified' } },
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'created' as const })
  }))
  try {
    const draft = await intake.prepare(raw)
    await intake.test(draft.id)
    const saved = await intake.savePending(draft.id)
    assert.deepEqual(saved, { version: 1, status: 'unverified', disposition: 'pending', checkedAt: null })
    assert.equal(registeredToken.includes('synthetic_test_key'), true)
    assert.equal(registered?.token, '', 'o segredo temporário é limpo depois que o cofre confirma o recebimento')
    await assert.rejects(intake.savePending(draft.id), /expiraram/)
  } finally { intake.discard() }

  const rejected = new CredentialIntake(async () => ({
    findLatestCredential: async () => null,
    verifyCredential: async () => ({ ...unsupported, outcome: 'invalid-token' as const }),
    registerVerifiedCredential: async () => ({ credential, verification: authenticated, disposition: 'created' as const })
  }))
  try {
    const draft = await rejected.prepare(raw)
    await rejected.test(draft.id)
    await assert.rejects(rejected.savePending(draft.id), /Só é possível guardar como pendente/)
  } finally { rejected.discard() }
})
