import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { credentialExecutionOperation, type CredentialExecutionOperation, type CredentialExecutionSource, type CredentialExecutionResult } from '../../../../src/contracts/credential-execution'
import { privateOperations, type PrivateOperation } from '../shared/private-action'

export type ExecutorAccess = { source: CredentialExecutionSource; provider: 'postgresql' }
export type ExecutorScope = { sessionId: string; taskId: string; conversationId: string; workspace: string }
type Grant = { scope: ExecutorScope; accesses: ExecutorAccess[]; operations: PrivateOperation[]; expires: number; busy: boolean; calls: Map<string, { fingerprint: string; result: CredentialExecutionResult }>; timer: ReturnType<typeof setTimeout> }
type Dependencies = {
  execute(source: CredentialExecutionSource, action: CredentialExecutionOperation): Promise<CredentialExecutionResult>;
  live(scope: ExecutorScope): Promise<boolean>;
  receipt(scope: ExecutorScope, operation: string, outcome: string): void;
}
const rejected = () => new Error('Uso privado recusado: confira vínculo, prazo e operação do pedido no Omni.')
const workspaceKey = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)

/** Bearer references are temporary capabilities, not secret values. The owner OS account remains trusted.
 * Nothing is persisted. A restart revokes all grants; no work is replayed on an uncertain result.
 */
