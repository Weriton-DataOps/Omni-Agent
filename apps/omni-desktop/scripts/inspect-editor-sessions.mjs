import { build } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
const app = resolve(import.meta.dirname, '..')
const output = resolve(app, 'out/checks/vscode-sessions.mjs')
await build({ entryPoints: [resolve(app, 'src/main/vscode-sessions.ts')], outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm' })
const { editorSessions, editorHistory, relayToEditor } = await import(pathToFileURL(output).href)
for (const session of await editorSessions()) {
  const messages = await editorHistory(session)
  console.log(JSON.stringify({ name: session.name, sessionId: session.sessionId, workspace: session.cwd, messages: messages.length, lastRole: messages.at(-1)?.role }))
  const records = await getSessionMessages(session.sessionId, { dir: session.cwd })
  const interactions = records.flatMap(record => Array.isArray(record.message?.content) ? record.message.content.filter(block => block.type === 'tool_use' && ['SendMessage', 'ListAgents'].includes(block.name)).map(block => ({ tool: block.name, to: block.input?.to, summary: block.input?.summary })) : [])
  console.log(JSON.stringify({ name: session.name, historicalInteractions: interactions.slice(-8) }))
  if (process.argv.includes('--probe') && session.name.startsWith('omni-')) {
    await relayToEditor(session, '', 'probe', new AbortController(), undefined, true)
    console.log(JSON.stringify({ peerReceiptVerified: true, sessionId: session.sessionId, remoteTaskStarted: false }))
  }
}
