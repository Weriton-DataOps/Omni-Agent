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

// Mapeia chaves de arquivo .env / KEY=VALUE para campo e pista (ssh/db) do Crachá.
const ENV_FIELD: [RegExp, Field][] = [
  [/^(?:ssh|pg|postgres(?:ql)?|db|database|mysql)?_?host(?:name)?$/i, 'host'],
  [/^(?:server|servidor)$/i, 'host'],
  [/^(?:ssh|pg|postgres(?:ql)?|db|database|mysql)?_?port$/i, 'port'],
  [/^(?:ssh|pg|postgres(?:ql)?|db|database|mysql)?_?(?:user(?:name)?|usuario|login|uid)$/i, 'user'],
  [/^(?:ssh|pg|postgres(?:ql)?|db|database|mysql)?_?(?:password|passwd|pass|pwd|senha|secret)$/i, 'password'],
  [/^(?:pg|postgres(?:ql)?|db|database|mysql)?_?(?:database|dbname|db_name|name)$/i, 'database'],
  [/^(?:ssh|host)_?key(?:_?sha256)?$/i, 'fingerprint'],
]
const ENV_CUE: [RegExp, Cue][] = [[/^ssh_/i, 'ssh'], [/^(?:pg|postgres|db|database|mysql)_/i, 'db']]

/** Converte um bloco KEY=VALUE (.env) em linhas rotuladas que o organizador já entende.
 * Retorna null quando não é env, ou quando há URI (o parser trata a URI diretamente). */
function envToLabeled(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  if (lines.length < 2) return null
  const pairs = lines.map(line => /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line))
  if (pairs.some(pair => !pair)) return null
  const out: string[] = []
  let cue: Cue | '' = ''
  for (const pair of pairs) {
    const value = pair![2].trim().replace(/^"(.*)"$|^'(.*)'$/, '$1$2')
    if (/:\/\//.test(value)) return null // URI: rota do parser, não do organizador.
    const field = ENV_FIELD.find(([pattern]) => pattern.test(pair![1]))?.[1]
    if (!field || !value) continue
    if (!cue) cue = ENV_CUE.find(([pattern]) => pattern.test(pair![1]))?.[1] ?? ''
    out.push(`${field}: ${value}`)
  }
  return out.length >= 2 ? (cue ? `${cue}\n` : '') + out.join('\n') : null
}

/** Localizadores NÃO secretos tirados da mensagem pública: host, porta, banco e pista.
 * Uma senha nunca vem daqui; o segredo mora só no anexo. */
