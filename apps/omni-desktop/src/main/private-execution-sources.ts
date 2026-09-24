import { randomUUID } from 'node:crypto'
import { parseCredential } from './credential-parser'
import type { ExecutorAccess } from './executor-access'
import type { CredentialReceipt } from '../shared/contracts'
import type { CredentialExecutionLeaf } from '../../../../src/contracts/credential-execution'
import { PrivateAccessInputError } from '../shared/private-access'

/** This parser runs only in main. Public results contain handles/counts, never connection fields. */
export async function privateExecutionSources(raw: string, lookup: (id: string) => Promise<CredentialReceipt | null>): Promise<{ accesses: ExecutorAccess[]; unsupported: number }> {
  let document: unknown
  try { document = JSON.parse(raw) } catch { document = raw }
  const combined = document && typeof document === 'object' && 'ssh' in document && 'database' in document ? document as { ssh: unknown; database: unknown; mode?: unknown } : null
  if (combined && combined.mode !== undefined && !['password', 'sudo-postgres'].includes(String(combined.mode))) throw new PrivateAccessInputError('Modo de acesso SSH inválido no Crachá.')
  const entries = document && typeof document === 'object' && 'credentials' in document
    ? (document as { credentials: unknown }).credentials : combined ? [combined.ssh, combined.database] : typeof document === 'string' && /\n\s*\n/.test(document) ? document.split(/\n\s*\n/).filter(Boolean) : [document]
  if (!Array.isArray(entries) || !entries.length || entries.length > 8) throw new PrivateAccessInputError('No Crachá, separe até oito acessos na lista JSON credentials. Nenhum acesso foi usado.')
  const accesses: ExecutorAccess[] = []; let unsupported = 0
  const parsedAccesses: { provider: 'postgresql' | 'ssh'; source: CredentialExecutionLeaf; host?: string; username?: string }[] = []
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'credentialId' in entry) {
      const ref = entry as { credentialId: unknown; version?: unknown }
      if (typeof ref.credentialId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(ref.credentialId)) throw new PrivateAccessInputError('Referência de acesso inválida no Crachá.')
      const item = await lookup(ref.credentialId)
      if (!item || !['active', 'unverified'].includes(item.status) || (ref.version !== undefined && ref.version !== item.version) || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) throw new PrivateAccessInputError('O acesso indicado está indisponível, expirou ou mudou de versão.')
      if (!['postgresql','postgres','pg','ssh'].includes(item.providerRef)) { unsupported++; continue }
      parsedAccesses.push({ provider: item.providerRef === 'ssh' ? 'ssh' : 'postgresql', source: { credentialId: item.credentialId, version: item.version } }); continue
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'kind' in entry) {
      const value = entry as Record<string, unknown>
      if (value.kind === 'ssh') {
        if (!['host','username'].every(key => typeof value[key] === 'string' && Boolean(value[key])) || !(typeof value.password === 'string' && value.password || typeof value.privateKey === 'string' && value.privateKey)) throw new PrivateAccessInputError('O SSH precisa de host, username e password ou privateKey no Crachá.')
        const token = JSON.stringify({ kind: 'ssh', host: value.host, username: value.username, port: String(value.port || 22), password: value.password, privateKey: value.privateKey, passphrase: value.passphrase, hostKeySha256: value.hostKeySha256 })
        if (Buffer.byteLength(token) > 2400) throw new Error('Acesso SSH acima do limite.')
        parsedAccesses.push({ provider: 'ssh', host: String(value.host), username: String(value.username), source: { registration: { credentialId: `temporary-${randomUUID()}`, providerRef: 'ssh', accountRef: 'private', environmentRef: 'private', token, expiresAt: null, renewalMode: 'none' } } }); continue
      }
      if (value.kind !== 'database' || !['postgresql','postgres','pg'].includes(String(value.engine))) { unsupported++; continue }
      if (!['host','database','username'].every(key => typeof value[key] === 'string' && Boolean(value[key])) || combined?.mode !== 'sudo-postgres' && !(typeof value.password === 'string' && value.password) || typeof value.port !== 'undefined' && !/^\d{1,5}$/.test(String(value.port))) throw new PrivateAccessInputError('O PostgreSQL precisa de host, database e username no Crachá; password só é dispensado no modo SSH sudo-postgres.')
      const token = JSON.stringify({ kind: 'database', engine: 'postgresql', host: value.host, database: value.database, username: value.username, password: value.password || '', port: String(value.port || 5432) })
      if (Buffer.byteLength(token) > 2400) throw new Error('Acesso privado acima do limite.')
      parsedAccesses.push({ provider: 'postgresql', host: String(value.host), username: String(value.username), source: { registration: { credentialId: `temporary-${randomUUID()}`, providerRef: 'postgresql', accountRef: 'private', environmentRef: 'private', token, expiresAt: null, renewalMode: 'none' } } }); continue
    }
    if (typeof entry !== 'string') { unsupported++; continue }
    // Never silently use the first of several ambiguous targets in pasted prose.
    if ((entry.match(/(?:^|\n)\s*(?:host|servidor|server)\s*[:=]/gi) || []).length > 1 || (entry.match(/\b(?:postgres(?:ql)?|mysql):\/\//gi) || []).length > 1) throw new PrivateAccessInputError('Há mais de um destino no anexo. Separe os acessos na lista JSON credentials do Crachá para não escolher o banco errado.')
    const parsed = parseCredential(entry)
    const payload = JSON.parse(parsed.registration.token)
    if (parsed.kind !== 'ssh' && (parsed.kind !== 'database' || payload.engine !== 'postgresql')) { unsupported++; continue }
    if (parsed.missing.length) throw new PrivateAccessInputError(`Complete no Crachá: ${parsed.missing.join(' ')}`)
    parsedAccesses.push({ provider: parsed.kind === 'ssh' ? 'ssh' : 'postgresql', source: { registration: parsed.registration }, host: payload.host, username: payload.username })
  }
  const ssh = parsedAccesses.filter(item => item.provider === 'ssh'); const databases = parsedAccesses.filter(item => item.provider === 'postgresql')
  if (ssh.length) {
    for (const database of databases) {
      const matches = ssh.filter(item => combined || database.host && item.host && [item.host,'127.0.0.1','localhost','::1'].includes(database.host))
      if (matches.length !== 1) throw new PrivateAccessInputError('Associe explicitamente o SSH ao banco no JSON privado {ssh, database, mode}. Não vou adivinhar o servidor.')
      const mode = combined?.mode === 'password' ? 'password' : combined?.mode === 'sudo-postgres' || database.username === 'postgres' ? 'sudo-postgres' : 'password'
      accesses.push({ provider: 'postgresql', source: { ssh: matches[0].source, database: database.source, mode } })
    }
    if (!databases.length) throw new PrivateAccessInputError('O SSH foi reconhecido. Inclua o banco de destino no Crachá para executar o psql dentro desse servidor.')
  } else for (const database of databases) accesses.push({ provider: 'postgresql', source: database.source })
  return { accesses, unsupported }
}
