import { observeEditorRecords, textOf, type TranscriptRecord, type EditorObservation } from './editor-transcript'
import { toolOperation, toolResultState, type ExecutionEvidence } from '../shared/return-evidence'

/** Main-branch evidence only. Raw tool input/output is never persisted or sent. */
export function observedEditorEvidence(records: TranscriptRecord[]): EditorObservation[] {
  const evidence = new Map<string, ExecutionEvidence>()
  let current: string | undefined
  const observations: EditorObservation[] = []
  for (const record of records) {
    if (record.isSidechain || record.parent_tool_use_id) continue
    const blocks = Array.isArray(record.message?.content) ? record.message.content : []
    const text = textOf(record.message?.content)
    if (record.isCompactSummary) { for (const trace of evidence.values()) trace.complete = false; current = undefined; continue }
    if (record.type === 'user' && !blocks.some(block => block.type === 'tool_result')) {
      const binding = text.match(/\[Omni Desktop authority:v1 request:([a-f0-9-]{36})\]/i)
      current = binding?.[1]
      if (current) evidence.set(current, { source: 'transcript', complete: true, calls: [] })
    }
    const events = observeEditorRecords(record)
    for (const event of events) if (event.kind === 'received') {
      current = event.requestId
      if (!evidence.has(current)) evidence.set(current, { source: 'transcript', complete: false, calls: [] })
    }
    const trace = current ? evidence.get(current) : undefined
    if (trace) for (const block of blocks) {
      if (record.type === 'assistant' && block.type === 'tool_use') {
        if (/^(?:Task|Agent)$/i.test(block.name)) trace.complete = false // Child tools are a separate transcript.
        trace.calls.push({ id: block.id, tool: String(block.name).slice(0, 100), operation: toolOperation(block.name, block.input), outcome: 'requested', at: record.timestamp || '' })
      } else if (block.type === 'tool_result') {
        const call = trace.calls.find(item => item.id === block.tool_use_id)
        const result = typeof block.content === 'string' ? block.content : textOf(block.content)
        if (call) Object.assign(call, toolResultState(result, block.is_error === true))
      }
    }
    for (const event of events) {
      const owned = evidence.get(event.requestId)
      observations.push({ ...event, ...(owned ? { executionEvidence: { ...owned, complete: owned.complete && owned.calls.length <= 250, calls: owned.calls.slice(-250).map(call => ({ ...call })) } } : {}) })
    }
  }
  return observations
}
