import { contextBridge, ipcRenderer } from 'electron'
import type { DocumentReaderApi } from '../shared/document-reference'
const api: DocumentReaderApi = {
  read: () => ipcRenderer.invoke('omni-document:read'),
  openReference: reference => ipcRenderer.invoke('omni-document:open', reference),
  openUrl: url => ipcRenderer.invoke('omni-document:url', url)
}
contextBridge.exposeInMainWorld('omniDocument', api)
