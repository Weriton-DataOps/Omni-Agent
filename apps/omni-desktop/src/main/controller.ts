import { randomUUID } from 'node:crypto'
import { readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { query, listSessions, getSessionMessages, type Options, type HookCallback, type PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { Store } from './store'
import { home, root, moduleAt, broker, claudeExecutable, voiceAvailable, startRuntime } from './runtime'
import type { Snapshot, RuntimeState, Permission, Conversation, Activity } from '../shared/contracts'
const now = () => new Date().toISOString()
type Dependencies = { loadModule: typeof moduleAt; getBroker: typeof broker; executable: typeof claudeExecutable }
export class Controller {
  state: RuntimeState = { broker: 'starting', voice: false, memory: { confirmed: 0, candidates: 0 }, missions: [], synchronization: 'Iniciando', activities: [] }
  readonly active = new Map<string, AbortController>()
  private approvals = new Map<string, { item: Permission; resolve: (r: PermissionResult) => void; input: Record<string, unknown> }>()
  private refreshing = false
  private synchronizationPending = false
  private vscodeWorkspaces: { id: string; workspace: string; sessions: number }[] = []
  private vscodeMonitor?: NodeJS.Timeout
  constructor(readonly store: Store, private readonly changed: (s: Snapshot) => void, private readonly agentQuery: typeof query = query,
    private readonly dependencies: Dependencies = { loadModule: moduleAt, getBroker: broker, executable: claudeExecutable }) {}
  snapshot(): Snapshot { return { conversations: this.store.conversations, state: this.state, permissions: [...this.approvals.values()].map(p => p.item) } }
  emit() { this.rebuildActivities(); this.changed(this.snapshot()) }
  private rebuildActivities() {
    const activities: Activity[] = []
    for (const c of this.store.conversations) {
      if (this.active.has(c.id) || c.phase === 'running' || c.phase === 'needs-input') {
        const subagentOpen = c.events.slice().reverse().find(e => e.kind === 'hook' && e.text === 'SubagentStart')
        const subagentClosed = c.events.slice().reverse().find(e => e.kind === 'hook' && e.text === 'SubagentStop')
        activities.push({ id: `omni:${c.id}`, source: 'omni', status: c.phase === 'needs-input' ? 'waiting' : 'running', conversationId: c.id,
          title: subagentOpen && (!subagentClosed || subagentOpen.at > subagentClosed.at) ? `Subagente do Omni · ${c.title}` : `Tarefa do Omni · ${c.title}`,
          detail: c.phase === 'needs-input' ? 'Aguardando sua decisão' : 'Executando em paralelo' })
      }
      if (c.phase === 'editor') activities.push({ id: `vscode:handoff:${c.id}`, source: 'vscode', status: 'waiting', conversationId: c.id, title: `Sessão Claude · ${c.title}`, detail: `Aguardando retorno · ${basename(c.workspace)}` })
    }
    for (const editor of this.vscodeWorkspaces) {
      if (activities.some(activity => activity.source === 'vscode' && activity.detail.endsWith(basename(editor.workspace)))) continue
      activities.push({ id: `vscode:${editor.id}`, source: 'vscode', status: 'ready', title: `VS Code · ${basename(editor.workspace)}`, detail: editor.sessions ? `${editor.sessions} sessão(ões) Omni mapeada(s)` : 'Projeto aberto · sem sessão Omni vinculada' })
    }
    activities.push({ id: 'overcore:future', source: 'overcore', status: 'unavailable', title: 'Overcore', detail: 'Aguardando contrato de integração' })
    activities.push({ id: 'oracle:future', source: 'oracle', status: 'unavailable', title: 'Oracle', detail: 'Aguardando retorno futuro' })
    this.state.activities = activities
  }
  private async refreshVsCodeMap() {
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
  }
  async initialize() {
    await this.store.load()
    if (!this.store.conversations.length) await this.store.create(root)
    this.emit()
    if (!this.vscodeMonitor) {
      this.vscodeMonitor = setInterval(() => { void this.refreshVsCodeMap().then(() => this.emit()) }, 4_000)
      this.vscodeMonitor.unref()
    }
    try {
      await Promise.race([startRuntime(), new Promise((_, reject) => setTimeout(() => reject(new Error('startup-timeout')), 30000))])
    } catch { this.state.error = 'Runtime durável indisponível; continuidade local preservada.' }
    await this.refresh()
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
  async send(id: string, text: string, channel: 'text' | 'voice' = 'text') {
    if (!text.trim() || text.length > 32000) throw new Error('Envie uma mensagem entre 1 e 32.000 caracteres.')
    const c = this.store.get(id)
    await this.assertIdle(c)
    if (!(await stat(c.workspace)).isDirectory()) throw new Error('O projeto não está disponível.')
    // Recheck after I/O: concurrent IPC submissions cannot enter the same session.
    if (this.active.has(id)) throw new Error('Esta conversa ainda está trabalhando.')
    const abort = new AbortController()
    this.active.set(id, abort)
    c.phase = 'running'; c.updatedAt = now()
    c.messages.push({ id: randomUUID(), role: 'user', text, at: now(), channel })
    if (c.title === 'Nova conversa') c.title = text.slice(0, 70)
    const response = { id: randomUUID(), role: 'assistant' as const, text: '', at: now(), channel }
    c.messages.push(response)
    try {
      await this.store.save(); this.emit()
      const hookModule = await this.dependencies.loadModule('runtime/hook-contexto.mjs')
      const { ClaudeActivationStore } = await this.dependencies.loadModule('dist/adapters/claude/activation-store.js')
      const activation = new ClaudeActivationStore(home, {})
      const isNewSession = c.sessionId === null
      if (isNewSession) { c.sessionId = randomUUID(); await this.store.save() }
      const turnInput = { hook_event_name: 'UserPromptSubmit', session_id: c.sessionId, cwd: c.workspace, prompt: text }
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
        settingSources: ['project', 'local'], permissionMode: 'default', hooks,
        env, includePartialMessages: true, persistSession: true, effort: 'medium',
        abortController: abort, maxBudgetUsd: 0.75,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `Você é o Omni, agente pessoal do proprietário. A personalidade, memória e continuidade canônicas chegam pelos hooks em cada turno. Execute e verifique o trabalho autorizado. Quando um trabalho puder avançar sem uma nova decisão do proprietário, delegue etapas independentes a subagentes do Claude Code e acompanhe o resultado; não peça ao proprietário para executar seu trabalho. Mantenha a conversa responsável pelo resultado. Canal atual: ${channel}. Repositório do runtime: ${root}. Não revele segredos. Um relato não prova execução.` },
        ...(isNewSession ? { sessionId: c.sessionId! } : { resume: c.sessionId! }),
        canUseTool: async (tool, input, options) => new Promise<PermissionResult>((resolve) => {
          const permissionId = randomUUID()
          const item: Permission = { id: permissionId, conversationId: id, tool, detail: JSON.stringify(input).slice(0, 2000) }
          this.approvals.set(permissionId, { item, resolve, input })
          c.phase = 'needs-input'; this.emit()
          options.signal.addEventListener('abort', () => { this.decide(permissionId, false) }, { once: true })
        })
      }
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: `${(options.systemPrompt as { append: string }).append}\n\n${additionalContext}` }
      let resultSeen = false
      for await (const message of this.agentQuery({ prompt: text, options })) {
        if ('session_id' in message && typeof message.session_id === 'string' && c.sessionId !== message.session_id) {
          c.sessionId = message.session_id
          await this.store.save()
        }
        if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
          response.text += message.event.delta.text; this.emit()
        }
        if (message.type === 'result') {
          resultSeen = true
          if (message.subtype === 'success') response.text = message.result || response.text
          else response.text += '\nA execução não concluiu: ' + message.subtype
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
      c.updatedAt = now(); await this.store.save(); this.emit()
      try {
        await (await this.dependencies.loadModule('runtime/sincronizacao-memoria-duravel.mjs')).sincronizarMemoriaDuravel(home)
        await (await this.dependencies.loadModule('runtime/sincronizacao-missoes-duraveis.mjs')).sincronizarMissoesDuraveis(home)
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
  cancel(id: string) { this.active.get(id)?.abort() }
  async delegate(parentId: string, text: string) {
    if (!text.trim() || text.length > 32000) throw new Error('Envie uma mensagem entre 1 e 32.000 caracteres.')
    const parent = this.store.get(parentId)
    if (!(await stat(parent.workspace)).isDirectory()) throw new Error('O projeto não está disponível.')
    const id = await this.store.create(parent.workspace)
    const child = this.store.get(id)
    child.title = `Tarefa · ${text.trim().slice(0, 62)}`
    child.phase = 'running'
    child.events.push({ at: now(), kind: 'delegated', text: `Criada a partir de ${parent.title}.` })
    parent.events.push({ at: now(), kind: 'delegated', text: `Nova tarefa paralela: ${child.title}` })
    parent.events = parent.events.slice(-200)
    await this.store.save(); this.emit()
    void this.send(id, text).catch(() => undefined)
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
