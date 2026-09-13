import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const directory = join(process.env.APPDATA || '', 'omni', 'desktop')
const historyPath = join(directory, 'conversations.json')
const history = JSON.parse(await readFile(historyPath, 'utf8'))
if (history.version !== 1 || !Array.isArray(history.conversations)) throw new Error('Histórico do Omni com formato não reconhecido; nada foi alterado.')
const source = history.conversations.at(0)
if (!source || typeof source.workspace !== 'string') throw new Error('Não há uma conversa válida para limpar.')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const archivePath = join(directory, `conversations.archive-${stamp}.json`)
await copyFile(historyPath, archivePath)
const at = new Date().toISOString()
const cleaned = {
  version: 1,
  conversations: [{ id: randomUUID(), title: 'Nova conversa', workspace: source.workspace, sessionId: null, messages: [], events: [], phase: 'idle', updatedAt: at }]
}
const temporary = join(dirname(historyPath), `conversations.${randomUUID()}.tmp`)
await writeFile(temporary, JSON.stringify(cleaned), { encoding: 'utf8', mode: 0o600 })
await rename(temporary, historyPath)
console.log(JSON.stringify({ archived: archivePath, conversations: cleaned.conversations.length }))
