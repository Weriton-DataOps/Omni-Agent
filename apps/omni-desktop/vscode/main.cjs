const vscode = require('vscode')
const fs = require('node:fs/promises')
const path = require('node:path')
const leases = new Map()
const base = () => path.join(process.env.APPDATA, 'omni', 'desktop')
const registryPath = () => path.join(base(), 'vscode', `window-${process.pid}.json`)
const actionsPath = () => path.join(base(), 'vscode-actions')
const workspaces = () => (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath).filter(value => typeof value === 'string' && value.length < 1000)
exports.activate = context => {
  const reportWindow = async () => {
    const destination = registryPath()
    const content = JSON.stringify({ at: new Date().toISOString(), workspaces: workspaces(), sessions: [...leases.values()].map(lease => ({ sessionId: lease.sessionId, workspace: lease.workspace })) })
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const temporary = destination + '.tmp'
    await fs.writeFile(temporary, content)
    await fs.rename(temporary, destination)
  }
  void reportWindow().catch(() => {})
  const reportTimer = setInterval(() => void reportWindow().catch(() => {}), 4000)
  const processActions = async () => {
    for (const file of await fs.readdir(actionsPath()).catch(() => [])) {
      const match = /^open-claude-([a-f0-9-]{36})\.json$/i.exec(file)
      if (!match) continue
      const source = path.join(actionsPath(), file)
      let action
      try { action = JSON.parse(await fs.readFile(source, 'utf8')) } catch { continue }
      if (action?.id !== match[1] || action.command !== 'open-claude' || !path.isAbsolute(action.workspace) || Date.now() - Date.parse(action.at) > 30000) continue
      if (!workspaces().some(workspace => path.resolve(workspace).toLowerCase() === path.resolve(action.workspace).toLowerCase())) continue
      const claimed = `${source}.${process.pid}.working`
      try { await fs.rename(source, claimed) } catch { continue }
      const receipt = path.join(actionsPath(), `receipt-${action.id}.json`)
      try {
        await vscode.commands.executeCommand('claude-vscode.editor.open')
        await fs.writeFile(receipt, JSON.stringify({ id: action.id, status: 'opened', at: new Date().toISOString() }))
      } catch (error) {
        await fs.writeFile(receipt, JSON.stringify({ id: action.id, status: 'failed', error: String(error?.message || error).slice(0, 240), at: new Date().toISOString() }))
      } finally { await fs.unlink(claimed).catch(() => {}) }
    }
  }
  const actionTimer = setInterval(() => void processActions().catch(() => {}), 300)
  context.subscriptions.push({ dispose: () => { clearInterval(reportTimer); clearInterval(actionTimer); void fs.unlink(registryPath()).catch(() => {}) } })
  context.subscriptions.push(vscode.window.registerUriHandler({ async handleUri(uri) {
    try {
      if (uri.path === '/workspace') {
        const workspace = new URLSearchParams(uri.query).get('path')
        if (!workspace || !path.isAbsolute(workspace)) return
        await fs.access(workspace)
        const current = vscode.workspace.workspaceFolders?.some(folder => path.resolve(folder.uri.fsPath).toLowerCase() === path.resolve(workspace).toLowerCase())
        if (!current) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspace), { forceNewWindow: true })
        else await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
        return
      }
      const nonce = new URLSearchParams(uri.query).get('nonce')
      if (uri.path !== '/session' || !/^[a-f0-9-]{36}$/i.test(nonce || '')) return
      const requestPath = path.join(base(), `handoff-${nonce}.json`)
      const request = JSON.parse(await fs.readFile(requestPath, 'utf8'))
      if (Date.now() - Date.parse(request.at) > 60000 || !/^[a-f0-9-]{36}$/i.test(request.id) || !/^[a-f0-9-]{36}$/i.test(request.sessionId)) throw Error('Solicitação expirada.')
      const store = JSON.parse(await fs.readFile(path.join(base(), 'conversations.json'), 'utf8'))
      const c = store.conversations.find(c => c.id === request.id && c.sessionId === request.sessionId && c.workspace === request.workspace && c.phase === 'editor')
      if (!c) throw Error('Sessão sem vínculo com o Omni Desktop.')
      // Executable comes from the installed Claude extension, never from the URI or request.
      const extension = vscode.extensions.getExtension('anthropic.claude-code')
      if (!extension) throw Error('Extensão Claude Code não encontrada.')
      const executable = path.join(extension.extensionPath, 'resources', 'native-binary', 'claude.exe')
      await fs.access(executable)
      const current = vscode.workspace.workspaceFolders?.some(f => path.resolve(f.uri.fsPath).toLowerCase() === path.resolve(c.workspace).toLowerCase())
      if (!current) {
        await context.globalState.update('omniPending', nonce)
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(c.workspace), { forceNewWindow: true })
        return
      }
      if (!vscode.workspace.isTrusted) throw Error('O projeto precisa estar confiável no VS Code.')
      await fs.unlink(requestPath)
      const leasePath = path.join(base(), `editor-${c.id}.json`)
      const heartbeat = async () => {
        const temporary = leasePath + '.tmp'
        await fs.writeFile(temporary, JSON.stringify({ sessionId: c.sessionId, at: new Date().toISOString() }))
        await fs.rename(temporary, leasePath)
      }
      await heartbeat()
      const terminal = vscode.window.createTerminal({ name: `Omni · ${c.title.slice(0, 35)}`, cwd: c.workspace, shellPath: executable, shellArgs: ['--resume', c.sessionId] })
      const timer = setInterval(() => void heartbeat().catch(() => {}), 4000)
      leases.set(terminal, { timer, leasePath, sessionId: c.sessionId, workspace: c.workspace })
      void reportWindow().catch(() => {})
      terminal.show()
    } catch (e) { vscode.window.showErrorMessage(`Omni: ${e.message}`) }
  }}))
  context.subscriptions.push(vscode.window.onDidCloseTerminal(async terminal => {
    const lease = leases.get(terminal)
    if (lease) { clearInterval(lease.timer); leases.delete(terminal); await fs.unlink(lease.leasePath).catch(() => {}); void reportWindow().catch(() => {}) }
  }))
  const pending = context.globalState.get('omniPending')
  if (pending) {
    void context.globalState.update('omniPending', undefined).then(() => vscode.env.openExternal(vscode.Uri.parse(`vscode://omni-local.omni-desktop-bridge/session?nonce=${pending}`)))
  }
}
exports.deactivate = () => { for (const lease of leases.values()) clearInterval(lease.timer); void fs.unlink(registryPath()).catch(() => {}) }
