import assert from 'node:assert/strict'
import test from 'node:test'
import { BrokerCredentialMetadataRepository } from '../src/adapters/postgresql/broker-credential-metadata-repository.js'
import type { AccessBrokerClient } from '../src/ports/access-broker-client.js'
import { parseCredentialMetadata } from '../src/contracts/credential-metadata.js'

const metadata = parseCredentialMetadata({ credentialId: 'postgresql-local-access-broker', version: 1, revision: 1, providerRef: 'postgresql', accountRef: 'omni-access-broker', environmentRef: 'local', secretRef: 'credential-ref:windows-omni-postgresql-local-access-broker-v1', issuedAt: '2026-09-08T20:00:00.000Z', expiryKind: 'non_expiring', expirySource: 'owner-attestation', expiresAt: null, status: 'active', statusChangedAt: '2026-09-08T20:00:00.000Z', lastCheckedAt: '2026-09-08T20:00:00.000Z', lastSuccessAt: '2026-09-08T20:00:00.000Z', unusableSince: null, lastFailureAt: null, failureCode: null, evidenceRef: 'bootstrap-verified', revokedAt: null, replacedById: null, renewalMode: 'none', renewBeforeSeconds: 0, nextCheckAt: null, nextRetryAt: null })

test('adapter PostgreSQL usa somente a porta do broker e nunca aceita segredo', async () => {
  const calls: unknown[] = []
  const broker: AccessBrokerClient = {
    health: async () => ({ protocol: 'omni-access-broker-v1', status: 'ready' }),
    readCredentialVersion: async (credentialId, version) => { calls.push({ credentialId, version }); return metadata },
    recordCredentialObservation: async (event, expectedRevision) => { calls.push({ event, expectedRevision }); return { outcome: 'recorded', credential: metadata } }
  }
  const repository = new BrokerCredentialMetadataRepository(broker)
  assert.equal(await repository.readVersion(metadata.credentialId, 1), metadata)
  assert.deepEqual(calls, [{ credentialId: metadata.credentialId, version: 1 }])
  assert.deepEqual(await repository.recordObservation({ eventId: 'event-1', credentialId: metadata.credentialId, version: 1, providerRef: metadata.providerRef, accountRef: metadata.accountRef, environmentRef: metadata.environmentRef, startedAt: metadata.statusChangedAt, completedAt: metadata.statusChangedAt, kind: 'authenticated', evidenceRef: 'evidence-1' }, 1), { outcome: 'recorded', credential: metadata })
})
