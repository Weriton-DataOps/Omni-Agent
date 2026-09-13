import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi, Snapshot } from '../shared/contracts'
const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('omni:snapshot'),
  create: () => ipcRenderer.invoke('omni:create'),
  openVsCodeWorkspace: (workspace, title, sessionId) => ipcRenderer.invoke('omni:vscode-workspace', workspace, title, sessionId),
  delegate: (id, text) => ipcRenderer.invoke('omni:delegate', id, text),
  consumeTask: id => ipcRenderer.invoke('omni:consume-task', id),
  acknowledgeReturns: id => ipcRenderer.invoke('omni:acknowledge-returns', id),
  chooseWorkspace: id => ipcRenderer.invoke('omni:workspace', id),
  send: (id, text, channel, attachments) => ipcRenderer.invoke(attachments?.length ? 'omni:send-attachments' : 'omni:send', id, text, channel, attachments),
  cancel: id => ipcRenderer.invoke('omni:cancel', id),
  decide: (id, allow) => ipcRenderer.invoke('omni:decide', id, allow),
  openEditor: id => ipcRenderer.invoke('omni:editor', id),
  listSessions: id => ipcRenderer.invoke('omni:sessions', id),
  resume: (id, sessionId) => ipcRenderer.invoke('omni:resume', id, sessionId),
  voiceToken: id => ipcRenderer.invoke('omni:voice', id),
  transcribe: audio => ipcRenderer.invoke('omni:transcribe', audio),
  prepareCredential: text => ipcRenderer.invoke('omni:credential-prepare', text),
  testCredential: id => ipcRenderer.invoke('omni:credential-test', id),
  saveCredential: id => ipcRenderer.invoke('omni:credential-save', id),
  discardCredentials: () => ipcRenderer.invoke('omni:credential-discard'),
  openUrl: url => ipcRenderer.invoke('omni:open-url', url),
  hide: () => ipcRenderer.invoke('omni:hide'),
  onChange: callback => {
    const handler = (_event: unknown, value: Snapshot) => callback(value)
    ipcRenderer.on('omni:change', handler)
    return () => { ipcRenderer.removeListener('omni:change', handler) }
  }
}
contextBridge.exposeInMainWorld('omni', api)
