import { randomUUID } from 'node:crypto'
import type { CredentialDraft, CredentialReceipt, CredentialRegistrationInput, CredentialSaved, CredentialVerification } from '../shared/contracts'
import { parseCredential } from './credential-parser'

interface CredentialBroker {
  findLatestCredential(id: string): Promise<CredentialReceipt | null>
  verifyCredential(input: CredentialRegistrationInput): Promise<CredentialVerification>
  registerVerifiedCredential(input: CredentialRegistrationInput, expectedVersion: number | null): Promise<{ credential: CredentialReceipt; verification: CredentialVerification; disposition: 'created' | 'reused' }>
}
type Pending = { registration: CredentialRegistrationInput; version: number | null; missing: string[]; expires: number; verification?: CredentialVerification; busy: boolean }
const labels: Record<string, string> = { vercel: 'Vercel', github: 'GitHub', postgresql: 'PostgreSQL', postgres: 'PostgreSQL', mysql: 'MySQL', sqlserver: 'SQL Server', 'sql-server': 'SQL Server', mssql: 'SQL Server', 'active-directory': 'Active Directory' }
const failure = () => new Error('Não foi possível concluir a conferência do Crachá. Tente novamente; nenhum dado foi gravado por esta conferência.')
const canonicalProvider = (value: string) => value === 'verecel' ? 'vercel' : value

/** Secrets stay in this short-lived main-process object, never in Store/snapshots/model input. */
export class CredentialIntake {
  private pending = new Map<string, Pending>()
  private epoch = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private getBroker: () => Promise<CredentialBroker>, private clock: () => number = Date.now) {}

  discard(): void {
    this.epoch++
    for (const entry of this.pending.values()) entry.registration.token = ''
    this.pending.clear()
    clearTimeout(this.timer)
  }

  async prepare(raw: unknown): Promise<CredentialDraft> {
    this.discard()
    const epoch = this.epoch
    if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 12000) throw new Error('Envie os dados de um acesso por vez, em até 12 KB.')
    const parsed = parseCredential(raw, new Date(this.clock()))
    raw = ''
    // Only known display names are reflected. An arbitrary service label may itself contain a secret.
    const service = labels[parsed.registration.providerRef] || (parsed.kind === 'certificate' ? 'Certificado' : parsed.kind === 'login' ? 'Login informado' : 'Serviço informado')
    let found: CredentialReceipt | null
    try {
      const broker = await this.getBroker()
      found = epoch === this.epoch ? await broker.findLatestCredential(parsed.registration.credentialId) : null
      if (epoch === this.epoch && !found && ['token', 'login'].includes(parsed.kind)) {
        const providers = parsed.registration.providerRef === 'vercel' ? ['vercel', 'verecel'] : [parsed.registration.providerRef]
        for (const provider of providers) {
          const legacyId = `${provider}-${parsed.registration.accountRef}`.slice(0, 80)
          if (legacyId === parsed.registration.credentialId || epoch !== this.epoch) continue
          const legacy = await broker.findLatestCredential(legacyId)
          if (legacy && canonicalProvider(legacy.providerRef) === parsed.registration.providerRef && legacy.accountRef === parsed.registration.accountRef &&
              (parsed.registration.environmentRef === 'unspecified' || legacy.environmentRef === parsed.registration.environmentRef)) { found = legacy; break }
        }
      }
    } catch { throw failure() }
    if (epoch !== this.epoch) { parsed.registration.token = ''; throw new Error('Esta conferência foi encerrada. Envie o acesso novamente.') }
    if (found) {
      if (canonicalProvider(found.providerRef) !== parsed.registration.providerRef || found.accountRef !== parsed.registration.accountRef ||
          (parsed.registration.environmentRef !== 'unspecified' && found.environmentRef !== parsed.registration.environmentRef)) throw new Error('O cadastro encontrado pertence a outro escopo. Informe o ambiente desse acesso.')
      parsed.registration.credentialId = found.credentialId
      parsed.registration.providerRef = found.providerRef
      if (parsed.registration.environmentRef === 'unspecified') parsed.registration.environmentRef = found.environmentRef
    }
    const id = randomUUID()
    this.pending.set(id, { registration: parsed.registration, version: found?.version ?? null, missing: parsed.missing, expires: this.clock() + 10 * 60_000, busy: false })
    this.timer = setTimeout(() => this.discard(), 10 * 60_000)
    this.timer.unref()
    return { id, service, kind: parsed.kind, expiresAt: parsed.registration.expiresAt, missing: parsed.missing, existing: found ? { version: found.version, status: found.status } : null }
  }

  private require(id: unknown): Pending {
    const entry = typeof id === 'string' ? this.pending.get(id) : undefined
    if (!entry || entry.expires <= this.clock()) { if (typeof id === 'string') this.pending.delete(id); throw new Error('Os dados temporários expiraram. Envie o acesso novamente.') }
    if (entry.busy) throw new Error('Aguarde a conferência em andamento.')
    if (entry.missing.length) throw new Error('Complete os dados solicitados antes de testar.')
    if (entry.registration.expiresAt && Date.parse(entry.registration.expiresAt) <= this.clock()) throw new Error('O vencimento informado já passou. Envie uma credencial vigente.')
    return entry
  }

  async test(id: unknown): Promise<CredentialVerification> {
    const entry = this.require(id), epoch = this.epoch
    entry.busy = true; entry.verification = undefined
    try {
      const broker = await this.getBroker()
      if (epoch !== this.epoch) throw new Error('Conferência encerrada.')
      const result = await broker.verifyCredential(entry.registration)
      if (epoch !== this.epoch) throw new Error('Conferência encerrada.')
      entry.verification = result
      return result
    } catch { throw new Error('O teste não pôde ser concluído. Nenhum acesso foi guardado. Tente novamente.') }
    finally { entry.busy = false }
  }

  async save(id: unknown): Promise<CredentialSaved> {
    const entry = this.require(id), epoch = this.epoch
    if (entry.verification?.outcome !== 'authenticated') throw new Error('Teste o acesso com sucesso antes de guardar.')
    entry.busy = true
    try {
      // The broker checks again at the write boundary; renderer status cannot manufacture a success.
      const broker = await this.getBroker()
      if (epoch !== this.epoch || this.pending.get(id as string) !== entry) throw new Error('Conferência encerrada.')
      const result = await broker.registerVerifiedCredential(entry.registration, entry.version)
      if (result.credential.status !== 'active' || result.verification.outcome !== 'authenticated') throw new Error('Armazenamento não confirmou acesso ativo.')
      entry.registration.token = ''
      this.pending.delete(id as string)
      return { version: result.credential.version, status: result.credential.status, disposition: result.disposition, checkedAt: result.verification.checkedAt }
    } catch (error) {
      entry.verification = undefined
      const message = error instanceof Error ? error.message : ''
      if (message.includes('credential-version-conflict')) throw new Error('Este acesso mudou durante a conferência. Envie os dados novamente para consultar a versão atual.')
      throw new Error('Não foi possível confirmar o armazenamento. Confira o acesso novamente antes de repetir.')
    } finally { entry.busy = false }
  }
}
