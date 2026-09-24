import type { Conversation, EditorSessionReturn } from '../shared/contracts'
/** Never regress to an older turn or resurrect a read result when only its label changes. */
export function updateEditorReturn(conversation: Conversation, latest?: EditorSessionReturn): boolean {
  if (!latest || latest.sessionId !== conversation.sessionId) return false
  const previous = conversation.editorReturn
  if (!previous || latest.at > previous.at) { conversation.editorReturn = latest; return true }
  if (latest.id === previous.id && (latest.objective !== previous.objective || latest.report !== previous.report)) {
    conversation.editorReturn = { ...latest, acknowledgedAt: previous.acknowledgedAt, deliveryState: previous.deliveryState }
    return true
  }
  return false
}
