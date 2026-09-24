import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi, Snapshot } from '../shared/contracts'
const api: DesktopApi = {
  openDocument: (conversationId, reference) => ipcRenderer.invoke('omni:document-open', conversationId, reference),
  attachmentPreview: (conversationId, attachmentId) => ipcRenderer.invoke('omni:attachment-preview', conversationId, attachmentId),
  snapshot: () => ipcRenderer.invoke('omni:snapshot'),
  create: () => ipcRenderer.invoke('omni:create'),
  openVsCodeWorkspace: (workspace, title, sessionId) => ipcRenderer.invoke('omni:vscode-workspace', workspace, title, sessionId),
  delegate: (id, text) => ipcRenderer.invoke('omni:delegate', id, text),
  consumeTask: id => ipcRenderer.invoke('omni:consume-task', id),
  releaseResult: id => ipcRenderer.invoke('omni:release-result', id),
  acknowledgeReturns: id => ipcRenderer.invoke('omni:acknowledge-returns', id),
  chooseWorkspace: id => ipcRenderer.invoke('omni:workspace', id),
  send: (id, text, channel, attachments, privateAttachmentId) => ipcRenderer.invoke('omni:send-attachments', id, text, channel, attachments, privateAttachmentId),
  cancel: id => ipcRenderer.invoke('omni:cancel', id),
  decide: (id, allow) => ipcRenderer.invoke('omni:decide', id, allow),
  resolveEditorBlock: (requestId, allow) => ipcRenderer.invoke('omni:editor-block', requestId, allow),
  openEditor: id => ipcRenderer.invoke('omni:editor', id),
  listSessions: id => ipcRenderer.invoke('omni:sessions', id),
  resume: (id, sessionId) => ipcRenderer.invoke('omni:resume', id, sessionId),
  voiceToken: id => ipcRenderer.invoke('omni:voice', id),
  transcribe: audio => ipcRenderer.invoke('omni:transcribe', audio),
  prepareCredential: text => ipcRenderer.invoke('omni:credential-prepare', text),
  prepareCredentialPath: path => ipcRenderer.invoke('omni:credential-prepare-path', path),
  pickCredentialDocument: () => ipcRenderer.invoke('omni:credential-pick-document'),
  pickCredentialAttachment: conversationId => ipcRenderer.invoke('omni:credential-pick-attachment', conversationId),
  lookupCredentials: text => ipcRenderer.invoke('omni:credential-lookup', text),
  testCredential: id => ipcRenderer.invoke('omni:credential-test', id),
  saveCredential: id => ipcRenderer.invoke('omni:credential-save', id),
  savePendingCredential: id => ipcRenderer.invoke('omni:credential-save-pending', id),
  discardCredentials: () => ipcRenderer.invoke('omni:credential-discard'),
  stageCredentialAttachment: (conversationId, text) => ipcRenderer.invoke('omni:credential-attachment-stage', conversationId, text),
  credentialAttachment: conversationId => ipcRenderer.invoke('omni:credential-attachment', conversationId),
  discardCredentialAttachment: conversationId => ipcRenderer.invoke('omni:credential-attachment-discard', conversationId),
  openUrl: url => ipcRenderer.invoke('omni:open-url', url),
  hide: () => ipcRenderer.invoke('omni:hide'),
  checkForUpdate: () => ipcRenderer.invoke('omni:update-check'),
  setAutoUpdate: enabled => ipcRenderer.invoke('omni:update-auto', enabled),
  applyUpdate: () => ipcRenderer.invoke('omni:update-apply'),
  onChange: callback => {
    const handler = (_event: unknown, value: Snapshot) => callback(value)
    ipcRenderer.on('omni:change', handler)
    return () => { ipcRenderer.removeListener('omni:change', handler) }
  }
}
contextBridge.exposeInMainWorld('omni', api)
