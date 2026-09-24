import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { query, listSessions, getSessionMessages, type Options, type HookCallback, type PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { Store } from './store'
import { editorSessions, editorHistory, readEditor, relayToEditor, sameWorkspace, type EditorSession } from './vscode-sessions'
import { Coordinator, isStatusInquiry } from './coordinator'
import { externalTaskNoticeId, externalTaskReceipt } from './external-task-receipt'
import { CredentialIntake } from './credential-intake'
import { ExecutorAccessBridge } from './executor-access'
import { authorizesPrivateExecution, PrivateAccessInputError } from '../shared/private-access'
import type { EditorExecution } from './editor-transcript'
import { ResultDeliveryQueue } from './result-delivery'
import { updateEditorReturn } from './editor-return-state'
import { cardReturnBatch, currentCardReturn } from '../shared/card-return'
import { buildAgentMaps } from './agent-maps'
import type { AgentNode } from '../shared/contracts'
import { pendingCoordinationTurns } from '../shared/coordination-state'
import { continuationBrief, ownerAddendumBrief, type Supervision } from '../shared/supervision'
import { executionTraceEvent } from '../shared/execution-trace'
import { toolOperation, toolResultState } from '../shared/return-evidence'
import { attachmentNotice, attachmentPrompt, attachmentPath, modelPrompt } from './attachment-content'
import { openClaudePanel, openVsCodeWorkspace } from './vscode-actions'
import { bodyContext, loadBodyContract } from './body-contract'
import { home, root, moduleAt, broker, executionBroker, claudeExecutable, voiceAvailable, startRuntime } from './runtime'
import type { Attachment, AttachmentInput, CredentialReceipt, CredentialRegistrationInput, LocalUpdateStatus, Snapshot, RuntimeState, Permission, Conversation, Activity, EditorRequest } from '../shared/contracts'
const now = () => new Date().toISOString()
/** Only the tail of a request chain represents work still waiting on VS Code. */
const activeEditorRequests = (requests: EditorRequest[] = []) => {
  const superseded = new Set(requests.flatMap(request => request.followupOf ? [request.followupOf] : []))
  return requests.filter(request => !superseded.has(request.id) && !isStatusInquiry(request.text))
}
const outstandingEditorRequest = (requests: EditorRequest[] = []) =>
  activeEditorRequests(requests).some(request => !['completed', 'blocked'].includes(request.status) && !request.acknowledgedAt)
const growthWorkspace = 'C:\\Users\\wp.santos\\Documents\\GR-Workspace\\Growth'
const workspaceCandidates = (text: string) => {
  const values = new Set<string>()
  for (const match of text.matchAll(/(?:[a-z]:\\|\/)[^\r\n]+/ig)) {
    const raw = match[0].trim().replace(/["'`].*$/u, '').trim().replace(/[.,;:!?]+$/u, '')
    const annotation = raw.search(/\s(?:[-–—]\s|\()/u)
    const initial = annotation > 0 ? raw.slice(0, annotation).trim() : raw
    // Prefer the entire literal path. Never walk up by removing words until an
    // unrelated existing folder happens to match.
    for (const value of [raw, initial]) if (value.length > 3) values.add(value)
  }
  return [...values]
}
const existingWorkspace = async (text: string) => {
  for (const candidate of workspaceCandidates(text)) {
    try { if ((await stat(candidate)).isDirectory()) return candidate } catch { /* Try the shorter, already-sanitized candidate. */ }
  }
  return undefined
}
const directoryExists = async (path: string | undefined) => {
  if (!path) return false
  try { return (await stat(path)).isDirectory() } catch { return false }
}
/**
 * General Omni work (research, comparison or diagnostics) has no project
 * folder. It runs in the Omni runtime when the old central-card path is stale.
 * An explicitly invalid path from the owner still never redirects elsewhere.
 */
const workspaceForTask = async (text: string, fallback: string, omniWorkspace = root) => {
  const explicit = await existingWorkspace(text)
  if (explicit) return explicit
  // Never silently turn an invalid explicit path into another project.
  if (workspaceCandidates(text).length) return undefined
  if (/\bgrowth\b/i.test(text)) return await directoryExists(growthWorkspace) ? growthWorkspace : undefined
  if (await directoryExists(fallback)) return fallback
  return await directoryExists(omniWorkspace) ? omniWorkspace : undefined
}
const isOpenClaudeVerb = (text: string) => /\b(?:abra|abre|abrir)\b/i.test(text) && /\bclaude\b/i.test(text) && /\b(?:sess[aã]o|painel|chat|claude)\b/i.test(text)
const isOpenVsCodeWorkspaceVerb = (text: string) => /\b(?:abra|abre|abrir)\b/i.test(text) && !/\bclaude\b/i.test(text) && /\b(?:projeto|workspace|pasta)\b/i.test(text)
const isOpenVsCodeLead = (text: string) => /\b(?:abra|abre|abrir)\b/i.test(text) && !/\bclaude\b/i.test(text) && /\b(?:vs\s*code|vscode)\b/i.test(text)
type Dependencies = { loadModule: typeof moduleAt; getBroker: typeof broker; executionBroker?: typeof executionBroker; executable: typeof claudeExecutable; sessions?: typeof editorSessions; readEditor?: typeof readEditor; relay?: typeof relayToEditor; openClaude?: typeof openClaudePanel; openWorkspace?: typeof openVsCodeWorkspace }
export class Controller {
  state: RuntimeState = { broker: 'starting', voice: false, memory: { confirmed: 0, candidates: 0 }, missions: [], synchronization: 'Iniciando', activities: [], update: { state: 'current', currentVersion: 'carregando', autoApply: false, checkedAt: new Date(0).toISOString(), detail: 'Conferindo a build local.' } }
  readonly active = new Map<string, AbortController>()
  private approvals = new Map<string, { item: Permission; resolve: (r: PermissionResult) => void; input: Record<string, unknown> }>()
  private refreshing = false
  private observingExternalTasks = false
  private synchronizationPending = false
  private lastDesktopAudit = 0
  private vscodeWorkspaces: { id: string; workspace: string; sessions: number }[] = []
  private vscodeMonitor?: NodeJS.Timeout
  private liveEditors: EditorSession[] = []
  private editorExecutions = new Map<string, EditorExecution>()
  private editorSubagents = new Map<string, AgentNode[]>()
  private editorOpening: Promise<void> = Promise.resolve()
  private relayMailboxes = new Map<string, Pick<EditorSession, 'sessionId' | 'cwd'>>()
  private editorRefreshing = false
  private shuttingDown = false
  private taskContinuations = new Set<string>()
  private bodyContract = loadBodyContract()
  readonly credentialIntake: CredentialIntake
  readonly executorAccess: ExecutorAccessBridge
  readonly coordinator: Coordinator
  readonly deliveries: ResultDeliveryQueue
  constructor(readonly store: Store, private readonly changed: (s: Snapshot) => void, private readonly agentQuery: typeof query = query,
    private readonly dependencies: Dependencies = { loadModule: moduleAt, getBroker: broker, executionBroker, executable: claudeExecutable }) {
    this.credentialIntake = new CredentialIntake(this.dependencies.getBroker)
    this.executorAccess = new ExecutorAccessBridge({
      execute: async (source, action) => (await (this.dependencies.executionBroker || this.dependencies.getBroker)()).executeCredential(source, action),
      live: async scope => {
        if (this.shuttingDown) return false
        const child = store.conversations.find(c => c.kind === 'task' && c.originTurnId === scope.taskId && c.sessionId === scope.sessionId)
        if (child) return child.phase === 'running' && !child.supervision?.cancelled && child.parentConversationId === scope.conversationId
        const target = store.conversations.find(c => c.sessionId === scope.sessionId && c.editorRequests?.some(r => r.id === scope.taskId))
        const request = target?.editorRequests?.find(r => r.id === scope.taskId)
        return !!request && !request.supervision?.cancelled && ['sending','sent','received'].includes(request.status) &&
          (request.originConversationId || target!.id) === scope.conversationId && (await (this.dependencies.sessions || editorSessions)()).some(s => s.sessionId === scope.sessionId && sameWorkspace(s.cwd, scope.workspace))
      },
      receipt: (scope, operation, outcome) => {
        const c = store.conversations.find(item => item.id === scope.conversationId)
        if (!c) return
        const turn = c.coordinationTurns?.find(item => item.id === scope.taskId)
        const message = c.messages.find(item => item.id === scope.taskId)
        const status = outcome === 'completed' ? 'access-used' : 'access-failed'
        if (turn?.privateAttachment) turn.privateAttachment.status = status
        if (message?.privateAttachment) message.privateAttachment.status = status
        c.events.push({ at: now(), turnId: scope.taskId, kind: 'private-access', text: `Crachá · ${operation}: ${outcome === 'completed' ? 'operação concluída pelo broker' : 'operação não concluída (' + outcome + ')'}. Sem senha no executor.` })
        c.events = c.events.slice(-200); void store.save().then(() => this.emit()).catch(() => {})
      }
    })
    this.coordinator = new Coordinator(store, () => this.emit(), {
      sessions: () => (this.dependencies.sessions || editorSessions)(),
      relay: (session, text, id, abort) => (this.dependencies.relay || relayToEditor)(session, text, id, abort, query, false),
      open: session => this.openVsCodeConversation(session.cwd, `${basename(session.cwd)} · ${session.name}`, session.sessionId),
      local: (parent, text, turnId) => this.delegate(parent, text, 'text', turnId),
      appendLocal: (parent, taskId, text, turnId) => this.appendToTask(parent, taskId, text, turnId),
      context: (c, text, options) => this.coordinatorContext(c, text, options), executable: () => this.dependencies.executable(),
      learnResult: (...args) => this.learnResult(...args),
      badgeLookup: text => this.credentialIntake.lookup(text),
      externalTask: async (sessionId, command, requestKey) => (await this.dependencies.loadModule('runtime/overcore-task-flow.mjs')).executarFluxoOvercore(home, sessionId, command, requestKey),
      badgeInspectDocument: path => this.credentialIntake.inspectDocumentPath(path),
      badgeClaimAttachment: (...args) => this.credentialIntake.claimAttachment(...args),
      badgeRestoreAttachment: (...args) => this.credentialIntake.restoreAttachment(...args),
      badgeReuseAttachment: (...args) => this.credentialIntake.reuseAttachment(...args),
      badgeAttachment: async (conversationId, turnId) => turnId ? this.credentialIntake.attachmentContext(conversationId, turnId) : '',
      badgeCommitAttachment: async (conversationId, turnId) => this.credentialIntake.commitAttachment(conversationId, turnId),
      badgeExecutorBrief: (conversationId, turnId, session) => this.executorBrief(conversationId, turnId, session),
      badgeRevokeTask: taskId => this.executorAccess.revokeTask(taskId)
    }, agentQuery, this.active)
    this.deliveries = new ResultDeliveryQueue(store, (...args) => this.coordinator.summarize(...args), () => this.emit(), this.active)
  }
  private async executorBrief(conversationId: string, turnId: string, session: Pick<EditorSession, 'sessionId' | 'cwd'>): Promise<string> {
    const c = this.store.get(conversationId)
    const turn = c.coordinationTurns?.find(item => item.id === turnId)
    if (!turn?.privateAttachment || !authorizesPrivateExecution(turn.text)) return ''
    const { accesses, unsupported } = await this.credentialIntake.executorSources(conversationId, turnId)
    if (!accesses.length) return 'CRACHÁ: contexto recebido, mas nenhum acesso tem adaptador executável compatível. A ponte atual oferece PostgreSQL: catálogo e atualização dos dados. Não houve conexão, cadastro ou teste. Informe qual operação falta; não procure nem peça segredos no chat.'
    const client = await (this.dependencies.executionBroker || this.dependencies.getBroker)()
    if (typeof client.executionCapabilities !== 'function' || !(await client.executionCapabilities()).includes('postgres.catalog')) throw new Error('O broker em execução ainda não oferece a ponte privada.')
    const brief = await this.executorAccess.issue({ sessionId: session.sessionId, taskId: turnId, conversationId, workspace: session.cwd }, accesses, join(root, 'apps/omni-desktop/scripts/use-cracha.mjs'))
    turn.privateAttachment.status = 'access-ready'
    const message = c.messages.find(item => item.id === turnId)
    if (message?.privateAttachment) message.privateAttachment.status = 'access-ready'
    c.events.push({ at: now(), turnId, kind: 'private-access', text: `Crachá: referência temporária preparada para ${accesses.length} acesso(s) PostgreSQL. Ainda não houve conexão.${unsupported ? ` ${unsupported} acesso(s) sem adaptador; não foram usados.` : ''}` })
    await this.store.save(); this.emit()
    return brief + (unsupported ? `\nHá ${unsupported} outro(s) acesso(s) no anexo sem adaptador: eles não foram transferidos nem usados.` : '')
  }
  private async coordinatorContext(c: Conversation, text: string, options: { captureOwnerPrompt?: boolean; turnId?: string } = {}) {
    c.coordinationSessionId ||= randomUUID()
    const { ClaudeActivationStore } = await this.dependencies.loadModule('dist/adapters/claude/activation-store.js')
    const input = { hook_event_name: 'UserPromptSubmit', session_id: c.coordinationSessionId, cwd: c.workspace, prompt: text }
    if (!(await new ClaudeActivationStore(home, {}).activate(input, { persistScope: true })).gravados) throw new Error('Contexto do Omni não ativado.')
    const result = await (await this.dependencies.loadModule('runtime/hook-contexto.mjs')).tratarHook(input, { ...process.env, OMNI_HOME: home }, { contextOnly: options.captureOwnerPrompt !== true, executorAvailable: false })
    const context = result.hookSpecificOutput?.additionalContext
    if (typeof context !== 'string' || !context.trim()) throw new Error('Contexto canônico indisponível.')
    const memory = result.hookSpecificOutput?.omniMetadata?.memory
    const persistence = result.hookSpecificOutput?.omniMetadata?.persistence
    if (persistence) {
      this.synchronizationPending = persistence.synchronized !== true
      c.events.push({ at: now(), turnId: options.turnId, kind: 'memory-write', text: `${persistence.recorded || 0} memória(s) extraída(s) da mensagem do proprietário; ${persistence.synchronized ? 'gravação durável confirmada' : 'sincronização com o banco pendente'}.` })
    }
    if (memory && typeof memory === 'object') {
      const applied = typeof memory.applied === 'number' ? memory.applied : 0
      const considered = typeof memory.considered === 'number' ? memory.considered : 0
      c.events.push({ at: now(), turnId: options.turnId, kind: 'memory-recall', text: `Memória consultada: ${applied} aplicada(s) entre ${considered} registro(s) considerados. IDs: ${(memory.appliedIds || []).join(', ') || 'nenhum'}.` })
      c.events = c.events.slice(-200)
    }
    this.rebuildActivities()
    return `${context}\n\n${bodyContext(await this.bodyContract, c, this.state)}`
  }
  /** Persist only facts verified by the Desktop itself, never the owner's raw chat. */
  private async syncMemory() {
    const result = await (await this.dependencies.loadModule('runtime/sincronizacao-memoria-duravel.mjs')).sincronizarMemoriaDuravel(home)
    if (!['synced', 'empty'].includes(result?.result)) throw new Error('Há memórias ainda não confirmadas no banco.')
  }
  private async learnResult(c: Conversation, requestId: string, report: string, supervision: Supervision, at: string) {
    if (supervision.learningReceipt?.synchronized) return
    const result = await (await this.dependencies.loadModule('runtime/aprendizado-resultados.mjs')).aprenderResultado(home, {
      requestId, workspace: c.workspace, report, review: supervision.review,
      evidence: { calls: [...(supervision.priorExecutionEvidence || []).flatMap(trace => trace.calls), ...(supervision.executionEvidence?.calls || [])] }, at
    })
    const memoryIds: string[] = result.memoryIds || []
    supervision.learningRetryAt = undefined
    supervision.learningReceipt = { memoryIds, synchronized: false, at: now() }
    // Local persistence precedes synchronization: a DB outage cannot lose learning.
    await this.store.save()
    try { await this.syncMemory(); supervision.learningReceipt.synchronized = true }
    catch { this.synchronizationPending = true }
    if (memoryIds.length && !c.events.some(event => event.kind === 'result-learning' && event.turnId === requestId)) {
      c.events.push({ at: now(), turnId: requestId, kind: 'result-learning', text: `${memoryIds.length} aprendizado(s) do resultado gravado(s) e disponível(is) para consulta. IDs: ${memoryIds.join(', ')}.` })
    }
    await this.store.save()
  }
  /** Resume interrupted writes and backfill reviewed results without model calls or resends. */
  private async resumeLearning() {
    const activated = await (await this.dependencies.loadModule('runtime/automacao-melhorias.mjs')).ativarAprendizadosOperacionais(home)
    let remaining = 8
    for (const c of this.store.conversations) {
      for (const request of [...(c.editorRequests || [])].reverse()) {
        if (!remaining || !['completed', 'blocked'].includes(request.status) || !request.report || !request.supervision?.review || request.supervision.learningReceipt?.synchronized || Date.parse(request.supervision.learningRetryAt || '') > Date.now()) continue
        remaining--
        try { await this.learnResult(c, request.id, request.report, request.supervision, request.lastObservedAt || request.at) }
        catch { request.supervision.learningRetryAt = new Date(Date.now() + 300_000).toISOString(); this.synchronizationPending = true }
      }
      if (remaining && c.kind === 'task' && c.supervision?.state === 'settled' && c.supervision.review && !c.supervision.learningReceipt?.synchronized && !(Date.parse(c.supervision.learningRetryAt || '') > Date.now()) && c.resultText) {
        remaining--
        try { await this.learnResult(c, c.id, c.resultText, c.supervision, c.updatedAt) }
        catch { c.supervision.learningRetryAt = new Date(Date.now() + 300_000).toISOString(); this.synchronizationPending = true }
      }
    }
    if (activated.memoryIds?.length) await this.syncMemory()
    await this.store.save()
  }
  private async rememberVerifiedWorkspace(workspace: string) {
    const memory = await this.dependencies.loadModule('runtime/memoria.mjs') as {
      registrarFatoOperacional?: (memoryHome: string, text: string, options: Record<string, unknown>) => Promise<unknown>
    }
    if (typeof memory.registrarFatoOperacional !== 'function') return
    await memory.registrarFatoOperacional(
      home,
      `Projeto ${basename(workspace)}: ${workspace}`,
      { source: 'runtime-verified-workspace', scope: { type: 'user' }, importance: 0.9 }
    )
    // Sync is best effort: the verified local fact remains usable during a
    // transient broker failure and refresh retries durable synchronization.
    try {
      await this.syncMemory()
      this.synchronizationPending = false
    } catch { this.synchronizationPending = true }
  }
  private async rememberedWorkspacePaths() {
    try {
      const memory = await (await this.dependencies.loadModule('runtime/memoria.mjs')).lerMemoria(home)
      return memory.confirmed
        .filter((item: { source?: unknown; text?: unknown }) => item.source === 'runtime-verified-workspace' && typeof item.text === 'string')
        .map((item: { text: string }) => /^Projeto\s+.+?:\s+((?:[a-z]:\\|\\\\|\/).+)$/iu.exec(item.text)?.[1]?.trim())
        .filter((path: string | undefined): path is string => Boolean(path))
    } catch { return [] as string[] }
  }
  /** Refresh the exact linked transcript before Omni interprets a card message. */
  private async refreshLinkedEditorHistory(c: Conversation) {
    if (c.kind !== 'external' || !c.sessionId) return
    const reading = await (this.dependencies.readEditor || readEditor)({ sessionId: c.sessionId, cwd: c.workspace }).catch(() => null)
    if (!reading) return
    c.editorHistory = reading.messages
    this.editorSubagents.set(c.sessionId, reading.subagents || [])
    this.editorExecutions.set(c.sessionId, reading.execution || { state: 'unknown' })
  }
  private async refreshExternalTasks() {
    if (this.observingExternalTasks || this.shuttingDown) return
    this.observingExternalTasks = true
    try {
      const adapter = await this.dependencies.loadModule('runtime/overcore-task-flow.mjs')
      if (typeof adapter.observarFluxosOvercore !== 'function') return
      for (const c of this.store.conversations.filter(c => c.kind === 'central' && c.coordinationSessionId)) {
        const flows: Record<string, unknown>[] = await adapter.observarFluxosOvercore(home, c.coordinationSessionId)
        for (const flow of flows) {
          if (!['succeeded', 'failed', 'blocked', 'cancelled'].includes(String(flow.status))) continue
          const id = externalTaskNoticeId(flow)
          if (!id || c.externalResultNotices?.includes(id)) continue
          c.messages.push({ id, role: 'assistant', channel: 'text', origin: 'omni', at: now(), text: externalTaskReceipt(flow) })
          c.externalResultNotices = [...(c.externalResultNotices || []), id]
          c.updatedAt = now()
        }
      }
      await this.store.save()
    } catch {
      // Preserve bindings during downtime; the next bounded observation retries GET only.
      this.state.error = 'Acompanhamento do Overcore indisponível; vínculos preservados para nova consulta.'
    } finally { this.observingExternalTasks = false }
  }
  async registerCredential(input: unknown): Promise<CredentialReceipt> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dados do CrachÃ¡ invÃ¡lidos.')
    const value = input as CredentialRegistrationInput
    const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u
    if (!identifier.test(value.credentialId) || value.credentialId.length > 80 || !identifier.test(value.providerRef) || !identifier.test(value.accountRef) || !identifier.test(value.environmentRef) ||
        typeof value.token !== 'string' || !value.token.trim() || value.token.length > 2400 ||
        !['none', 'refresh', 'rotate', 'reauthenticate'].includes(value.renewalMode) ||
        (value.expiresAt !== null && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))))) {
      throw new Error('Confira identificador, escopo, token e vencimento do CrachÃ¡.')
    }
    const receipt = await (await this.dependencies.getBroker() as any).registerCredential({ ...value, token: value.token.trim(), expiresAt: value.expiresAt ? new Date(value.expiresAt).toISOString() : null })
    this.state.synchronization = `CrachÃ¡ atualizado: ${receipt.providerRef} · ${receipt.accountRef}`
    this.emit()
    return receipt as CredentialReceipt
  }
  async findCredential(credentialId: string): Promise<CredentialReceipt | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/u.test(credentialId)) throw new Error('Identificador do CrachÃ¡ invÃ¡lido.')
    return await (await this.dependencies.getBroker() as any).findLatestCredential(credentialId) as CredentialReceipt | null
  }
  snapshot(): Snapshot { return { conversations: this.store.conversations, state: this.state, permissions: [...this.approvals.values()].map(p => p.item), results: this.deliveries.tickets(), agentMaps: buildAgentMaps(this.store.conversations, this.editorSubagents, this.editorExecutions) } }
  setUpdateStatus(update: LocalUpdateStatus) { this.state.update = update; this.emit() }
  emit() {
    this.rebuildActivities(); this.changed(this.snapshot())
    if (!this.shuttingDown) queueMicrotask(() => this.deliveries.preparePending())
  }
  async releaseResult(id: string) {
    const conversation = this.store.conversations.find(c => c.editorReturn?.id === id || c.editorRequests?.some(r => r.id === id))
    let batch: ReturnType<typeof cardReturnBatch> | undefined
    if (conversation?.sessionId) {
      // Recheck the exact session even if a background refresh is already busy.
      // A stale click must never fall back to an older Desktop request.
      const reading = await (this.dependencies.readEditor || readEditor)({ sessionId: conversation.sessionId, cwd: conversation.workspace })
      if (updateEditorReturn(conversation, reading.latestReturn)) { await this.store.save(); this.emit() }
      if (reading.execution?.state === 'running' || reading.subagents?.some(child => child.state === 'running')) throw new Error('A sessão iniciou outra execução. Nenhum retorno antigo foi publicado.')
      const ticket = currentCardReturn(this.deliveries.tickets(), conversation.id)
      const alreadyRead = conversation.editorReturn?.id === id ? conversation.editorReturn.acknowledgedAt : conversation.editorRequests?.find(r => r.id === id)?.acknowledgedAt
      if (!alreadyRead && (!ticket || ticket.id !== id || (reading.execution?.turnStartedAt && reading.execution.turnSource !== 'desktop' && reading.execution.turnSource !== 'relay' && (ticket.at || '') < reading.execution.turnStartedAt))) throw new Error('Esse retorno não corresponde à rodada atual. Aguarde o resumo novo no card.')
      batch = ticket ? cardReturnBatch(this.deliveries.tickets(), conversation.id, ticket.source, ticket.id) : undefined
    }
    batch ||= conversation ? cardReturnBatch(this.deliveries.tickets(), conversation.id, 'vscode', id) : undefined
    if (!batch?.length) return this.deliveries.release(id)
    if (batch.some(ticket => ticket.state !== 'ready')) throw new Error('Os retornos desta sessão ainda estão sendo preparados. Aguarde o card indicar que todos estão prontos.')
    let delivered = conversation?.id || ''
    for (const ticket of batch) delivered = await this.deliveries.release(ticket.id)
    return delivered
  }
  async attachmentPreview(conversationId: string, attachmentId: string) {
    const c = this.store.get(conversationId)
    const attachment = c.messages.flatMap(message => message.attachments || []).find(a => a.id === attachmentId && a.kind === 'image')
    if (!attachment) throw new Error('Imagem não pertence a esta conversa.')
    const bytes = await readFile(attachmentPath(this.store.directory, c.id, attachment))
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Imagem excede o limite.')
    return `data:${attachment.mime};base64,${bytes.toString('base64')}`
  }
  private rebuildActivities() {
    const activities: Activity[] = []
    const returns = this.deliveries.tickets()
    for (const c of this.store.conversations.filter(c => c.kind !== 'task')) {
      const planning = pendingCoordinationTurns(c, this.store.conversations).length > 0
      // An external conversation already has a VS Code card. Its planning must
      // stay on that card instead of looking like a new central Omni execution.
      if (planning && c.kind !== 'external') activities.push({ id: `omni:coord:${c.id}`, source: 'omni', status: 'running', conversationId: c.id, workspace: c.workspace, title: 'Omni · entendendo o pedido', detail: 'Definindo o destino e o escopo antes de iniciar a execução' })
    }
    for (const c of this.store.conversations) {
      if (c.kind === 'external') continue
      if (c.kind === 'task') {
        if (c.acknowledgedAt) continue
        const active = this.active.has(c.id) || c.phase === 'running' || c.phase === 'needs-input' || c.summaryState === 'running'
        activities.push({ id: `omni:${c.id}`, source: 'omni', status: active ? (c.phase === 'needs-input' ? 'waiting' : 'running') : 'ready', conversationId: c.id, parentConversationId: c.parentConversationId, workspace: c.workspace, outcome: active ? undefined : c.phase === 'completed' ? 'completed' : c.phase === 'interrupted' ? 'interrupted' : 'failed',
          title: `Subagente do Omni · ${c.title.replace(/^Subagente · /, '')}`,
          detail: active ? (c.phase === 'needs-input' ? 'Aguardando decisão necessária' : 'Executando em segundo plano') : c.phase === 'completed' ? 'Concluído · clique para ver e retirar da fila' : 'Interrompido ou falhou · clique para ver e retirar da fila' })
        if (returns.some(ticket => ticket.id === c.id && ticket.state === 'preparing')) Object.assign(activities.at(-1)!, { status: 'waiting', outcome: undefined, detail: 'Preparando retorno em segundo plano' })
        continue
      }
      if (this.active.has(c.id) || c.phase === 'running' || c.phase === 'needs-input') {
        const subagentOpen = c.events.slice().reverse().find(e => e.kind === 'hook' && e.text === 'SubagentStart')
        const subagentClosed = c.events.slice().reverse().find(e => e.kind === 'hook' && e.text === 'SubagentStop')
        activities.push({ id: `omni:${c.id}`, source: 'omni', status: c.phase === 'needs-input' ? 'waiting' : 'running', conversationId: c.id,
          title: subagentOpen && (!subagentClosed || subagentOpen.at > subagentClosed.at) ? `Subagente do Omni · ${c.title}` : `Tarefa do Omni · ${c.title}`,
          detail: c.phase === 'needs-input' ? 'Aguardando sua decisão' : 'Executando em paralelo' })
      }
      if (c.phase === 'editor') activities.push({ id: `vscode:handoff:${c.id}`, source: 'vscode', status: 'waiting', conversationId: c.id, workspace: c.workspace, title: `Sessão Claude · ${c.title}`, detail: `Aguardando retorno · ${basename(c.workspace)}` })
    }
    // A workspace alone is not a Claude session. Only live session identities
    // create VS Code cards; retained unread results are projected separately.
    for (const session of this.liveEditors) {
      const linked = this.store.conversations.find(c => c.kind === 'external' && c.sessionId === session.sessionId)
      const planning = pendingCoordinationTurns(linked, this.store.conversations).length > 0
      // Acompanhamentos antigos podem ter sido gravados como pedidos antes de
      // receberem classificação local. Eles permanecem auditáveis, mas nunca
      // representam execução ou retorno pendente no card.
      const requests = activeEditorRequests(linked?.editorRequests)
      // A raw report is already a return for the owner, even if synthesis failed.
      // A reported correction is not a green result: it is an incomplete
      // hand-back that still needs the next VS Code round. Keep it yellow even
      // when an older prepared summary remains on the card.
      // A report is a hand-back, not proof that the original objective ended.
      // It stays yellow until a terminal request exists at the end of its chain.
      const pending = requests.findLast(r => !['completed', 'blocked'].includes(r.status))
      const execution = this.editorExecutions.get(session.sessionId)
      const candidate = currentCardReturn(returns, linked?.id)
      const latest = candidate && (!execution?.turnStartedAt || (candidate.at || '') >= execution.turnStartedAt) ? candidate : undefined
      const returnBatch = latest ? cardReturnBatch(returns, linked?.id, latest.source, latest.id) : []
      const preparing = returnBatch.some(ticket => ticket.state === 'preparing' || ticket.state === 'reviewing')
      const finished = !pending ? requests.findLast(r => ['completed', 'blocked'].includes(r.status)) : undefined
      const running = execution?.state === 'running' || this.editorSubagents.get(session.sessionId)?.some(child => child.state === 'running')
      // Green requires both a prepared summary and a confirmed idle session;
      // otherwise an old response could be announced while telemetry is gone.
      const returned = !planning && !pending && execution?.state === 'idle' && latest?.state === 'ready' && returnBatch.length > 0 && returnBatch.every(ticket => ticket.state === 'ready')
      const standardPending = ({ sending: 'Encaminhando comando para a sessão', sent: 'Comando enviado · aguardando início no VS Code', received: 'Pedido recebido · aguardando início da execução', reported: 'Atividade devolvida · aguardando continuidade', summarizing: 'Omni preparando o retorno', uncertain: 'Entrega não confirmada' } as Record<string, string>)[pending?.status || '']
      const correctionPending = ({ sending: 'Encaminhando correção para a sessão', sent: 'Correção enviada · aguardando início no VS Code', received: 'Correção recebida · aguardando início da execução', reported: 'Correção devolvida · aguardando nova execução', summarizing: 'Omni preparando o retorno da correção', uncertain: 'Correção enviada · entrega ainda não confirmada' } as Record<string, string>)[pending?.status || '']
      // A dispatch and a live run are different facts. Never erase a pending
      // correction merely because the last sampled VS Code state was idle.
      const pendingDetail = (pending?.disconnected ? 'Entrega anterior não confirmada · nova sessão vinculada' : pending?.followupOf ? correctionPending : standardPending) ||
        (execution?.state === 'idle' ? 'Sessão ociosa · sem pedido pendente' : 'Aguardando retorno')
      activities.push({ id: `vscode:session:${session.sessionId}`, source: 'vscode', status: planning || running ? 'running' : returned ? 'ready' : pending || preparing || !execution || execution.state === 'unknown' ? 'waiting' : 'ready', workspace: session.cwd, sessionId: session.sessionId, conversationId: linked?.id, online: true, title: `VS Code · ${basename(session.cwd)} · ${session.name}`, detail: planning ? 'Omni entendendo o pedido neste card' : running ? 'Sessão executando no VS Code' : returned ? `${returnBatch.length > 1 ? `${returnBatch.length} retornos prontos` : 'Resumo pronto'} · clique no card para ler` : preparing ? 'Preparando retornos em segundo plano' : pending ? pendingDetail : !execution || execution.state === 'unknown' ? 'Estado da execução indisponível' : finished?.status === 'completed' ? 'Último trabalho concluído' : finished?.status === 'blocked' ? 'Último trabalho bloqueado' : 'Sessão Claude ociosa', ...(returned ? { attention: 'return' as const } : {}) })
    }
    // A closed VS Code session must not erase a delivery that it never
    // acknowledged.  Keep it visibly yellow, without resending anything.
    const liveSessionIds = new Set(this.liveEditors.map(session => session.sessionId))
    for (const c of this.store.conversations.filter(c => c.kind === 'external' && c.sessionId && !liveSessionIds.has(c.sessionId))) {
      const requests = activeEditorRequests(c.editorRequests)
      const pending = requests.findLast(request => !['completed', 'blocked'].includes(request.status) && !request.acknowledgedAt)
      const latest = currentCardReturn(returns, c.id)
      const returnBatch = latest ? cardReturnBatch(returns, c.id, latest.source, latest.id) : []
      const preparing = returnBatch.some(ticket => ticket.state === 'preparing' || ticket.state === 'reviewing')
      const batchReady = latest?.state === 'ready' && returnBatch.length > 0 && returnBatch.every(ticket => ticket.state === 'ready')
      if (!pending && !preparing && !batchReady) continue
      const detail = batchReady && !pending
        ? `${returnBatch.length > 1 ? `${returnBatch.length} retornos prontos` : 'Resumo pronto'} · sessão desconectada`
        : pending?.status === 'reported'
          ? 'Atividade devolvida · sessão desconectada antes da continuação'
          : pending?.status === 'received'
            ? 'Pedido recebido · sessão desconectada antes do retorno'
            : pending?.status === 'summarizing' || preparing
              ? 'Omni preparando retorno · sessão desconectada'
              : 'Entrega não confirmada · sessão desconectada'
      const ready = !pending && batchReady
      activities.push({ id: `vscode:offline:${c.id}`, source: 'vscode', status: ready ? 'ready' : 'waiting', workspace: c.workspace, sessionId: c.sessionId!, conversationId: c.id, online: false, title: c.title, detail, ...(ready ? { attention: 'return' as const } : {}) })
    }
    activities.push({ id: 'overcore:future', source: 'overcore', status: 'unavailable', title: 'Overcore', detail: 'Aguardando contrato de integração' })
    activities.push({ id: 'oracle:future', source: 'oracle', status: 'unavailable', title: 'Oracle', detail: 'Aguardando retorno futuro' })
    this.state.activities = activities
  }
  /** Marks only finished project reports as seen; commands and raw editor history stay intact. */
  async acknowledgeReturns(id: string) {
    const conversation = this.store.get(id)
    let changed = false
    for (const request of conversation.editorRequests || []) {
      if (['completed', 'blocked', 'reported'].includes(request.status) && !request.acknowledgedAt && !['ready', 'delivering'].includes(request.deliveryState || '')) {
        request.acknowledgedAt = now()
        changed = true
      }
    }
    if (!changed) return
    await this.store.save()
    this.emit()
  }
  private async refreshVsCodeMap() {
    if (this.editorRefreshing) return
    this.editorRefreshing = true
    try {
    this.liveEditors = await (this.dependencies.sessions || editorSessions)()
    let changed = false
    const liveSessionIds = new Set(this.liveEditors.map(session => session.sessionId))
    for (const conversation of this.store.conversations.filter(conversation => conversation.kind === 'external' && conversation.sessionId)) {
      const online = liveSessionIds.has(conversation.sessionId!)
      if (conversation.editorOnline !== online) { conversation.editorOnline = online; changed = true }
    }
    const directory = join(this.store.directory, 'vscode')
    const found: { id: string; workspace: string; sessions: number }[] = []
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !/^window-[\w-]+\.json$/i.test(entry.name)) continue
        try {
          const raw = JSON.parse(await readFile(join(directory, entry.name), 'utf8')) as { at?: unknown; workspaces?: unknown; sessions?: unknown }
          const reportedAt = typeof raw.at === 'string' ? Date.parse(raw.at) : Number.NaN
          if (!Number.isFinite(reportedAt) || Date.now() - reportedAt > 15_000 || !Array.isArray(raw.workspaces)) continue
          for (const workspace of raw.workspaces) if (typeof workspace === 'string' && workspace.length < 1000) {
            found.push({ id: entry.name.slice(0, -5), workspace, sessions: Array.isArray(raw.sessions) ? raw.sessions.length : 0 })
          }
        } catch { /* stale or malformed registry entry is ignored */ }
      }
    } catch { /* Bridge may not have reported an editor yet. */ }
    this.vscodeWorkspaces = found
    // Observe every open Claude session before any click. Inserting the binding
    // synchronously prevents a simultaneous manual open from creating duplicates.
    for (const session of this.liveEditors) {
      if (this.store.conversations.some(c => c.kind === 'external' && c.sessionId === session.sessionId)) continue
      // A restarted VS Code session gets its previous card back only when the
      // workspace has exactly one unresolved offline card.  We deliberately do
      // not retarget or resend the old request: it remains a recorded,
      // unconfirmed delivery while the next owner command uses the new UUID.
      const candidates = this.store.conversations.filter(c => c.kind === 'external' && !!c.sessionId && !liveSessionIds.has(c.sessionId) && sameWorkspace(c.workspace, session.cwd) && outstandingEditorRequest(c.editorRequests))
      if (candidates.length === 1) {
        const card = candidates[0]
        const previousSessionId = card.sessionId!
        card.sessionId = session.sessionId
        card.workspace = session.cwd
        card.title = `VS Code · ${basename(session.cwd)} · ${session.name}`
        card.editorOnline = true
        for (const request of card.editorRequests || []) if (request.targetSessionId === previousSessionId && !['completed', 'blocked'].includes(request.status)) request.disconnected = true
        card.events.push({ at: now(), kind: 'session-rebound', text: 'Nova sessão VS Code vinculada. Entregas anteriores foram preservadas como não confirmadas e não foram reenviadas.' })
        card.events = card.events.slice(-200)
        changed = true
        continue
      }
      this.store.conversations.unshift({ id: randomUUID(), kind: 'external', host: 'vscode', sessionId: session.sessionId,
        workspace: session.cwd, title: `VS Code · ${basename(session.cwd)} · ${session.name}`, messages: [], events: [],
        phase: 'idle', updatedAt: now(), editorProjectionVersion: 2, editorOnline: true })
      changed = true
    }
    const observedMailboxes = new Set<string>()
    // Technical inboxes are observed without requiring their card to be opened.
    // Retain known inboxes in this process even if their editor closes.
    for (const session of this.liveEditors) if (sameWorkspace(session.cwd, root) && /^omni(?:-|$)/i.test(session.name)) this.relayMailboxes.set(session.sessionId, session)
    for (const c of this.store.conversations.filter(c => c.kind === 'external' && c.sessionId)) {
      const before = JSON.stringify([c.editorHistory, c.editorRequests, c.editorOnline, c.editorReturn])
      const reading = await (this.dependencies.readEditor || readEditor)({ sessionId: c.sessionId!, cwd: c.workspace }).catch(() => null)
      if (reading) { c.editorHistory = reading.messages; this.editorSubagents.set(c.sessionId!, reading.subagents || []) }
      else this.editorSubagents.set(c.sessionId!, (this.editorSubagents.get(c.sessionId!) || []).map(node => ({ ...node, state: 'unknown', progress: 'Leitura da sessão indisponível; último registro preservado' })))
      updateEditorReturn(c, reading?.latestReturn)
      this.editorExecutions.set(c.sessionId!, reading?.execution || { state: 'unknown' })
      await this.coordinator.observe(c, reading?.observations || [], this.liveEditors.some(s => s.sessionId === c.sessionId), reading?.activityAt)
      if (sameWorkspace(c.workspace, root)) {
        observedMailboxes.add(c.sessionId!)
        if (reading?.relayInbox?.length) await this.coordinator.observeRelayInbox(reading.relayInbox)
      }
      if (before !== JSON.stringify([c.editorHistory, c.editorRequests, c.editorOnline, c.editorReturn])) changed = true
    }
    for (const mailbox of this.relayMailboxes.values()) {
      if (observedMailboxes.has(mailbox.sessionId)) continue
      const reading = await (this.dependencies.readEditor || readEditor)(mailbox).catch(() => null)
      if (!reading?.relayInbox?.length) continue
      const before = JSON.stringify(this.store.conversations.flatMap(conversation => conversation.editorRequests || []))
      await this.coordinator.observeRelayInbox(reading.relayInbox)
      if (before !== JSON.stringify(this.store.conversations.flatMap(conversation => conversation.editorRequests || []))) changed = true
    }
    // Local Omni tasks can also spawn internal Claude agents. Observe their
    // persisted session metadata without executing or resuming them.
    for (const task of this.store.conversations.filter(c => c.kind === 'task' && c.sessionId)) {
      const reading = await (this.dependencies.readEditor || readEditor)({ sessionId: task.sessionId!, cwd: task.workspace }).catch(() => null)
      this.editorSubagents.set(task.sessionId!, reading?.subagents || [])
    }
    if (changed) await this.store.save()
    } finally { this.editorRefreshing = false }
  }
  private returnRoute(target: EditorSession): EditorSession | undefined {
    const route = this.liveEditors.find(session => session.sessionId !== target.sessionId && sameWorkspace(session.cwd, root) && /^omni(?:-|$)/i.test(session.name))
    if (route) this.relayMailboxes.set(route.sessionId, route)
    return route
  }
  async initialize() {
    await this.store.load()
    if (!this.store.conversations.length) await this.store.create(root)
    let recoveredInterruptedTurn = false
    for (const conversation of this.store.conversations) {
      if (conversation.phase === 'running' || conversation.phase === 'needs-input') {
        conversation.phase = 'interrupted'
        conversation.updatedAt = now()
        conversation.events.push({ at: now(), kind: 'recovery', text: 'Rodada anterior interrompida durante atualização; sessão preservada.' })
        conversation.events = conversation.events.slice(-200)
        recoveredInterruptedTurn = true
      }
    }
    if (recoveredInterruptedTurn) await this.store.save()
    this.emit()
    if (!this.vscodeMonitor) {
      this.vscodeMonitor = setInterval(() => { void Promise.all([this.refreshVsCodeMap(), this.refreshExternalTasks()]).then(() => this.emit()).catch(() => { this.state.error = 'Falha ao observar sessões; pedidos preservados.'; this.emit() }) }, 4_000)
      this.vscodeMonitor.unref()
    }
    try {
      await Promise.race([startRuntime(), new Promise((_, reject) => setTimeout(() => reject(new Error('startup-timeout')), 30000))])
    } catch { this.state.error = 'Runtime durável indisponível; continuidade local preservada.' }
    await this.refresh()
    this.coordinator.resume()
    for (const task of this.store.conversations.filter(c => c.kind === 'task' && c.supervision && c.supervision.state !== 'settled' && !c.supervision.cancelled)) {
      if (task.supervision!.state === 'retry-ready') void this.continueTask(task)
      else if (!this.active.has(task.id)) void this.markTaskReady(task)
    }
  }
  async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      await this.refreshVsCodeMap()
      const memory = await (await this.dependencies.loadModule('runtime/memoria.mjs')).lerMemoria(home)
      this.state.memory = { confirmed: memory.confirmed.length, candidates: memory.candidates.length }
      if (Date.now() - this.lastDesktopAudit > 60_000) {
        this.lastDesktopAudit = Date.now()
        // Local learning must not depend on PostgreSQL health or another audit.
        try { await this.resumeLearning() } catch { this.synchronizationPending = true }
        try {
          await (await this.dependencies.loadModule('runtime/auditoria-desktop.mjs')).auditarDesktop(home)
          await (await this.dependencies.loadModule('runtime/sincronizacao-aprendizado-operacional.mjs')).sincronizarAprendizadoOperacional(home)
        } catch { this.synchronizationPending = true }
      }
      this.state.voice = await voiceAvailable()
      const client = await this.dependencies.getBroker()
      this.state.broker = (await client.health()).status
      this.state.missions = await client.listActiveMissions()
      delete this.state.error
      this.state.synchronization = this.synchronizationPending ? 'Banco conectado · sincronização pendente' : 'Banco conectado · cache de memória compartilhado'
      if (this.synchronizationPending && !this.active.size) {
        try {
          await this.syncMemory()
          await (await this.dependencies.loadModule('runtime/sincronizacao-missoes-duraveis.mjs')).sincronizarMissoesDuraveis(home)
          await (await this.dependencies.loadModule('runtime/sincronizacao-aprendizado-operacional.mjs')).sincronizarAprendizadoOperacional(home)
          this.synchronizationPending = false
          this.state.synchronization = 'Sincronização recuperada · banco conectado'
        } catch { /* Keep the pending status visible for the next retry. */ }
      }
    } catch { await this.refreshVsCodeMap(); this.state.broker = 'degraded'; this.state.synchronization = 'Banco indisponível · cache local preservado' }
    finally { this.refreshing = false; this.emit() }
  }
  async assertIdle(c: Conversation) {
    if (this.active.has(c.id)) throw new Error('Esta conversa ainda está trabalhando.')
    try {
      const lease = JSON.parse(await readFile(join(this.store.directory, `editor-${c.id}.json`), 'utf8'))
      if (Date.now() < (lease.expiresAt || Date.parse(lease.at) + 15000)) throw new Error('A sessão está no terminal do VS Code. Encerre essa sessão para retomar aqui.')
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  }
  async sessions(id: string) {
    const c = this.store.get(id)
    return (await listSessions({ dir: c.workspace, limit: 50 })).map(s => ({ id: s.sessionId, title: s.customTitle || s.summary || s.sessionId }))
  }
  async openVsCodeConversation(workspace: string, title: string, sessionId?: string) {
    const previous = this.editorOpening
    let release!: () => void
    this.editorOpening = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return await this.bindVsCodeConversation(workspace, title, sessionId) }
    finally { release() }
  }
  private async bindVsCodeConversation(workspace: string, title: string, sessionId?: string) {
    if (!(await stat(workspace)).isDirectory()) throw new Error('O projeto mapeado pelo VS Code não está mais disponível.')
    await this.rememberVerifiedWorkspace(workspace)
    const candidates = (await (this.dependencies.sessions || editorSessions)()).filter(session => sameWorkspace(session.cwd, workspace))
    const session = sessionId ? candidates.find(session => session.sessionId === sessionId) : candidates.length === 1 ? candidates[0] : undefined
    if (!session) throw new Error(candidates.length > 1 ? 'Este projeto tem várias sessões. Selecione o card da sessão desejada.' : 'O projeto está aberto, mas não há sessão Claude ativa vinculada no VS Code.')
    const bound = this.store.conversations.find(conversation => conversation.kind === 'external' && (!conversation.host || conversation.host === 'vscode') && conversation.sessionId === session.sessionId)
    if (bound && !sameWorkspace(bound.workspace, session.cwd)) throw new Error('A sessao ja esta vinculada a outro projeto; vinculo preservado.')
    const existing = bound || this.store.conversations.find(conversation => conversation.kind === 'external' && (!conversation.host || conversation.host === 'vscode') && !conversation.sessionId && !conversation.messages.length && !conversation.editorRequests?.length && sameWorkspace(conversation.workspace, session.cwd))
    const id = existing?.id || randomUUID()
    if (!existing) this.store.conversations.unshift({ id, kind: 'external', host: 'vscode', sessionId: session.sessionId, workspace,
      title, messages: [], events: [], phase: 'idle', updatedAt: now(), editorProjectionVersion: 2 })
    const conversation = this.store.get(id)
    conversation.host = 'vscode'
    conversation.sessionId = session.sessionId
    conversation.editorProjectionVersion = 2
    const reading = await (this.dependencies.readEditor || readEditor)(session)
    conversation.editorHistory = reading.messages
    updateEditorReturn(conversation, reading.latestReturn)
    conversation.editorOnline = true
    conversation.title = `VS Code · ${title.replace(/^VS Code · /, '')}`
    conversation.events.push({ at: now(), kind: 'vscode-linked', text: 'Chat externo vinculado ao projeto mapeado no VS Code.' })
    await this.store.save(); this.emit()
    return id
  }
  async resume(id: string, sessionId: string) {
    const c = this.store.get(id)
    await this.assertIdle(c)
    if (!(await this.sessions(id)).some(s => s.id === sessionId)) throw new Error('A sessão não pertence ao projeto selecionado.')
    if (this.store.conversations.some(other => other.id !== id && other.sessionId === sessionId)) throw new Error('Essa sessão já está vinculada a outra conversa.')
    const messages = await getSessionMessages(sessionId, { dir: c.workspace, limit: 200 })
    c.messages = messages.flatMap((m: any) => {
      const body = m.message?.content
      const text = typeof body === 'string' ? body : Array.isArray(body) ? body.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : ''
      return text && (m.type === 'user' || m.type === 'assistant') ? [{ id: randomUUID(), role: m.type as 'user' | 'assistant', text, at: now(), channel: 'text' as const }] : []
    })
    c.sessionId = sessionId; c.phase = 'idle'; c.title = (await this.sessions(id)).find(s => s.id === sessionId)?.title || 'Sessão retomada'
    await this.store.save(); this.emit()
  }
  private async saveAttachments(conversationId: string, inputs: unknown): Promise<Attachment[]> {
    if (inputs === undefined) return []
    if (!Array.isArray(inputs) || inputs.length > 8) throw new Error('Up to eight attachments are allowed per message.')
    const folder = join(this.store.directory, 'attachments', conversationId)
    const attachments: Attachment[] = []
    for (const input of inputs as AttachmentInput[]) {
      if (!input || (input.kind !== 'image' && input.kind !== 'text')) throw new Error('Invalid attachment.')
      const attachmentId = randomUUID()
      if (input.kind === 'text') {
        if (typeof input.text !== 'string' || input.text.length > 256000) throw new Error('Invalid or oversized text attachment.')
        const content = Buffer.from(input.text, 'utf8')
        await mkdir(folder, { recursive: true })
        await writeFile(join(folder, `${attachmentId}.txt`), content, { mode: 0o600 })
        attachments.push({ id: attachmentId, kind: 'text', name: (input.name || 'mensagem-longa.txt').slice(0, 120), mime: 'text/plain', size: content.byteLength, preview: input.text.slice(0, 240) })
        continue
      }
      if (typeof input.data !== 'string') throw new Error('Invalid image attachment.')
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(input.data)
      if (!match) throw new Error('Only PNG, JPEG, WebP, and GIF images are accepted.')
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) throw new Error('Each image must be no larger than 5 MB.')
      const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1]
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, `${attachmentId}.${extension}`), bytes, { mode: 0o600 })
      attachments.push({ id: attachmentId, kind: 'image', name: (input.name || `imagem.${extension}`).slice(0, 120), mime: match[1], size: bytes.byteLength, preview: 'Imagem anexada localmente.' })
    }
    return attachments
  }
  private async quickOpenClaude(c: Conversation, text: string, channel: 'text' | 'voice') {
    if (c.kind !== 'central' || !isOpenClaudeVerb(text)) return false
    const workspace = await this.workspaceMentionedIn(c, text)
    if (!workspace) return false
    c.phase = 'running'; c.updatedAt = now()
    c.messages.push({ id: randomUUID(), role: 'user', text, at: now(), channel, origin: 'owner' })
    c.events.push({ at: now(), kind: 'quick-command', text: `Abrindo Claude no VS Code: ${workspace}` })
    await this.store.save(); this.emit()
    try {
      await (this.dependencies.openClaude || openClaudePanel)(workspace, this.store.directory)
      await this.rememberVerifiedWorkspace(workspace)
      c.phase = 'completed'
      c.messages.push({ id: randomUUID(), role: 'assistant', text: `Claude aberto na janela **${basename(workspace)}**. A sessao visual esta pronta; nao criei subagente nem repassei o comando.`, at: now(), channel: 'text', origin: 'omni' })
    } catch (error) {
      c.phase = 'failed'
      c.messages.push({ id: randomUUID(), role: 'assistant', text: `Nao consegui abrir o Claude na janela **${basename(workspace)}**: ${String((error as Error).message).slice(0, 240)}. Nenhum subagente foi criado.`, at: now(), channel: 'text', origin: 'omni' })
    }
    c.updatedAt = now(); await this.store.save(); this.emit()
    return true
  }
  private async workspaceMentionedIn(c: Conversation, text: string) {
    const current = await existingWorkspace(text)
    if (current) return current
    if (workspaceCandidates(text).length) throw new Error('O caminho informado não existe. Não escolhi outro projeto pelo histórico.')
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const words = normalize(text).replace(/[^a-z0-9]+/g, ' ')
    const sessions = await (this.dependencies.sessions || editorSessions)()
    const remembered = await this.rememberedWorkspacePaths()
    const matchesWords = (path: string) => {
      const name = normalize(basename(path)).replace(/[^a-z0-9]+/g, ' ')
      return name && (` ${words} `).includes(` ${name} `)
    }
    // A fact confirmed by the Desktop wins over a compatibility alias.  This
    // prevents an old hard-coded Growth path from making a known project look
    // ambiguous after it was opened elsewhere.
    const verified: string[] = []
    for (const path of remembered.filter(matchesWords)) {
      if (await existingWorkspace(path) === path && !verified.some(value => sameWorkspace(value, path))) verified.push(path)
    }
    if (verified.length > 1) throw new Error('Há mais de um projeto verificado com esse nome. Informe o caminho exato; nenhuma janela foi aberta.')
    if (verified.length === 1) return verified[0]
    // Static aliases remain only as bootstrap compatibility for an existing Desktop.
    const paths = [...new Set([
      growthWorkspace,
      join(root, '..', 'GR-Workspace', 'Station'),
      ...sessions.map(s => s.cwd),
      ...this.store.conversations.map(item => item.workspace)
    ])]
    const matching = paths.filter(matchesWords)
    const valid: string[] = []
    for (const path of matching) if (await existingWorkspace(path) === path && !valid.some(value => sameWorkspace(value, path))) valid.push(path)
    if (valid.length > 1) throw new Error('Há mais de um projeto compatível. Informe o caminho exato; nenhuma janela foi aberta.')
    if (valid.length === 1) return valid[0]
    // Named targets never inherit an unrelated path from an earlier conversation.
    if (!/\b(?:la|ali|aqui|nesse|neste|nessa|nesta|esse|este)\b/.test(words)) throw new Error('Não identifiquei o projeto pelo nome. Informe o caminho; não usei uma pasta antiga.')
    for (const message of [...c.messages].reverse().filter(message => message.role === 'user')) {
      const candidate = await existingWorkspace(message.text)
      if (candidate) return candidate
    }
    return undefined
  }
  private hasPendingVsCodeTarget(c: Conversation) {
    if (c.kind !== 'central') return false
    const latestOwnerMessage = [...c.messages].reverse().find(message => message.role === 'user')
    return Boolean(latestOwnerMessage && isOpenVsCodeLead(latestOwnerMessage.text))
  }
  private async quickOpenVsCodeWorkspace(c: Conversation, text: string, channel: 'text' | 'voice') {
    if (c.kind !== 'central' || (!isOpenVsCodeWorkspaceVerb(text) && !this.hasPendingVsCodeTarget(c))) return false
    const workspace = await this.workspaceMentionedIn(c, text)
    if (!workspace) return false
    c.phase = 'running'; c.updatedAt = now()
    c.messages.push({ id: randomUUID(), role: 'user', text, at: now(), channel, origin: 'owner' })
    c.events.push({ at: now(), kind: 'quick-command', text: `Abrindo projeto no VS Code: ${workspace}` })
    await this.store.save(); this.emit()
    try {
      await (this.dependencies.openWorkspace || openVsCodeWorkspace)(workspace)
      await this.rememberVerifiedWorkspace(workspace)
      c.phase = 'completed'
      c.messages.push({ id: randomUUID(), role: 'assistant', text: `Projeto **${basename(workspace)}** aberto no VS Code. Foi uma ação direta; não criei subagente nem encaminhei uma tarefa.`, at: now(), channel: 'text', origin: 'omni' })
    } catch (error) {
      c.phase = 'failed'
      c.messages.push({ id: randomUUID(), role: 'assistant', text: `Não consegui abrir o projeto **${basename(workspace)}** no VS Code: ${String((error as Error).message).slice(0, 240)}. Nenhum subagente foi criado.`, at: now(), channel: 'text', origin: 'omni' })
    }
    c.updatedAt = now(); await this.store.save(); this.emit()
    return true
  }
  async send(id: string, text: string, channel: 'text' | 'voice' = 'text', inputs?: unknown, privateAttachmentId?: string) {
    if (typeof text !== 'string' || text.length > 256000) throw new Error('Mensagem grande demais.')
    const c = this.store.get(id)
    const badgeId = privateAttachmentId || this.credentialIntake.attachmentInfo(id)?.id
    const normalizedInputs: AttachmentInput[] = Array.isArray(inputs) ? [...inputs as AttachmentInput[]] : []
    let messageText = text.trim()
    if (messageText.length > 6000) {
      normalizedInputs.push({ kind: 'text', name: 'mensagem-longa.txt', text: messageText })
      messageText = ''
    }
    const attachments = await this.saveAttachments(c.id, normalizedInputs)
    if (!messageText && !attachments.length && !badgeId) throw new Error('Escreva uma mensagem ou adicione um anexo.')
    const processingText = messageText || (badgeId ? 'Considere o anexo privado do Crachá como contexto desta mensagem; não o exponha nem faça validação ou cadastro automático.' : attachmentNotice(attachments))
    if (!badgeId && !attachments.length && await this.quickOpenVsCodeWorkspace(c, messageText, channel)) return
    if (!badgeId && !attachments.length && await this.quickOpenClaude(c, messageText, channel)) return
    if (c.kind === 'external') {
      if (!(await (this.dependencies.sessions || editorSessions)()).some(s => s.sessionId === c.sessionId && sameWorkspace(s.cwd, c.workspace))) throw new Error('A sessão vinculada não está ativa no VS Code. O pedido não foi enviado.')
      await this.refreshLinkedEditorHistory(c)
      await this.coordinator.enqueue(c, processingText, channel, attachments, messageText, badgeId); return
    }
    if (c.kind === 'central') { await this.coordinator.enqueue(c, processingText, channel, attachments, messageText, badgeId); return }
    await this.assertIdle(c)
    if (!(await stat(c.workspace)).isDirectory()) throw new Error('O projeto não está disponível.')
    // Recheck after I/O: concurrent IPC submissions cannot enter the same session.
    if (this.active.has(id)) throw new Error('Esta conversa ainda está trabalhando.')
    const abort = new AbortController()
    this.active.set(id, abort)
    c.phase = 'running'; c.updatedAt = now()
    const ownerMessage = { id: randomUUID(), role: 'user' as const, text: messageText, at: now(), channel, ...(attachments.length ? { attachments } : {}) }
    c.messages.push(ownerMessage)
    if (c.title === 'Nova conversa') c.title = (messageText || attachmentNotice(attachments)).slice(0, 70)
    const response = { id: randomUUID(), role: 'assistant' as const, text: '', at: now(), channel }
    c.messages.push(response)
    try {
      await this.store.save(); this.emit()
      const hookModule = await this.dependencies.loadModule('runtime/hook-contexto.mjs')
      const { ClaudeActivationStore } = await this.dependencies.loadModule('dist/adapters/claude/activation-store.js')
      const activation = new ClaudeActivationStore(home, {})
      const isNewSession = c.sessionId === null
      if (isNewSession) { c.sessionId = randomUUID(); await this.store.save() }
      const turnInput = { hook_event_name: 'UserPromptSubmit', session_id: c.sessionId, cwd: c.workspace, prompt: processingText }
      const activated = await activation.activate(turnInput, { persistScope: true })
      if (!activated.gravados) throw new Error('Não foi possível ativar o contexto persistente desta sessão.')
      // Every entry channel explicitly builds its context before inference, independent of host hook delivery.
      const turnContext = await hookModule.tratarHook(turnInput, { ...process.env, OMNI_HOME: home }, { contextOnly: c.kind === 'task' })
      const additionalContext = turnContext.hookSpecificOutput?.additionalContext
      if (typeof additionalContext !== 'string' || !additionalContext.trim()) throw new Error('O contexto canônico do Omni não foi carregado.')
      c.events.push({ at: now(), turnId: ownerMessage.id, kind: 'context', text: 'Personalidade, memória e continuidade carregadas para este turno.' })
      if (c.supervision) {
        if (c.supervision.executionEvidence) c.supervision.priorExecutionEvidence = [...(c.supervision.priorExecutionEvidence || []), c.supervision.executionEvidence].slice(-3)
        c.supervision.executionEvidence = { source: 'hooks', complete: true, calls: [] }
      }
      const hook: HookCallback = async (input) => {
        if (input.hook_event_name === 'UserPromptSubmit') return { suppressOutput: true }
        const evidence = c.supervision?.executionEvidence
        if (evidence && 'tool_use_id' in input && 'tool_name' in input) {
          if (input.hook_event_name === 'PreToolUse') {
            evidence.calls.push({ id: input.tool_use_id, tool: input.tool_name, operation: toolOperation(input.tool_name, input.tool_input), outcome: 'requested', at: now() })
            if (evidence.calls.length > 250) { evidence.complete = false; evidence.calls.shift() }
          } else {
            const call = evidence.calls.find(item => item.id === input.tool_use_id)
            if (call && input.hook_event_name === 'PostToolUse') Object.assign(call, toolResultState(typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response) || ''))
            if (call && input.hook_event_name === 'PostToolUseFailure') Object.assign(call, toolResultState(String(input.error), true))
          }
        }
        const rawTrace = executionTraceEvent(input)
        const trace = rawTrace ? { ...rawTrace, turnId: ownerMessage.id } : null
        if (trace?.kind === 'tool-running') {
          c.events.push(trace)
          c.events = c.events.slice(-200)
          this.emit()
        } else if (!trace) c.events.push({ at: now(), turnId: ownerMessage.id, kind: 'hook', text: input.hook_event_name })
        if (input.hook_event_name === 'SessionStart') {
          await activation.activate(input, { persistScope: true })
        }
        const result = await hookModule.tratarHook(input, { ...process.env, OMNI_HOME: home })
        if (trace && trace.kind !== 'tool-running') {
          const prior = trace.id ? c.events.findIndex(event => event.id === trace.id && event.kind === 'tool-running') : -1
          if (prior >= 0) c.events[prior] = trace
          else c.events.push(trace)
          c.events = c.events.slice(-200); this.emit()
        }
        return result
      }
      const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd', 'TaskCompleted'] as const
      const hooks = Object.fromEntries(events.map(e => [e, [{ hooks: [hook], timeout: 120 }]])) as Options['hooks']
      const env = { ...process.env }
      for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CLAUDECODE', 'ELECTRON_RUN_AS_NODE']) delete env[key]
      const options: Options = {
        cwd: c.workspace, pathToClaudeCodeExecutable: await this.dependencies.executable(),
        // This is the owner's personal, locally authenticated Omni. The previous
        // default mode surfaced every Claude Code tool request back to the owner,
        // even reads and canonical Omni operations that are already authorized.
        settingSources: ['project', 'local'], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, hooks,
        env, includePartialMessages: true, persistSession: true, effort: 'medium',
        abortController: abort, maxBudgetUsd: 0.75,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `Você é o Omni, agente pessoal do proprietário. A personalidade, memória e continuidade canônicas chegam pelos hooks em cada turno. Execute e verifique o trabalho autorizado. Esta tarefa já foi aberta por um coordenador do Omni: trate o briefing como autorizado e assuma a investigação, pesquisa, exploração e execução que cabem nele. Quando um trabalho puder avançar sem uma nova decisão do proprietário, delegue etapas independentes a subagentes do Claude Code e acompanhe o resultado; não peça ao proprietário para executar seu trabalho. Mantenha a conversa responsável pelo resultado. Quando o proprietário disser “Growth”, o único projeto canônico é ${growthWorkspace}; não abra nem pesquise outro projeto Growth. Canal atual: ${channel}. Repositório do runtime: ${root}. Não revele segredos. Um relato não prova execução.\n\nFale como Omni: atento, direto, caloroso e criterioso — nunca como log ou terminal. Comece pelo que importa para o proprietário. Use Markdown simples, com títulos curtos quando ajudarem, parágrafos de até quatro linhas e listas para fatos ou próximos passos. Use **ênfase** e \`código\` só para tornar a leitura mais clara. Separe resultado, evidência e decisão pendente; não espalhe frases soltas nem repita o briefing. Ícones textuais só quando realmente orientarem a leitura; não use emojis.` },
        ...(isNewSession ? { sessionId: c.sessionId! } : { resume: c.sessionId! }),
        // Intentionally no canUseTool callback: bypass mode must not turn an
        // already granted local authority into repeated UI approval cards.
      }
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: `${(options.systemPrompt as { append: string }).append}\n\n${additionalContext}` }
      let resultSeen = false
      const privateAttachments = await attachmentPrompt(this.store.directory, c.id, attachments)
      const agentPrompt = privateAttachments ? `${processingText}\n\n${privateAttachments}` : processingText
      let executorPrivateBrief = ''
      if (c.kind === 'task' && c.parentConversationId && c.originTurnId) {
        try { executorPrivateBrief = await this.executorBrief(c.parentConversationId, c.originTurnId, { sessionId: c.sessionId!, cwd: c.workspace }) }
        catch (error) { executorPrivateBrief = `CRACHÁ: a ponte existe, mas o acesso privado não foi preparado. ${error instanceof PrivateAccessInputError ? error.message : 'Broker privado indisponível nesta rodada.'} Não houve uso. Não procure credenciais fora da ponte.` }
      }
      for await (const message of this.agentQuery({ prompt: await modelPrompt([agentPrompt, executorPrivateBrief].filter(Boolean).join('\n\n'), this.store.directory, c.id, attachments), options })) {
        if ('parent_tool_use_id' in message && message.parent_tool_use_id) continue
        if ('session_id' in message && typeof message.session_id === 'string' && c.sessionId !== message.session_id) {
          c.sessionId = message.session_id
          await this.store.save()
        }
        if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
          response.text += message.event.delta.text; this.emit()
        }
        if (message.type === 'result') {
          resultSeen = true
          // The provider's final result can be a regenerated summary of the streamed text.
          // Never replace text the owner is already reading; use it only when no delta arrived.
          if (message.subtype === 'success') {
            if (c.kind === 'task') c.resultText = message.result || response.text
            if (!response.text.trim()) response.text = message.result || response.text
          } else response.text += '\nA execução não concluiu: ' + message.subtype
          c.phase = message.is_error ? 'failed' : 'completed'
        }
      }
      if (!resultSeen) throw new Error('A sessão terminou sem resultado confirmado.')
    } catch (e) {
      c.phase = abort.signal.aborted ? 'interrupted' : 'failed'
      response.text += abort.signal.aborted ? '\n(Interrompido; sessão preservada.)' : '\nNão foi possível concluir esta rodada. A sessão foi preservada.'
      c.events.push({ at: now(), turnId: ownerMessage.id, kind: 'error', text: String((e as Error).message || 'Error').replace(/(?:sk-|ek_|Bearer\s+)[\w.-]+/gi, '[credencial ocultada]').slice(0, 500) })
    } finally {
      for (const [key, p] of this.approvals) if (p.item.conversationId === id) this.decide(key, false)
      this.active.delete(id)
      if (c.kind === 'task' && c.originTurnId) this.executorAccess.revokeTask(c.originTurnId)
      if (c.kind === 'task' && c.phase !== 'completed') c.resultText = response.text
      if (c.kind === 'task' && c.parentConversationId) c.summaryState = 'running'
      c.updatedAt = now(); await this.store.save(); this.emit()
      if (c.kind === 'task' && c.parentConversationId && !this.shuttingDown) await this.markTaskReady(c)
      try {
        await this.syncMemory()
        await (await this.dependencies.loadModule('runtime/sincronizacao-missoes-duraveis.mjs')).sincronizarMissoesDuraveis(home)
        await (await this.dependencies.loadModule('runtime/sincronizacao-aprendizado-operacional.mjs')).sincronizarAprendizadoOperacional(home)
        this.synchronizationPending = false
      } catch { this.synchronizationPending = true }
      await this.refresh()
    }
  }
  decide(id: string, allow: boolean) {
    const p = this.approvals.get(id)
    if (!p) return
    this.approvals.delete(id)
    p.resolve(allow ? { behavior: 'allow', updatedInput: p.input } : { behavior: 'deny', message: 'Ação não autorizada nesta solicitação.' })
    this.store.get(p.item.conversationId).phase = 'running'; this.emit()
  }
  async resolveEditorBlock(requestId: string, allow: boolean) {
    await this.coordinator.resolveEditorBlock(requestId, allow)
  }
  prepareShutdown() {
    this.shuttingDown = true
    this.executorAccess.close()
    this.deliveries.stop()
    this.coordinator.stop()
    for (const abort of this.active.values()) abort.abort()
  }
  cancel(id: string) {
    const task = this.store.conversations.find(c => c.id === id || `summary:${c.id}` === id)
    if (task?.supervision) task.supervision.cancelled = true
    this.active.get(id)?.abort()
  }
  private async markTaskReady(task: Conversation) {
    const parent = this.store.conversations.find(conversation => conversation.id === task.parentConversationId)
    if (!parent || !['central', 'external'].includes(parent.kind) || this.shuttingDown || this.active.has(`summary:${task.id}`)) return
    const supervision = task.supervision ||= { objective: task.messages.find(m => m.role === 'user')?.text || task.title, retries: 0, state: 'executing' }
    // A same-scope owner update is durable. Resume this exact session before a
    // final evaluation so it never becomes a duplicate task or a lost message.
    if (supervision.ownerAddenda?.length) {
      await this.continueTaskAddenda(task)
      return
    }
    supervision.state = 'reviewing'; task.summaryState = 'running'
    const summaryAbort = new AbortController(); this.active.set(`summary:${task.id}`, summaryAbort)
    try {
      await this.store.save(); this.emit()
      const report = task.resultText || task.messages.filter(m => m.role === 'assistant').at(-1)?.text || 'Execução interrompida sem relato final; confira o estado existente antes de continuar.'
      const review = supervision.review ||= await this.coordinator.reviewReturn(parent, supervision, report, task.phase, summaryAbort, task)
      if (this.shuttingDown) return
      task.reportSummary = review.message
      task.summaryState = 'ready'
      if (review.action === 'retry' && !supervision.cancelled) {
        supervision.evidenceReports = [...(supervision.evidenceReports || []), report.slice(0, 22000)].slice(-3)
        supervision.correctionHistory = [...(supervision.correctionHistory || []), review.instruction || ''].slice(-4)
        supervision.retries++; supervision.previousReport = report; supervision.state = 'retry-ready'
        task.acknowledgedAt = undefined
        task.phase = 'running'
      } else {
        supervision.state = 'settled'
        if (review.action !== 'complete') task.phase = 'failed'
        try { await this.learnResult(task, task.id, report, supervision, task.updatedAt) }
        catch { this.synchronizationPending = true }
      }
    } catch {
      task.summaryState = 'failed'; supervision.state = this.shuttingDown ? 'reviewing' : 'settled'
      task.reportSummary = 'O executor retornou, mas não consegui avaliar a entrega automaticamente. Preservei o resultado e a sessão; o trabalho ainda precisa de conferência.'
      task.phase = 'failed'
    }
    finally { this.active.delete(`summary:${task.id}`) }
    if (this.shuttingDown) { await this.store.save(); return }
    if (supervision.ownerAddenda?.length) {
      await this.store.save(); this.emit()
      void this.continueTaskAddenda(task)
      return
    }
    if (supervision.state !== 'retry-ready') {
      task.deliveryState = 'ready'
      const noticeId = `task-ready:${task.id}`
      if (!parent.messages.some(m => m.id === noticeId)) parent.messages.push({ id: noticeId, role: 'assistant', text: supervision.review?.action === 'complete' ? `${task.title}: retorno avaliado; preparando a apresentação no card. Você escolhe quando receber o relato completo.` : `${task.title}: ${task.reportSummary?.slice(0, 320) || 'O retorno precisa de atenção.'}`, at: now(), channel: 'text', origin: 'omni' })
    }
    parent.events.push({ at: now(), kind: 'subagent-ready', text: supervision.state === 'retry-ready' ? 'Retorno avaliado; correção preparada para o mesmo subagente.' : 'Retorno avaliado; aguardando liberação da entrega final.' })
    parent.events = parent.events.slice(-200)
    parent.updatedAt = now()
    await this.store.save(); this.emit()
    if (supervision.state === 'retry-ready') void this.continueTask(task)
  }
  private async continueTask(task: Conversation) {
    if (this.shuttingDown || this.taskContinuations.has(task.id) || task.supervision?.state !== 'retry-ready') return
    this.taskContinuations.add(task.id)
    try {
      const supervision = task.supervision!
      if (supervision.cancelled) { supervision.state = 'settled'; task.phase = 'interrupted'; await this.store.save(); return }
      const review = supervision.review!
      const instruction = continuationBrief(supervision, review.instruction!)
      const parent = this.store.get(task.parentConversationId!)
      supervision.state = 'executing'; supervision.review = undefined
      supervision.learningReceipt = undefined
      task.summaryState = undefined; task.resultText = undefined; task.reportSummary = undefined; task.deliveryState = undefined; task.deliveryError = false
      task.acknowledgedAt = undefined; task.phase = 'running'
      // Persist the attempt before starting so a restart reviews uncertain work instead of blindly repeating it.
      await this.store.save()
      const running = this.send(task.id, instruction)
      const noticeId = `task-correction:${task.id}:${supervision.retries}`
      if (!parent.messages.some(m => m.id === noticeId)) parent.messages.push({ id: noticeId, role: 'assistant', text: `${review.message.slice(0, 320)}\n\nDevolvi a correção ao subagente e continuo acompanhando.`, at: now(), channel: 'text', origin: 'omni' })
      await this.store.save(); this.emit()
      // Let the next completed attempt schedule its own review/correction.
      this.taskContinuations.delete(task.id)
      await running
    } catch {
      task.phase = 'failed'; task.summaryState = 'failed'
      task.reportSummary = 'Preparei a correção, mas a retomada do executor falhou. O trabalho e a sessão estão preservados.'
      if (task.supervision) task.supervision.state = 'settled'
      await this.store.save(); this.emit()
      task.deliveryState = 'ready'; await this.store.save(); this.emit()
    } finally { this.taskContinuations.delete(task.id) }
  }
  private async continueTaskAddenda(task: Conversation) {
    if (this.shuttingDown || this.taskContinuations.has(task.id) || !task.supervision?.ownerAddenda?.length) return
    this.taskContinuations.add(task.id)
    try {
      const supervision = task.supervision
      if (supervision.cancelled) { supervision.state = 'settled'; task.phase = 'interrupted'; await this.store.save(); return }
      const addenda = supervision.ownerAddenda!.splice(0, 8)
      const parent = this.store.get(task.parentConversationId!)
      const report = task.resultText || task.messages.filter(message => message.role === 'assistant').at(-1)?.text
      if (report) supervision.evidenceReports = [...(supervision.evidenceReports || []), report.slice(0, 22000)].slice(-3)
      const instruction = ownerAddendumBrief(supervision, addenda)
      supervision.state = 'executing'; supervision.review = undefined
      supervision.learningReceipt = undefined
      task.summaryState = undefined; task.resultText = undefined; task.reportSummary = undefined; task.deliveryState = undefined; task.deliveryError = false
      task.acknowledgedAt = undefined; task.phase = 'running'
      await this.store.save()
      const running = this.send(task.id, instruction)
      const noticeId = `task-addendum:${task.id}:${addenda.map(item => item.id).join(':')}`
      if (!parent.messages.some(message => message.id === noticeId)) parent.messages.push({ id: noticeId, role: 'assistant', text: `Incluí seu complemento em **${task.title}**. Ele continua na mesma sessão; não abri outro subagente.`, at: now(), channel: 'text', origin: 'omni' })
      await this.store.save(); this.emit()
      // Permit the completion of this resumed turn to schedule an addendum that
      // arrived while it was running.
      this.taskContinuations.delete(task.id)
      await running
    } catch {
      task.phase = 'failed'; task.summaryState = 'failed'
      task.reportSummary = 'O complemento foi preservado, mas não consegui retomar a mesma sessão do subagente.'
      if (task.supervision) task.supervision.state = 'settled'
      await this.store.save(); this.emit()
      task.deliveryState = 'ready'; await this.store.save(); this.emit()
    } finally { this.taskContinuations.delete(task.id) }
  }
  async consumeTask(id: string) {
    const task = this.store.get(id)
    if (task.kind !== 'task' || !task.parentConversationId) throw new Error('Esta execução não pertence à fila de subagentes.')
    if (task.supervision) return task.acknowledgedAt ? task.parentConversationId : this.releaseResult(id)
    if (this.active.has(id) || task.phase === 'running' || task.phase === 'needs-input' || task.summaryState === 'running') throw new Error('O subagente ainda está executando ou preparando a síntese.')
    const parent = this.store.get(task.parentConversationId)
    if (!['central', 'external'].includes(parent.kind)) throw new Error('Resultado preservado: a tarefa não possui um chat de origem válido.')
    if (!task.acknowledgedAt) {
      const outcome = task.phase === 'completed' ? 'concluiu' : task.phase === 'interrupted' ? 'foi interrompida' : 'precisa de atenção'
      const reportId = `report:${task.id}`
      const legacy = parent.messages.find(message => message.text.startsWith(`**${task.title}** ${outcome}.\n`))
      const report = parent.messages.find(message => message.id === reportId) || legacy
      if (report) parent.messages = parent.messages.filter(message => message.id !== report.id)
      parent.messages.push(report ? { ...report, id: reportId } : { id: reportId, role: 'assistant', text: task.supervision && task.reportSummary ? task.reportSummary : `**${task.title}** ${outcome}.\n\n${task.reportSummary || task.resultText || task.messages.filter(message => message.role === 'assistant').at(-1)?.text || 'Não houve texto de retorno; o estado foi preservado.'}`, at: now(), channel: 'text', origin: 'omni' })
      task.acknowledgedAt = now()
      task.updatedAt = task.acknowledgedAt
      parent.events.push({ at: now(), kind: 'subagent-report', text: `${task.title}: ${outcome}. Resultado entregue e removido da fila.` })
      parent.events = parent.events.slice(-200)
      parent.updatedAt = now()
      await this.store.save(); this.emit()
    }
    return parent.id
  }
  async delegate(parentId: string, text: string, channel: 'text' | 'voice' = 'text', originTurnId?: string) {
    if (!text.trim() || text.length > 32000) throw new Error('Envie uma mensagem entre 1 e 32.000 caracteres.')
    const parent = this.store.get(parentId)
    // Direct UI delegation remains central-only. The coordinator may create a
    // local validation under an external card only with its durable turn id.
    if (parent.kind !== 'central' && !(parent.kind === 'external' && originTurnId)) throw new Error('Subagentes do Omni só podem ser criados pelo chat central. Use a sessão vinculada para comandos do VS Code.')
    const previous = originTurnId && this.store.conversations.find(c => c.originTurnId === originTurnId)
    if (previous) return previous.id
    // A model-generated briefing may quote a path from its explanation. Only a
    // path in the owner's original turn can choose the worker workspace.
    const ownerText = originTurnId
      ? parent.coordinationTurns?.find(turn => turn.id === originTurnId)?.text || text
      : text
    const workspace = await workspaceForTask(ownerText, parent.workspace)
    if (!workspace || !(await stat(workspace)).isDirectory()) throw new Error('Não encontrei uma pasta válida no caminho informado. O pedido foi preservado e não será enviado para outro projeto.')
    const id = await this.store.create(workspace, 'task', parent.id)
    const child = this.store.get(id)
    child.originTurnId = originTurnId
    child.supervision = { objective: parent.coordinationTurns?.find(t => t.id === originTurnId)?.text || text, executionBrief: text, retries: 0, state: 'executing' }
    child.title = `Subagente · ${child.supervision.objective.trim().replace(/omni-request-binding:\S+\s*/gi, '').slice(0, 62)}`
    child.phase = 'running'
    child.events.push({ at: now(), kind: 'delegated', text: `Criada a partir de ${parent.title}.` })
    if (!originTurnId) {
      parent.messages.push({ id: randomUUID(), role: 'user', text, at: now(), channel })
      parent.messages.push({ id: randomUUID(), role: 'assistant', text: `Encaminhei para **${child.title}**. Eu continuo disponível aqui; vou avaliar o retorno e te atualizar aqui, incluindo as correções que eu encaminhar.`, at: now(), channel: 'text' })
    }
    parent.events.push({ at: now(), kind: 'delegated', text: `Nova tarefa paralela: ${child.title}` })
    parent.events = parent.events.slice(-200)
    await this.store.save(); this.emit()
    void this.send(id, text).catch(async error => {
      const detail = String((error as Error).message || 'Error').replace(/(?:sk-|ek_|Bearer\s+)[\w.-]+/gi, '[credencial ocultada]').slice(0, 500)
      child.events.push({ at: now(), kind: 'error', text: detail })
      // A failed preflight has not entered send's execution try/finally. Give it
      // the same bounded review path; an allocated card is not proof of a start.
      const beforeExecution = !child.messages.some(message => message.role === 'user')
      if (beforeExecution) {
        child.phase = 'failed'
        child.resultText = `O subagente não iniciou a execução. O pedido está preservado. Falha na preparação: ${detail}`
        child.messages.push({ id: randomUUID(), role: 'user', text, at: now(), channel })
        child.messages.push({ id: randomUUID(), role: 'assistant', text: child.resultText, at: now(), channel: 'text', origin: 'omni' })
        child.summaryState = 'running'
      }
      // If execution already produced a result, preserve it: a later persistence
      // or follow-up failure does not prove that the executor never ran.
      child.updatedAt = now()
      await this.store.save(); this.emit()
      if (beforeExecution && !this.shuttingDown) await this.markTaskReady(child)
    })
    return id
  }
  /** Queue an owner complement for the worker already responsible for this objective. */
  async appendToTask(parentId: string, taskId: string, text: string, originTurnId: string) {
    if (!text.trim() || text.length > 32000) throw new Error('Envie um complemento entre 1 e 32.000 caracteres.')
    const parent = this.store.get(parentId)
    const task = this.store.get(taskId)
    if (!['central', 'external'].includes(parent.kind) || task.kind !== 'task' || task.parentConversationId !== parent.id) throw new Error('O subagente escolhido não pertence a esta conversa.')
    const supervision = task.supervision
    const stillWorking = this.active.has(task.id) || this.active.has(`summary:${task.id}`) || task.phase === 'running' || task.phase === 'needs-input' || task.summaryState === 'running'
    if (!supervision || supervision.cancelled || !stillWorking) throw new Error('Esse subagente não está mais executando; não anexei o complemento a uma tarefa encerrada.')
    supervision.ownerAddenda ||= []
    if (!supervision.ownerAddenda.some(item => item.id === originTurnId)) {
      supervision.ownerAddenda.push({ id: originTurnId, instruction: text.trim(), at: now() })
      supervision.ownerAddenda = supervision.ownerAddenda.slice(-8)
      task.events.push({ at: now(), kind: 'owner-addendum', text: 'Complemento do proprietário guardado para a mesma sessão.' })
      task.events = task.events.slice(-200)
      parent.events.push({ at: now(), kind: 'delegated-followup', text: `Complemento encaminhado ao subagente existente: ${task.title}` })
      parent.events = parent.events.slice(-200)
      parent.updatedAt = now(); task.updatedAt = now()
      await this.store.save(); this.emit()
    }
    return task.id
  }
  async handoff(id: string) {
    const c = this.store.get(id)
    await this.assertIdle(c)
    if (!c.sessionId) throw new Error('Envie a primeira mensagem para criar a sessão Claude antes de abri-la no editor.')
    const nonce = randomUUID()
    await writeFile(join(this.store.directory, `editor-${c.id}.json`), JSON.stringify({ sessionId: c.sessionId, at: now(), expiresAt: Date.now() + 60000 }), { mode: 0o600 })
    await writeFile(join(this.store.directory, `handoff-${nonce}.json`), JSON.stringify({ id, sessionId: c.sessionId, workspace: c.workspace, executable: await claudeExecutable(), at: now() }), { mode: 0o600 })
    c.phase = 'editor'; await this.store.save(); this.emit()
    return `vscode://omni-local.omni-desktop-bridge/session?nonce=${nonce}`
  }
}
