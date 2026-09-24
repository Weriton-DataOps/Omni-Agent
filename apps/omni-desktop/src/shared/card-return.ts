import type { Activity, ResultTicket, EditorRequest } from './contracts'

export function pendingEditorRequests(requests: EditorRequest[]) {
  const predecessors = new Set(requests.flatMap(request => request.followupOf ? [request.followupOf] : []))
  return requests.filter(request => !predecessors.has(request.id) && !['completed', 'blocked'].includes(request.status))
}

/**
 * Prefer the current return, but never make an unread historical return
 * unreachable once it is the only one left on the card.
 */
export function currentCardReturn(results: ResultTicket[], conversationId?: string, source: Activity['source'] = 'vscode') {
  const scoped = results.filter(result => result.conversationId === conversationId && result.source === source)
  return scoped.filter(result => !result.previous).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0]
    || scoped.sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0]
}

/**
 * A Desktop-request return opens the pending reports of that same VS Code card
 * together, in chronological order. A direct owner/Claude reply remains an
 * independent turn and never pulls an unrelated task history into the chat.
 */
export function cardReturnBatch(results: ResultTicket[], conversationId: string | undefined, source: Activity['source'], selectedId?: string) {
  const scoped = results.filter(result => result.conversationId === conversationId && result.source === source)
  const selected = selectedId ? scoped.find(result => result.id === selectedId) : currentCardReturn(scoped, conversationId, source)
  if (!selected) return []
  if (source !== 'vscode' || selected.kind === 'editor-response') return [selected]
  return scoped.filter(result => result.kind !== 'editor-response').sort((a, b) => (a.at || '').localeCompare(b.at || ''))
}

export function cardMessageId(result: ResultTicket) {
  return result.kind === 'editor-response' ? result.id : result.source === 'omni' ? `report:${result.id}` : `editor-report:${result.id}${result.evidenceId ? `:${result.evidenceId}` : ''}`
}
