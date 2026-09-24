import { readFile, readdir, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentNode, AgentState } from '../shared/contracts'
import { editorExecution, mainTranscript, textOf, type TranscriptRecord } from './editor-transcript'

type RecordWithAgent = TranscriptRecord & { sessionId?: string; agentId?: string; toolUseResult?: Record<string, any>; message?: TranscriptRecord['message'] & { id?: string; model?: string; usage?: Record<string, number> } }
const idFor = (session: string, agent: string) => `agent:${session}:${agent}`
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id)
const publicText = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/\b(?:sk-ant-|sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, '[segredo omitido]').replace(/\bBearer\s+\S+/gi, 'Bearer [omitido]').slice(0, limit) : undefined
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const cache = new Map<string, { size: number; mtime: number; records: RecordWithAgent[] }>()

/** Only same-session files are admitted. Raw tools and thinking never enter the projection. */
export function projectSubagents(sessionId: string, parent: TranscriptRecord[], transcripts: Map<string, RecordWithAgent[]>): AgentNode[] {
  const root = `session:${sessionId}`
  const nodes = new Map<string, AgentNode>()
  const branches = new Map<string, RecordWithAgent[]>()
  for (const [agentId, records] of transcripts) {
    if (!safeId(agentId)) continue
    const own = records.filter(r => r && typeof r === 'object' && r.agentId === agentId && r.sessionId === sessionId)
    if (!own.length) continue
    const branch = mainTranscript(new Map(own.filter(r => r.uuid).map(r => [r.uuid!, { ...r, isSidechain: false, parent_tool_use_id: null }]))) as RecordWithAgent[]
    branches.set(agentId, branch)
    const execution = editorExecution(branch)
    const first = branch.find(r => r.type === 'user' && !r.isMeta && typeof r.message?.content === 'string')
    const final = branch.findLast(r => r.type === 'assistant' && r.message?.stop_reason === 'end_turn' && textOf(r.message?.content).trim())
    const interrupted = branch.findLast(r => r.type === 'user' && /^\[Request interrupted by user/i.test(textOf(r.message?.content)))
    const state: AgentState = execution.state === 'running' ? 'running' : execution.state === 'idle' ? interrupted && (!final?.timestamp || interrupted.timestamp! >= final.timestamp) ? 'interrupted' : 'completed' : 'unknown'
    const usage = new Map<string, Record<string, number>>()
    for (const r of branch) if (r.type === 'assistant' && r.message?.id && r.message.usage) {
      const previous = usage.get(r.message.id) || {}
      for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
        const value = number(r.message.usage[key]); if (value !== undefined) previous[key] = Math.max(previous[key] || 0, value)
      }
      usage.set(r.message.id, previous)
    }
    const tool = branch.findLast(r => r.type === 'assistant' && Array.isArray(r.message?.content) && r.message.content.some((b: any) => b.type === 'tool_use'))
    const toolNames = Array.isArray(tool?.message?.content) ? tool.message.content.filter((b: any) => b.type === 'tool_use').map((b: any) => String(b.name || '')).join(', ') : ''
    nodes.set(agentId, { id: idFor(sessionId, agentId), parentId: root, title: `Subagente · ${agentId.slice(0, 8)}`, state,
      objective: publicText(first && textOf(first.message?.content), 4000), startedAt: first?.timestamp || branch[0]?.timestamp,
      lastActivityAt: execution.at, ...(execution.state === 'idle' ? { endedAt: execution.at } : {}),
      ...(final && state === 'completed' ? { result: publicText(textOf(final.message?.content), 12000), evidenceId: final.uuid } : {}),
      model: branch.findLast(r => r.message?.model)?.message?.model,
      ...(usage.size ? { tokens: Object.values([...usage.values()].at(-1)!).reduce((a, b) => a + b, 0), tokenScope: 'last-call' as const } : {}),
      progress: toolNames ? `Última ferramenta registrada: ${toolNames.slice(0, 160)}` : 'Sem etapa de ferramenta registrada' })
  }
  const correlate = (records: RecordWithAgent[], parentId: string) => {
    const calls = new Map<string, any>()
    for (const r of records) {
      for (const block of Array.isArray(r.message?.content) ? r.message.content : []) if (block.type === 'tool_use' && /^(Agent|Task)$/.test(block.name)) calls.set(block.id, { ...block, at: r.timestamp })
      const result = r.toolUseResult
      const reply = Array.isArray(r.message?.content) ? r.message.content.find((b: any) => b.type === 'tool_result' && calls.has(b.tool_use_id)) : undefined
      if (!reply || !result || !safeId(result.agentId)) continue
      const call = calls.get(reply.tool_use_id), agentId = result.agentId
      const node = nodes.get(agentId) || { id: idFor(sessionId, agentId), parentId, title: `Subagente · ${agentId.slice(0, 8)}`, state: 'unknown' as AgentState }
      if (node.id === parentId) continue
      node.parentId = parentId
      node.title = publicText(call.input?.description || result.description, 180) || node.title
      node.objective = publicText(call.input?.prompt || result.prompt, 4000) || node.objective
      node.startedAt ||= call.at
      node.model ||= publicText(result.resolvedModel, 100)
      // Terminal receipts can settle missing/unfinished files; newer child activity wins.
      if (!node.lastActivityAt || (r.timestamp && r.timestamp >= node.lastActivityAt)) {
        const terminal = reply.is_error || result.status === 'failed' ? 'failed' : ['killed', 'cancelled', 'interrupted'].includes(result.status) ? 'interrupted' : result.status === 'completed' ? 'completed' : undefined
        if (terminal) { node.state = terminal; node.endedAt = r.timestamp; node.evidenceId = r.uuid }
        else if (result.status === 'async_launched' && node.state === 'unknown') node.state = 'running'
      }
      if (!node.lastActivityAt || (r.timestamp && r.timestamp >= node.lastActivityAt)) {
        if (number(result.totalTokens) !== undefined) { node.tokens = result.totalTokens; node.tokenScope = 'reported-total' }
        if (number(result.totalDurationMs) !== undefined) node.durationMs = result.totalDurationMs
      }
      nodes.set(agentId, node)
    }
  }
  correlate(parent as RecordWithAgent[], root)
  for (const [agentId, branch] of branches) correlate(branch, idFor(sessionId, agentId))
  // A malformed cycle cannot hide agents or recurse forever in the view.
  const byId = new Map([...nodes.values()].map(n => [n.id, n]))
  for (const n of nodes.values()) {
    const seen = new Set([n.id]); let p = n.parentId
    while (p && byId.has(p)) { if (seen.has(p)) { n.parentId = root; break }; seen.add(p); p = byId.get(p)?.parentId }
    if (n.durationMs === undefined && n.startedAt && n.endedAt) { const elapsed = Date.parse(n.endedAt) - Date.parse(n.startedAt); if (elapsed >= 0) n.durationMs = elapsed }
  }
  return [...nodes.values()].sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
}

