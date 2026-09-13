import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { query, listSessions, getSessionMessages, type Options, type HookCallback, type PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { Store } from './store'
import { editorSessions, editorHistory, readEditor, relayToEditor, sameWorkspace, type EditorSession } from './vscode-sessions'
import { Coordinator } from './coordinator'
import { ResultDeliveryQueue } from './result-delivery'
import { pendingCoordinationTurns } from '../shared/coordination-state'
import { continuationBrief } from '../shared/supervision'
import { bodyContext, loadBodyContract } from './body-contract'
import { home, root, moduleAt, broker, claudeExecutable, voiceAvailable, startRuntime } from './runtime'
import type { Attachment, AttachmentInput, CredentialReceipt, CredentialRegistrationInput, LocalUpdateStatus, Snapshot, RuntimeState, Permission, Conversation, Activity } from '../shared/contracts'
const now = () => new Date().toISOString()
const growthWorkspace = 'C:\\Users\\wp.santos\\Documents\\GR-Workspace\\Growth'
const workspaceForTask = (text: string, fallback: string) => /\bgrowth\b/i.test(text) ? growthWorkspace : fallback
type Dependencies = { loadModule: typeof moduleAt; getBroker: typeof broker; executable: typeof claudeExecutable; sessions?: typeof editorSessions; readEditor?: typeof readEditor; relay?: typeof relayToEditor }
export class Controller {
  state: RuntimeState = { broker: 'starting', voice: false, memory: { confirmed: 0, candidates: 0 }, missions: [], synchronization: 'Iniciando', activities: [], update: { state: 'current', currentVersion: 'carregando', autoApply: false, checkedAt: new Date(0).toISOString(), detail: 'Conferindo a build local.' } }
  readonly active = new Map<string, AbortController>()
  private approvals = new Map<string, { item: Permission; resolve: (r: PermissionResult) => void; input: Record<string, unknown> }>()
  private refreshing = false
  private synchronizationPending = false
  private vscodeWorkspaces: { id: string; workspace: string; sessions: number }[] = []
  private vscodeMonitor?: NodeJS.Timeout
  private liveEditors: EditorSession[] = []
  private editorSubagents = new Map<string, { id: string; lastActivityAt: string }[]>()
  private editorOpening: Promise<void> = Promise.resolve()
  private relayMailboxes = new Map<string, Pick<EditorSession, 'sessionId' | 'cwd'>>()
  private editorRefreshing = false
  private shuttingDown = false
  private taskContinuations = new Set<string>()
  private bodyContract = loadBodyContract()
  readonly coordinator: Coordinator
  readonly deliveries: ResultDeliveryQueue
  constructor(readonly store: Store, private readonly changed: (s: Snapshot) => void, private readonly agentQuery: typeof query = query,
    private readonly dependencies: Dependencies = { loadModule: moduleAt, getBroker: broker, executable: claudeExecutable }) {
    this.coordinator = new Coordinator(store, () => this.emit(), {
      sessions: () => (this.dependencies.sessions || editorSessions)(),
      relay: (session, text, id, abort) => (this.dependencies.relay || relayToEditor)(session, text, id, abort, query, false, this.returnRoute(session)),
      open: session => this.openVsCodeConversation(session.cwd, `${basename(session.cwd)} · ${session.name}`, session.sessionId),
      local: (parent, text, turnId) => this.delegate(parent, text, 'text', turnId),
      context: (c, text) => this.coordinatorContext(c, text), executable: () => this.dependencies.executable()
    }, agentQuery, this.active)
    this.deliveries = new ResultDeliveryQueue(store, (...args) => this.coordinator.summarize(...args), () => this.emit(), this.active)
  }
  private async coordinatorContext(c: Conversation, text: string) {
    c.coordinationSessionId ||= randomUUID()
    const { ClaudeActivationStore } = await this.dependencies.loadModule('dist/adapters/claude/activation-store.js')
    const input = { hook_event_name: 'UserPromptSubmit', session_id: c.coordinationSessionId, cwd: c.workspace, prompt: text }
    if (!(await new ClaudeActivationStore(home, {}).activate(input, { persistScope: true })).gravados) throw new Error('Contexto do Omni não ativado.')
    const result = await (await this.dependencies.loadModule('runtime/hook-contexto.mjs')).tratarHook(input, { ...process.env, OMNI_HOME: home })
    const context = result.hookSpecificOutput?.additionalContext
    if (typeof context !== 'string' || !context.trim()) throw new Error('Contexto canônico indisponível.')
    this.rebuildActivities()
    return `${context}\n\n${bodyContext(await this.bodyContract, c, this.state)}`
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
  snapshot(): Snapshot { return { conversations: this.store.conversations, state: this.state, permissions: [...this.approvals.values()].map(p => p.item), results: this.deliveries.tickets() } }
  setUpdateStatus(update: LocalUpdateStatus) { this.state.update = update; this.emit() }
  emit() { this.rebuildActivities(); this.changed(this.snapshot()) }
  releaseResult(id: string) { return this.deliveries.release(id) }
  private rebuildActivities() {
    const activities: Activity[] = []
    for (const c of this.store.conversations.filter(c => c.kind !== 'task')) {
      const planning = pendingCoordinationTurns(c, this.store.conversations).length > 0
      if (planning) activities.push({ id: `omni:coord:${c.id}`, source: 'omni', status: 'running', conversationId: c.id, workspace: c.workspace, title: 'Omni · entendendo o pedido', detail: 'Definindo o destino e o escopo antes de iniciar a execução' })
    }
    for (const c of this.store.conversations) {
      if (c.kind === 'external') continue
      if (c.kind === 'task') {
        if (c.acknowledgedAt) continue
        const active = this.active.has(c.id) || c.phase === 'running' || c.phase === 'needs-input' || c.summaryState === 'running'
        activities.push({ id: `omni:${c.id}`, source: 'omni', status: active ? (c.phase === 'needs-input' ? 'waiting' : 'running') : 'ready', conversationId: c.id, parentConversationId: c.parentConversationId, workspace: c.workspace, outcome: active ? undefined : c.phase === 'completed' ? 'completed' : c.phase === 'interrupted' ? 'interrupted' : 'failed',
          title: `Subagente do Omni · ${c.title.replace(/^Subagente · /, '')}`,
          detail: active ? (c.phase === 'needs-input' ? 'Aguardando decisão necessária' : 'Executando em segundo plano') : c.phase === 'completed' ? 'Concluído · clique para ver e retirar da fila' : 'Interrompido ou falhou · clique para ver e retirar da fila' })
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
    for (const editor of this.vscodeWorkspaces) {
      if (this.liveEditors.some(session => sameWorkspace(session.cwd, editor.workspace))) continue
      if (activities.some(activity => activity.source === 'vscode' && activity.detail.endsWith(basename(editor.workspace)))) continue
      activities.push({ id: `vscode:${editor.id}`, source: 'vscode', status: 'ready', workspace: editor.workspace, title: `VS Code · ${basename(editor.workspace)}`, detail: editor.sessions ? `${editor.sessions} sessão(ões) Omni mapeada(s)` : 'Projeto aberto · sem sessão Omni vinculada' })
    }
    for (const session of this.liveEditors) {
      const linked = this.store.conversations.find(c => c.kind === 'external' && c.sessionId === session.sessionId)
      const requests = linked?.editorRequests || []
      // A raw report is already a return for the owner, even if synthesis failed.
      const pending = requests.findLast(r => !['completed', 'blocked', 'reported'].includes(r.status))
      const returned = requests.findLast(r => ['completed', 'blocked', 'reported'].includes(r.status) && !r.acknowledgedAt)
      const finished = !pending ? requests.findLast(r => ['completed', 'blocked'].includes(r.status)) : undefined
      const unseenFinished = !!finished && !finished.acknowledgedAt
      // A receipt is evidence that the project accepted a command, not a perpetual
      // heartbeat. Stop the spinner after a short silence; the card remains waiting
      // until a report arrives, but never pretends the Claude session is still working.
      const observedAt = pending ? Date.parse(pending.lastObservedAt || pending.at) : Number.NaN
      const recentlyObserved = Number.isFinite(observedAt) && Date.now() - observedAt < 180_000
      const running = !!pending && recentlyObserved && ['sending', 'sent', 'received', 'summarizing'].includes(pending.status)
      const stalePending = !!pending && !running && ['sending', 'sent', 'received', 'summarizing'].includes(pending.status)
      activities.push({ id: `vscode:session:${session.sessionId}`, source: 'vscode', status: pending ? (running ? 'running' : 'waiting') : 'ready', workspace: session.cwd, sessionId: session.sessionId, conversationId: linked?.id, title: `VS Code · ${basename(session.cwd)} · ${session.name}`, detail: stalePending ? 'Sem atividade recente · retorno não confirmado' : pending ? ({ sending: 'Encaminhando comando para a sessão', sent: 'Comando enviado · aguardando confirmação', received: 'Pedido recebido · aguardando relato', reported: 'Relato recebido · Omni preparando retorno', summarizing: 'Omni preparando o retorno', uncertain: 'Entrega não confirmada' } as Record<string, string>)[pending.status] || 'Aguardando retorno' : returned ? 'Retorno pronto · clique para visualizar' : finished?.status === 'completed' ? 'Último trabalho concluído' : finished?.status === 'blocked' ? 'Último trabalho bloqueado' : 'Sessão Claude ativa', ...(returned ? { attention: 'return' as const } : {}), ...(unseenFinished ? { outcome: finished!.status === 'completed' ? 'completed' as const : 'failed' as const } : {}) })
      const latestSubagent = this.editorSubagents.get(session.sessionId)?.[0]
      const subagentAge = latestSubagent ? Date.now() - Date.parse(latestSubagent.lastActivityAt) : Number.POSITIVE_INFINITY
      if (latestSubagent && subagentAge < 15 * 60_000) activities.at(-1)!.child = { id: latestSubagent.id, title: 'Subagente da sessão', status: subagentAge < 3 * 60_000 ? 'running' : 'completed' }
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
    let changed = false
    const observedMailboxes = new Set<string>()
    // Technical inboxes are observed without requiring their card to be opened.
    // Retain known inboxes in this process even if their editor closes.
    for (const session of this.liveEditors) if (sameWorkspace(session.cwd, root) && /^omni(?:-|$)/i.test(session.name)) this.relayMailboxes.set(session.sessionId, session)
    for (const c of this.store.conversations.filter(c => c.kind === 'external' && c.sessionId)) {
      const before = JSON.stringify([c.editorHistory, c.editorRequests, c.editorOnline])
      const reading = await (this.dependencies.readEditor || readEditor)({ sessionId: c.sessionId!, cwd: c.workspace }).catch(() => null)
      if (reading) { c.editorHistory = reading.messages; this.editorSubagents.set(c.sessionId!, reading.subagents || []) }
      await this.coordinator.observe(c, reading?.observations || [], this.liveEditors.some(s => s.sessionId === c.sessionId), reading?.activityAt)
      if (sameWorkspace(c.workspace, root)) {
        observedMailboxes.add(c.sessionId!)
        if (reading?.relayInbox?.length) await this.coordinator.observeRelayInbox(reading.relayInbox)
      }
      if (before !== JSON.stringify([c.editorHistory, c.editorRequests, c.editorOnline])) changed = true
    }
    for (const mailbox of this.relayMailboxes.values()) {
      if (observedMailboxes.has(mailbox.sessionId)) continue
      const reading = await (this.dependencies.readEditor || readEditor)(mailbox).catch(() => null)
      if (!reading?.relayInbox?.length) continue
      const before = JSON.stringify(this.store.conversations.flatMap(conversation => conversation.editorRequests || []))
      await this.coordinator.observeRelayInbox(reading.relayInbox)
      if (before !== JSON.stringify(this.store.conversations.flatMap(conversation => conversation.editorRequests || []))) changed = true
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
      this.vscodeMonitor = setInterval(() => { void this.refreshVsCodeMap().then(() => this.emit()).catch(() => { this.state.error = 'Falha ao observar sessões; pedidos preservados.'; this.emit() }) }, 4_000)
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
      this.state.voice = await voiceAvailable()
      const client = await this.dependencies.getBroker()
      this.state.broker = (await client.health()).status
      this.state.missions = await client.listActiveMissions()
      delete this.state.error
      this.state.synchronization = this.synchronizationPending ? 'Banco conectado · sincronização pendente' : 'Banco conectado · cache de memória compartilhado'
      if (this.synchronizationPending && !this.active.size) {
        try {
          await (await this.dependencies.loadModule('runtime/sincronizacao-memoria-duravel.mjs')).sincronizarMemoriaDuravel(home)
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
    const candidates = (await (this.dependencies.sessions || editorSessions)()).filter(session => sameWorkspace(session.cwd, workspace))
    const session = sessionId ? candidates.find(session => session.sessionId === sessionId) : candidates.length === 1 ? candidates[0] : undefined
    if (!session) throw new Error(candidates.length > 1 ? 'Este projeto tem várias sessões. Selecione o card da sessão desejada.' : 'O projeto está aberto, mas não há sessão Claude ativa vinculada no VS Code.')
    const bound = this.store.conversations.find(conversation => conversation.kind === 'external' && (!conversation.host || conversation.host === 'vscode') && conversation.sessionId === session.sessionId)
    if (bound && !sameWorkspace(bound.workspace, session.cwd)) throw new Error('A sessao ja esta vinculada a outro projeto; vinculo preservado.')
    const existing = bound || this.store.conversations.find(conversation => conversation.kind === 'external' && (!conversation.host || conversation.host === 'vscode') && !conversation.sessionId && !conversation.messages.length && !conversation.editorRequests?.length && sameWorkspace(conversation.workspace, session.cwd))
    const id = existing?.id || await this.store.create(workspace, 'external')
    const conversation = this.store.get(id)
    conversation.host = 'vscode'
    conversation.sessionId = session.sessionId
    conversation.editorProjectionVersion = 2
    conversation.editorHistory = (await (this.dependencies.readEditor || readEditor)(session)).messages
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
  async send(id: string, text: string, channel: 'text' | 'voice' = 'text', inputs?: unknown) {
    if (typeof text !== 'string' || text.length > 256000) throw new Error('Mensagem grande demais.')
    const c = this.store.get(id)
    const normalizedInputs: AttachmentInput[] = Array.isArray(inputs) ? [...inputs as AttachmentInput[]] : []
    let messageText = text.trim()
    if (messageText.length > 6000) {
      normalizedInputs.push({ kind: 'text', name: 'mensagem-longa.txt', text: messageText })
      messageText = 'Texto longo enviado como anexo.'
    }
    const attachments = await this.saveAttachments(c.id, normalizedInputs)
    if (!messageText && !attachments.length) throw new Error('Escreva uma mensagem ou adicione um anexo.')
    if (!messageText) messageText = attachments.length === 1 ? `Anexo #1: ${attachments[0].name}` : `${attachments.length} anexos enviados.`
    if (c.kind === 'external') {
      if (!(await (this.dependencies.sessions || editorSessions)()).some(s => s.sessionId === c.sessionId && sameWorkspace(s.cwd, c.workspace))) throw new Error('A sessão vinculada não está ativa no VS Code. O pedido não foi enviado.')
      await this.coordinator.enqueue(c, messageText, channel, attachments); return
    }
    if (c.kind === 'central') { await this.coordinator.enqueue(c, messageText, channel, attachments); return }
    await this.assertIdle(c)
    if (!(await stat(c.workspace)).isDirectory()) throw new Error('O projeto não está disponível.')
    // Recheck after I/O: concurrent IPC submissions cannot enter the same session.
    if (this.active.has(id)) throw new Error('Esta conversa ainda está trabalhando.')
    const abort = new AbortController()
    this.active.set(id, abort)
    c.phase = 'running'; c.updatedAt = now()
    c.messages.push({ id: randomUUID(), role: 'user', text: messageText, at: now(), channel, ...(attachments.length ? { attachments } : {}) })
    if (c.title === 'Nova conversa') c.title = messageText.slice(0, 70)
    const response = { id: randomUUID(), role: 'assistant' as const, text: '', at: now(), channel }
    c.messages.push(response)
    try {
      await this.store.save(); this.emit()
      const hookModule = await this.dependencies.loadModule('runtime/hook-contexto.mjs')
      const { ClaudeActivationStore } = await this.dependencies.loadModule('dist/adapters/claude/activation-store.js')
      const activation = new ClaudeActivationStore(home, {})
      const isNewSession = c.sessionId === null
      if (isNewSession) { c.sessionId = randomUUID(); await this.store.save() }
      const turnInput = { hook_event_name: 'UserPromptSubmit', session_id: c.sessionId, cwd: c.workspace, prompt: messageText }
      const activated = await activation.activate(turnInput, { persistScope: true })
      if (!activated.gravados) throw new Error('Não foi possível ativar o contexto persistente desta sessão.')
      // Every entry channel explicitly builds its context before inference, independent of host hook delivery.
      const turnContext = await hookModule.tratarHook(turnInput, { ...process.env, OMNI_HOME: home })
      const additionalContext = turnContext.hookSpecificOutput?.additionalContext
      if (typeof additionalContext !== 'string' || !additionalContext.trim()) throw new Error('O contexto canônico do Omni não foi carregado.')
      c.events.push({ at: now(), kind: 'context', text: 'Personalidade, memória e continuidade carregadas para este turno.' })
      const hook: HookCallback = async (input) => {
        if (input.hook_event_name === 'UserPromptSubmit') return { suppressOutput: true }
        c.events.push({ at: now(), kind: 'hook', text: input.hook_event_name })
        if (input.hook_event_name === 'SessionStart') {
          await activation.activate(input, { persistScope: true })
        }
        const result = await hookModule.tratarHook(input, { ...process.env, OMNI_HOME: home })
        if (input.hook_event_name === 'PostToolUse' || input.hook_event_name === 'PostToolUseFailure') {
          c.events.push({ at: now(), kind: input.hook_event_name, text: input.tool_name })
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
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `Você é o Omni, agente pessoal do proprietário. A personalidade, memória e continuidade canônicas chegam pelos hooks em cada turno. Execute e verifique o trabalho autorizado. Quando um trabalho puder avançar sem uma nova decisão do proprietário, delegue etapas independentes a subagentes do Claude Code e acompanhe o resultado; não peça ao proprietário para executar seu trabalho. Mantenha a conversa responsável pelo resultado. Quando o proprietário disser “Growth”, o único projeto canônico é ${growthWorkspace}; não abra nem pesquise outro projeto Growth. Canal atual: ${channel}. Repositório do runtime: ${root}. Não revele segredos. Um relato não prova execução.\n\nFale como Omni: atento, direto, caloroso e criterioso — nunca como log ou terminal. Comece pelo que importa para o proprietário. Use Markdown simples, com títulos curtos quando ajudarem, parágrafos de até quatro linhas e listas para fatos ou próximos passos. Use **ênfase** e \`código\` só para tornar a leitura mais clara. Separe resultado, evidência e decisão pendente; não espalhe frases soltas nem repita o briefing. Ícones textuais só quando realmente orientarem a leitura; não use emojis.` },
        ...(isNewSession ? { sessionId: c.sessionId! } : { resume: c.sessionId! }),
        // Intentionally no canUseTool callback: bypass mode must not turn an
        // already granted local authority into repeated UI approval cards.
      }
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: `${(options.systemPrompt as { append: string }).append}\n\n${additionalContext}` }
      let resultSeen = false
      for await (const message of this.agentQuery({ prompt: messageText, options })) {
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
      c.events.push({ at: now(), kind: 'error', text: String((e as Error).message || 'Error').replace(/(?:sk-|ek_|Bearer\s+)[\w.-]+/gi, '[credencial ocultada]').slice(0, 500) })
    } finally {
      for (const [key, p] of this.approvals) if (p.item.conversationId === id) this.decide(key, false)
      this.active.delete(id)
      if (c.kind === 'task' && c.phase !== 'completed') c.resultText = response.text
      if (c.kind === 'task' && c.parentConversationId) c.summaryState = 'running'
      c.updatedAt = now(); await this.store.save(); this.emit()
      if (c.kind === 'task' && c.parentConversationId && !this.shuttingDown) await this.markTaskReady(c)
      try {
        await (await this.dependencies.loadModule('runtime/sincronizacao-memoria-duravel.mjs')).sincronizarMemoriaDuravel(home)
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
  prepareShutdown() {
    this.shuttingDown = true
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
    if (!parent || parent.kind !== 'central' || this.shuttingDown || this.active.has(`summary:${task.id}`)) return
    const supervision = task.supervision ||= { objective: task.messages.find(m => m.role === 'user')?.text || task.title, retries: 0, state: 'executing' }
    supervision.state = 'reviewing'; task.summaryState = 'running'
    const summaryAbort = new AbortController(); this.active.set(`summary:${task.id}`, summaryAbort)
    try {
      await this.store.save(); this.emit()
      const report = task.resultText || task.messages.filter(m => m.role === 'assistant').at(-1)?.text || 'Execução interrompida sem relato final; confira o estado existente antes de continuar.'
      const review = supervision.review ||= await this.coordinator.reviewReturn(parent, supervision, report, task.phase, summaryAbort)
      if (this.shuttingDown) return
      task.reportSummary = review.message
      task.summaryState = 'ready'
      if (review.action === 'retry' && !supervision.cancelled) {
        supervision.evidenceReports = [...(supervision.evidenceReports || []), report.slice(0, 22000)].slice(-3)
        supervision.retries++; supervision.previousReport = report; supervision.state = 'retry-ready'
        task.acknowledgedAt = undefined
        task.phase = 'running'
      } else {
        supervision.state = 'settled'
        if (review.action !== 'complete') task.phase = 'failed'
      }
    } catch {
      task.summaryState = 'failed'; supervision.state = this.shuttingDown ? 'reviewing' : 'settled'
      task.reportSummary = 'O executor retornou, mas não consegui avaliar a entrega automaticamente. Preservei o resultado e a sessão; o trabalho ainda precisa de conferência.'
      task.phase = 'failed'
    }
    finally { this.active.delete(`summary:${task.id}`) }
    if (this.shuttingDown) { await this.store.save(); return }
    if (supervision.state !== 'retry-ready') {
      task.deliveryState = 'ready'
      const noticeId = `task-ready:${task.id}`
      if (!parent.messages.some(m => m.id === noticeId)) parent.messages.push({ id: noticeId, role: 'assistant', text: supervision.review?.action === 'complete' ? `${task.title}: retorno avaliado e pronto no card. Você escolhe quando receber o relato completo.` : `${task.title}: ${task.reportSummary?.slice(0, 320) || 'O retorno precisa de atenção.'}`, at: now(), channel: 'text', origin: 'omni' })
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
  async consumeTask(id: string) {
    const task = this.store.get(id)
    if (task.kind !== 'task' || !task.parentConversationId) throw new Error('Esta execução não pertence à fila de subagentes.')
    if (task.supervision) return task.acknowledgedAt ? task.parentConversationId : this.releaseResult(id)
    if (this.active.has(id) || task.phase === 'running' || task.phase === 'needs-input' || task.summaryState === 'running') throw new Error('O subagente ainda está executando ou preparando a síntese.')
    const parent = this.store.get(task.parentConversationId)
    if (parent.kind !== 'central') throw new Error('Resultado preservado: a tarefa não possui um chat central de origem válido.')
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
    if (parent.kind !== 'central') throw new Error('Subagentes do Omni só podem ser criados pelo chat central. Use a sessão vinculada para comandos do VS Code.')
    const previous = originTurnId && this.store.conversations.find(c => c.originTurnId === originTurnId)
    if (previous) return previous.id
    const workspace = workspaceForTask(text, parent.workspace)
    if (!(await stat(workspace)).isDirectory()) throw new Error('O projeto não está disponível.')
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
