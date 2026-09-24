import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Conversation, EditorRequest } from '../shared/contracts'
export class Store {
  conversations: Conversation[] = []
  private writes: Promise<void> = Promise.resolve()
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true })
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'conversations.json'), 'utf8'))
      if (data.version !== 1 || !Array.isArray(data.conversations)) throw new Error('Histórico com formato não reconhecido; arquivo preservado.')
      this.conversations = data.conversations
      let migrated = false
      let primary = this.conversations.find(c => c.kind === 'central' && c.primary)
      if (!primary) {
        primary = this.conversations.filter(c => c.kind === 'central').sort((a, b) => b.messages.length - a.messages.length)[0]
        if (primary) { primary.primary = true; migrated = true }
      }
      for (const c of this.conversations) {
        // The final report is released only by its card. Remove old delivery
        // preferences so an upgrade cannot revive an invisible automatic send.
        if ('autoDeliver' in c) { delete (c as { autoDeliver?: unknown }).autoDeliver; migrated = true }
        for (const message of c.messages) if (message.streaming) { message.streaming = false; message.interrupted = true; migrated = true }
        if (c.deliveryState === 'delivering') { c.deliveryState = 'ready'; c.deliveryError = true; migrated = true }
        if (c.editorReturn?.deliveryState === 'delivering') { c.editorReturn.deliveryState = 'ready'; c.editorReturn.deliveryError = true; migrated = true }
        if (!['task', 'external'].includes(c.kind)) c.kind = 'central'
        if (!c.parentConversationId) delete c.parentConversationId
        if (c.kind === 'external' && c.editorProjectionVersion !== 2) {
          c.archivedMessages = c.messages
          c.messages = []
          c.editorProjectionVersion = 2; c.phase = 'idle'; migrated = true
        }
        for (const turn of c.coordinationTurns || []) if (turn.state === 'planning') { turn.state = 'queued'; migrated = true }
        for (const request of c.editorRequests || []) {
          if ('autoDeliver' in request) { delete (request as { autoDeliver?: unknown }).autoDeliver; migrated = true }
          if (request.deliveryState === 'delivering') { request.deliveryState = 'ready'; request.deliveryError = true; migrated = true }
          request.originConversationId ||= c.id
          if (request.status === 'sending') { request.status = 'uncertain'; migrated = true }
          if (request.status === 'summarizing') { request.status = 'reported'; request.summaryError = 'Síntese interrompida; relato preservado.'; migrated = true }
          const pending = !request.acknowledgedAt && request.deliveryState !== 'delivered' && (
            !['completed', 'blocked', 'reported'].includes(request.status) || ['ready', 'delivering'].includes(request.deliveryState || '') ||
            (request.supervision && request.supervision.state !== 'settled') || (request.status === 'reported' && !request.summary)
          )
          if (c.kind === 'external' && pending) {
            if (request.deliveryConversationId !== c.id) { request.deliveryConversationId = c.id; migrated = true }
            if (this.projectEditorRequest(c, request)) migrated = true
          }
        }
        if (c.summaryState === 'running') { c.summaryState = 'failed'; migrated = true }
        if (!['running', 'needs-input'].includes(c.phase)) continue
        c.phase = 'interrupted'
        c.events.push({ at: new Date().toISOString(), kind: 'recovery', text: 'Aplicativo reiniciado. Sessão preservada para retomada.' })
        migrated = true
      }
      if (migrated) await this.save()
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  save() {
    const content = JSON.stringify({ version: 1, conversations: this.conversations })
    const operation = this.writes.catch(() => {}).then(async () => {
      const temporary = join(this.directory, `${randomUUID()}.tmp`)
      await writeFile(temporary, content, { mode: 0o600 })
      const destination = join(this.directory, 'conversations.json')
      let lastError: unknown
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rename(temporary, destination)
          return
        } catch (error) {
          lastError = error
          const code = (error as NodeJS.ErrnoException).code
          if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code || '') || attempt === 4) break
          await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
        }
      }
      await unlink(temporary).catch(() => {})
      throw lastError
    })
    this.writes = operation
    return operation
  }
  get(id: string) {
    const c = this.conversations.find(c => c.id === id)
    if (!c) throw new Error('Conversa não encontrada.')
    return c
  }
  /** The session chat shows the delegated objective, never a fabricated owner turn. */
  projectEditorRequest(target: Conversation, request: EditorRequest): boolean {
    let initial = request
    const seen = new Set<string>()
    while (initial.followupOf && !seen.has(initial.id)) {
      seen.add(initial.id)
      const previous = target.editorRequests?.find(item => item.id === initial.followupOf)
      if (!previous) break
      initial = previous
    }
    const id = `editor-forwarded:${initial.id}`
    if (target.messages.some(message => message.id === id || (message.id === initial.id && message.role === 'user'))) return false
    const source = this.conversations.find(conversation => conversation.id === (initial.originConversationId || request.originConversationId))
    const original = source?.coordinationTurns?.find(turn => turn.id === initial.id)?.text ||
      source?.messages.find(message => message.id === initial.id && message.role === 'user')?.text ||
      source?.archivedMessages?.find(message => message.id === initial.id && message.role === 'user')?.text ||
      initial.supervision?.objective || request.supervision?.objective
    const objective = original?.trim()
    const text = objective ? `Pedido encaminhado pelo Omni.\n\n${objective.length > 1800 ? `${objective.slice(0, 1800).trimEnd()}…` : objective}` :
      'Pedido encaminhado pelo Omni. O acompanhamento e o retorno desta demanda ficam no chat da sessão.'
    target.messages.push({ id, role: 'assistant', origin: 'omni', author: 'Omni · encaminhamento', text, at: initial.at || request.at, channel: 'text', requestId: initial.id })
    if (request.at > target.updatedAt) target.updatedAt = request.at
    return true
  }
  async create(workspace: string, kind: Conversation['kind'] = 'central', parentConversationId?: string) {
    const id = randomUUID()
    this.conversations.unshift({ id, workspace, sessionId: null, title: kind === 'central' ? 'Nova conversa' : kind === 'external' ? 'VS Code' : 'Tarefa', messages: [], events: [], phase: 'idle', updatedAt: new Date().toISOString(), kind, ...(kind === 'external' ? { editorProjectionVersion: 2 } : {}), ...(kind === 'central' && !this.conversations.some(c => c.kind === 'central' && c.primary) ? { primary: true } : {}), ...(parentConversationId ? { parentConversationId } : {}) })
    await this.save()
    return id
  }
}
