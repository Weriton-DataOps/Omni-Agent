import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'

import type { Ajv2020 as Ajv2020Type } from 'ajv/dist/2020.js'
import type { FormatsPlugin } from 'ajv-formats'

import { AuthorityService } from '../src/application/evaluate-authority.js'
import { NodeDocumentFingerprinter } from '../src/adapters/node/node-document-fingerprinter.js'
import {
  OvercoreAuthorityAdapter,
  evaluateOvercoreAuthorizationRequest
} from '../src/adapters/overcore/authorization.js'
import {
  authorizationContractProvenance,
  authorizationDecisionV1,
  authorizationRequestV1
} from '../src/adapters/overcore/contracts/schemas.js'

const require = createRequire(import.meta.url)
const Ajv2020 = (require('ajv/dist/2020').default ?? require('ajv/dist/2020')) as typeof Ajv2020Type
const addFormats = (require('ajv-formats').default ?? require('ajv-formats')) as FormatsPlugin

const fixedAt = new Date('2026-08-31T15:00:00.000Z')
const fingerprinter = new NodeDocumentFingerprinter()

function requestFixture(): Record<string, unknown> {
  const base = {
    contractVersion: '1.0',
    authorizationRequestId: 'authreq-omni-ts-test-0001',
    createdAt: '2026-08-31T15:00:00.000Z',
    requester: { id: 'execution-environment-test-0001', kind: 'execution-environment' },
    authorityProvider: { id: 'omni-authority-provider', kind: 'assistant' },
    requestBinding: {
      requestId: 'request-omni-ts-test-0001',
      requestFingerprint: { algorithm: 'sha256-jcs-v1', value: `sha256:${'1'.repeat(64)}` },
      clientId: 'client-omni-ts-test-0001'
    },
    planBinding: {
      planId: 'plan-omni-ts-test-0001',
      planRevision: 1,
      planFingerprint: { algorithm: 'sha256-jcs-v1', value: `sha256:${'2'.repeat(64)}` },
      strategyFingerprint: { algorithm: 'sha256-jcs-v1', value: `sha256:${'3'.repeat(64)}` }
    },
    authorityCeiling: {
      mode: 'proceed-within-scope',
      grants: [{ resourceRef: 'resource-omni-ts-test', operations: ['filesystem.read'] }],
      expansionBoundaries: ['destructive', 'secret-access']
    },
    actions: [{
      actionId: 'action-omni-ts-read-0001',
      stepRef: 'step-omni-ts-read-0001',
      position: 1,
      scope: 'request-resource',
      resourceRef: 'resource-omni-ts-test',
      operation: 'filesystem.read',
      effectMode: 'none',
      effectClass: 'read-only',
      riskLevel: 'low',
      requestedControls: ['sanitize-output']
    }],
    riskSummary: {
      maximumRisk: 'low',
      triggeredBoundaries: [],
      requestResourceActionCount: 1,
      journaledEffectCount: 0
    }
  }
  return { ...base, authorizationRequestFingerprint: fingerprinter.fingerprint(base) }
}

function reversibleMutationRequest(): Record<string, unknown> {
  const input = requestFixture()
  const base = structuredClone(input) as Record<string, unknown>
  const ceiling = base.authorityCeiling as Record<string, unknown>
  ceiling.grants = [{ resourceRef: 'resource-omni-ts-test', operations: ['filesystem.modify'] }]
  const actions = base.actions as Array<Record<string, unknown>>
  actions[0] = {
    ...actions[0],
    actionId: 'action-omni-ts-write-0001',
    operation: 'filesystem.modify',
    effectMode: 'journaled',
    effectKey: 'effect-omni-ts-write-0001',
    effectClass: 'reversible-change',
    riskLevel: 'medium',
    requestedControls: [
      'checkpoint-before-mutation',
      'verify-after-effect',
      'reconcile-before-retry',
      'revocation-check-before-effect'
    ]
  }
  base.riskSummary = {
    maximumRisk: 'medium', triggeredBoundaries: [], requestResourceActionCount: 1, journaledEffectCount: 1
  }
  delete base.authorizationRequestFingerprint
  return { ...base, authorizationRequestFingerprint: fingerprinter.fingerprint(base) }
}

function compileSchemas() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    validateFormats: true
  })
  addFormats(ajv)
  return {
    request: ajv.compile(authorizationRequestV1),
    decision: ajv.compile(authorizationDecisionV1)
  }
}

function decoderAccepts(document: unknown): boolean {
  try {
    evaluateOvercoreAuthorizationRequest(document, { at: fixedAt })
    return true
  } catch {
    return false
  }
}

