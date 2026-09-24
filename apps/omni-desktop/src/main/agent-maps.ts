import type { AgentMap, AgentNode, AgentState, Conversation } from '../shared/contracts'
import type { EditorExecution } from './editor-transcript'

const localState = (c: Conversation): AgentState => c.phase === 'running' ? 'running' : c.phase === 'needs-input' ? 'waiting' : c.phase === 'completed' ? 'completed' : c.phase === 'failed' ? 'failed' : c.phase === 'interrupted' ? 'interrupted' : 'unknown'
export function buildAgentMaps(conversations: Conversation[], children: Map<string, AgentNode[]>, executions: Map<string, EditorExecution>): AgentMap[] {
  const result: AgentMap[] = []
  for (const c of conversations) {
    const external = c.kind === 'external'
    const rootId = external ? `session:${c.sessionId}` : `conversation:${c.id}`
    const execution = c.sessionId ? executions.get(c.sessionId) : undefined
    const root: AgentNode = { id: rootId, title: c.title, state: external ? execution?.state === 'running' ? 'running' : execution?.state === 'idle' ? 'waiting' : 'unknown' : localState(c), progress: external && execution?.state === 'idle' ? 'Sessão ociosa' : undefined }
    const nodes: AgentNode[] = [root]
    const append = (owner: Conversation, parentId: string) => {
      for (const child of children.get(owner.sessionId || '') || []) nodes.push({ ...child, parentId: child.parentId === `session:${owner.sessionId}` ? parentId : child.parentId })
    }
    append(c, rootId)
    if (!external) for (const task of conversations.filter(t => t.kind === 'task' && t.parentConversationId === c.id)) {
      const id = `conversation:${task.id}`
      nodes.push({ id, parentId: rootId, title: task.title, state: localState(task), objective: (task.supervision?.objective || task.title).slice(0, 4000),
        ...(['completed', 'failed', 'interrupted'].includes(task.phase) ? { result: (task.reportSummary || task.resultText || '').slice(0, 12000) } : {}) })
      append(task, id)
    }
    if (nodes.some(n => n.parentId === rootId && n.state === 'running')) root.state = 'running'
    if (nodes.length > 1) result.push({ conversationId: c.id, rootId, source: external ? 'vscode' : 'omni', nodes })
  }
  return result
}