export class ExecutorAccessBridge {
  private grants = new Map<string, Grant>()
  private server?: Server
  private starting?: Promise<string>
  private stopped = false
  private endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\omni-cracha-${randomUUID()}` : join(tmpdir(), `omni-cracha-${randomUUID()}.sock`)
  get hasGrants() { return this.grants.size > 0 }
  constructor(private dependencies: Dependencies, private clock = Date.now) {}
  private async listen(): Promise<string> {
    if (this.stopped) throw rejected()
    return this.starting ||= new Promise((resolve, reject) => {
      const server = createServer(socket => {
        let buffer = ''; let accepted = false
        socket.setEncoding('utf8'); socket.setTimeout(30_000, () => socket.destroy())
        socket.on('error', () => {})
        socket.on('data', chunk => {
          if (accepted) return
          buffer += chunk
          if (Buffer.byteLength(buffer) > 4096) { socket.destroy(); return }
          const end = buffer.indexOf('\n'); if (end < 0) return
          accepted = true
          let request: unknown
          try { request = JSON.parse(buffer.slice(0, end)); buffer = '' }
          catch { socket.end(JSON.stringify({ ok: false, error: 'Pedido privado inválido.' }) + '\n'); return }
          void this.use(request).then(result => socket.end(JSON.stringify({ ok: true, ...result }) + '\n')).catch(() => socket.end(JSON.stringify({ ok: false, error: rejected().message }) + '\n'))
        })
      })
      this.server = server
      server.once('error', () => { this.starting = undefined; reject(rejected()) })
      server.listen(this.endpoint, () => { server.unref(); resolve(this.endpoint) })
    })
  }
  async issue(scope: ExecutorScope, accesses: ExecutorAccess[], clientPath: string, ttlMs = 30 * 60_000, operations: readonly PrivateOperation[] = privateOperations): Promise<string> {
    if (!operations.length || operations.some(op => !privateOperations.includes(op))) throw rejected()
    if (this.stopped || !uuid(scope.sessionId) || !uuid(scope.taskId) || !uuid(scope.conversationId) || !accesses.length || accesses.length > 8 || ttlMs < 1000 || ttlMs > 30 * 60_000 || this.grants.size >= 32) throw rejected()
    const endpoint = await this.listen()
    const workspace = await realpath(scope.workspace)
    const id = randomBytes(32).toString('hex')
    const timer = setTimeout(() => this.revoke(id), ttlMs); timer.unref()
    this.grants.set(id, { scope: { ...scope, workspace }, accesses: structuredClone(accesses), operations: [...operations], expires: this.clock() + ttlMs, busy: false, calls: new Map(), timer })
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    const command = `node ${quote(clientPath)} --pipe ${quote(endpoint)} --grant ${id} --session ${scope.sessionId} --task ${scope.taskId}`
    return `CRACHÁ — PONTE EXECUTÁVEL PRIVADA\nReferência temporária deste pedido, por ${Math.round(ttlMs / 60_000)} minutos. Não é senha e não dá acesso ao cofre. Execute a partir da raiz deste projeto; não transfira a referência a outra sessão. Não há teste/cadastro automático.\nAcessos disponíveis: ${accesses.map((access, i) => `access-${i + 1} (PostgreSQL ${'ssh' in access.source ? 'por canal SSH: psql executado DENTRO do servidor, modo ' + access.source.mode : 'direto'})`).join(', ')}.\nCliente real (PowerShell):\n${command} --access access-1 --operation postgres.catalog --page 0\nCatálogo paginado, 100 colunas por página; incremente --page até página vazia. Para medir atualização de uma coluna temporal real:\n${command} --access access-1 --operation postgres.freshness --schema public --table NOME --column COLUNA\nUse nomes reais do catálogo. O cliente gera um id único por chamada; --call UUID permite recuperar o mesmo resultado sem repetir a operação. Não crie loops de repetição em falha. A ponte SSH já existe e é invocada automaticamente nos acessos marcados SSH; não abra outro túnel nem procure senha. O broker confere a chave do servidor com known_hosts ou fingerprint do Crachá e usa sudo não interativo quando configurado; não altera permissões do servidor. A ponte não aceita SQL livre, escrita, shell arbitrário nem destinos fornecidos pelo executor. Se faltar uma operação, reporte a lacuna específica. Resultado completed é recibo da operação medida; referência emitida não prova conexão. Credenciais permanecem no processo confiável.`
  }
  async use(value: unknown): Promise<{ result: CredentialExecutionResult; replayed: boolean }> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || this.stopped) throw rejected()
    const request = value as Record<string, unknown>
    if (Object.keys(request).some(key => !['grant', 'sessionId', 'taskId', 'workspace', 'access', 'callId', 'action'].includes(key)) || typeof request.grant !== 'string' || !/^[a-f0-9]{64}$/.test(request.grant) || !uuid(request.callId)) throw rejected()
    const grant = this.grants.get(request.grant)
    if (!grant || grant.expires <= this.clock()) { this.revoke(request.grant); throw rejected() }
    if (request.sessionId !== grant.scope.sessionId || request.taskId !== grant.scope.taskId || typeof request.workspace !== 'string' || workspaceKey(await realpath(request.workspace)) !== workspaceKey(grant.scope.workspace)) throw rejected()
    if (!(await this.dependencies.live(grant.scope))) { this.revoke(request.grant); throw rejected() }
    // Recheck after the asynchronous liveness probe: expiry/revocation may have occurred meanwhile.
    if (this.grants.get(request.grant) !== grant || grant.expires <= this.clock()) throw rejected()
    const action = credentialExecutionOperation(request.action)
    if (!grant.operations.includes(action.kind)) throw rejected()
    if (typeof request.access !== 'string' || !/^access-[1-8]$/.test(request.access)) throw rejected()
    const access = grant.accesses[Number(request.access.slice(7)) - 1]; if (!access) throw rejected()
    const fingerprint = createHash('sha256').update(JSON.stringify([request.access, action])).digest('hex')
    const previous = grant.calls.get(request.callId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw rejected()
      return { result: structuredClone(previous.result), replayed: true }
    }
    if (grant.busy || grant.calls.size >= 64) throw rejected()
    grant.busy = true
    // Consume before I/O, including failures/timeouts. A retry never replays an uncertain effect.
    const record = { fingerprint, result: { outcome: 'unavailable', operation: action.kind, data: null } as CredentialExecutionResult }
    grant.calls.set(request.callId, record)
    try {
      const result = await this.dependencies.execute(access.source, action)
      if (result.operation !== action.kind || !['completed', 'unsupported', 'unavailable', 'timeout', 'denied', 'host-key-required'].includes(result.outcome) || Buffer.byteLength(JSON.stringify(result)) > 50_000) throw rejected()
      record.result = structuredClone(result)
    } catch { /* generic receipt only; adapter errors must never reflect secrets */ }
    finally { grant.busy = false }
    this.dependencies.receipt(grant.scope, action.kind, record.result.outcome)
    return { result: structuredClone(record.result), replayed: false }
  }
  revoke(id: string): void {
    const grant = this.grants.get(id); if (!grant) return
    clearTimeout(grant.timer)
    for (const access of grant.accesses) for (const leaf of 'ssh' in access.source ? [access.source.ssh, access.source.database] : [access.source]) if ('registration' in leaf) leaf.registration.token = ''
    grant.accesses.length = 0; grant.calls.clear(); this.grants.delete(id)
  }
  revokeTask(taskId: string): void { for (const [id, grant] of this.grants) if (grant.scope.taskId === taskId) this.revoke(id) }
  close(): void { this.stopped = true; for (const id of this.grants.keys()) this.revoke(id); this.server?.close() }
}
