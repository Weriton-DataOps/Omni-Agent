import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Message } from '../shared/contracts'

export interface TranscriptRecord { type: string; uuid?: string; timestamp?: string; isMeta?: boolean; isCompactSummary?: boolean; isSidechain?: boolean; parent_tool_use_id?: string | null; message?: { content?: unknown } }
export const textOf = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('\n\n') : ''
export function visibleEditorMessage(record: TranscriptRecord, name: string): Message | null {
  if (record.isMeta || record.isCompactSummary || record.isSidechain || record.parent_tool_use_id || !record.uuid || !['user', 'assistant'].includes(record.type)) return null
  const text = textOf(record.message?.content)
  if (!text.trim() || /^(This session is being continued from a previous conversation|Another Claude session sent a message:|<command-(?:message|name)>|<local-command|Base directory for this skill:|<system-reminder>)/.test(text.trim())) return null
  return { id: record.uuid, role: record.type as 'user' | 'assistant', text, at: record.timestamp || '', channel: 'text', origin: 'editor', author: record.type === 'user' ? 'Você · histórico do VS Code' : `Claude · ${name}` }
}
export interface EditorObservation { requestId: string; kind: 'received' | 'completed' | 'blocked'; text: string; at: string; evidenceId: string }
export function observeEditorRecord(record: TranscriptRecord): EditorObservation | null {
  if (record.type !== 'assistant' || record.isSidechain || record.parent_tool_use_id || !record.uuid || !record.timestamp) return null
  const text = textOf(record.message?.content).trim()
  const marker = text.match(/^\[Omni Desktop (received|report):([a-f0-9-]{36})(?: status:(completed|blocked))?\]\s*/i)
  if (!marker || (marker[1] === 'report' && !marker[3])) return null
  // A short task can acknowledge and finish in the same assistant message.
  if (marker[1] === 'received') {
    const tail = text.slice(marker[0].length)
    const final = tail.match(/(?:^|\n)\[Omni Desktop report:([a-f0-9-]{36}) status:(completed|blocked)\]\s*/i)
    if (final?.[1] === marker[2]) return { requestId: marker[2], kind: final[2] as 'completed' | 'blocked', text: tail.slice(final.index! + final[0].length), at: record.timestamp, evidenceId: record.uuid }
  }
  return { requestId: marker[2], kind: marker[1] === 'received' ? 'received' : marker[3] as 'completed' | 'blocked', text: text.slice(marker[0].length), at: record.timestamp, evidenceId: record.uuid }
}

/**
 * Sessions created before the report protocol may end with a plain final answer.
 * We accept it only after a correlated Desktop request, with explicit completion
 * wording and no later tool call; silence alone is never treated as success.
 */
export function observeNaturalCompletion(records: Iterable<TranscriptRecord>): EditorObservation[] {
  let requestId: string | undefined
  let terminal: EditorObservation | undefined
  for (const record of records) {
    if (record.isMeta || record.isCompactSummary || record.isSidechain || record.parent_tool_use_id || !record.uuid || !record.timestamp) continue
    const text = textOf(record.message?.content).trim()
    if (record.type === 'user') {
      const request = text.match(/^\[Omni Desktop authority:v1 request:([a-f0-9-]{36})\]/im)
      if (request) { requestId = request[1]; terminal = undefined }
      continue
    }
    if (record.type !== 'assistant' || !requestId) continue
    if (Array.isArray(record.message?.content) && record.message.content.some(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool_use')) { terminal = undefined; continue }
    if (!text || /^\[Omni Desktop (received|report):/i.test(text)) continue
    const finished = /\b(conclu[ií]d[oa]|finalizad[oa]|implementad[oa]|resolvid[oa]|entregue|feito|tarefa pronta|deploy (?:feito|conclu[ií]do|realizado)|testes? (?:passaram|verdes))\b/i.test(text)
    const negated = /\b(n[aã]o|sem)\s+(?:foi\s+)?(?:conclu[ií]d[oa]|finalizad[oa]|feito|resolvid[oa]|entregue)\b/i.test(text)
    if (finished && !negated) terminal = { requestId, kind: 'completed', text, at: record.timestamp, evidenceId: record.uuid }
  }
  return terminal ? [terminal] : []
}

// Cross-session callbacks are stored by Claude as hidden meta user records.
// They must stay out of the visible transcript, but their UUID is a durable
// receipt for the Desktop request that originated the work.
export interface RelayInboxObservation extends EditorObservation { fromName: string }
export function observeRelayInboxRecord(record: TranscriptRecord): RelayInboxObservation | null {
  if (record.type !== 'user' || !record.isMeta || !record.uuid || !record.timestamp) return null
  const envelope = textOf(record.message?.content)
  const source = envelope.match(/<cross-session-message\b[^>]*\bfrom-name="([^"]+)"[^>]*>([\s\S]*?)<\/cross-session-message>/i)
  if (!source) return null
  const observation = observeEditorRecord({ type: 'assistant', uuid: record.uuid, timestamp: record.timestamp, message: { content: source[2] } })
  return observation ? { ...observation, fromName: source[1] } : null
}

const paths = new Map<string, string>()
const cache = new Map<string, { mtime: number; size: number; records: Map<string, TranscriptRecord> }>()
// Only UUID filenames inside the Claude project store; never paths supplied by a model.
export async function transcriptMetadata(sessionId: string): Promise<Map<string, TranscriptRecord>> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error('Sessão inválida.')
  let path = paths.get(sessionId)
  if (!path) {
    const directory = join(homedir(), '.claude/projects')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const candidate = join(directory, entry.name, `${sessionId}.jsonl`)
      try { if ((await stat(candidate)).isFile()) { path = candidate; paths.set(sessionId, path); break } } catch { /* not this project */ }
    }
  }
  if (!path) return new Map()
  const info = await stat(path)
  const hit = cache.get(path)
  if (hit?.mtime === info.mtimeMs && hit.size === info.size) return hit.records
  const records = new Map<string, TranscriptRecord>()
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    // Tool and sidechain records are not shown in the chat, but their timestamp is a
    // useful heartbeat: it tells the Desktop that the executor is still moving.
    try { const item = JSON.parse(line) as TranscriptRecord; if (item.uuid) records.set(item.uuid, item) } catch { /* incomplete append, retry on next mtime */ }
  }
  if (cache.size > 20) cache.clear()
  cache.set(path, { mtime: info.mtimeMs, size: info.size, records })
  return records
}

export interface ExternalSubagentActivity { id: string; lastActivityAt: string }
/** Subagent transcripts are local session telemetry only; their text never enters the Desktop. */
export async function externalSubagents(sessionId: string): Promise<ExternalSubagentActivity[]> {
  await transcriptMetadata(sessionId)
  const parent = paths.get(sessionId)
  if (!parent) return []
  const directory = join(dirname(parent), 'subagents')
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const activities = await Promise.all(entries.filter(entry => entry.isFile() && /^agent-[a-z0-9]+\.jsonl$/i.test(entry.name)).map(async entry => {
    const info = await stat(join(directory, entry.name)).catch(() => null)
    return info ? { id: entry.name.slice(0, -6), lastActivityAt: info.mtime.toISOString() } : null
  }))
  return activities.filter((activity): activity is ExternalSubagentActivity => !!activity).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
}