export async function readSubagentMap(sessionId: string, parentPath: string, parent: TranscriptRecord[]): Promise<AgentNode[]> {
  const sessionDirectory = join(dirname(parentPath), sessionId), directory = join(sessionDirectory, 'subagents')
  for (const path of [sessionDirectory, directory]) { const info = await lstat(path).catch(() => null); if (!info?.isDirectory() || info.isSymbolicLink()) return projectSubagents(sessionId, parent, new Map()) }
  const entries = (await readdir(directory, { withFileTypes: true })).filter(e => e.isFile() && /^agent-[a-z0-9-]+\.jsonl$/i.test(e.name)).slice(0, 128)
  const transcripts = new Map<string, RecordWithAgent[]>()
  for (const entry of entries) {
    const path = join(directory, entry.name), info = await lstat(path).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) continue
    const hit = cache.get(path)
    let records = hit?.records
    if (!hit || hit.size !== info.size || hit.mtime !== info.mtimeMs) {
      const raw = await readFile(path, 'utf8').catch(() => '')
      records = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      if (cache.size >= 128) cache.delete(cache.keys().next().value!)
      cache.set(path, { size: info.size, mtime: info.mtimeMs, records: records! })
    }
    transcripts.set(entry.name.slice(6, -6), records || [])
  }
  return projectSubagents(sessionId, parent, transcripts)
}
