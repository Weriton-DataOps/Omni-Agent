import React, { type ReactNode } from 'react'

interface MessageTextProps { text: string; streaming?: boolean }

function safeUrl(value: string): string | null {
  if (/[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) return null
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : null
  } catch { return null }
}

function link(href: string, label: ReactNode, key: number): ReactNode {
  return <a key={key} className="chat-link" href={href} title="Abrir no navegador" onClick={event => {
    event.preventDefault()
    void window.omni.openUrl(href)
  }}>{label}</a>
}

function closingMarker(value: string, marker: string, from: number, code = false): number {
  let found = value.indexOf(marker, from)
  while (found >= 0) {
    let slashes = 0
    for (let cursor = found - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++
    const exactCodeRun = !code || (value[found - 1] !== '`' && value[found + marker.length] !== '`')
    if ((code || slashes % 2 === 0) && exactCodeRun) return found
    found = value.indexOf(marker, found + marker.length)
  }
  return -1
}

/** React text nodes keep both Markdown and arbitrary executor text escaped. */
function inline(value: string, streaming: boolean, depth = 0): ReactNode[] {
  if (depth > 12) return [value]
  const output: ReactNode[] = []
  let plain = ''
  const flush = () => { if (plain) { output.push(plain); plain = '' } }
  let index = 0
  while (index < value.length) {
    const char = value[index]
    if (char === '\\' && /[\\`*_[\]{}()#+.!>~-]/.test(value[index + 1] || '')) {
      plain += value[index + 1]; index += 2; continue
    }
    if (char === '\n') { flush(); output.push(<br key={index} />); index++; continue }
    if (char === '`') {
      const marker = value.slice(index).match(/^`+/)![0]
      const end = closingMarker(value, marker, index + marker.length, true)
      if (end >= 0 || streaming) {
        flush()
        output.push(<code key={index}>{value.slice(index + marker.length, end >= 0 ? end : undefined)}</code>)
        index = end >= 0 ? end + marker.length : value.length
        continue
      }
    }
    if (char === '[') {
      const rest = value.slice(index)
      const complete = rest.match(/^\[([^\]\n]*)\]\(([^)\n]*)\)/)
      if (complete) {
        flush()
        const href = safeUrl(complete[2])
        output.push(href ? link(href, inline(complete[1], false, depth + 1), index) : complete[0])
        index += complete[0].length
        continue
      }
      if (streaming) {
        const partial = rest.match(/^\[([^\]\n]*)$/) || rest.match(/^\[([^\]\n]*)\](?:\([^\)\n]*)?$/)
        if (partial) {
          flush(); output.push(...inline(partial[1], true, depth + 1)); index = value.length; continue
        }
      }
    }
    if ((char === 'h' || char === 'H') && /^https?:\/\//i.test(value.slice(index))) {
      const raw = value.slice(index).match(/^https?:\/\/[^\s<>()\[\]{}*`]+/i)?.[0]
      if (raw) {
        const candidate = raw.replace(/[.,;:!?]+$/, '')
        const href = safeUrl(candidate)
        // The last URL may still be arriving; wait for a boundary or the final event.
        if (href && !(streaming && index + raw.length === value.length)) {
          flush(); output.push(link(href, candidate, index)); plain += raw.slice(candidate.length)
          index += raw.length; continue
        }
      }
    }
    const marker = ['***', '___', '**', '__', '~~', '*', '_'].find(item => value.startsWith(item, index))
    if (marker && !(marker.includes('_') && /[\p{L}\p{N}]/u.test(value[index - 1] || ''))) {
      const after = value[index + marker.length]
      if (!after && streaming) { index += marker.length; continue }
      if (after && !/\s/.test(after)) {
        const end = closingMarker(value, marker, index + marker.length)
        if (end >= 0 || streaming) {
          flush()
          const children = inline(value.slice(index + marker.length, end >= 0 ? end : undefined), streaming && end < 0, depth + 1)
          output.push(marker.length === 3 ? <strong key={index}><em>{children}</em></strong>
            : marker === '~~' ? <del key={index}>{children}</del>
            : marker.length === 2 ? <strong key={index}>{children}</strong> : <em key={index}>{children}</em>)
          index = end >= 0 ? end + marker.length : value.length
          continue
        }
      }
    }
    plain += char; index++
  }
  flush()
  return output
}

const fenceStart = (line: string) => line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
const headingStart = (line: string) => line.match(/^ {0,3}(#{1,6})\s+(.*)$/)
const listStart = (line: string) => line.match(/^ {0,3}(?:([-+*])|(\d+)[.)])\s+(.*)$/)
const rule = (line: string) => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)
const blockStart = (line: string) => fenceStart(line) || headingStart(line) || listStart(line) || /^ {0,3}>/.test(line) || rule(line)

function blocks(text: string, streaming: boolean, depth = 0): ReactNode[] {
  if (depth > 12) return [text]
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const output: ReactNode[] = []
  const isTail = (nextLine: number) => streaming && lines.slice(nextLine).every(line => !line.trim())
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const start = index
    const fence = fenceStart(line)
    if (fence) {
      index++
      const first = index
      const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$')
      while (index < lines.length && !close.test(lines[index])) index++
      const closed = index < lines.length
      const literal = lines.slice(first, index).join('\n') + (closed && index > first ? '\n' : '')
      output.push(<pre key={start}><code>{literal}</code></pre>)
      if (closed) index++
      continue
    }
    const heading = headingStart(line)
    if (heading) {
      index++
      output.push(React.createElement('h' + heading[1].length, { key: start }, inline(heading[2].replace(/\s+#+\s*$/, ''), isTail(index))))
      continue
    }
    if (rule(line)) { output.push(<hr key={start} />); index++; continue }
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) quoted.push(lines[index++].replace(/^ {0,3}>\s?/, ''))
      output.push(<blockquote key={start}>{blocks(quoted.join('\n'), isTail(index), depth + 1)}</blockquote>)
      continue
    }
    const list = listStart(line)
    if (list) {
      const ordered = !!list[2]
      const items: ReactNode[] = []
      while (index < lines.length) {
        const item = listStart(lines[index])
        if (!item || !!item[2] !== ordered) break
        items.push(<li key={index}>{inline(item[3], isTail(index + 1))}</li>)
        index++
      }
      output.push(ordered ? <ol key={start} start={Number(list[2]) === 1 ? undefined : Number(list[2])}>{items}</ol> : <ul key={start}>{items}</ul>)
      continue
    }
    const paragraph: string[] = [line]
    index++
    while (index < lines.length && lines[index].trim() && !blockStart(lines[index])) paragraph.push(lines[index++])
    output.push(<p key={start}>{inline(paragraph.join('\n'), isTail(index))}</p>)
  }
  return output
}

export function MessageText({ text, streaming = false }: MessageTextProps) {
  return <div className={'message-text' + (streaming ? ' streaming' : '')} aria-busy={streaming}>{blocks(text, streaming)}</div>
}
