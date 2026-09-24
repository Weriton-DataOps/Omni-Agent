import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { EditorSessionReturn, Message } from '../shared/contracts'

export interface TranscriptRecord { type: string; uuid?: string; parentUuid?: string | null; timestamp?: string; isMeta?: boolean; isCompactSummary?: boolean; isSidechain?: boolean; parent_tool_use_id?: string | null; message?: { content?: unknown; stop_reason?: string | null } }

/** Follow the current main branch, excluding tool subagents and abandoned turns. */
export function mainTranscript(records: Map<string, TranscriptRecord>): TranscriptRecord[] {
  const main = [...records.values()].filter(record => !record.isSidechain && !record.parent_tool_use_id)
  const leaf = main.at(-1)
  if (!leaf || !('parentUuid' in leaf)) return main
  const branch: TranscriptRecord[] = []
  const seen = new Set<string>()
  let record: TranscriptRecord | undefined = leaf
  while (record?.uuid && !seen.has(record.uuid)) {
    seen.add(record.uuid)
    if (!record.isSidechain && !record.parent_tool_use_id) branch.push(record)
    record = record.parentUuid ? records.get(record.parentUuid) : undefined
  }
  return branch.reverse()
}

export interface EditorExecution { state: 'running' | 'idle' | 'unknown'; at?: string; evidenceId?: string; requestId?: string; turnStartedAt?: string; turnSource?: 'owner' | 'desktop' | 'relay' | 'technical' }
const crossSession = (text: string) => /<cross-session-message\b/.test(text)
const technicalInput = (text: string) => /^(?:<task-(?:notification|started|progress)\b|<system-reminder>|<local-command|<command-(?:message|name)>)/.test(text)
/** Execution is session telemetry. It never completes a task or renews old requests. */
export function editorExecution(records: Iterable<TranscriptRecord>): EditorExecution {
  let execution: EditorExecution = { state: 'unknown' }
  let requestId: string | undefined
  let turnStartedAt: string | undefined
  let turnSource: EditorExecution['turnSource']
  for (const record of records) {
    if (record.isSidechain || record.parent_tool_use_id || record.isCompactSummary || !record.uuid || !record.timestamp) continue
    const text = textOf(record.message?.content).trim()
    const blocks = Array.isArray(record.message?.content) ? record.message.content : []
    let state: EditorExecution['state'] | undefined
    if (record.type === 'user' && crossSession(text)) {
      state = 'running'; requestId = undefined; turnStartedAt = record.timestamp; turnSource = 'relay'
    } else if (record.type === 'user' && !record.isMeta) {
      if (/^\[Request interrupted by user/i.test(text)) state = 'idle'
      // Tool output belongs to the active turn.  It must not replace the
      // source of that turn: a later tool result from an Omni relay is not a
      // new owner request and cannot make its already-prepared reports stale.
      else if (blocks.some(block => block.type === 'tool_result')) state = 'running'
      else if (visibleEditorMessage(record, 'projeto')) {
        state = 'running'; requestId = undefined; turnStartedAt = record.timestamp
        turnSource = /^\[Omni Desktop authority:v1 request:/i.test(text) ? 'desktop' : 'owner'
      }
    }
    if (record.type === 'assistant') {
      const observation = observeEditorRecord(record)
      if (observation) requestId = observation.requestId
      if (record.message?.stop_reason === 'tool_use' || blocks.some(block => block.type === 'tool_use')) state = 'running'
      else if (text && (record.message?.stop_reason === 'end_turn' || (observation && observation.kind !== 'received'))) state = 'idle'
      else if (text || blocks.some(block => block.type === 'thinking')) state = 'running'
    }
    if (state) execution = { state, at: record.timestamp, evidenceId: record.uuid, ...(requestId ? { requestId } : {}), ...(turnStartedAt ? { turnStartedAt } : {}), ...(turnSource ? { turnSource } : {}) }
  }
  return execution
}
export const textOf = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('\n\n') : ''
export function visibleEditorMessage(record: TranscriptRecord, name: string): Message | null {
  if (record.isMeta || record.isCompactSummary || record.isSidechain || record.parent_tool_use_id || !record.uuid || !['user', 'assistant'].includes(record.type)) return null
  const text = textOf(record.message?.content)
  if (!text.trim() || technicalInput(text.trim()) || /^(This session is being continued from a previous conversation|Another Claude session sent a message:|Base directory for this skill:)/.test(text.trim())) return null
  return { id: record.uuid, role: record.type as 'user' | 'assistant', text, at: record.timestamp || '', channel: 'text', origin: 'editor', author: record.type === 'user' ? 'Você · histórico do VS Code' : `Claude · ${name}` }
}
export interface EditorObservation { requestId: string; kind: 'received' | 'completed' | 'blocked'; text: string; at: string; evidenceId: string; executionEvidence?: import('../shared/return-evidence').ExecutionEvidence }
/** Latest answered owner turn in this exact session. No task correlation is inferred.
 * Multiple end_turn chunks (including a follow-up after a hook) belong together;
 * tool commentary, compact summaries, relay envelopes and sidechains do not.
 */
export function latestEditorReturn(records: Iterable<TranscriptRecord>, sessionId: string): EditorSessionReturn | undefined {
  let turn: TranscriptRecord | undefined
  let answers: string[] = []
  let latest: EditorSessionReturn | undefined
  for (const record of records) {
    if (record.isSidechain || record.parent_tool_use_id || !record.uuid || !record.timestamp) continue
    const text = textOf(record.message?.content).trim()
    if (record.isCompactSummary || (record.type === 'user' && /This session is being continued from a previous conversation|\[Omni Desktop authority:v1 request:/.test(text))) { turn = undefined; answers = []; continue }
    if (record.type === 'user' && crossSession(text)) {
      // A peer envelope is context, never a new owner authorization.
      turn = { ...record, message: { content: 'Resposta à mensagem recebida de outra sessão' } }; answers = []; continue
    }
    if (record.type === 'user' && /^auto(?:mode)?\s+(?:on|off)$/i.test(text)) {
      turn = { ...record, message: { content: turn ? textOf(turn.message?.content) : 'Continuação do trabalho nesta sessão' } }; answers = []; continue
    }
    if (record.type === 'user' && visibleEditorMessage(record, 'projeto') && !/^\[Request interrupted by user/i.test(text)) { turn = record; answers = []; continue }
    if (record.type !== 'assistant' || record.isMeta) continue
    if (observeEditorRecord(record)) { turn = undefined; answers = []; continue }
    if (!turn || record.message?.stop_reason !== 'end_turn' || !visibleEditorMessage(record, 'projeto')) continue
    answers.push(`Resposta em ${record.timestamp}:\n${text}`)
    latest = { id: `editor-response:${sessionId}:${record.uuid}`, sessionId, turnId: turn.uuid!, evidenceId: record.uuid, at: record.timestamp, objective: textOf(turn.message?.content), report: answers.join('\n\n'), deliveryState: 'ready' }
  }
  return latest
}
/**
 * Reads every Desktop protocol block contained in one Claude response.
 *
 * Claude can compact two completed requests into a single assistant record.
 * Each complete marker is a correlated return, not just the first line of the
 * response. Marker-local evidence keeps one report from hiding the other.
 */
export function observeEditorRecords(record: TranscriptRecord): EditorObservation[] {
  if (record.type !== 'assistant' || record.isSidechain || record.parent_tool_use_id || !record.uuid || !record.timestamp) return []
  const text = textOf(record.message?.content).trim()
  // Do not consume line breaks after a marker: the following line can itself
  // be another protocol block in the same assistant response.
  const matches = [...text.matchAll(/(?:^|\n)\[Omni Desktop (received|report):([a-f0-9-]{36})(?: status:(completed|blocked))?\][ \t]*/gi)]
  const markers = matches.map(match => ({
    kind: match[1].toLowerCase() as 'received' | 'report',
    requestId: match[2],
    outcome: match[3]?.toLowerCase() as 'completed' | 'blocked' | undefined,
    start: match.index || 0,
    contentStart: (match.index || 0) + match[0].length
  })).filter(marker => marker.kind === 'received' || !!marker.outcome)
  if (!markers.length) return []

  const events: Array<Omit<EditorObservation, 'evidenceId'>> = []
  for (const [index, marker] of markers.entries()) {
    // A short task may acknowledge and finish in one response. The report is
    // the final state; the receipt would add no information.
    if (marker.kind === 'received' && markers.slice(index + 1).some(next => next.kind === 'report' && next.requestId === marker.requestId)) continue
    const next = markers[index + 1]
    events.push({
      requestId: marker.requestId,
      kind: marker.kind === 'received' ? 'received' : marker.outcome!,
      text: text.slice(marker.contentStart, next?.start).trim(),
      at: record.timestamp!,
    })
  }
  return events.map((event, index) => ({ ...event, evidenceId: events.length === 1 ? record.uuid! : `${record.uuid}:${index}` }))
}

/** Compatibility helper for callers that need only the latest protocol event. */
export function observeEditorRecord(record: TranscriptRecord): EditorObservation | null {
  return observeEditorRecords(record).at(-1) || null
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
    if (record.isSidechain || record.parent_tool_use_id || !record.uuid || !record.timestamp) continue
    if (record.isCompactSummary) { requestId = undefined; terminal = undefined; continue }
    const text = textOf(record.message?.content).trim()
    if (record.type === 'user') {
      const request = text.match(/^\[Omni Desktop authority:v1 request:([a-f0-9-]{36})\]/im)
      if (request) { requestId = request[1]; terminal = undefined }
      else if (crossSession(text) || visibleEditorMessage(record, 'projeto')) { requestId = undefined; terminal = undefined }
      continue
    }
    if (record.type !== 'assistant' || !requestId) continue
    if (Array.isArray(record.message?.content) && record.message.content.some(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool_use')) { terminal = undefined; continue }
    if (record.message?.stop_reason !== 'end_turn') { terminal = undefined; continue }
    if (!text || /^\[Omni Desktop (received|report):/i.test(text)) continue
    const finished = /\b(conclu[ií]d[oa]|finalizad[oa]|implementad[oa]|resolvid[oa]|entregue|feito|tarefa pronta|deploy (?:feito|conclu[ií]do|realizado)|testes? (?:passaram|verdes))\b/i.test(text)
    const negated = /\b(n[aã]o|sem)\s+(?:foi\s+|esta\s+|está\s+)?(?:conclu[ií]d[oa]|finalizad[oa]|implementad[oa]|feito|resolvid[oa]|entregue|testes?\s+(?:passaram|verdes))\b/i.test(text)
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

export type ExternalSubagentActivity = import('../shared/contracts').AgentNode
/** Public metadata and final text from children of this exact session only. */
export async function externalSubagents(sessionId: string): Promise<ExternalSubagentActivity[]> {
  const records = await transcriptMetadata(sessionId)
  const parent = paths.get(sessionId)
  if (!parent) return []
  const { readSubagentMap } = await import('./subagent-map')
  return readSubagentMap(sessionId, parent, mainTranscript(records))
}
