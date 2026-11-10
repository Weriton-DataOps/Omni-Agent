'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// window.ilha: a ponte do renderer com o main. O renderer NÃO pode declarar um global chamado `ilha`
// (este nome é não-configurável); lá ele se chama `ponte`.
contextBridge.exposeInMainWorld('ilha', {
  // renderer → main (sem resposta: não esperam ida e volta)
  pronta: (medidas) => ipcRenderer.send('pronta', medidas),
  alvo: (retangulo) => ipcRenderer.send('alvo', retangulo),
  escape: (ligar) => ipcRenderer.send('escape', !!ligar),
  // main → renderer: só o dado, nunca o evento do Electron
  aoPonteiro: (cb) => { ipcRenderer.on('ponteiro', (_evento, dados) => cb({ dentro: !!dados?.dentro })); },
  aoCursor: (cb) => {
    ipcRenderer.on('cursor', (_evento, d) => {
      const x = Number(d?.x); const y = Number(d?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) cb({ x, y });
    });
  },
  aoTecla:(cb) => { ipcRenderer.on('tecla', (_evento, tecla) => cb(String(tecla))); },
  // o card Actions: abre o depósito (janela do Oráculo, pela casa) e pede o resumo; o do Oráculo abre o painel
  abrirActions: () => ipcRenderer.send('abrir-actions'),
  abrirOraculo: () => ipcRenderer.send('abrir-oraculo'),
  abrirOvercore: () => ipcRenderer.send('abrir-overcore'),
  resumoOvercore: () => ipcRenderer.invoke('overcore:resumo'),
  abrirCofre: () => ipcRenderer.send('abrir-cofre'),
  resumoCofre: () => ipcRenderer.invoke('cofre:resumo'),
  resumoOracle: () => ipcRenderer.invoke('oracle:resumo'),
  abrirChat: () => ipcRenderer.send('abrir-chat'),
  resumoActions: () => ipcRenderer.invoke('actions:resumo'),
  // card apagado: escolhe a pasta do agente e instala ({ ok, erro?, tarefas? })
  instalarAgente: (agente) => ipcRenderer.invoke('agente:instalar', String(agente)),
  // sessões do Claude Code: lista, passo a passo e a última edição (diff)
  sessoes: () => ipcRenderer.invoke('sessoes'),
  passos: (arquivo) => ipcRenderer.invoke('passos', arquivo),
  diff: (arquivo) => ipcRenderer.invoke('diff', arquivo),
  // a coluna de sistema e o card do WhatsApp
  sistema: () => ipcRenderer.invoke('sistema'),
  whatsapp: () => ipcRenderer.invoke('whatsapp'),
  abrirPareamento: () => ipcRenderer.send('abrir-pareamento'),
  fechar: () => ipcRenderer.invoke('fechar'),
});
