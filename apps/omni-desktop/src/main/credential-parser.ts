import { createHash } from 'node:crypto'
import type { CredentialRegistrationInput } from '../shared/contracts'

export type CredentialKind = 'token' | 'login' | 'database' | 'active-directory' | 'certificate'
export interface ParsedCredential {
  registration: CredentialRegistrationInput
  kind: CredentialKind
  /** Only a recognized provider name or an explicitly labelled service; never the raw message. */
  serviceLabel: string
  missing: string[]
}

const labels = 'serviço|servico|sistema|provedor|service|provider|conta|account|organização|organizacao|ambiente|environment|host|servidor|server|porta|port|banco|database|db|usuário|usuario|username|user|login|domínio|dominio|domain|senha|password|token|chave|api key|secret|vence|vencimento|expira|expires|sslmode'
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const ref = (value: string, fallback: string) => identifier(normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback)
const identifier = (value: string) => value.length <= 80 ? value : `${value.slice(0, 63).replace(/-+$/, '')}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`

// Quoted fields may contain spaces/punctuation. Unquoted fields stop at another field or a separator.
function field(text: string, names: string): string {
  const pattern = new RegExp(`(?:^|[\\s,;])(?:${names})(?:\\s*[:=]\\s*|\\s+)(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^,;\\r\\n]*?)(?=\\s+(?:${labels})\\s*(?:[:=]|\\s)|[,;\\r\\n]|$))`, 'i')
  const match = pattern.exec(text)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

function atom(text: string, names: string): string {
  const pattern = new RegExp(`(?:^|[\\s,;])(?:${names})(?:\\s*[:=]\\s*|\\s+)(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s,;]+))`, 'i')
  const match = pattern.exec(text)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

const recognized = (value: string) => {
  const text = normalize(value)
  if (/\b(?:vercel|verecel)\b/.test(text)) return { id: 'vercel', label: 'Vercel' }
  if (/\bgithub\b/.test(text)) return { id: 'github', label: 'GitHub' }
  if (/\b(?:postgres|postgresql)\b/.test(text)) return { id: 'postgresql', label: 'PostgreSQL' }
  if (/\bmysql\b/.test(text)) return { id: 'mysql', label: 'MySQL' }
  if (/\b(?:sql server|sqlserver|mssql)\b/.test(text)) return { id: 'sqlserver', label: 'SQL Server' }
  if (/\b(?:active directory|active-directory|ad)\b/.test(text)) return { id: 'active-directory', label: 'Active Directory' }
  return null
}

function expiry(text: string, now: Date): string | null {
  const relative = /\b(?:expira|vence|vencimento|expires)\s*[:=]?\s*(?:em|in)\s+(\d+)\s*(dias?|days?|horas?|hours?)\b/i.exec(text)
  if (relative) {
    const value = Number(relative[1])
    if (value < 1 || value > 36500) throw new Error('Informe um prazo de vencimento válido.')
    return new Date(now.getTime() + value * (/^(?:dia|day)/i.test(relative[2]) ? 86400000 : 3600000)).toISOString()
  }
  const value = /\b(?:expira|vence|vencimento|expires)\s*[:=]?\s*(?:(?:em|on)\s+)?(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/i.exec(text)?.[1]
  if (!value) return null
  const [year, month, day] = value.includes('/') ? value.split('/').reverse().map(Number) : value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getTime() <= now.getTime()) throw new Error('Informe uma data de vencimento válida e futura.')
  return date.toISOString()
}

/** Runs exclusively in the trusted main process. Callers must never log this result or its input. */
export function parseCredential(text: string, now: Date = new Date()): ParsedCredential {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 16000 || !Number.isFinite(now.getTime())) throw new Error('Envie uma descrição de acesso válida, com até 16 KB.')
  const missing: string[] = []
  const pem = /-----BEGIN (CERTIFICATE|PRIVATE KEY|ENCRYPTED PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----[\s\S]+?-----END \1-----/g
  const certificatePem = text.match(pem)?.join('\n') ?? ''
  const withoutPem = text.replace(pem, ' ')
  const uriText = /\b(?:postgres(?:ql)?|mysql|mssql|sqlserver):\/\/[^\s<>"']+/i.exec(withoutPem)?.[0]
  let uri: URL | undefined
  if (uriText) {
    try { uri = new URL(uriText.replace(/[;,]$/, '')) } catch { throw new Error('A conexão do banco está incompleta ou inválida.') }
  }
  const plain = withoutPem.replace(uriText ?? /$^/, ' ')
  const suppliedPassword = atom(plain, 'senha|password|secret')
  const suppliedAccount = atom(plain, 'conta|account|organização|organizacao')
  const classification = [suppliedPassword, suppliedAccount].filter(Boolean).reduce((safe, value) => safe.split(value).join(' '), plain)
  const lower = normalize(classification)
  const known = recognized(classification) ?? (uri ? recognized(uri.protocol.replace(':', '')) : null)
  const kind: CredentialKind = certificatePem || /\b(?:certificado|certificate|pem)\b/.test(lower) ? 'certificate'
    : uri || /\b(?:postgres(?:ql)?|mysql|sql server|sqlserver|mssql|banco de dados|database)\b/.test(lower) ? 'database'
      : /\b(?:active directory|active-directory|ad|dominio)\b/.test(lower) ? 'active-directory'
        : /\b(?:usuario|username|login|senha|password)\b/.test(lower) && !/\b(?:token|chave|api key)\b/.test(lower) ? 'login' : 'token'

  let username = atom(plain, 'usuário|usuario|username|user|login')
  let password = suppliedPassword
  let host = atom(plain, 'host|servidor|server')
  let port = atom(plain, 'porta|port')
  let database = atom(plain, 'banco|database|db')
  let domain = atom(plain, 'domínio|dominio|domain')
  const explicitAccount = suppliedAccount
  const explicitService = field(plain, 'serviço|servico|sistema|provedor|service|provider')
  const explicitEnvironment = atom(plain, 'ambiente|environment')
  let account = explicitAccount || username || 'pessoal'
  let secret = ''

  if (kind === 'token') {
    secret = atom(plain, 'token|chave|api key|secret')
    if (/^(?:da|do|de|para|vercel|verecel|github)$/i.test(secret)) secret = ''
    if (!secret) secret = /\b(?:vcp_[a-zA-Z0-9_-]+|gh[pousr]_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+)\b/.exec(plain)?.[0] ?? ''
    if (!secret) secret = /\b(?=[A-Za-z0-9._-]{16,}\b)(?=[A-Za-z0-9._-]*[A-Za-z])(?=[A-Za-z0-9._-]*\d)[A-Za-z0-9._-]+\b/.exec(plain)?.[0] ?? ''
    if (!secret) missing.push('Qual é o token ou a chave de acesso?')
  }
  if (uri) {
    try {
      username = decodeURIComponent(uri.username)
      password = decodeURIComponent(uri.password)
      host = uri.hostname
      port = uri.port
      database = decodeURIComponent(uri.pathname.replace(/^\//, ''))
      account = explicitAccount || username || 'pessoal'
    } catch { throw new Error('A conexão do banco está incompleta ou inválida.') }
  }
  if (kind === 'active-directory') {
    username ||= explicitAccount
    const principal = /^([^\\\s]+)\\([^\\\s]+)$/.exec(username) ?? /(?:^|\s)([^\\\s,;]+)\\([^\\\s,;]+)(?=\s|$)/.exec(plain)
    if (principal) { domain ||= principal[1]; username = principal[2] }
    if (!domain) missing.push('Qual é o domínio do Active Directory?')
    account = explicitAccount || [domain, username].filter(Boolean).join('-') || 'pessoal'
  }
  if (kind === 'database') {
    if (host.includes(':') && !host.startsWith('[') && host.split(':').length === 2) { const split = host.split(':'); host = split[0]; port ||= split[1] }
    if (!host) missing.push('Qual é o servidor do banco?')
    if (!database) missing.push('Qual é o nome do banco?')
    if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error('Informe uma porta de banco válida.')
  }
  if (kind === 'database' || kind === 'active-directory' || kind === 'login') {
    if (!username) missing.push('Qual é o usuário desse acesso?')
    if (!password) missing.push('Qual é a senha desse acesso?')
  }
  if (kind === 'certificate' && !certificatePem) missing.push('Inclua o certificado completo em formato PEM.')

  // Identity metadata can never inherit an unlabelled token (the old parser did this).
  const secrets = [secret, password, certificatePem].filter(Boolean)
  const hasSecret = (value: string) => secrets.some(item => item.length >= 8 ? value.includes(item) : value === item)
  const safeService = explicitService && explicitService.length <= 100 && /^[\p{L}\p{N} ._-]+$/u.test(explicitService) && !hasSecret(explicitService) ? explicitService : ''
  const provider = safeService ? recognized(safeService) ?? { id: ref(safeService, 'unspecified'), label: safeService } : known
  if (!provider) missing.push('Para qual serviço ou sistema é esse acesso? Informe “serviço: nome”.')
  if (kind === 'database' && !['postgresql', 'mysql', 'sqlserver'].includes(known?.id ?? '')) missing.push('Qual é o tipo de banco: PostgreSQL, MySQL ou SQL Server?')
  if ([account, username, host, database, domain, explicitEnvironment, provider?.label ?? ''].some(value => value && hasSecret(value))) throw new Error('Separe o nome da conta, o ambiente e o segredo em campos diferentes.')

  const environmentRef = explicitEnvironment ? ref(explicitEnvironment, 'unspecified') : 'unspecified'
  const providerRef = provider?.id ?? 'unspecified'
  const accountRef = ref(account, 'pessoal')
  const engine = known?.id ?? 'unspecified'
  const details = kind === 'database' ? { host, port, database, username, password, engine, ...(uri?.searchParams.get('sslmode') ? { sslmode: uri.searchParams.get('sslmode')! } : {}) }
    : kind === 'active-directory' ? { domain, username, password, ...(host ? { host } : {}) }
      : kind === 'certificate' ? { certificatePem, ...(password ? { password } : {}) }
        : kind === 'login' ? { username, password } : { token: secret }
  const token = JSON.stringify({ kind, ...details })
  if (Buffer.byteLength(token, 'utf8') > 2400) throw new Error('Este acesso excede o limite de 2.400 bytes do cofre. Use uma referência de certificado ou credencial menor.')
  const defaultPort = ({ postgresql: '5432', mysql: '3306', sqlserver: '1433' } as Record<string, string>)[engine] || ''
  const target = kind === 'database' ? [host, port || defaultPort, database].filter(Boolean).map(value => ref(value, 'unspecified')) : kind === 'active-directory' ? [ref(domain, 'unspecified')] : []
  const credentialId = identifier([providerRef, accountRef, ...(explicitEnvironment ? [environmentRef] : []), ...target].join('-'))
  return {
    registration: { credentialId, providerRef, accountRef, environmentRef, token, expiresAt: expiry(plain, now), renewalMode: kind === 'login' || kind === 'active-directory' ? 'reauthenticate' : 'rotate' },
    kind,
    serviceLabel: provider?.label ?? 'Serviço a informar',
    missing,
  }
}
