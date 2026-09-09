import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi, Snapshot } from '../shared/contracts'
const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('omni:snapshot'),
  create: () => ipcRenderer.invoke('omni:create'),
  delegate: (id, text) => ipcRenderer.invoke('omni:delegate', id, text),
  chooseWorkspace: id => ipcRenderer.invoke('omni:workspace', id),
  send: (id, text, channel) => ipcRenderer.invoke('omni:send', id, text, channel),
  cancel: id => ipcRenderer.invoke('omni:cancel', id),
  decide: (id, allow) => ipcRenderer.invoke('omni:decide', id, allow),
  openEditor: id => ipcRenderer.invoke('omni:editor', id),
  listSessions: id => ipcRenderer.invoke('omni:sessions', id),
  resume: (id, sessionId) => ipcRenderer.invoke('omni:resume', id, sessionId),
  voiceToken: id => ipcRenderer.invoke('omni:voice', id),
  transcribe: audio => ipcRenderer.invoke('omni:transcribe', audio),
  hide: () => ipcRenderer.invoke('omni:hide'),
  onChange: callback => {
    const handler = (_event: unknown, value: Snapshot) => callback(value)
    ipcRenderer.on('omni:change', handler)
    return () => { ipcRenderer.removeListener('omni:change', handler) }
  }
}
contextBridge.exposeInMainWorld('omni', api)
