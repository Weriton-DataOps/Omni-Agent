import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { OvercoreTaskFlow, OvercoreHttpClient, listTaskFlows, type TaskFlowTransport } from '../src/adapters/overcore/task-flow.js'
import { NodeDocumentFingerprinter } from '../src/adapters/node/node-document-fingerprinter.js'
import type { JsonObject } from '../src/core/shared/json.js'

const fp = new NodeDocumentFingerprinter()
const input = () => ({
  objective: 'Inspecionar contratos somente leitura.',
  context: { references: [{ refId: 'ref-test-project', uri: 'file:///C:/fixtures/', kind: 'repository', sensitivity: 'public' }], assumptions: [] },
  discoveryAuthority: { mode: 'inspect-only', grants: [] },
  availableExecutionAuthority: { mode: 'proceed-within-scope', grants: [], expansionBoundaries: [] }
})
class Peer implements TaskFlowTransport {
  identity = 'http://127.0.0.1:2345'
  preparations = new Map<string, JsonObject>()
  requests: string[] = []
  admitted = 0
  taskRequest: JsonObject = {}
  failAfterPrepare = false
  failAfterAdmit = false
  status = 'running'
  wrongBinding = false
  missingResult = false
  async request(path: string, method: string, body?: JsonObject): Promise<JsonObject> {
    this.requests.push(`${method} ${path}`)
    if (path === '/v1/preflight') {
      const draft = structuredClone(body!.draft) as JsonObject
      const key = `${draft.draftId}:${draft.revision}`
      let report = this.preparations.get(key)
      if (!report) {
        this.taskRequest = { ...draft, requestId: 'request-test-linked', idempotencyKey: draft.executionIdempotencyKey! }
        report = { reportId: `report-test-${draft.revision}`, draftId: draft.draftId!, draftRevision: draft.revision!, draftFingerprint: { ...fp.fingerprint(draft) },
          status: draft.revision === 1 ? 'decisions-required' : 'ready', checks: [],
          requiredDecisions: draft.revision === 1 ? [{ decisionId: 'decision-output', question: 'Formato?', options: [{ optionId: 'option-memory', label: 'Somente resultado' }] }, { decisionId: 'decision-criteria', question: 'Critério?', options: [{ optionId: 'option-json', label: 'Validar JSON' }] }] : [] }
        this.preparations.set(key, report)
      }
      if (this.failAfterPrepare) { this.failAfterPrepare = false; throw new Error('simulated timeout after persistence') }
      return structuredClone(report)
    }
    if (path.endsWith('/admit')) {
      this.admitted = 1
      if (this.failAfterAdmit) { this.failAfterAdmit = false; throw new Error('simulated timeout after admission') }
      return { reportId: 'report-test-2', taskId: 'task-test-linked', status: 'running' }
    }
    if (path.endsWith('/cancel')) this.status = 'cancelled'
    return { taskId: this.wrongBinding ? 'task-wrong' : 'task-test-linked', status: this.status, stateRevision: 8, request: this.taskRequest, result: !this.missingResult && ['succeeded', 'failed', 'blocked', 'cancelled'].includes(this.status) ? { resultId: 'result-test-linked', taskId: 'task-test-linked', requestId: this.taskRequest.requestId!, requestFingerprint: { ...fp.fingerprint(this.taskRequest) }, status: this.status, summary: 'Conferência concluída.', criteria: [], evidence: [] } : null }
  }
}
const answer = () => ({ reportId: 'report-test-1', answers: [{ decisionId: 'decision-output', optionId: 'option-memory' }, { decisionId: 'decision-criteria', optionId: 'option-json' }], changes: { knownAcceptanceCriteria: [{ id: 'criterion-json', description: 'Todos os arquivos são JSON legível.', verificationHint: 'test' }], executionHints: { expectedOutputKind: 'no-artifact' } } })
async function fixture(run: (home: string, peer: Peer, flow: OvercoreTaskFlow) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'omni-flow-test-'))
  const peer = new Peer()
  try { await run(home, peer, new OvercoreTaskFlow(home, peer)) }
  finally { await rm(home, { recursive: true, force: true }) }
}

