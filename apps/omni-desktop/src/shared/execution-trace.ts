import type { RunEvent } from './contracts'

const secretKey = /(?:^|[_\- .])(password|passwd|token|secret|api[_-]?key|private[_-]?key|authorization|cookie|credential|access[_-]?key|dsn|connection(?:[_-]?string)?)(?:$|[_\- .])/i
const inlineSecret = /\b(?:sk-|ek-|ghp_|github_pat_|xox[baprs]-|AIza|ya29\.)[A-Za-z0-9_.\-]{8,}\b|\bBearer\s+[A-Za-z0-9_.\-]+|\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi
const assignmentSecret = /((?:password|passwd|token|secret|api[_-]?key|private[_-]?key|authorization|cookie|credential|access[_-]?key|dsn|connection(?:[_-]?string)?)\s*(?:=|:|\s+)\s*)([^\s,'"`;}\]]+)/gi
const maxTraceLength = 2400

function redactText(value: string) {
  return value
    .replace(inlineSecret, '[segredo ocultado]')
    .replace(assignmentSecret, '$1[segredo ocultado]')
}

function safeValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (typeof value === 'undefined') return undefined
  if (depth >= 5) return '[estrutura resumida]'
  if (Array.isArray(value)) return value.slice(0, 24).map(item => safeValue(item, seen, depth + 1))
  if (typeof value === 'object') {
    if (seen.has(value)) return '[referência circular]'
    seen.add(value)
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, item]) => [key, secretKey.test(key) ? '[segredo ocultado]' : safeValue(item, seen, depth + 1)]))
  }
  return `[${typeof value}]`
}

/** Never persist raw tool payloads: make a bounded, readable audit projection. */
export function executionTraceText(value: unknown) {
  let rendered = ''
  try {
    const safe = safeValue(value)
    rendered = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2)
  } catch { rendered = '[não foi possível projetar este dado]' }
  const trimmed = (rendered || '[vazio]').trim()
  return trimmed.length > maxTraceLength ? `${trimmed.slice(0, maxTraceLength)}\n… saída resumida` : trimmed
}

type ToolHook = {
  hook_event_name: string
  tool_name?: string
  tool_use_id?: string
  tool_input?: unknown
  tool_response?: unknown
  error?: string
  duration_ms?: number
}

/** Converts the SDK hook payload into a renderer-safe execution event. */
export function executionTraceEvent(input: ToolHook): RunEvent | null {
  if (!input.tool_name) return null
  const base = { id: input.tool_use_id, at: new Date().toISOString(), text: input.tool_name, durationMs: input.duration_ms }
  if (input.hook_event_name === 'PreToolUse') return { ...base, kind: 'tool-running', input: executionTraceText(input.tool_input) }
  if (input.hook_event_name === 'PostToolUse') return { ...base, kind: 'tool-complete', input: executionTraceText(input.tool_input), output: executionTraceText(input.tool_response) }
  if (input.hook_event_name === 'PostToolUseFailure') return { ...base, kind: 'tool-failed', input: executionTraceText(input.tool_input), output: executionTraceText(input.error || 'A ferramenta não retornou um detalhe.') }
  return null
}
