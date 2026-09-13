import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Conversation } from '../shared/contracts'
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
        if (!['task', 'external'].includes(c.kind)) c.kind = 'central'
        if (!c.parentConversationId) delete c.parentConversationId
        if (c.kind === 'external' && c.editorProjectionVersion !== 2) {
          c.archivedMessages = c.messages
          c.messages = (c.editorRequests || []).map(r => ({ id: r.id, text: r.text, at: r.at, role: 'user' as const, channel: 'text' as const, origin: 'owner' as const }))
          c.editorProjectionVersion = 2; c.phase = 'idle'; migrated = true
        }
        for (const turn of c.coordinationTurns || []) if (turn.state === 'planning') { turn.state = 'queued'; migrated = true }
        for (const request of c.editorRequests || []) {
          request.originConversationId ||= c.id
          if (request.status === 'sending') { request.status = 'uncertain'; migrated = true }
          if (request.status === 'summarizing') { request.status = 'reported'; request.summaryError = 'Síntese interrompida; relato preservado.'; migrated = true }
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
      await rename(temporary, join(this.directory, 'conversations.json'))
    })
    this.writes = operation
    return operation
  }
  get(id: string) {
    const c = this.conversations.find(c => c.id === id)
    if (!c) throw new Error('Conversa não encontrada.')
    return c
  }
  async create(workspace: string, kind: Conversation['kind'] = 'central', parentConversationId?: string) {
    const id = randomUUID()
    this.conversations.unshift({ id, workspace, sessionId: null, title: kind === 'central' ? 'Nova conversa' : kind === 'external' ? 'VS Code' : 'Tarefa', messages: [], events: [], phase: 'idle', updatedAt: new Date().toISOString(), kind, ...(kind === 'central' && !this.conversations.some(c => c.kind === 'central' && c.primary) ? { primary: true } : {}), ...(parentConversationId ? { parentConversationId } : {}) })
    await this.save()
    return id
  }
}
