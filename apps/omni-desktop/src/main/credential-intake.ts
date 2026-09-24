import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, extname } from 'node:path'
import type { CredentialDraft, CredentialInventoryItem, CredentialReceipt, CredentialRegistrationInput, CredentialSaved, CredentialVerification, PrivateCredentialDocumentInspection, PrivateCredentialAttachment } from '../shared/contracts'
import { parseCredential } from './credential-parser'
import { privateExecutionSources } from './private-execution-sources'

interface CredentialBroker {
  findLatestCredential(id: string): Promise<CredentialReceipt | null>
  listCredentialMetadata?(query?: string): Promise<readonly CredentialInventoryItem[]>
  verifyCredential(input: CredentialRegistrationInput): Promise<CredentialVerification>
  registerCredential?(input: CredentialRegistrationInput): Promise<CredentialReceipt>
  registerVerifiedCredential(input: CredentialRegistrationInput, expectedVersion: number | null): Promise<{ credential: CredentialReceipt; verification: CredentialVerification; disposition: 'created' | 'reused' }>
}
type Pending = { registration: CredentialRegistrationInput; version: number | null; missing: string[]; expires: number; verification?: CredentialVerification; busy: boolean }
export type AttachmentCommit = { state: 'saved' | 'pending' | 'needs-input' | 'unverified'; message: string }
const labels: Record<string, string> = { vercel: 'Vercel', github: 'GitHub', postgresql: 'PostgreSQL', postgres: 'PostgreSQL', mysql: 'MySQL', sqlserver: 'SQL Server', 'sql-server': 'SQL Server', mssql: 'SQL Server', 'active-directory': 'Active Directory', 'google-cloud': 'Google Cloud' }
const failure = () => new Error('Não foi possível concluir a conferência do Crachá. Tente novamente; nenhum dado foi gravado por esta conferência.')
const canonicalProvider = (value: string) => value === 'verecel' ? 'vercel' : value
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const stopWords = new Set(['acesso', 'acessos', 'credencial', 'credenciais', 'crachá', 'cracha', 'cofre', 'tem', 'tenho', 'temos', 'existe', 'consultar', 'consulte', 'listar', 'liste', 'mostrar', 'mostre', 'qual', 'quais', 'para', 'com', 'sem', 'do', 'da', 'de', 'no', 'na', 'o', 'a', 'os', 'as', 'meu', 'minha'])
const inventoryTerms = (value: string) => [...new Set((normalized(value).match(/[a-z0-9][a-z0-9._-]{2,79}/g) || []).filter(term => !stopWords.has(term)))].slice(0, 3)
const uniqueItems = (items: readonly CredentialInventoryItem[]) => [...new Map(items.map(item => [item.credentialId, item])).values()].slice(0, 20)

/** Secrets stay in this short-lived main-process object, never in Store/snapshots/model input. */
export class CredentialIntake {
  private pending = new Map<string, Pending>()
  private attachments = new Map<string, string>()
  private attachmentIds = new Map<string, string>()
  private submittedAttachments = new Map<string, { raw: string; id: string; conversationId: string; timer: ReturnType<typeof setTimeout> }>()
  private attachmentTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Private composition for one open Crachá conversation. It never reaches Store, IPC output or logs. */
  private privateInput = ''
  private epoch = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private attachmentOperations = 0
  get hasPrivateContext(): boolean { return this.attachments.size > 0 || this.submittedAttachments.size > 0 || this.attachmentOperations > 0 }
  constructor(private getBroker: () => Promise<CredentialBroker>, private clock: () => number = Date.now) {}

  private clearPending() {
    for (const entry of this.pending.values()) entry.registration.token = ''
    this.pending.clear()
    clearTimeout(this.timer)
  }

