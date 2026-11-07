'use strict';

// window.cofre: a ponte da janela do cofre (F1, plano 5, T6). Só os canais cofre:*, e cada argumento sai
// convertido: texto vira String, os dados do cadastro só levam os campos do cadastro, as mudanças da edição
// saem como objeto simples. O main confere o remetente e o resto (cofre-ipc.js).
const { contextBridge, ipcRenderer } = require('electron');

const texto = (v) => String(v ?? '');
const CAMPOS_DO_CADASTRO = ['nome', 'tipo', 'servico', 'url', 'usuario', 'notas', 'agentes'];
const doCadastro = (dados) => Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, texto(dados?.[c])]));
const mudancas = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? JSON.parse(JSON.stringify(m)) : {});

contextBridge.exposeInMainWorld('cofre', {
  listar: () => ipcRenderer.invoke('cofre:listar'),
  lixeira: () => ipcRenderer.invoke('cofre:lixeira'),
  esvaziar: () => ipcRenderer.invoke('cofre:esvaziar'),
  saude: (duplicatas) => ipcRenderer.invoke('cofre:saude', duplicatas === true),
  historico: (id) => ipcRenderer.invoke('cofre:historico', texto(id)),
  testar: (nome) => ipcRenderer.invoke('cofre:testar', texto(nome)),
  cadastrar: (dados, valor) => ipcRenderer.invoke('cofre:cadastrar', doCadastro(dados), texto(valor)),
  cadastrarDaArea: (dados) => ipcRenderer.invoke('cofre:cadastrar-da-area', doCadastro(dados)),
  editar: (nome, m) => ipcRenderer.invoke('cofre:editar', texto(nome), mudancas(m)),
  rotacionar: (nome, valor) => ipcRenderer.invoke('cofre:rotacionar', texto(nome), texto(valor)),
  rotacionarDaArea: (nome) => ipcRenderer.invoke('cofre:rotacionar-da-area', texto(nome)),
  apagar: (nome) => ipcRenderer.invoke('cofre:apagar', texto(nome)),
  restaurar: (id) => ipcRenderer.invoke('cofre:restaurar', texto(id)),
  revelar: (nome) => ipcRenderer.invoke('cofre:revelar', texto(nome)),
  copiar: (nome) => ipcRenderer.invoke('cofre:copiar', texto(nome)),
});
