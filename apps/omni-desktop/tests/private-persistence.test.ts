import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PrivateContextStore } from '../src/main/private-context-store'
import { CredentialIntake } from '../src/main/credential-intake'
import type { CredentialReceipt, CredentialRegistrationInput } from '../src/shared/contracts'
import { Controller } from '../src/main/controller'
import { Store } from '../src/main/store'
const secret = 'SYNTHETIC-PERSISTENCE-NEVER-PUBLIC'
const raw = JSON.stringify({ ssh: { kind: 'ssh', host: 'fixture.invalid', username: 'root', password: secret }, database: { kind: 'database', engine: 'postgresql', host: 'fixture.invalid', username: 'postgres', database: 'fixture' }, mode: 'sudo-postgres' })
function cipher() {
  const key = randomBytes(32)
  return {
    encrypt(text: string) { const iv = randomBytes(12), enc = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, enc.update(text, 'utf8'), enc.final(), enc.getAuthTag()]) },
    decrypt(bytes: Buffer) { const dec = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); dec.setAuthTag(bytes.subarray(-16)); return Buffer.concat([dec.update(bytes.subarray(12, -16)), dec.final()]).toString('utf8') }
  }
}
async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'omni-private-persistence-')))
  const crypto = cipher(), metadata = new Map<string, CredentialReceipt>(), vault = new Map<string, string>()
  const counters = { writes: 0, tests: 0, failSecond: false }
  const broker = {
    findLatestCredential: async (id: string) => metadata.get(id) || null,
    listCredentialMetadata: async () => [...metadata.values()].map(({ secretRef, ...item }) => item),
    verifyCredential: async () => { counters.tests++; throw Error('No validation on save') },
    registerVerifiedCredential: async () => { throw Error('No validation on save') },
    registerCredential: async (input: CredentialRegistrationInput) => {
      if (counters.failSecond && input.providerRef === 'postgresql') throw Error('Synthetic interrupted registration')
      counters.writes++
      const receipt = { credentialId: input.credentialId, providerRef: input.providerRef, accountRef: input.accountRef, environmentRef: input.environmentRef, version: 1, status: 'unverified', secretRef: 'fixture-ref', expiresAt: null }
      metadata.set(input.credentialId, receipt); vault.set(input.credentialId, input.token); return receipt
    }
  }
  const intakes: CredentialIntake[] = []
  const make = (workspace = 'C:/fixture/project') => {
    const intake = new CredentialIntake(async () => broker)
    intake.configurePersistence(new PrivateContextStore(directory, crypto), () => workspace); intakes.push(intake); return intake
  }
  t.after(async () => { for (const intake of intakes) intake.discard(); await rm(directory, { recursive: true, force: true }) })
  return { directory, crypto, metadata, vault, counters, make, broker }
}
test('recebimento criptografado sobrevive ao reinício; cadastro do par não testa e recuperação não pede novo anexo', async t => {
  const f = await fixture(t), c = randomUUID(), turn = randomUUID()
  let intake = f.make()
  const receipt = intake.stageAttachment(c, raw); intake.claimAttachment(c, turn, receipt.id)
  for (const file of await readdir(f.directory)) assert.ok(!(await readFile(join(f.directory, file))).includes(Buffer.from(secret)))
  intake.discard(); intake = f.make()
  assert.match(intake.attachmentContext(c, turn), /par SSH/)
  const stored = await intake.commitAttachment(c, turn)
  assert.equal(stored.state, 'pending'); assert.equal(stored.credentialIds?.length, 2)
  assert.equal(f.counters.tests, 0); assert.equal(f.counters.writes, 2)
  assert.equal(intake.attachment(c, turn), '')
  intake.discard(); intake = f.make()
  const sources = intake.availableSources(c)
  assert.equal(sources.length, 1); assert.equal(sources[0].status, 'stored')
  assert.ok(!JSON.stringify(sources).includes(secret))
  const later = randomUUID(); assert.ok(intake.reuseAttachment(c, later, sources[0].turnId))
  await intake.commitAttachment(c, later)
  const executable = await intake.executorSources(c, later)
  assert.ok('ssh' in executable.accesses[0].source)
  assert.ok(!JSON.stringify(executable).includes(secret)); assert.equal(f.counters.writes, 2)
  const anotherCard = randomUUID(), newTurn = randomUUID()
  assert.ok(intake.reuseAttachment(anotherCard, newTurn, sources[0].turnId))
  assert.equal((await intake.executorSources(anotherCard, newTurn)).accesses.length, 1)
  assert.equal(f.make('C:/another/project').availableSources(randomUUID()).length, 0)
  const id = stored.credentialIds![0]; f.metadata.set(id, { ...f.metadata.get(id)!, status: 'revoked' })
  await assert.rejects(intake.executorSources(c, later), /revogado/)
})
test('cadastro interrompido retoma pelo recibo sem duplicar o primeiro componente', async t => {
  const f = await fixture(t), c = randomUUID(), turn = randomUUID()
  let intake = f.make(); const receipt = intake.stageAttachment(c, raw); intake.claimAttachment(c, turn, receipt.id)
  f.counters.failSecond = true
  await assert.rejects(intake.commitAttachment(c, turn))
  assert.equal(f.counters.writes, 1)
  intake.discard(); intake = f.make(); f.counters.failSecond = false
  await intake.commitAttachment(c, turn)
  assert.equal(f.counters.writes, 2); assert.equal(f.counters.tests, 0)
})
test('criptação indisponível recusa recebimento; chave errada não vira ausência de acesso', async t => {
  const f = await fixture(t), c = randomUUID(), intake = f.make()
  const receipt = intake.stageAttachment(c, raw)
  const wrong = new PrivateContextStore(f.directory, cipher())
  assert.throws(() => wrong.read(receipt.id), /conta Windows/)
  const blocked = new CredentialIntake(async () => { throw Error() })
  blocked.configurePersistence(new PrivateContextStore(f.directory, { encrypt: () => { throw Error('Crypto unavailable') }, decrypt: () => '' }), () => 'fixture')
  assert.throws(() => blocked.stageAttachment(c, raw)); assert.equal(blocked.hasPrivateContext, false)
})
test('rollback de recebimento restaura rascunho protegido sem consumir outro anexo', async t => {
  const f = await fixture(t), c = randomUUID(), turn = randomUUID(), intake = f.make()
  const receipt = intake.stageAttachment(c, raw); intake.claimAttachment(c, turn, receipt.id)
  intake.restoreAttachment(c, turn)
  assert.equal(intake.attachmentInfo(c)?.id, receipt.id)
  intake.claimAttachment(c, turn, receipt.id)
  const next = intake.stageAttachment(c, 'Contexto seguinte')
  intake.restoreAttachment(c, turn)
  assert.equal(intake.attachmentInfo(c)?.id, next.id)
  await intake.commitAttachment(c, turn)
  assert.equal(intake.attachmentInfo(c)?.id, next.id)
})
test('cadastro anterior no banco é selecionável sem anexo; infraestrutura interna não é oferecida', async t => {
  const f = await fixture(t), c = randomUUID(), turn = randomUUID(), intake = f.make()
  const item = { credentialId: 'postgresql-owner-existing', providerRef: 'postgresql', accountRef: 'owner', environmentRef: 'project', version: 3, status: 'unverified', secretRef: 'not-for-model', expiresAt: null }
  f.metadata.set(item.credentialId, item)
  f.metadata.set('postgresql-local-access-broker', { ...item, credentialId: 'postgresql-local-access-broker' })
  const sources = await intake.catalogSources(c)
  assert.equal(sources.length, 1); assert.equal(sources[0].turnId, 'vault:postgresql-owner-existing:3')
  assert.ok(intake.reuseAttachment(c, turn, sources[0].turnId))
  assert.equal(intake.sourceIsBound(c, turn, sources[0].turnId), true)
  assert.deepEqual((await intake.executorSources(c, turn)).accesses[0].source, { credentialId: item.credentialId, version: 3 })
  assert.equal(f.counters.writes, 0); assert.equal(f.counters.tests, 0)
})
test('controller real cadastra antes da concessão e usa referências depois do reinício, sem novo anexo', async t => {
  const f = await fixture(t), store = new Store(join(f.directory, 'chat')); await store.load()
  const c = store.get(await store.create(f.directory, 'external')); c.sessionId = randomUUID()
  const session = { sessionId: c.sessionId, cwd: f.directory, name: 'fixture', pid: 1, address: 'fixture' }
  const executions: unknown[] = []
  const executionBroker = { ...f.broker, executionCapabilities: async () => ['postgres.catalog', 'postgres.freshness'], executeCredential: async (source: unknown) => { executions.push(source); return { outcome: 'completed', operation: 'postgres.catalog', data: [{ table: 'fixture' }] } } }
  const dependencies = { getBroker: async () => executionBroker, executionBroker: async () => executionBroker, sessions: async () => [session], executable: async () => '', loadModule: async () => ({}) }
  const controllers: Controller[] = []
  t.after(() => { for (const controller of controllers) { controller.prepareShutdown(); controller.credentialIntake.discard() } })
  const makeController = () => {
    const controller = new Controller(store, () => {}, undefined, dependencies as never)
    controller.credentialIntake.configurePersistence(new PrivateContextStore(join(f.directory, 'protected'), f.crypto), () => f.directory)
    controllers.push(controller); return controller
  }
  let controller = makeController()
  const attachment = controller.credentialIntake.stageAttachment(c.id, raw)
  const run = async (sourceId: string, first: boolean) => {
    const turnId = randomUUID()
    const receipt = first ? controller.credentialIntake.claimAttachment(c.id, turnId, attachment.id)! : controller.credentialIntake.reuseAttachment(c.id, turnId, sourceId)!
    const privateAttachment = { ...receipt, status: 'received' as const }
    const text = 'Use o acesso cadastrado para consultar o catálogo, sem alterações.'
    c.messages.push({ id: turnId, role: 'user', text, at: new Date().toISOString(), channel: 'text', privateAttachment })
    c.coordinationTurns = [...(c.coordinationTurns || []), { id: turnId, text, at: new Date().toISOString(), state: 'planned', privateAttachment, plan: { action: 'project', sessionId: c.sessionId!, instruction: 'Consultar catálogo.', reply: 'Executar leitura.', privateAccess: { action: 'use', sourceTurnId: first ? turnId : sourceId, operations: ['postgres.catalog'], authorizationQuote: 'Use o acesso cadastrado' } } }]
    c.editorRequests = [...(c.editorRequests || []), { id: turnId, text, at: new Date().toISOString(), status: 'sent', targetSessionId: c.sessionId!, originConversationId: c.id }]
    const brief = await (controller as unknown as { executorBrief(c: string, t: string, s: typeof session): Promise<string> }).executorBrief(c.id, turnId, session)
    const grant = /--grant ([a-f0-9]{64})/.exec(brief)![1]
    const result = await controller.executorAccess.use({ grant, sessionId: c.sessionId, taskId: turnId, workspace: f.directory, access: 'access-1', callId: randomUUID(), action: { kind: 'postgres.catalog', page: 0 } })
    assert.equal(result.result.outcome, 'completed')
    assert.ok(!brief.includes(secret)); assert.ok(!JSON.stringify(c).includes(secret)); assert.ok(!JSON.stringify(executions).includes(secret))
    await store.save()
  }
  await run('', true)
  assert.equal(f.counters.writes, 2); assert.equal(f.counters.tests, 0)
  controller.prepareShutdown(); controller.credentialIntake.discard()
  controller = makeController()
  const sources = await controller.credentialIntake.catalogSources(c.id)
  assert.equal(sources.length, 1)
  await run(sources[0].turnId, false)
  assert.equal(f.counters.writes, 2); assert.equal(executions.length, 2)
})
