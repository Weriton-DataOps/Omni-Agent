'use strict';

// Os projetos do Weriton (Documents\Actions\projetos.md): um bloco "## Nome" por projeto, com as linhas
// **Fase:**, **Dor do momento:**, **Plano de origem:**, **Ideias ligadas:** e a lista **Entregas:** de
// checkboxes "- [ ] entrega — dd/mm/aaaa". Item com "(proposto pelo Omni)" no fim ainda espera o ✓ dele.
//
// Fonte da verdade: projeto com **Plano de origem:** apontando para um .md com checkboxes é ESPELHADO —
// os itens vêm de lá e o check grava lá; a lista local fica vazia (nunca duas listas brigando). Plano de
// origem que sumiu ou não tem checkbox: o card avisa e fica só leitura.

const fs = require('fs');
const path = require('path');
const { RAIZ, dataMs, hojeMs } = require('./pontos');

const ARQUIVO = path.join(RAIZ, 'projetos.md');
const DIA = 86400e3;
const CHECK = /^(\s*)- \[([ xX])\]\s+(.*)$/;
const PROPOSTO = /\s*\(proposto pelo Omni\)\s*$/i;
const LIMITE = 512 * 1024;

function lerTexto(arquivo) {
  const st = fs.statSync(arquivo);
  if (!st.isFile() || st.size > LIMITE) throw new Error('arquivo inválido');
  return fs.readFileSync(arquivo, 'utf8');
}

// "texto — dd/mm/aaaa (proposto pelo Omni)" → partes
function lerItem(conteudo, agora) {
  const proposto = PROPOSTO.test(conteudo);
  const semMarca = conteudo.replace(PROPOSTO, '').trim();
  const m = /^(.*?)\s+—\s+(\d{2}\/\d{2}\/\d{4})\s*$/.exec(semMarca);
  const titulo = (m ? m[1] : semMarca).trim();
  const data = m ? m[2] : '';
  const ms = dataMs(data);
  return { titulo, data, proposto, dias: ms === null ? null : Math.round((ms - hojeMs(agora)) / DIA) };
}

function itensDe(linhas, inicio, fim, fonte, arquivo, agora) {
  const itens = [];
  for (let i = inicio; i < fim; i++) {
    const c = CHECK.exec(linhas[i]);
    if (!c) continue;
    itens.push({ fonte, arquivo, linha: i, bruto: linhas[i], feito: c[2] !== ' ', ...lerItem(c[3], agora) });
  }
  return itens;
}

// caminho do plano de origem: absoluto, ou relativo à pasta do Actions; "—" ou vazio = sem plano
function resolverOrigem(valor) {
  const v = String(valor || '').replace(/`/g, '').trim();
  if (!v || /^[—-]+$/.test(v)) return null;
  return path.resolve(RAIZ, v);
}

function lerProjetos(agora = Date.now()) {
  let texto;
  try { texto = lerTexto(ARQUIVO); } catch { return { arquivo: ARQUIVO, projetos: [] }; }
  const linhas = texto.split(/\r?\n/);
  const inicios = [];
  linhas.forEach((l, i) => { if (/^##\s+\S/.test(l)) inicios.push(i); });
  const projetos = inicios.map((ini, k) => {
    const fim = k + 1 < inicios.length ? inicios[k + 1] : linhas.length;
    const bloco = linhas.slice(ini, fim);
    const campo = (nome) => {
      const m = bloco.map((l) => new RegExp(`^\\*\\*${nome}:\\*\\*\\s*(.*)$`, 'i').exec(l)).find(Boolean);
      return m ? m[1].trim() : '';
    };
    const nome = linhas[ini].replace(/^##\s+/, '').trim();
    const origem = resolverOrigem(campo('Plano de origem'));
    const locais = itensDe(linhas, ini, fim, 'local', ARQUIVO, agora);
    let itens = locais;
    let aviso = '';
    let somenteLeitura = false;
    if (origem) {
      try {
        const lo = lerTexto(origem).split(/\r?\n/);
        const espelhados = itensDe(lo, 0, lo.length, 'origem', origem, agora);
        if (!espelhados.length) { aviso = 'o plano de origem não tem checklist'; somenteLeitura = true; }
        else {
          itens = espelhados;
          if (locais.length) aviso = 'há itens locais além do plano de origem; valem os do plano';
        }
      } catch { aviso = 'o plano de origem sumiu'; somenteLeitura = true; }
    }
    const datadas = itens.filter((i) => !i.feito && !i.proposto && i.dias !== null).sort((a, b) => a.dias - b.dias);
    const ideias = campo('Ideias ligadas').split(',').map((s) => s.trim().replace(/\s*\(.*\)$/, '')).filter((s) => s && !/^[—-]+$/.test(s));
    const pastaBruta = campo('Pasta').replace(/`/g, '').trim();
    return {
      nome,
      // onde o trabalho do projeto mora: o despacho do Actions procura sessão aberta nesta pasta
      pasta: pastaBruta && !/^[—-]+$/.test(pastaBruta) ? path.resolve(pastaBruta) : '',
      fase: campo('Fase'),
      dor: campo('Dor do momento'),
      origem,
      aviso,
      somenteLeitura,
      itens,
      ideias,
      proximo: datadas[0] || null,
      semData: !itens.some((i) => !i.proposto && i.dias !== null),
    };
  });
  return { arquivo: ARQUIVO, projetos };
}

module.exports = { lerProjetos, ARQUIVO, CHECK, PROPOSTO, resolverOrigem };
