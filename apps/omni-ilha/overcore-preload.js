'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// window.overcore: a janela do Overcore só lê e pede ações ao main. O token do Overcore nunca chega aqui.
contextBridge.exposeInMainWorld('overcore', {
  lista: () => ipcRenderer.invoke('overcore:lista'),
  acao: (acao, id) => ipcRenderer.invoke('overcore:acao', String(acao), String(id)),
  ligar: () => ipcRenderer.invoke('overcore:ligar'),
});
