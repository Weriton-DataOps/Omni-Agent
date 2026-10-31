'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// window.actions: a janela Actions lê a mesa e pede escritas ao main (que valida). O renderer não toca no disco.
contextBridge.exposeInMainWorld('actions', {
  listar: () => ipcRenderer.invoke('actions:listar'),
  ler: (slug) => ipcRenderer.invoke('actions:ler', String(slug)),
  mesa: () => ipcRenderer.invoke('actions:mesa'),
  veredito: (slug, dados) => ipcRenderer.invoke('actions:veredito', String(slug), {
    tipo: String(dados?.tipo || ''), motivo: String(dados?.motivo || ''), projeto: String(dados?.projeto || ''), ate: String(dados?.ate || ''),
  }),
  visto: (slug) => ipcRenderer.invoke('actions:visto', String(slug)),
  executar: (dados) => ipcRenderer.invoke('actions:executar', { slug: String(dados?.slug || ''), projeto: String(dados?.projeto || ''), instrucao: String(dados?.instrucao || '') }),
  responder: (id, texto) => ipcRenderer.invoke('actions:responder', String(id), String(texto || '')),
  reenviar: (id) => ipcRenderer.invoke('actions:reenviar', String(id)),
  execucaoVista: (id) => ipcRenderer.invoke('actions:execucao-vista', String(id)),
  aoTrocarAba: (cb) => { ipcRenderer.on('aba', (_e, aba) => cb(String(aba))); },
  item: (ref, acao) => ipcRenderer.invoke('actions:item', { arquivo: String(ref?.arquivo || ''), linha: Number(ref?.linha), bruto: String(ref?.bruto ?? '') }, String(acao)),
});
