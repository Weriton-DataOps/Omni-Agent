import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExecutorAccess } from './executor-access'

export interface PrivateContextRecord {
  id: string; conversationId: string; workspace: string; turnIds: string[];
  raw: string | null; size: number; createdAt: string; expiresAt: string | null;
  accesses?: ExecutorAccess[]; credentialIds?: string[]; label?: string;
}
export interface PrivateContextPersistence {
  read(id: string): PrivateContextRecord | null;
  list(): PrivateContextRecord[];
  write(record: PrivateContextRecord): void;
  remove(id: string): void;
}
const validId = (id: string) => /^[a-f0-9-]{36}$/i.test(id)
/** DPAPI CurrentUser, independent of Electron's profile key/flush lifecycle.
 * Plain values travel only through redirected stdio, never arguments or files.
 */
export const windowsPrivateContextCrypto = {
  encrypt(text: string): Buffer { return protect(Buffer.from(text, 'utf8'), 'Protect') },
  decrypt(bytes: Buffer): string { const plain = protect(bytes, 'Unprotect'); try { return plain.toString('utf8') } finally { plain.fill(0) } }
}
function protect(input: Buffer, operation: 'Protect' | 'Unprotect'): Buffer {
  if (process.platform !== 'win32') throw Error('Proteção privada exige Windows.')
  const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $taskBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); try { $taskResult=[Security.Cryptography.ProtectedData]::${operation}($taskBytes,[Text.Encoding]::UTF8.GetBytes('Omni/private-context/v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($taskResult)) } finally { [Array]::Clear($taskBytes,0,$taskBytes.Length); if($null -ne $taskResult){[Array]::Clear($taskResult,0,$taskResult.Length)} }`
  const result = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { input: input.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 200_000 })
  if (operation === 'Protect') input.fill(0)
  if (result.status !== 0 || !/^[A-Za-z0-9+/=]+$/.test(result.stdout || '')) throw Error('Proteção privada do Windows indisponível. Nenhum conteúdo foi confirmado.')
  return Buffer.from(result.stdout, 'base64')
}
/** Only ciphertext is written. Production supplies Windows DPAPI CurrentUser.
 * Never fall back to plaintext; the OS account is the trust boundary.
 */
export class PrivateContextStore implements PrivateContextPersistence {
  private cache = new Map<string, { stamp: string; record: PrivateContextRecord }>()
  constructor(private directory: string, private crypto: { encrypt(text: string): Buffer; decrypt(bytes: Buffer): string }, private clock = Date.now) {}
  read(id: string): PrivateContextRecord | null {
    if (!validId(id)) return null
    let bytes: Buffer, stamp: string
    try {
      const path = join(this.directory, `${id}.sealed`), info = statSync(path)
      stamp = `${info.size}:${info.mtimeMs}`
      const cached = this.cache.get(id)
      if (cached?.stamp === stamp && (!cached.record.expiresAt || Date.parse(cached.record.expiresAt) > this.clock())) return structuredClone(cached.record)
      bytes = readFileSync(path)
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw Error('Não foi possível ler o contexto protegido do Crachá.') }
    try {
      if (bytes.length > 100_000) throw Error()
      const value = JSON.parse(this.crypto.decrypt(bytes)) as PrivateContextRecord
      if (value.id !== id || !validId(value.conversationId) || !Array.isArray(value.turnIds) || !value.turnIds.every(validId) || typeof value.workspace !== 'string' || !(value.raw === null || typeof value.raw === 'string') || !Number.isSafeInteger(value.size)) throw Error()
      if (value.expiresAt && Date.parse(value.expiresAt) <= this.clock()) { this.remove(id); return null }
      this.cache.set(id, { stamp, record: structuredClone(value) })
      return value
    } catch { throw Error('Não foi possível abrir o contexto protegido do Crachá nesta conta Windows.') }
    finally { bytes.fill(0) }
  }
  list(): PrivateContextRecord[] {
    let names: string[]
    try { names = readdirSync(this.directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw Error('Índice privado indisponível.') }
    return names.filter(name => name.endsWith('.sealed') && validId(name.slice(0, -7))).map(name => this.read(name.slice(0, -7))).filter((r): r is PrivateContextRecord => r !== null)
  }
  write(record: PrivateContextRecord): void {
    if (!validId(record.id) || !validId(record.conversationId)) throw Error('Vínculo privado inválido.')
    const encrypted = this.crypto.encrypt(JSON.stringify(record))
    const temporary = join(this.directory, `${record.id}.${randomUUID()}.tmp`)
    try {
      mkdirSync(this.directory, { recursive: true })
      writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, join(this.directory, `${record.id}.sealed`))
      const info = statSync(join(this.directory, `${record.id}.sealed`))
      this.cache.set(record.id, { stamp: `${info.size}:${info.mtimeMs}`, record: structuredClone(record) })
    } catch { throw Error('Não foi possível preservar o contexto privado. Nada foi confirmado como recebido.') }
    finally { encrypted.fill(0); try { unlinkSync(temporary) } catch { /* already renamed / not created */ } }
  }
  remove(id: string): void {
    this.cache.delete(id)
    if (!validId(id)) throw Error('Referência privada inválida.')
    try { unlinkSync(join(this.directory, `${id}.sealed`)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Não foi possível descartar o contexto protegido.') }
  }
}