test('serviço TypeScript valida unknown antes de avaliar o núcleo neutro', () => {
  const service = new AuthorityService({ now: () => fixedAt })
  assert.throws(() => service.evaluate(null), /objeto esperado/)
  assert.throws(() => service.evaluate({ actions: [] }), /campo|esperad|mínimo/)
  const evaluation = service.evaluate({
    ceiling: {
      mode: 'proceed-within-scope',
      grants: [{ resourceRef: 'resource-a', operations: ['filesystem.read'] }],
      expansionBoundaries: []
    },
    actions: [{
      actionId: 'action-neutral-read-0001',
      scope: 'request-resource',
      resourceRef: 'resource-a',
      operation: 'filesystem.read',
      effectMode: 'none',
      effectClass: 'read-only',
      riskLevel: 'low',
      requestedControls: ['sanitize-output']
    }],
    maximumRisk: 'low',
    triggeredBoundaries: []
  })
  assert.equal(evaluation.outcome, 'permit-with-constraints')
})

test('decoder dependency-free acompanha o JSON Schema canônico nos casos estruturais', () => {
  const validators = compileSchemas()
  const cases: unknown[] = [
    requestFixture(),
    null,
    { ...requestFixture(), unknownField: true },
    { ...requestFixture(), contractVersion: '2.0' },
    { ...requestFixture(), authorizationRequestFingerprint: { algorithm: 'sha256-jcs-v1', value: 'sha256:curto' } },
    (() => {
      const value = requestFixture()
      const actions = structuredClone(value.actions) as Array<Record<string, unknown>>
      delete actions[0]?.resourceRef
      return { ...value, actions }
    })(),
    (() => {
      const value = requestFixture()
      const actions = structuredClone(value.actions) as Array<Record<string, unknown>>
      if (actions[0]) actions[0].requestedControls = ['sanitize-output', 'sanitize-output']
      return { ...value, actions }
    })()
  ]
  for (const [index, document] of cases.entries()) {
    assert.equal(
      decoderAccepts(document),
      validators.request(document) as boolean,
      `divergência decoder/schema no caso ${index}: ${JSON.stringify(validators.request.errors)}`
    )
  }
})

test('adapter verifica fingerprint de conteúdo e emite decisão válida no schema público', () => {
  const validators = compileSchemas()
  const input = requestFixture()
  const decision = evaluateOvercoreAuthorizationRequest(input, { at: fixedAt })
  assert.equal(decision.outcome, 'permit-with-constraints')
  assert.equal(validators.decision(decision), true, JSON.stringify(validators.decision.errors))

  const tampered = structuredClone(input)
  const actions = tampered.actions as Array<Record<string, unknown>>
  if (actions[0]) actions[0].operation = 'filesystem.modify'
  assert.throws(() => evaluateOvercoreAuthorizationRequest(tampered, { at: fixedAt }), /fingerprint nao corresponde/)
})

test('schemas emitidos preservam fingerprints pinados de proveniência', async () => {
  const paths = [
    ['authorization-request-v1.schema.json', authorizationContractProvenance.requestSchemaSha256],
    ['authorization-decision-v1.schema.json', authorizationContractProvenance.decisionSchemaSha256]
  ] as const
  for (const [name, expected] of paths) {
    const document = await import('node:fs/promises').then(async ({ readFile }) =>
      JSON.parse(await readFile(join(process.cwd(), 'dist', 'adapters', 'overcore', 'contracts', name), 'utf8')) as unknown
    )
    const actual = fingerprinter.fingerprint(document).value
    assert.equal(actual, expected)
  }
})

test('autoridade permite somente mutacao reversivel journaled com todos os controles e revalida o mesmo efeito', () => {
  const input = reversibleMutationRequest()
  const adapter = new OvercoreAuthorityAdapter(
    new AuthorityService({ now: () => fixedAt }),
    fingerprinter
  )
  const decision = adapter.evaluate(input)
  assert.equal(decision.outcome, 'permit-with-constraints')
  assert.equal(decision.actionDecisions[0]?.outcome, 'permit')

  const active = adapter.revalidateEffect({
    contractVersion: '1.0',
    authorizationRequest: input,
    effect: {
      actionId: 'action-omni-ts-write-0001',
      effectKey: 'effect-omni-ts-write-0001',
      resourceRef: 'resource-omni-ts-test',
      operation: 'filesystem.modify'
    }
  })
  assert.equal(active.status, 'active')

  const missingControl = structuredClone(input)
  const actions = missingControl.actions as Array<Record<string, unknown>>
  if (actions[0]) actions[0].requestedControls = ['checkpoint-before-mutation']
  delete missingControl.authorizationRequestFingerprint
  missingControl.authorizationRequestFingerprint = fingerprinter.fingerprint(missingControl)
  assert.equal(adapter.evaluate(missingControl).outcome, 'deny')

  assert.throws(() => adapter.revalidateEffect({
    contractVersion: '1.0',
    authorizationRequest: input,
    effect: {
      actionId: 'action-omni-ts-write-0001',
      effectKey: 'effect-omni-ts-other-0001',
      resourceRef: 'resource-omni-ts-test',
      operation: 'filesystem.modify'
    }
  }), /efeito nao corresponde/i)
})
