import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { query, Options } from '@anthropic-ai/claude-agent-sdk'
import { CredentialIntake } from '../src/main/credential-intake'
import { Coordinator } from '../src/main/coordinator'
import { Store } from '../src/main/store'
import { privateAccessCapabilities, privateReceiptReply } from '../src/shared/private-access'
const secret = 'PRIVATE-CONTEXT-SYNTHETIC-NEVER-PERSIST'
const until = async (check: () => boolean) => { const end = Date.now() + 4000; while (!check()) { if (Date.now() > end) throw Error('Timeout'); await new Promise(r => setTimeout(r, 5)) } }

for (const mode of ['reply', 'project', 'false-receipt'] as const) test(`anexo vinculado à mensagem: ${mode}, sem validação automática ou vazamento`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-private-turn-'))
  const store = new Store(directory); await store.load()
  const c = store.get(await store.create(directory, 'external')); c.sessionId = 'test-session'
  const intake = new CredentialIntake(async () => { throw Error('Não acessar o cofre ao receber contexto') })
  const active = new Map<string, AbortController>(), prompts: string[] = [], relayed: string[] = []
  t.after(async () => { intake.discard(); await until(() => active.size === 0); await store.save(); await rm(directory, { recursive: true, force: true }) })
  const agent = (async function* ({ prompt, options }: { prompt: string; options: Options }) {
    prompts.push(prompt)
    assert.equal(options.persistSession, false)
    assert.match(prompt, /CAPACIDADES REAIS DO CRACHÁ/)
    assert.match(prompt, /scopedUseReference":true/)
    if (options.outputFormat) yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: mode === 'project' ? 'project' : 'reply', sessionId: mode === 'project' ? c.sessionId : null, instruction: mode === 'project' ? 'Preparar o plano público sem conectar aos acessos privados.' : null, reply: 'Vou considerar o contexto privado.' } }
    else yield { type: 'result', subtype: 'success', is_error: false, result: mode === 'false-receipt' ? 'Os acessos ficam guardados, mas não validados.' : 'Recebi o contexto privado; vou tratar a finalidade indicada.' }
  }) as unknown as typeof query
  const session = { sessionId: c.sessionId, name: 'Teste', cwd: directory, pid: 1, address: 'test' }
  const coordinator = new Coordinator(store, () => {}, {
    context: async () => 'Contexto de teste', executable: async () => 'test.exe', sessions: async () => [session], open: async () => c.id,
    relay: async (_session, text) => { relayed.push(text) }, local: async () => { throw Error('Não mudar de destino') },
    badgeClaimAttachment: (...args) => intake.claimAttachment(...args), badgeRestoreAttachment: (...args) => intake.restoreAttachment(...args),
    badgeAttachment: async (id, turnId) => intake.attachmentContext(id, turnId)
  }, agent, active)
  const attachment = intake.stageAttachment(c.id, `serviço: PostgreSQL; host: PRIVATE-HOST; senha: ${secret}`)
  await coordinator.enqueue(c, 'Prepare o planejamento; segue contexto no Crachá.', 'text', [], 'Prepare o planejamento; segue contexto no Crachá.', attachment.id)
  assert.equal(intake.attachmentInfo(c.id), null)
  assert.equal(c.messages[0].privateAttachment?.id, attachment.id)
  const next = intake.stageAttachment(c.id, 'Outro contexto para a próxima mensagem')
  await until(() => c.coordinationTurns?.[0].state === 'done' && active.size === 0)
  assert.equal(c.messages[0].privateAttachment?.status, 'considered')
  assert.equal(intake.attachmentInfo(c.id)?.id, next.id)
  assert.equal(relayed.length, mode === 'project' ? 1 : 0)
  for (const output of [...prompts, ...relayed, JSON.stringify(c), await readFile(join(directory, 'conversations.json'), 'utf8')]) {
    assert.ok(!output.includes(secret)); assert.ok(!output.includes('PRIVATE-HOST')); assert.ok(!output.includes('Outro contexto para a próxima mensagem'))
  }
  if (mode === 'false-receipt') assert.match(c.messages.at(-1)!.text, /não confirma gravação/)
})

test('falha de persistência reverte recebimento sem deixar turno fantasma', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-private-rollback-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new Store(directory); await store.load(); const c = store.get(await store.create(directory))
  const intake = new CredentialIntake(async () => { throw Error('Não usar cofre') }); t.after(() => intake.discard())
  const info = intake.stageAttachment(c.id, secret)
  const coordinator = new Coordinator(store, () => {}, { sessions: async () => [], relay: async () => {}, open: async () => '', local: async () => '', context: async () => '', executable: async () => '', badgeClaimAttachment: (...args) => intake.claimAttachment(...args), badgeRestoreAttachment: (...args) => intake.restoreAttachment(...args) })
  store.save = async () => { throw Error('Falha sintética de disco') }
  await assert.rejects(coordinator.enqueue(c, 'Considere o contexto.', 'text', [], 'Considere o contexto.', info.id), /Falha sintética/)
  assert.equal(c.messages.length, 0); assert.equal(c.coordinationTurns?.length, 0)
  assert.equal(intake.attachmentInfo(c.id)?.id, info.id)
})

test('capacidade real não confunde metadado com concessão de uso e não permite recibo falso', () => {
  assert.equal(privateAccessCapabilities.executor.scopedUseReference, true)
  assert.equal(privateAccessCapabilities.executor.sshTunnel, 'managed-ssh-channel-with-remote-psql')
  assert.equal(privateAccessCapabilities.vault.registration, true)
  assert.match(privateReceiptReply('Já guardei os dois acessos.'), /não confirma gravação/)
  assert.equal(privateReceiptReply('Não guardei nem testei o acesso.'), 'Não guardei nem testei o acesso.')
})
