import { app } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateContextStore, windowsPrivateContextCrypto } from '../src/main/private-context-store'
import { CredentialIntake } from '../src/main/credential-intake'
const directory = process.env.OMNI_PRIVATE_TEST_DIR!
const conversationId = '14877689-edc8-41ba-a8a4-4a4e9181db49'
const turnId = '2b58aa6a-9ae4-4c87-8826-c374742d2fbd'
const secret = 'SYNTHETIC-DPAPI-RESTART-ONLY'
app.setPath('userData', join(directory, 'electron'))
let check = 'crypto-available'
app.whenReady().then(() => {
  const repository = new PrivateContextStore(join(directory, 'private'), windowsPrivateContextCrypto)
  const intake = new CredentialIntake(async () => { throw Error('No real broker permitted in smoke test') })
  intake.configurePersistence(repository, () => directory)
  if (process.env.OMNI_PRIVATE_TEST_PHASE === 'write') {
    const attachment = intake.stageAttachment(conversationId, secret)
    intake.claimAttachment(conversationId, turnId, attachment.id)
    for (const name of readdirSync(join(directory, 'private'))) assert.ok(!readFileSync(join(directory, 'private', name)).includes(Buffer.from(secret)))
    intake.discard()
    console.log(JSON.stringify({ phase: 'write', encrypted: true, vaultOrNetworkCalls: 0 }))
  } else {
    check = 'read-bound-content'
    assert.equal(intake.attachment(conversationId, turnId), secret)
    check = 'list-recoverable-sources'
    assert.equal(intake.availableSources(conversationId).length, 1)
    assert.ok(!JSON.stringify(intake.availableSources(conversationId)).includes(secret))
    console.log(JSON.stringify({ phase: 'read-after-process-restart', restored: true, secretInPublicMetadata: false, vaultOrNetworkCalls: 0 }))
    intake.discard()
  }
  app.exit(0)
}).catch(() => { console.log(JSON.stringify({ status: 'failed', check })); app.exit(1) })
