import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Coordinator } from '../src/main/coordinator'
import { Store } from '../src/main/store'
import { observedEditorEvidence } from '../src/main/editor-evidence'
import { mainTranscript, transcriptMetadata } from '../src/main/editor-transcript'
import type { query } from '@anthropic-ai/claude-agent-sdk'
import type { Supervision } from '../src/shared/supervision'

// Reads only the session explicitly audited by the owner. No relay, deploy,
// setting change, or real request resumption is available in this harness.
const sessionId = '18b43508-8e59-4818-9f8b-af14e5d86053'
const requestId = 'e54c9a46-b050-4aed-85cd-053d17884868'
const records = mainTranscript(await transcriptMetadata(sessionId))
const report = observedEditorEvidence(records).findLast(event => event.requestId === requestId && event.kind === 'blocked')
assert.ok(report?.executionEvidence, 'Faltou a trilha real da sessão auditada')
const dir = await mkdtemp(join(tmpdir(), 'omni-resolution-validation-'))
try {
  const store = new Store(dir); await store.load()
  const card = store.get(await store.create(dir))
  const forbidden = async () => { throw new Error('Este ensaio não pode executar ou encaminhar tarefas') }
  const coordinator = new Coordinator(store, () => {}, {
    sessions: async () => [], relay: forbidden, local: forbidden, open: forbidden,
    executable: forbidden, context: forbidden
  }, (async function* () { throw new Error('Modelo externo proibido para a trilha real.') }) as unknown as typeof query)
  const supervision: Supervision = { objective: 'Conferir publicação somente do GA4, preservando o trabalho de terceiros.', retries: 0, state: 'reviewing', executionEvidence: report.executionEvidence }
  const review = await coordinator.reviewReturn(card, supervision, report.text, 'blocked')
  assert.equal(review.action, 'retry')
  assert.match(review.instruction || '', /somente leitura/)
  console.log(JSON.stringify({ realTrace: { complete: report.executionEvidence.complete, calls: report.executionEvidence.calls.length, publicationCalls: report.executionEvidence.calls.filter(call => call.operation === 'publish').length }, decision: review.action, needsOwner: review.needsOwner, noExternalActions: true }))
  coordinator.stop()
} finally { await rm(dir, { recursive: true, maxRetries: 5 }) }
