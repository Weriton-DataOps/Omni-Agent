import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'

import { avaliarEnvelopeAutoridade } from '../runtime/decisor-autoridade.mjs'
import {
  avaliarPedidoOvercore,
  criarServidorAutoridadeOvercore
} from '../adaptadores/overcore-authority-http.mjs'

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
  }
  return value
}

function fingerprint(value) {
  const digest = createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
  return { algorithm: 'sha256-jcs-v1', value: `sha256:${digest}` }
}

function request() {
  const base = {
    contractVersion: '1.0',
    authorizationRequestId: 'authreq-omni-http-test-0001',
    createdAt: '2026-08-31T15:00:00.000Z',
    requester: { id: 'overcore-execution-environment', kind: 'execution-environment' },
    authorityProvider: { id: 'omni-authority-provider', kind: 'assistant' },
    requestBinding: {
      requestId: 'request-omni-http-test-0001',
      requestFingerprint: { algorithm: 'sha256-jcs-v1', value: `sha256:${'1'.repeat(64)}` },
      clientId: 'client-omni-http-test-0001'
    },
    planBinding: {
      planId: 'plan-omni-http-test-0001', planRevision: 1,
      planFingerprint: { algorithm: 'sha256-jcs-v1', value: `sha256:${'2'.repeat(64)}` },
      strategyFingerprint: { algorithm: 'sha256-jcs-v1', value: `sha256:${'3'.repeat(64)}` }
    },
    authorityCeiling: {
      mode: 'proceed-within-scope',
      grants: [{ resourceRef: 'resource-omni-http-test', operations: ['filesystem.read'] }],
      expansionBoundaries: ['destructive', 'secret-access']
    },
    actions: [{
      actionId: 'action-omni-http-read-0001', stepRef: 'step-omni-http-read-0001', position: 1,
      scope: 'request-resource', resourceRef: 'resource-omni-http-test', operation: 'filesystem.read',
      effectMode: 'none', effectClass: 'read-only', riskLevel: 'low', requestedControls: ['sanitize-output']
    }],
    riskSummary: {
      maximumRisk: 'low', triggeredBoundaries: [], requestResourceActionCount: 1, journaledEffectCount: 0
    }
  }
  return { ...base, authorizationRequestFingerprint: fingerprint(base) }
}

function reversibleMutationRequest() {
  const input = request()
  const base = structuredClone(input)
  base.authorityCeiling.grants = [{ resourceRef: 'resource-omni-http-test', operations: ['filesystem.modify'] }]
  base.actions[0] = {
    ...base.actions[0],
    actionId: 'action-omni-http-write-0001',
    operation: 'filesystem.modify', effectMode: 'journaled', effectKey: 'effect-omni-http-write-0001',
    effectClass: 'reversible-change', riskLevel: 'medium',
    requestedControls: [
      'checkpoint-before-mutation', 'verify-after-effect',
      'reconcile-before-retry', 'revocation-check-before-effect'
    ]
  }
  base.riskSummary = {
    maximumRisk: 'medium', triggeredBoundaries: [], requestResourceActionCount: 1, journaledEffectCount: 1
  }
  delete base.authorizationRequestFingerprint
  return { ...base, authorizationRequestFingerprint: fingerprint(base) }
}

test('nucleo neutro permite somente leitura coberta pelo teto recebido', () => {
  const decision = avaliarEnvelopeAutoridade({
    ceiling: { mode: 'proceed-within-scope', grants: [{ resourceRef: 'resource-a', operations: ['filesystem.read'] }] },
    actions: [{
      actionId: 'action-neutral-read-0001', scope: 'request-resource', resourceRef: 'resource-a',
      operation: 'filesystem.read', effectMode: 'none', effectClass: 'read-only', riskLevel: 'low',
      requestedControls: ['sanitize-output']
    }],
    maximumRisk: 'low', triggeredBoundaries: []
  }, { at: new Date('2026-08-31T15:00:00.000Z') })
  assert.equal(decision.outcome, 'permit-with-constraints')
  assert.equal(decision.actionDecisions[0].outcome, 'permit')

  const denied = avaliarEnvelopeAutoridade({
    ceiling: { mode: 'proceed-within-scope', grants: [] },
    actions: [{
      actionId: 'action-neutral-write-0001', scope: 'request-resource', resourceRef: 'resource-a',
      operation: 'filesystem.modify', effectMode: 'journaled', effectClass: 'reversible-change', riskLevel: 'medium',
      requestedControls: []
    }],
    maximumRisk: 'medium', triggeredBoundaries: []
  }, { at: new Date('2026-08-31T15:00:00.000Z') })
  assert.equal(denied.outcome, 'deny')
  assert.equal(denied.actionDecisions[0].reasonCode, 'risk-policy')
})

test('adaptador produz decisao vinculada e recusa fingerprint adulterado', () => {
  const input = request()
  const decision = avaliarPedidoOvercore(input, { at: new Date('2026-08-31T15:00:00.000Z') })
  assert.equal(decision.authorizationRequestId, input.authorizationRequestId)
  assert.deepEqual(decision.requestBinding, input.requestBinding)
  assert.deepEqual(decision.planBinding, input.planBinding)
  assert.equal(decision.issuer.providerId, 'omni-authority-provider')
  assert.deepEqual(decision.decisionFingerprint, fingerprint({ ...decision, decisionFingerprint: undefined }))

  const tampered = structuredClone(input)
  tampered.actions[0].operation = 'filesystem.modify'
  assert.throws(() => avaliarPedidoOvercore(tampered), /fingerprint.*nao corresponde/i)
})

test('servidor aceita somente token local e devolve JSON', async () => {
  const token = 'token-local-omni-authority-test-0001'
  const server = criarServidorAutoridadeOvercore({
    token,
    at: () => new Date('2026-08-31T15:00:00.000Z')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/v1/authority/evaluate`
  try {
    const unauthorized = await fetch(endpoint, { method: 'POST', body: '{}' })
    assert.equal(unauthorized.status, 401)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(request())
    })
    assert.equal(response.status, 200)
    const decision = await response.json()
    assert.equal(decision.outcome, 'permit-with-constraints')
  }
  finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('servidor revalida o efeito reversivel imediatamente antes da escrita', async () => {
  const token = 'token-local-omni-revalidation-test-0001'
  const server = criarServidorAutoridadeOvercore({
    token,
    at: () => new Date('2026-08-31T15:00:00.000Z')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/v1/authority/revalidate-effect`
  try {
    const authorizationRequest = reversibleMutationRequest()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: '1.0', authorizationRequest,
        effect: {
          actionId: 'action-omni-http-write-0001', effectKey: 'effect-omni-http-write-0001',
          resourceRef: 'resource-omni-http-test', operation: 'filesystem.modify'
        }
      })
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'active')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('nucleo neutro permanece independente do adaptador externo', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../runtime/decisor-autoridade.mjs', import.meta.url), 'utf8')
  )
  assert.doesNotMatch(source, /OverCore|PostgreSQL|Agent SDK|Task Manager/i)
})