  private expire() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.discard(), 10 * 60_000)
    this.timer.unref()
  }

  discard(): void {
    this.epoch++
    this.clearPending()
    this.privateInput = ''
    for (const timer of this.attachmentTimers.values()) clearTimeout(timer)
    this.attachmentTimers.clear()
    this.attachments.clear()
    this.attachmentIds.clear()
    for (const entry of this.submittedAttachments.values()) clearTimeout(entry.timer)
    this.submittedAttachments.clear()
  }

  /** Hiding the app clears drafts, not a private context already accepted for work. */
  discardDrafts(): void {
    if (!this.attachmentOperations) { this.epoch++; this.clearPending(); this.privateInput = '' }
    for (const id of [...this.attachments.keys()]) this.discardAttachment(id)
  }

  /** Stores one opaque, conversation-scoped document only in main-process memory. */
  stageAttachment(conversationId: string, raw: unknown): PrivateCredentialAttachment {
    if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 12_000) throw new Error('Envie um anexo privado de até 12 KB.')
    const previous = this.attachmentTimers.get(conversationId)
    if (previous) clearTimeout(previous)
    const text = raw.trim()
    this.attachments.set(conversationId, text)
    const id = randomUUID(); this.attachmentIds.set(conversationId, id)
    const timer = setTimeout(() => this.discardAttachment(conversationId), 10 * 60_000)
    timer.unref()
    this.attachmentTimers.set(conversationId, timer)
    return { id, size: Buffer.byteLength(text, 'utf8') }
  }

  attachment(conversationId: string, turnId?: string): string {
    if (!turnId) return this.attachments.get(conversationId) || ''
    const entry = this.submittedAttachments.get(turnId)
    return entry?.conversationId === conversationId ? entry.raw : ''
  }
  attachmentInfo(conversationId: string): PrivateCredentialAttachment | null {
    const text = this.attachment(conversationId)
    return text ? { id: this.attachmentIds.get(conversationId)!, size: Buffer.byteLength(text, 'utf8') } : null
  }
  async executorSources(conversationId: string, turnId: string) {
    const raw = this.attachment(conversationId, turnId)
    if (!raw) throw new Error('O contexto privado deste pedido expirou. Anexe novamente pelo Crachá.')
    return privateExecutionSources(raw, async id => (await this.getBroker()).findLatestCredential(id))
  }
  claimAttachment(conversationId: string, turnId: string, expectedId?: string): PrivateCredentialAttachment | null {
    const info = this.attachmentInfo(conversationId)
    if (expectedId && info?.id !== expectedId) throw new Error('O anexo privado mudou ou expirou. Confira o Crachá; a mensagem não foi enviada.')
    if (!info) return null
    const raw = this.attachment(conversationId)
    this.discardAttachment(conversationId)
    const timer = setTimeout(() => this.discardAttachment(conversationId, turnId), 10 * 60_000); timer.unref()
    this.submittedAttachments.set(turnId, { ...info, raw, conversationId, timer })
    return info
  }
  restoreAttachment(conversationId: string, turnId: string): void {
    const entry = this.submittedAttachments.get(turnId)
    if (!entry || entry.conversationId !== conversationId || this.attachments.has(conversationId)) return
    const { raw, id } = entry
    this.discardAttachment(conversationId, turnId)
    this.stageAttachment(conversationId, raw)
    this.attachmentIds.set(conversationId, id)
  }
  reuseAttachment(conversationId: string, turnId: string, previousTurnId: string): PrivateCredentialAttachment | null {
    const previous = this.submittedAttachments.get(previousTurnId)
    if (!previous || previous.conversationId !== conversationId) return null
    const timer = setTimeout(() => this.discardAttachment(conversationId, turnId), 10 * 60_000); timer.unref()
    this.submittedAttachments.set(turnId, { ...previous, timer })
    return { id: previous.id, size: Buffer.byteLength(previous.raw, 'utf8') }
  }

  /**
   * Gives the coordinator enough private context to converse about an
   * attachment without ever giving the model its secret value. The original
   * text remains only in this in-memory Crachá slot for a later local action.
   */
  attachmentContext(conversationId: string, turnId?: string): string {
    const raw = this.attachment(conversationId, turnId)
    if (!raw) return ''
    const size = Buffer.byteLength(raw, 'utf8')
    try {
      const value = JSON.parse(raw) as Record<string, unknown>
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = ['type', 'project_id', 'projectId', 'client_email', 'clientEmail', 'host', 'port', 'database', 'username'].filter(key => key in value)
        const serviceAccount = value.type === 'service_account' || Boolean(value.private_key || value.privateKey)
        return [
          `Há um anexo privado do Crachá nesta conversa (${size} bytes; JSON).`,
          'ssh' in value && 'database' in value ? 'A estrutura descreve o par SSH + PostgreSQL para a ponte de execução remota.' : serviceAccount ? 'A estrutura indica uma conta de serviço.' : 'A estrutura é um JSON privado de acesso.',
          keys.length ? `Tipos de campos presentes (valores privados): ${keys.join(', ')}.` : '',
          'O conteúdo original está vinculado a esta mensagem no Crachá. Receber não significa validar, cadastrar ou usar o acesso. Não repita valores nem encaminhe o anexo ao executor. Se o proprietário pediu uso, delegue a tarefa: o runtime fornece a referência da ponte e o cliente ao executor. Sem recibo não afirme que a credencial já foi usada.'
        ].filter(Boolean).join(' ')
      }
    } catch { /* Textual private attachments receive the redacted summary below. */ }
    // A regex blacklist leaked unlabeled passwords and arbitrary confidential prose.
    // Interpret locally and project only a fixed service label, never raw fragments.
    let service = 'Conteúdo privado textual'
    try { const parsed = parseCredential(raw, new Date(this.clock())); service = labels[parsed.registration.providerRef] || service } catch { /* Still valid private context, not rejected by a credential validator. */ }
    return `Há um anexo privado do Crachá vinculado a esta mensagem (${size} bytes). Tipo identificado localmente: ${service}. O original permanece no canal privado, disponível ao tratamento local pelo Omni. Anexar não testa nem cadastra acesso. Use a finalidade indicada na mensagem pública; não repita o conteúdo, não peça reenvio e não encaminhe o anexo ao executor. Se houve pedido de uso, delegue: a referência executável e o cliente da ponte são acrescentados pelo runtime. Não afirme que utilizou credenciais sem recibo de uso.`
  }
  discardAttachment(conversationId: string, turnId?: string): void {
    if (turnId) {
      const entry = this.submittedAttachments.get(turnId)
      if (entry?.conversationId === conversationId) { clearTimeout(entry.timer); this.submittedAttachments.delete(turnId) }
      return
    }
    const timer = this.attachmentTimers.get(conversationId)
    if (timer) clearTimeout(timer)
    this.attachmentTimers.delete(conversationId)
    this.attachments.delete(conversationId)
    this.attachmentIds.delete(conversationId)
  }

  /**
   * A deliberate owner request can promote this conversation's private
   * attachment into the existing guarded Crachá lifecycle. Staging never calls
   * this method; it is the explicit boundary between "discuss" and "act".
   */
  async commitAttachment(conversationId: string, turnId?: string): Promise<AttachmentCommit> {
    this.attachmentOperations++
    try { return await this.commitPrivateAttachment(conversationId, turnId) }
    finally { this.attachmentOperations-- }
  }
  private async commitPrivateAttachment(conversationId: string, turnId?: string): Promise<AttachmentCommit> {
    const raw = this.attachment(conversationId, turnId)
    if (!raw) throw new Error('O anexo privado desta conversa não está mais disponível.')
    // Attachments are isolated by conversation. Do not combine one card's
    // material with an old protected composition from another flow.
    this.privateInput = ''
    let draft: CredentialDraft
    try { draft = await this.prepare(raw) }
    catch (error) { this.privateInput = ''; throw error }
    if (draft.missing.length) {
      this.privateInput = ''
      return { state: 'needs-input', message: `${draft.service}: antes de guardar, preciso confirmar somente isto: ${draft.missing.join(' ')}` }
    }
    let verification: CredentialVerification
    try { verification = await this.test(draft.id) }
    catch (error) { this.privateInput = ''; throw error }
    try {
      if (verification.outcome === 'authenticated') {
        const saved = await this.save(draft.id)
        this.discardAttachment(conversationId, turnId); this.privateInput = ''
        return { state: 'saved', message: `${draft.service} foi validado e guardado no Crachá (versão ${saved.version}). O anexo privado foi descartado.` }
      }
      if (verification.outcome === 'unsupported') {
        const saved = await this.savePending(draft.id)
        this.discardAttachment(conversationId, turnId); this.privateInput = ''
        return { state: 'pending', message: `${draft.service} foi guardado no Crachá como pendente de validação segura (versão ${saved.version}). O anexo privado foi descartado.` }
      }
      this.privateInput = ''
      return { state: 'unverified', message: `${draft.service} não foi guardado: ${verification.summary} O anexo privado continua disponível para você decidir o próximo passo.` }
    } catch (error) { this.privateInput = ''; throw error }
  }

  /**
   * Opens an owner-nominated JSON only in the trusted process. The file is
   * structurally inspected then discarded: no registration, test or relay.
   */
  async inspectDocumentPath(value: unknown): Promise<PrivateCredentialDocumentInspection> {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || !isAbsolute(value.trim()) || extname(value.trim()).toLowerCase() !== '.json') throw new Error('Informe o caminho absoluto de um arquivo JSON para a conferência privada.')
    let bytes: Buffer | undefined
    try {
      const path = await realpath(value.trim())
      const info = await stat(path)
      if (!info.isFile() || info.size < 2 || info.size > 12_000) throw new Error('O documento privado precisa ser um JSON de até 12 KB.')
      bytes = await readFile(path)
      const parsed = parseCredential(bytes.toString('utf8'), new Date(this.clock()))
      if (parsed.kind !== 'service-account') return { kind: 'unsupported-json', service: 'JSON não reconhecido', providerRef: null, accountRef: null, projectRef: null, hasPrivateKey: false, canStore: false, missing: ['Este JSON não é uma conta de serviço compatível com o Crachá.'] }
      const payload = JSON.parse(parsed.registration.token) as { projectId?: unknown; privateKey?: unknown }
      return {
        kind: 'google-service-account', service: parsed.serviceLabel, providerRef: parsed.registration.providerRef,
        accountRef: parsed.registration.accountRef, projectRef: typeof payload.projectId === 'string' && payload.projectId ? payload.projectId : null,
        hasPrivateKey: typeof payload.privateKey === 'string' && payload.privateKey.length > 0, canStore: parsed.missing.length === 0, missing: parsed.missing,
      }
    } catch (error) {
      if (error instanceof Error && /^(Informe|O documento|Este JSON)/.test(error.message)) throw error
      throw new Error('Não consegui abrir o JSON no Crachá. Nenhum dado foi guardado ou enviado.')
    } finally { bytes?.fill(0) }
  }

  /** Opens a selected JSON only long enough to stage it in the Crachá slot. */
  async stageAttachmentPath(conversationId: string, value: unknown): Promise<PrivateCredentialAttachment> {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || !isAbsolute(value.trim()) || extname(value.trim()).toLowerCase() !== '.json') throw new Error('Selecione um arquivo JSON para o Crachá.')
    let bytes: Buffer | undefined
    try {
      const path = await realpath(value.trim())
      const info = await stat(path)
      if (!info.isFile() || info.size < 2 || info.size > 12_000) throw new Error('O documento privado precisa ser um JSON de até 12 KB.')
      bytes = await readFile(path)
      return this.stageAttachment(conversationId, bytes.toString('utf8'))
    } catch (error) {
      if (error instanceof Error && /^(Selecione|O documento)/.test(error.message)) throw error
      throw new Error('Não consegui abrir o JSON no Crachá. Nenhum dado foi guardado ou enviado.')
    } finally { bytes?.fill(0) }
  }

  /** Stages an owner-nominated JSON in the private Crachá flow; it never saves by itself. */
  async prepareDocumentPath(value: unknown): Promise<CredentialDraft> {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || !isAbsolute(value.trim()) || extname(value.trim()).toLowerCase() !== '.json') throw new Error('Informe o caminho absoluto de um arquivo JSON para o Crachá.')
    let bytes: Buffer | undefined
    try {
      const path = await realpath(value.trim())
      const info = await stat(path)
      if (!info.isFile() || info.size < 2 || info.size > 12_000) throw new Error('O documento privado precisa ser um JSON de até 12 KB.')
      bytes = await readFile(path)
      return await this.prepare(bytes.toString('utf8'))
    } catch (error) {
      if (error instanceof Error && /^(Informe|O documento|Este JSON)/.test(error.message)) throw error
      throw new Error('Não consegui abrir o JSON no Crachá. Nenhum dado foi guardado ou enviado.')
    } finally { bytes?.fill(0) }
  }

  /** Read-only private lookup for questions such as "tem acesso para Conecta?". */
  async lookup(raw: unknown): Promise<CredentialInventoryItem[]> {
    if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 1000) throw new Error('Faça uma consulta curta ao Crachá.')
    if (/\b(?:senha|password|token|secret|chave|cpf)\b/i.test(raw)) throw new Error('Para guardar ou testar um acesso, envie os dados no fluxo de cadastro; a consulta não recebe segredos.')
    const broker = await this.getBroker()
    if (!broker.listCredentialMetadata) throw new Error('A consulta de cadastros ainda não está disponível neste Crachá. Atualize o Omni e tente novamente.')
    const terms = inventoryTerms(raw)
    try {
      const results = await Promise.all((terms.length ? terms : ['']).map(term => broker.listCredentialMetadata!(term)))
      return uniqueItems(results.flat())
    } catch { throw new Error('Não consegui consultar os metadados do Crachá agora. Nenhum segredo foi lido ou alterado.') }
  }

  async prepare(raw: unknown): Promise<CredentialDraft> {
    if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 12000) throw new Error('Envie os dados de um acesso por vez, em até 12 KB.')
    // New fields take precedence, while previously supplied fields remain available
    // only in this short-lived main-process memory. This lets a person send service,
    // login and secret in separate protected messages without exposing or persisting them.
    const combined = this.privateInput ? `${raw}\n${this.privateInput}` : raw
    if (Buffer.byteLength(combined, 'utf8') > 12000) throw new Error('Os dados temporários já atingiram 12 KB. Limpe a conversa e envie o acesso novamente.')
    const epoch = ++this.epoch
    this.clearPending()
    const parsed = parseCredential(combined, new Date(this.clock()))
    raw = ''
    this.privateInput = combined
    // Only known display names are reflected. An arbitrary service label may itself contain a secret.
    const service = labels[parsed.registration.providerRef] || (parsed.serviceLabel !== 'Serviço a informar' ? parsed.serviceLabel : parsed.kind === 'certificate' ? 'Certificado' : parsed.kind === 'login' ? 'Login informado' : 'Serviço informado')
    let found: CredentialReceipt | null
    let matches: CredentialInventoryItem[] = []
    try {
      const broker = await this.getBroker()
      found = epoch === this.epoch ? await broker.findLatestCredential(parsed.registration.credentialId) : null
      if (epoch === this.epoch && broker.listCredentialMetadata) {
        const terms = [...new Set([parsed.registration.providerRef, parsed.registration.accountRef].filter(value => value && value !== 'unspecified' && value !== 'pessoal'))]
        const listed = await Promise.all(terms.map(term => broker.listCredentialMetadata!(term)))
        matches = uniqueItems(listed.flat())
      }
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
    this.expire()
    return { id, service, kind: parsed.kind, expiresAt: parsed.registration.expiresAt, missing: parsed.missing, existing: found ? { version: found.version, status: found.status } : null, matches }
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

  async savePending(id: unknown): Promise<CredentialSaved> {
    const entry = this.require(id), epoch = this.epoch
    if (entry.verification?.outcome !== 'unsupported') throw new Error('Só é possível guardar como pendente quando o Crachá confirma que não há teste seguro para este tipo de acesso.')
    entry.busy = true
    try {
      const broker = await this.getBroker()
      if (!broker.registerCredential) throw new Error('Armazenamento pendente indisponível.')
      if (epoch !== this.epoch || this.pending.get(id as string) !== entry) throw new Error('Conferência encerrada.')
      const receipt = await broker.registerCredential(entry.registration)
      if (receipt.status !== 'unverified') throw new Error('O Crachá não confirmou o estado pendente.')
      entry.registration.token = ''
      this.pending.delete(id as string)
      return { version: receipt.version, status: receipt.status, disposition: 'pending', checkedAt: null }
    } catch {
      throw new Error('Não foi possível guardar este acesso como pendente. Nenhum dado foi confirmado no Crachá.')
    } finally { entry.busy = false }
  }
}
