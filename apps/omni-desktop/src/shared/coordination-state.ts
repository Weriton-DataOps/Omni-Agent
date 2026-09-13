import type { Conversation } from './contracts'

/** Keep the indicator through dispatch until its confirmation appears in chat. */
export function pendingCoordinationTurns(conversation: Conversation | undefined, conversations: Conversation[]) {
  const delegated = new Set(conversations.flatMap(c => [
    ...((c.kind === 'task' && c.parentConversationId === conversation?.id && c.originTurnId) ? [c.originTurnId] : []),
    ...(c.editorRequests || []).filter(r => (r.originConversationId || c.id) === conversation?.id).map(r => r.id)
  ]))
  return (conversation?.coordinationTurns || []).filter(t =>
    ['queued', 'planning', 'planned'].includes(t.state) && !(delegated.has(t.id) &&
      conversation?.messages.some(m => m.role === 'assistant' && m.id === `coord:${t.id}`)))
}
