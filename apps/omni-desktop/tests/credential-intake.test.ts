import assert from 'node:assert/strict'
import test from 'node:test'
import { CredentialIntake } from '../src/main/credential-intake'
import type { CredentialReceipt, CredentialVerification } from '../src/shared/contracts'

const raw = 'serviço: vercel; token: synthetic_test_key_123456789; conta: pessoal; ambiente: production'
const authenticated: CredentialVerification = { outcome: 'authenticated', checkedAt: '2026-09-11T12:00:00.000Z', method: 'vercel-user', summary: 'Consulta autenticada concluída.' }
const credential: CredentialReceipt = { credentialId: 'vercel-pessoal', version: 1, providerRef: 'vercel', accountRef: 'pessoal', environmentRef: 'production', expiresAt: null, status: 'active', secretRef: 'credential-ref:test-only' }

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
