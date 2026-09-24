import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executionTraceEvent, executionTraceText } from '../src/shared/execution-trace'

test('rastro de execução preserva a operação e nunca persiste segredo', () => {
  const event = executionTraceEvent({
    hook_event_name: 'PostToolUse', tool_name: 'PowerShell', tool_use_id: 'tool-1', duration_ms: 2150,
    tool_input: { command: 'psql postgresql://admin:super-secret@127.0.0.1/omni', token: 'synthetic-token-must-not-appear' },
    tool_response: { status: 'ok', password: 'also-hidden' }
  })
  assert.equal(event?.kind, 'tool-complete')
  assert.equal(event?.text, 'PowerShell')
  assert.equal(event?.durationMs, 2150)
  assert.doesNotMatch(JSON.stringify(event), /super-secret|synthetic-token-must-not-appear|also-hidden/)
  assert.match(event?.input || '', /segredo ocultado/)
  assert.match(event?.output || '', /segredo ocultado/)
})

test('rastro limita saída grande sem quebrar dados de operação', () => {
  const value = executionTraceText({ result: 'a'.repeat(4000), status: 'running' })
  assert.match(value, /saída resumida/)
  assert.match(value, /"result"/)
  assert.ok(value.length < 2500)
})
