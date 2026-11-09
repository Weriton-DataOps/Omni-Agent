'use strict';

// O Oracle visto da ilha (27/10). Só leitura e só do disco: os projetos que ele acompanha são os .md de
// Documents\Oracle\state (fora os que começam com _), e a última vigia é a última linha gravada em
// observability\history. Nada de rede nem de banco: o card mostra o que o Oracle já escreveu.

const fs = require('fs');
const path = require('path');

const ORACLE = process.env.OMNI_ORACLE_DIR || path.join(require('os').homedir(), 'Documents', 'Oracle');
const VIGIA_FRESCA_MS = 30 * 60e3; // leitura mais velha que isso é Oracle parado, não vigiando

function mtime(arquivo) {
  try { return fs.statSync(arquivo).mtimeMs; } catch { return 0; }
}

function resumo() {
  let projetos = [];
  try {
    projetos = fs.readdirSync(path.join(ORACLE, 'state'))
      .filter((n) => n.endsWith('.md') && !n.startsWith('_'))
      .map((n) => ({ nome: n.slice(0, -3), alteradoEm: mtime(path.join(ORACLE, 'state', n)) }))
      .sort((a, b) => b.alteradoEm - a.alteradoEm);
  } catch {
    return { ok: false, erro: 'Oracle não encontrado', projetos: [], ultimaVigia: 0 };
  }
  let ultimaVigia = 0;
  try {
    const hist = path.join(ORACLE, 'observability', 'history');
    for (const n of fs.readdirSync(hist)) ultimaVigia = Math.max(ultimaVigia, mtime(path.join(hist, n)));
  } catch { /* sem histórico: nunca vigiou */ }
  return { ok: true, vigiando: Date.now() - ultimaVigia < VIGIA_FRESCA_MS, ultimaVigia, total: projetos.length, projetos: projetos.slice(0, 3) };
}

module.exports = { resumo };
