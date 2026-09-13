type PartialString = { text: string; end: number; complete: boolean }

// Decode only completed escape sequences. A split unicode escape (or surrogate
// pair) waits for the next provider delta, so no temporary replacement character
// or raw JSON escaping ever reaches the conversation.
function jsonString(source: string, start: number): PartialString | null {
  if (source[start] !== '"') return null
  let text = ''
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]
    if (char === '"') return { text, end: i + 1, complete: true }
    if (char === '\\') {
      const escaped = source[++i]
      if (escaped === undefined) return { text, end: i, complete: false }
      if (escaped === 'u') {
        const hex = source.slice(i + 1, i + 5)
        if (hex.length < 4) return { text, end: i, complete: false }
        if (!/^[a-f0-9]{4}$/i.test(hex)) return null
        const code = parseInt(hex, 16)
        if (code >= 0xd800 && code <= 0xdbff) {
          const second = source.slice(i + 5, i + 11)
          if (second.length < 6) return { text, end: i, complete: false }
          if (!/^\\u[dD][c-fC-F][a-fA-F0-9]{2}$/.test(second)) return null
          text += String.fromCharCode(code, parseInt(second.slice(2), 16)); i += 10
        } else { text += String.fromCharCode(code); i += 4 }
      } else {
        const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (!(escaped in escapes)) return null
        text += escapes[escaped]
      }
    } else {
      if (char.charCodeAt(0) < 0x20) return null
      text += char
    }
  }
  return { text, end: source.length, complete: false }
}

/** Read one top-level string from an unfinished JSON object, never nested data. */
export function partialReply(source: string): string | null {
  let i = 0
  const whitespace = () => { while (/\s/.test(source[i] || '') && i < source.length) i++ }
  whitespace()
  if (source[i++] !== '{') return null
  while (i < source.length) {
    whitespace()
    const key = jsonString(source, i)
    if (!key?.complete) return null
    i = key.end; whitespace()
    if (source[i++] !== ':') return null
    whitespace()
    if (key.text === 'reply') return jsonString(source, i)?.text ?? null
    // Skip other values without interpreting their strings or nested keys.
    let depth = 0
    while (i < source.length) {
      if (source[i] === '"') {
        const value = jsonString(source, i)
        if (!value?.complete) return null
        i = value.end; continue
      }
      if (source[i] === '{' || source[i] === '[') depth++
      else if (source[i] === '}' || source[i] === ']') {
        if (!depth) return null
        depth--
      } else if (source[i] === ',' && depth === 0) { i++; break }
      i++
    }
  }
  return null
}

type StreamBlock = { kind: 'text' | 'json'; text: string }

/** Provider deltas only: no timers and no synthetic character animation. */
export class CoordinatorTextStream {
  private blocks = new Map<number, StreamBlock>()
  private visible = ''
  private plainPrefix = ''
  private previousPlainMessage = ''
  constructor(private structured: boolean, private onText: (text: string) => void) {}
  get text() { return this.visible }
  private publish(text: string) {
    // A provider can retry/regenerate structured output. Preserve what the owner
    // is already reading; only extend the existing prefix.
    if (text.length > this.visible.length && text.startsWith(this.visible)) {
      this.visible = text; this.onText(text)
    }
  }
  private plainMessage() { return [...this.blocks.values()].filter(block => block.kind === 'text').map(block => block.text).join('') }
  private publishPlain(text: string) {
    if (!text) return
    if (!this.plainPrefix) { this.publish(text); return }
    // A retry may replay the previous message or the entire accumulated reply.
    // Wait only while the real deltas are an identical prefix; no timer is used.
    if (this.plainPrefix.startsWith(text) || this.previousPlainMessage.startsWith(text)) return
    if (text.startsWith(this.plainPrefix)) this.publish(text)
    else if (this.previousPlainMessage && text.startsWith(this.previousPlainMessage)) this.publish(this.plainPrefix + text.slice(this.previousPlainMessage.length))
    else this.publish(`${this.plainPrefix}\n\n${text}`)
  }
  consume(message: unknown) {
    const item = message as { type?: string; parent_tool_use_id?: string | null; event?: { type?: string; index?: number; content_block?: { type?: string; name?: string; text?: string }; delta?: { type?: string; text?: string; partial_json?: string } } }
    if (item.type !== 'stream_event' || item.parent_tool_use_id || !item.event) return
    const event = item.event
    if (event.type === 'message_start') {
      if (!this.structured) {
        this.previousPlainMessage = this.plainMessage() || this.previousPlainMessage
        this.plainPrefix = this.visible
      }
      this.blocks.clear(); return
    }
    const index = event.index ?? 0
    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block?.type === 'text') this.blocks.set(index, { kind: 'text', text: block.text || '' })
      else if (this.structured && block?.type === 'tool_use' && block.name === 'StructuredOutput') this.blocks.set(index, { kind: 'json', text: '' })
      else this.blocks.delete(index)
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta
      let block = this.blocks.get(index)
      // Some compatible providers omit an empty text-block start.
      if (!block && delta?.type === 'text_delta') { block = { kind: 'text', text: '' }; this.blocks.set(index, block) }
      if (!block) return
      if (delta?.type === 'text_delta' && block.kind === 'text') block.text += delta.text || ''
      else if (delta?.type === 'input_json_delta' && block.kind === 'json') block.text += delta.partial_json || ''
      if (block.text.length > 128_000) { this.blocks.delete(index); return }
    } else return
    if (this.structured) {
      for (const block of this.blocks.values()) {
        const reply = partialReply(block.text)
        if (reply !== null) this.publish(reply)
      }
    } else this.publishPlain(this.plainMessage())
  }
  finish(text: string) {
    if (this.structured || text.startsWith(this.visible)) { this.publish(text); return }
    const current = this.plainMessage()
    // SDK result may contain only the last assistant message, or a regenerated
    // version. Extend the current segment when compatible; never duplicate or
    // replace earlier streamed messages with that last-message result.
    if (!current || text.startsWith(current)) this.publishPlain(text)
  }
}

export function conciseNotice(text: string, limit = 320): string {
  const plain = text.replace(/\s+/g, ' ').trim()
  if (plain.length <= limit) return plain
  const cut = plain.slice(0, limit - 1)
  const boundary = cut.lastIndexOf(' ')
  return `${cut.slice(0, boundary > limit / 2 ? boundary : cut.length).replace(/[,:;\s]+$/, '')}…`
}
