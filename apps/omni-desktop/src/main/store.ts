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
      for (const c of this.conversations) if (['running', 'needs-input'].includes(c.phase)) {
        c.phase = 'interrupted'
        c.events.push({ at: new Date().toISOString(), kind: 'recovery', text: 'Aplicativo reiniciado. Sessão preservada para retomada.' })
      }
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
  async create(workspace: string) {
    const id = randomUUID()
    this.conversations.unshift({ id, workspace, sessionId: null, title: 'Nova conversa', messages: [], events: [], phase: 'idle', updatedAt: new Date().toISOString() })
    await this.save()
    return id
  }
}
