'use strict';

// window.pareamento: a ponte da janela "Parear WhatsApp" (F2, plano 4c). Só três coisas: pedir um passo,
// cancelar o que roda e ouvir os eventos do pareador. O main confere o remetente e o passo; para cá só
// vem o evento já filtrado pela lista fechada do pareador, nunca o evento do Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pareamento', {
  iniciar: (passo) => ipcRenderer.invoke('whatsapp:parear-iniciar', String(passo ?? '')),
  cancelar: () => ipcRenderer.invoke('whatsapp:parear-cancelar'),
  aoEvento: (cb) => {
    ipcRenderer.on('whatsapp:pareamento', (_evento, e) => { if (e && typeof e === 'object') cb({ ...e }); });
  },
});