function locatorsFromContext(context: string): { host?: string; port?: string; database?: string; cue?: Cue } {
  if (typeof context !== 'string' || !context.trim()) return {}
  const out: { host?: string; port?: string; database?: string; cue?: Cue } = {}
  const ip = IPV4.exec(context)
  const named = /(?<![\p{L}\p{N}_])(?:host|hostname|servidor|server|endere[cç]o|address)\s*[:=]?\s*([A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::(\d{1,5}))?/iu.exec(context)
  if (ip) out.host = ip[0]
  else if (named) { out.host = named[1]; if (named[2]) out.port = named[2] }
  const port = /(?<![\p{L}\p{N}_])(?:porta|port)\s*[:=]?\s*(\d{1,5})/iu.exec(context)
  if (port && !out.port) out.port = port[1]
  const database = /(?<![\p{L}\p{N}_])(?:banco(?: de dados)?|database|dbname)\s*[:=]?\s*([A-Za-z_][A-Za-z0-9_-]{0,62})/iu.exec(context)
  if (database) out.database = database[1]
  const cue = cueOf(context)
  if (cue) out.cue = cue
  return out
}

/** Quando a mensagem ou o anexo indicam SSH/PostgreSQL e o acesso não fechou, diz o que faltou.
 * Nunca ecoa valores do anexo; retorna null quando não há pista de SSH/PostgreSQL. */
export function missingAccessHint(raw: string, context = ''): string | null {
  // JSON, PEM e URI têm rota própria (documento privado/parser); a dica é só para texto livre.
  if (typeof raw !== 'string' || !raw.trim()) return null
  try { JSON.parse(raw); return null } catch { /* texto livre */ }
  if (/-----BEGIN [A-Z ]+-----/.test(raw) || /\b[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null
  // "banco" sozinho pode ser instituição financeira; aqui só conta pista inequívoca de SSH/PostgreSQL.
  const strictDb = /(?<![\p{L}\p{N}_])(?:postgres(?:ql)?|pg\d*|psql|banco de dados|database|dw)(?![\p{L}\p{N}_])/iu
  const cue: Cue | null = SSH_CUE.test(context) || SSH_CUE.test(raw) ? 'ssh' : strictDb.test(context) || strictDb.test(raw) ? 'db' : null
  if (!cue) return null
  const hasHost = Boolean(locatorsFromContext(context).host) || IPV4.test(raw) || /[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(raw)
  const lacks = [hasHost ? '' : 'o endereço completo do servidor (IP ou nome, não só o final)', 'usuário e senha — um por linha ou com rótulo (usuário: / senha:)']
  return `Recebi o anexo, mas não consegui montar o acesso ${cue === 'ssh' ? 'SSH' : 'PostgreSQL'}. Falta ${lacks.filter(Boolean).join(' e ')}. Nada foi gravado; a tarefa não foi enviada.`
}

/** Retorna null quando o texto não descreve SSH/PostgreSQL com segurança; o parser antigo segue valendo.
 * `context` traz só localizadores públicos (host/porta/banco) da mensagem — nunca segredo. */
export function organizeCredentialText(raw: string, context = ''): OrganizedCredentials | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try { JSON.parse(raw); return null } catch { /* texto livre: organizar */ }
  if (/-----BEGIN [A-Z ]+-----/.test(raw)) return null
  if (/\b(?:postgres(?:ql)?|mysql|mssql|sqlserver):\/\//i.test(raw)) return null
  const body = envToLabeled(raw) ?? raw
  const ctx = locatorsFromContext(context)

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

  for (const line of body.split(/\r?\n/)) {
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
    // Linha solta só é user@host quando o host tem ponto ou é IP; senão uma senha com "@" seria lida errado.
    const at = USER_AT_HOST.exec(line)
    if (at && (IPV4.test(at[2]) || at[2].includes('.'))) { put('user', at[1], lineCue); put('host', at[2], lineCue); if (at[3]) put('port', at[3], lineCue); continue }
    const ip = IPV4.exec(line)
    if (ip) { put('host', ip[0], lineCue); continue }
    // Cabeçalho ("DW .7 (SSH)", "PG7"): abre um segmento do tipo indicado.
    if (lineCue && (!current || Object.keys((current as Segment).fields).length)) open(lineCue)
    else if (lineCue && current) (current as Segment).cue ??= lineCue
  }

  // Colagem sem rótulo, só "usuário / senha" (duas linhas), com o host vindo da mensagem pública.
  // Cada valor é uma palavra e não é um rótulo; qualquer outra forma segue sem palpite.
  if (!segments.some(s => Object.keys(s.fields).length)) {
    const bare = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const hostLike = (value: string) => IPV4.test(value) || /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?$/.test(value)
    if (bare.length === 2 && bare.every(value => !/\s/.test(value) && !fieldOf(value.replace(/[:=]$/, ''))) && !hostLike(bare[0]) && ctx.host)
      open(ctx.cue ?? null).fields = { user: bare[0], password: bare[1] }
  }

  const filled = segments.filter(s => Object.keys(s.fields).length)
  // O que o anexo não trouxe e a mensagem pública trouxe: host, porta e banco (nunca segredo).
  if (filled.length === 1) {
    const fields = filled[0].fields
    if (!fields.host && ctx.host) fields.host = ctx.host
    if (!fields.port && ctx.port) fields.port = ctx.port
    if (!fields.database && ctx.database && (filled[0].cue === 'db' || ctx.cue === 'db')) fields.database = ctx.database
  }
  const wholeCue = cueOf(body) ?? ctx.cue ?? null
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
    if (d || DB_CONTEXT.test(body) || DB_CONTEXT.test(context)) {
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
