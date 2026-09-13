import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const directory = join(process.env.APPDATA || '', 'omni', 'desktop')
const historyPath = join(directory, 'conversations.json')
const history = JSON.parse(await readFile(historyPath, 'utf8'))
if (history.version !== 1 || !Array.isArray(history.conversations)) throw new Error('Histórico do Omni com formato não reconhecido; nada foi alterado.')
const at = new Date().toISOString()
let recovered = 0
for (const conversation of history.conversations) {
  if (conversation?.phase !== 'running' && conversation?.phase !== 'needs-input') continue
  conversation.phase = 'interrupted'
  conversation.updatedAt = at
  conversation.events = Array.isArray(conversation.events) ? conversation.events : []
  conversation.events.push({ at, kind: 'recovery', text: 'Rodada interrompida durante atualização; sessão preservada.' })
  conversation.events = conversation.events.slice(-200)
  recovered++
}
if (recovered) {
  const temporary = join(directory, `conversations.${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(history), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, historyPath)
}
console.log(JSON.stringify({ recovered }))
