import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readMarkdownDocument } from './markdown-document'
import type { MarkdownDocument } from '../shared/document-reference'

type Entry = { window: BrowserWindow; document: MarkdownDocument }
export class DocumentWindows {
  private entries = new Map<string, Entry>()
  private url: string
  constructor(private page: string, private preload: string, private openUrl: (value: unknown) => Promise<void>, devUrl?: string) {
    this.url = devUrl ? new URL('document.html', devUrl).href : pathToFileURL(page).href
    ipcMain.handle('omni-document:read', async event => {
      const entry = this.sender(event)
      const fragment = entry.document.fragment
      entry.document = { ...await readMarkdownDocument(entry.document.workspace, entry.document.path), fragment }
      return entry.document
    })
    ipcMain.handle('omni-document:open', (event, reference: unknown) => {
      const { document } = this.sender(event)
      return this.open(document.workspace, reference, dirname(document.path))
    })
    ipcMain.handle('omni-document:url', (event, url: unknown) => { this.sender(event); return this.openUrl(url) })
  }
  private sender(event: IpcMainInvokeEvent): Entry {
    const entry = [...this.entries.values()].find(item => item.window.webContents === event.sender)
    if (!entry || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== this.url) throw new Error('Origem inválida.')
    return entry
  }
  async open(workspace: string, reference: unknown, base?: string) {
    const document = await readMarkdownDocument(workspace, reference, base)
    const key = document.workspace + '\0' + document.path
    const existing = this.entries.get(key)
    if (existing && !existing.window.isDestroyed()) {
      existing.document = document
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.show(); existing.window.focus()
      await existing.window.webContents.reload()
      return
    }
    const window = new BrowserWindow({ title: `${document.name} · Omni`, width: 1000, height: 800, minWidth: 560, minHeight: 420, show: false, backgroundColor: '#101317',
      webPreferences: { preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'omni-documents' } })
    this.entries.set(key, { window, document })
    window.setMenuBarVisibility(false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.on('closed', () => this.entries.delete(key))
    window.once('ready-to-show', () => { window.show(); window.focus() })
    try { await window.loadURL(this.url) }
    catch (error) { window.destroy(); throw error }
  }
}