test('conversa mantém identidade entre decisões, reinício, resposta, resultado e repetição', () => fixture(async (home, peer, flow) => {
  const initial = await flow.start('session-one', 'owner-turn-one', input())
  assert.equal(initial.status, 'decisions-required'); assert.equal(peer.admitted, 0)
  const flowId = String(initial.flowId)
  const second = await new OvercoreTaskFlow(home, peer).answer('session-one', flowId, answer())
  assert.equal(second.status, 'running'); assert.equal(second.draftId, initial.draftId)
  assert.equal(second.revision, 2); assert.equal(peer.preparations.size, 2)
  const repeated = await flow.answer('session-one', flowId, answer())
  assert.equal(repeated.taskId, second.taskId); assert.equal(peer.preparations.size, 2)
  peer.status = 'succeeded'
  peer.missingResult = true
  await assert.rejects(flow.follow('session-one', flowId), /Resultado verificado/)
  peer.missingResult = false
  assert.equal((await flow.follow('session-one', flowId)).status, 'succeeded')
  assert.deepEqual(await listTaskFlows(home, 'other-session'), [])
  await assert.rejects(flow.follow('other-session', flowId), /outra conversa/)
  assert.equal(peer.requests.filter(path => path.endsWith('/admit')).length, 1)
  assert.ok(peer.requests.every(path => !path.includes('work-once')))
}))

test('timeout depois do Preflight e da admissão recupera o mesmo documento persistido', () => fixture(async (home, peer, flow) => {
  peer.failAfterPrepare = true
  await assert.rejects(flow.start('session-one', 'owner-turn-one', input()), /timeout/)
  const cached = (await listTaskFlows(home, 'session-one'))[0]!
  const initial = await new OvercoreTaskFlow(home, peer).follow('session-one', String(cached.flowId))
  assert.equal(peer.preparations.size, 1)
  peer.failAfterAdmit = true
  await assert.rejects(flow.answer('session-one', String(initial.flowId), answer()), /timeout/)
  const recovered = await new OvercoreTaskFlow(home, peer).answer('session-one', String(initial.flowId), answer())
  assert.equal(recovered.taskId, 'task-test-linked'); assert.equal(peer.preparations.size, 2)
}))

test('respostas incompletas, relatório errado e troca de identidade não chegam ao peer', () => fixture(async (_home, peer, flow) => {
  const initial = await flow.start('session-one', 'owner-turn-one', input())
  const flowId = String(initial.flowId)
  for (const bad of [
    { ...answer(), reportId: 'report-other' },
    { ...answer(), answers: answer().answers.slice(0, 1) },
    { ...answer(), answers: [answer().answers[0], answer().answers[0]] },
    { ...answer(), changes: { revision: 99 } },
    { ...answer(), changes: {} }
  ]) await assert.rejects(flow.answer('session-one', flowId, bad))
  assert.equal(peer.requests.length, 1)
  await assert.rejects(flow.start('session-one', 'owner-turn-one', { ...input(), objective: 'Outro trabalho' }), /outro conteúdo/)
  assert.equal(peer.requests.length, 1)
}))

test('concorrência local e cancelamento preservam uma única tarefa; readback alheio é recusado', () => fixture(async (_home, peer, flow) => {
  const [one, two] = await Promise.all([flow.start('s1', 'turn1', input()), flow.start('s1', 'turn1', input())])
  assert.equal(one.flowId, two.flowId); assert.equal(peer.preparations.size, 1)
  await flow.answer('s1', String(one.flowId), answer())
  peer.wrongBinding = true
  await assert.rejects(flow.follow('s1', String(one.flowId)), /não pertence/)
  peer.wrongBinding = false
  assert.equal((await flow.cancel('s1', String(one.flowId))).status, 'cancelled')
}))

test('cliente recusa endpoint externo, redirecionamento e erro HTML sem expor token', async () => {
  const token = 'private-token-for-test'
  for (const endpoint of ['https://example.com', 'http://localhost:2222', 'http://127.0.0.1:2222/path', 'http://user:pass@127.0.0.1']) assert.throws(() => new OvercoreHttpClient(endpoint, token))
  const transport: typeof fetch = async (_url, options) => {
    assert.equal(options?.redirect, 'error')
    return new Response('<html>bad</html>', { status: 200 })
  }
  await assert.rejects(new OvercoreHttpClient('http://127.0.0.1:2222', token, transport).request('/v1/preflight', 'POST', {}), error => error instanceof Error && /inválido/.test(error.message) && !error.message.includes(token))
})
