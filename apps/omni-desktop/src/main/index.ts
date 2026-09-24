import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell, globalShortcut } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Controller } from './controller'
import { Store } from './store'
import { home, root, broker, mintVoiceToken, transcribeAudio } from './runtime'
import { LocalUpdateService } from './update-service'
import { resultId } from './ipc-identifiers'
import { DocumentWindows } from './document-windows'
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let shuttingDown = false
const page = join(import.meta.dirname, '../renderer/index.html')
const trustedUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(page).href
const store = new Store(join(home, 'desktop'))
const updates = new LocalUpdateService([join(import.meta.dirname, 'index.js'), join(import.meta.dirname, '../preload/index.cjs'), page, join(import.meta.dirname, '../preload/document.cjs'), join(import.meta.dirname, '../renderer/document.html'), join(root, 'apps/omni-desktop/scripts/use-cracha.mjs'), join(root, 'apps/omni-desktop/scripts/ssh-executor.mjs'), join(root, 'dist/adapters/windows/node-access-broker-client.js'), join(root, 'scripts/omni-credential-execution.ps1'), join(root, 'contratos/atualizacao/integridade.json')], join(home, 'desktop', 'update-preferences.json'))
async function releaseIdentity() {
  try {
    const { verificarIntegridadeRelease } = await import(pathToFileURL(join(root, 'runtime', 'integridade-release.mjs')).href)
    const result = await verificarIntegridadeRelease(root)
    return { version: result.releaseVersion, fingerprint: result.fingerprint, integrity: result.status === 'verified' ? 'verified' as const : 'drifted' as const }
  } catch {
    return { version: 'indisponível', fingerprint: null, integrity: 'unavailable' as const }
  }
}
const controller = new Controller(store, snapshot => {
  if (window && !window.isDestroyed()) window.webContents.send('omni:change', snapshot)
})
const credentialIntake = controller.credentialIntake
const id = (v: unknown) => { if (typeof v !== 'string' || !/^[a-f0-9-]{36}$/i.test(v)) throw new Error('Identificador inválido.'); return v }
const externalUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Link inválido.')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Link inválido.') }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Link inválido.')
  return url.href
}
function register(name: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(`omni:${name}`, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl) throw new Error('Origem inválida.')
    return handler(...args)
  })
}
function show() { window?.show(); window?.focus() }
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
app.setPath('userData', join(home, 'desktop/electron'))
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.setAppUserModelId('local.omni.desktop')
  app.on('second-instance', show)
  app.on('before-quit', event => {
    credentialIntake.discard()
    if (quitting) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    controller.prepareShutdown()
    void (async () => {
      const deadline = Date.now() + 8000
      while (controller.active.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      await store.save()
      quitting = true; app.quit()
    })()
  })
  app.whenReady().then(async () => {
    window = new BrowserWindow({ title: 'Omni', width: 1320, height: 850, minWidth: 900, minHeight: 650, backgroundColor: '#101317', show: false,
      webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
    window.setMenuBarVisibility(false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('render-process-gone', () => credentialIntake.discardDrafts())
    window.on('hide', () => credentialIntake.discardDrafts())
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === window?.webContents && permission === 'media' && contents.getURL() === trustedUrl && 'mediaTypes' in details && (details.mediaTypes || []).every((t: string) => t === 'audio'))
    })
    window.on('close', e => { if (!quitting) { e.preventDefault(); window?.hide() } })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#12181e"/><circle cx="16" cy="16" r="9" fill="none" stroke="#c7ed99" stroke-width="3"/></svg>')
    tray = new Tray(nativeImage.createFromDataURL('data:image/svg+xml;base64,' + svg.toString('base64')))
    tray.setToolTip('Omni · conversa e continuidade')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir Omni', click: show }, { label: 'Encerrar Omni', click: () => app.quit() }]))
    tray.on('click', show)
    register('snapshot', () => controller.snapshot())
    const checkForUpdate = async () => {
      await updates.check()
      await wait(350)
      const status = await updates.check()
      controller.setUpdateStatus(status)
      return status
    }
    const applyUpdate = async () => {
      await checkForUpdate()
      if (!updates.canApply()) throw new Error('Não há uma atualização local pronta para aplicar.')
      if (credentialIntake.hasPrivateContext || controller.executorAccess.hasGrants) {
        const detail = 'Há contexto privado temporário no Crachá. A atualização aguarda seu tratamento, descarte ou expiração para não apagá-lo.'
        controller.setUpdateStatus(updates.markBlocked(detail)); throw new Error(detail)
      }
      if (controller.active.size) {
        controller.setUpdateStatus(updates.markBlocked('Há uma resposta ou encaminhamento em andamento. Quando ele terminar, atualize sem interromper o trabalho.'))
        throw new Error('O Omni está trabalhando. Aguarde a resposta terminar para atualizar.')
      }
      await updates.recordApplying()
      controller.setUpdateStatus(updates.markApplying())
      credentialIntake.discard()
      await store.save()
      quitting = true
      app.relaunch()
      app.exit(0)
    }
    register('update-check', checkForUpdate)
    register('update-auto', async enabled => {
      if (typeof enabled !== 'boolean') throw new Error('Preferência de atualização inválida.')
      controller.setUpdateStatus(await updates.setAutoApply(enabled))
      if (enabled) {
        await checkForUpdate()
        if (updates.canApply() && !controller.active.size) await applyUpdate()
      }
      return controller.snapshot().state.update
    })
    register('update-apply', applyUpdate)
    register('create', async () => { const result = await store.create(root); controller.emit(); return result })
    register('vscode-workspace', async (workspace, title, sessionId) => {
      if (typeof workspace !== 'string' || typeof title !== 'string' || workspace.length > 1000 || title.length > 200) throw new Error('Projeto do VS Code inválido.')
      const target = resolve(workspace)
      return controller.openVsCodeConversation(target, title, sessionId === undefined ? undefined : id(sessionId))
    })
    register('delegate', (value, text) => { if (typeof text !== 'string') throw new Error('Mensagem inválida.'); return controller.delegate(id(value), text) })
    register('consume-task', value => controller.consumeTask(id(value)))
    register('release-result', value => controller.releaseResult(resultId(value)))
    register('attachment-preview', (conversationId, attachmentId) => controller.attachmentPreview(id(conversationId), id(attachmentId)))
    const documents = new DocumentWindows(join(import.meta.dirname, '../renderer/document.html'), join(import.meta.dirname, '../preload/document.cjs'), value => shell.openExternal(externalUrl(value)), process.env.ELECTRON_RENDERER_URL)
    register('document-open', (conversationId, reference) => documents.open(store.get(id(conversationId)).workspace, reference))
    register('acknowledge-returns', value => controller.acknowledgeReturns(id(value)))
    register('workspace', async value => {
      const c = store.get(id(value)); await controller.assertIdle(c)
      if (c.sessionId) throw new Error('Crie uma nova conversa para trocar de projeto e preservar a sessão atual.')
      const result = await dialog.showOpenDialog(window!, { title: 'Projeto do Omni', properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return
      c.workspace = resolve(result.filePaths[0]); await store.save(); controller.emit()
    })
    register('send', (value, text, channel) => { if (typeof text !== 'string') throw new Error('Mensagem inválida.'); return controller.send(id(value), text, channel === 'voice' ? 'voice' : 'text') })
    register('send-attachments', (value, text, channel, attachments, privateAttachmentId) => { if (typeof text !== 'string') throw new Error('Invalid message.'); return controller.send(id(value), text, channel === 'voice' ? 'voice' : 'text', attachments, privateAttachmentId === undefined ? undefined : id(privateAttachmentId)) })
    register('cancel', value => controller.cancel(id(value)))
    register('decide', (value, allow) => controller.decide(id(value), allow === true))
    register('editor-block', (value, allow) => controller.resolveEditorBlock(id(value), allow === true))
    register('sessions', value => controller.sessions(id(value)))
    register('resume', (value, sessionId) => controller.resume(id(value), id(sessionId)))
    register('editor', async value => { await shell.openExternal(await controller.handoff(id(value))) })
    register('credential-prepare', value => credentialIntake.prepare(value))
    register('credential-prepare-path', value => credentialIntake.prepareDocumentPath(value))
    register('credential-pick-document', async () => {
      const result = await dialog.showOpenDialog(window!, {
        title: 'Selecionar JSON privado para o Crachá',
        properties: ['openFile'],
        filters: [{ name: 'Documento JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePaths[0]) return null
      return credentialIntake.prepareDocumentPath(result.filePaths[0])
    })
    register('credential-pick-attachment', async conversationId => {
      const result = await dialog.showOpenDialog(window!, {
        title: 'Selecionar JSON privado para o Crachá',
        properties: ['openFile'],
        filters: [{ name: 'Documento JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePaths[0]) return null
      return credentialIntake.stageAttachmentPath(id(conversationId), result.filePaths[0])
    })
    register('credential-lookup', value => credentialIntake.lookup(value))
    register('credential-test', value => credentialIntake.test(value))
    register('credential-save', value => credentialIntake.save(value))
    register('credential-save-pending', value => credentialIntake.savePending(value))
    register('credential-discard', () => credentialIntake.discard())
    register('credential-attachment-stage', (conversationId, text) => credentialIntake.stageAttachment(id(conversationId), text))
    register('credential-attachment', conversationId => credentialIntake.attachmentInfo(id(conversationId)))
    register('credential-attachment-discard', conversationId => credentialIntake.discardAttachment(id(conversationId)))
    register('open-url', async value => { await shell.openExternal(externalUrl(value)) })
    register('voice', async value => { store.get(id(value)); return mintVoiceToken() })
    register('transcribe', transcribeAudio)
    register('hide', () => window?.hide())
    if (!globalShortcut.register('Control+Enter', () => window?.isVisible() && window.isFocused() ? window.hide() : show())) {
      tray.setToolTip('Omni · Ctrl+Enter está ocupado por outro aplicativo')
    }
    app.on('will-quit', () => globalShortcut.unregisterAll())
    if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(trustedUrl)
    else await window.loadFile(page)
    show()
    try {
      await controller.initialize()
      updates.setReleaseIdentity(await releaseIdentity())
      controller.setUpdateStatus(await updates.initialize())
    } catch { dialog.showErrorBox('Omni', 'Não foi possível abrir o histórico. Os arquivos existentes foram preservados.'); app.quit(); return }
    setInterval(() => void controller.refresh(), 15000).unref()
    setInterval(() => void (async () => {
      const status = await updates.check()
      if (status.autoApply && updates.canApply()) {
        if (credentialIntake.hasPrivateContext || controller.executorAccess.hasGrants) controller.setUpdateStatus(updates.markBlocked('Atualização aguardando: há contexto privado temporário ou referência de uso no Crachá. Ele não será descartado para reiniciar.'))
        else if (controller.active.size) controller.setUpdateStatus(updates.markBlocked('Atualização local pronta. Ela será aplicada assim que o Omni não estiver respondendo ou encaminhando trabalho.'))
        else await applyUpdate()
      } else controller.setUpdateStatus(status)
    })().catch(() => controller.setUpdateStatus(updates.markBlocked('Não foi possível aplicar a atualização automaticamente. Você pode tentar pelo botão Atualizar.'))), 5000).unref()
  }).catch(error => { dialog.showErrorBox('Omni', `Falha ao iniciar: ${error.name}`); app.quit() })
}
