import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { runInNewContext } from 'node:vm'
const source = await readFile(resolve(import.meta.dirname, '../../vscode/main.cjs'), 'utf8')
const id = '11111111-1111-1111-1111-111111111111'
const sessionId = '22222222-2222-2222-2222-222222222222'
const nonce = '33333333-3333-3333-3333-333333333333'
async function harness(stale = false) {
  let handler: any; let terminalOptions: any; const errors: string[] = []; const writes: string[] = []
  const workspace = resolve('out/test-project')
  const request = { id, sessionId, workspace, executable: 'malicious.exe', at: new Date(Date.now() - (stale ? 120000 : 0)).toISOString() }
  const vscode = {
    window: {
      registerUriHandler: (h: unknown) => { handler = h; return {} },
      onDidCloseTerminal: () => ({}),
      createTerminal: (options: unknown) => { terminalOptions = options; return { show() {} } },
      showErrorMessage: (text: string) => errors.push(text)
    },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: { fsPath: workspace } }] },
    extensions: { getExtension: () => ({ extensionPath: resolve('installed-claude') }) }
  }
  const fs = {
    readFile: async (path: string) => path.endsWith('conversations.json') ? JSON.stringify({ conversations: [{ id, sessionId, workspace, phase: 'editor', title: 'Teste' }] }) : JSON.stringify(request),
    access: async () => {}, unlink: async (p: string) => { writes.push(p) },
    writeFile: async (p: string) => { writes.push(p) }, rename: async () => {}
  }
  const exports: any = {}
  runInNewContext(source, { exports, require: (name: string) => name === 'vscode' ? vscode : name === 'node:fs/promises' ? fs : { join, resolve },
    process: { env: { APPDATA: 'test-profile' } }, URLSearchParams, Date, setInterval: () => 1, clearInterval: () => {} })
  exports.activate({ subscriptions: [], globalState: { get: () => undefined } })
  await handler.handleUri({ path: '/session', query: `nonce=${nonce}` })
  return { terminalOptions, errors, writes }
}
test('ponte só inicia o Claude instalado, com argumentos separados e sessão vinculada', async () => {
  const result = await harness()
  assert.deepEqual(result.errors, [])
  assert.equal(result.terminalOptions.shellPath, join(resolve('installed-claude'), 'resources/native-binary/claude.exe'))
  assert.equal(JSON.stringify(result.terminalOptions.shellArgs), JSON.stringify(['--resume', sessionId]))
  assert.ok(result.writes.some(p => p.endsWith(`handoff-${nonce}.json`)))
})
test('solicitação expirada não abre terminal', async () => {
  const result = await harness(true)
  assert.equal(result.terminalOptions, undefined)
  assert.equal(result.writes.length, 0)
  assert.match(result.errors[0], /expirada/)
})
