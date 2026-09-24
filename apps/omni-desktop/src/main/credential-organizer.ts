import { createHash } from 'node:crypto'
import type { CredentialRegistrationInput } from '../shared/contracts'

/**
 * Organiza o texto livre colado no Crachá em acessos estruturados.
 * Roda somente no processo principal: o texto nunca chega ao modelo, e o
 * resultado é o mesmo JSON privado que `privateExecutionSources` já aceita.
 * Quem chama nunca deve registrar em log a entrada nem o resultado.
 */
export type OrganizedCredentials =
  | { kind: 'document'; json: string; label: string }
  | { kind: 'registration'; registration: CredentialRegistrationInput; label: string }

type Field = 'host' | 'port' | 'user' | 'password' | 'database' | 'fingerprint'
type Cue = 'ssh' | 'db'
interface Segment { cue: Cue | null; fields: Partial<Record<Field, string>> }

// Ordem importa: rótulos compostos antes dos simples ("host key" antes de "host").
const LABELS: [Field, RegExp][] = [
  ['fingerprint', /(?<![\p{L}\p{N}_])(?:fingerprint|finger ?print|host ?key(?:sha256)?|chave do host)(?![\p{L}\p{N}_])/iu],
  ['password', /(?<![\p{L}\p{N}_])(?:senha|password|passwd|pass|pwd|secret)(?![\p{L}\p{N}_])/iu],
  ['user', /(?<![\p{L}\p{N}_])(?:usu[aá]rio|username|user|login|usr)(?![\p{L}\p{N}_])/iu],
  ['database', /(?<![\p{L}\p{N}_])(?:banco de dados|banco|database|dbname|db|base)(?![\p{L}\p{N}_])/iu],
  ['port', /(?<![\p{L}\p{N}_])(?:porta|port)(?![\p{L}\p{N}_])/iu],
  ['host', /(?<![\p{L}\p{N}_])(?:hostname|host|servidor|server|endere[cç]o|address|ip|m[aá]quina)(?![\p{L}\p{N}_])/iu],
]
const SSH_CUE = /(?<![\p{L}\p{N}_])ssh(?![\p{L}\p{N}_])/iu
const DB_CUE = /(?<![\p{L}\p{N}_])(?:postgres(?:ql)?|pg\d*|psql|banco|database)(?![\p{L}\p{N}_])/iu
// Menção solta a data warehouse também indica que o SSH existe para chegar ao banco.
const DB_CONTEXT = /(?<![\p{L}\p{N}_])(?:postgres(?:ql)?|pg\d*|psql|banco|database|dw)(?![\p{L}\p{N}_])/iu
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/
const USER_AT_HOST = /(?<![\p{L}\p{N}_.-])([A-Za-z0-9._-]{1,64})@((?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?(?![\p{L}\p{N}_])/u

const cueOf = (text: string): Cue | null => SSH_CUE.test(text) ? 'ssh' : DB_CUE.test(text) ? 'db' : null
const fieldOf = (label: string): Field | null => LABELS.find(([, pattern]) => pattern.test(label))?.[0] ?? null
const clean = (value: string) => value.trim().replace(/^["'`]|["'`]$/g, '').trim()

function splitHostPort(host: string): { host: string; port?: string } {
  const match = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(host)
  return match ? { host: match[1], port: match[2] } : { host }
}

/** Retorna null quando o texto não descreve SSH/PostgreSQL com segurança; o parser antigo segue valendo. */
export function organizeCredentialText(raw: string): OrganizedCredentials | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try { JSON.parse(raw); return null } catch { /* texto livre: organizar */ }
  if (/-----BEGIN [A-Z ]+-----/.test(raw)) return null
  if (/\b(?:postgres(?:ql)?|mysql|mssql|sqlserver):\/\//i.test(raw)) return null

  const segments: Segment[] = []
  let current: Segment | null = null
  const open = (cue: Cue | null) => { current = { cue, fields: {} }; segments.push(current); return current }
  const put = (field: Field, value: string, cue: Cue | null) => {
    if (!value) return
    // Um rótulo com qualificador ("senha do PG7") vai ao segmento desse tipo.
    let target: Segment | null = cue ? [...segments].reverse().find(s => s.cue === cue && !s.fields[field]) ?? null : current
    if (cue && !target && current && current.cue === null && !current.fields[field]) { current.cue = cue; target = current }
    if (!target || target.fields[field]) target = open(cue ?? target?.cue ?? null)
    target.fields[field] = value
    current = target
  }

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) { current = null; continue }
    const separator = /^([^:=\r\n]{1,48}?)\s*[:=]\s*(.+)$/.exec(line)
    const label = separator ? fieldOf(separator[1]) : null
    if (separator && label) {
      const cue = cueOf(separator[1])
      const value = clean(separator[2])
      if (label === 'host') {
        const at = USER_AT_HOST.exec(value)
        if (at) { put('user', at[1], cue); put('host', at[2], cue); if (at[3]) put('port', at[3], cue); continue }
        const split = splitHostPort(value)
        put('host', split.host, cue); if (split.port) put('port', split.port, cue)
      } else put(label, value, cue)
      continue
    }
    // Linha sem "rótulo: valor": pares inline, user@host, IP solto ou cabeçalho.
    const tokens = line.trim().split(/\s+/)
    const lineCue = cueOf(line.replace(USER_AT_HOST, ' '))
    let consumed = false
    for (let index = 0; index < tokens.length - 1; index++) {
      const field = fieldOf(tokens[index].replace(/[:=]$/, ''))
      if (!field || fieldOf(tokens[index + 1].replace(/[:=]$/, ''))) continue
      put(field, clean(tokens[index + 1]), lineCue)
      index++; consumed = true
    }
    if (consumed) continue
    const at = USER_AT_HOST.exec(line)
    if (at) { put('user', at[1], lineCue); put('host', at[2], lineCue); if (at[3]) put('port', at[3], lineCue); continue }
    const ip = IPV4.exec(line)
    if (ip) { put('host', ip[0], lineCue); continue }
    // Cabeçalho ("DW .7 (SSH)", "PG7"): abre um segmento do tipo indicado.
    if (lineCue && (!current || Object.keys((current as Segment).fields).length)) open(lineCue)
    else if (lineCue && current) (current as Segment).cue ??= lineCue
  }

  const filled = segments.filter(s => Object.keys(s.fields).length)
  const wholeCue = cueOf(raw)
  for (const segment of filled) {
    if (segment.cue) continue
    if (segment.fields.database) segment.cue = 'db'
    else if (segment.fields.host && segment.fields.user && segment.fields.password) {
      const typed = filled.filter(s => s.cue)
      // Host + usuário + senha sem pista explícita é, na prática, acesso SSH.
      segment.cue = typed.some(s => s.cue === 'db') || wholeCue !== 'db' ? 'ssh' : typed.some(s => s.cue === 'ssh') ? 'db' : 'db'
    }
  }
  const ssh = filled.filter(s => s.cue === 'ssh')
  const dbs = filled.filter(s => s.cue === 'db')
  if (ssh.length > 1 || dbs.length > 1) return null

  const port = (value: string | undefined, fallback: string) => value && /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535 ? value : fallback
  if (ssh.length === 1) {
    const s = ssh[0].fields
    if (!s.host || !s.user || !s.password) return null
    const sshObject = { kind: 'ssh', host: s.host, username: s.user, password: s.password, port: port(s.port, '22'), ...(s.fingerprint ? { hostKeySha256: s.fingerprint } : {}) }
    const d = dbs[0]?.fields
    if (d || DB_CONTEXT.test(raw)) {
      // Sem senha do banco, o acesso usa `sudo -n -u postgres` dentro do servidor SSH.
      const database = { kind: 'database', engine: 'postgresql', host: d?.host || '127.0.0.1', port: port(d?.port, '5432'), database: d?.database || 'postgres', username: d?.user || 'postgres', password: d?.password || '' }
      const mode = database.password ? 'password' : 'sudo-postgres'
      return { kind: 'document', json: JSON.stringify({ ssh: sshObject, database, mode }), label: 'SSH + PostgreSQL' }
    }
    const token = JSON.stringify(sshObject)
    const hostRef = s.host.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'host'
    const accountRef = s.user.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ssh'
    const credentialId = `ssh-${accountRef}-${hostRef}-${sshObject.port}`.slice(0, 63).replace(/-+$/, '') + '-' + createHash('sha256').update(`${s.host}|${s.user}|${sshObject.port}`).digest('hex').slice(0, 8)
    return { kind: 'registration', label: 'SSH', registration: { credentialId, providerRef: 'ssh', accountRef, environmentRef: 'unspecified', token, expiresAt: null, renewalMode: 'rotate' } }
  }
  if (dbs.length === 1) {
    const d = dbs[0].fields
    if (!d.host || !d.user || !d.password) return null
    const split = splitHostPort(d.host)
    const database = { kind: 'database', engine: 'postgresql', host: split.host, port: port(d.port || split.port, '5432'), database: d.database || 'postgres', username: d.user, password: d.password }
    return { kind: 'document', json: JSON.stringify({ credentials: [database] }), label: 'PostgreSQL' }
  }
  return null
}
