'use strict';

// O painel de sistema da ilha (21/10): o que o Gerenciador de Tarefas mostra de relance — memória, CPU,
// disco, há quanto tempo a máquina está ligada e quem está comendo a RAM. Sem admin e sem PowerShell:
// os.* para os números e um `tasklist` assíncrono, guardado por alguns segundos, para os processos.
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// CPU: o os só dá tempos acumulados por núcleo; o uso é a diferença entre duas leituras.
const tempos = () => os.cpus().reduce((a, c) => {
  const t = c.times;
  a.ocioso += t.idle;
  a.total += t.user + t.nice + t.sys + t.idle + t.irq;
  return a;
}, { ocioso: 0, total: 0 });
let amostra = tempos();
function usoCpu() {
  const agora = tempos();
  const antes = amostra;
  amostra = agora;
  const total = agora.total - antes.total;
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, 100 * (1 - (agora.ocioso - antes.ocioso) / total)));
}

// Processos: `tasklist /FO CSV /NH` → "nome.exe","pid","sessão","nº","123.456 K". A memória vem no formato
// do idioma do Windows (ponto ou vírgula de milhar), então só os dígitos contam.
const VALIDADE_MS = 8000;
let lista = [];
let lidoEm = 0;
let lendo = false;
function relerProcessos() {
  if (lendo) return;
  lendo = true;
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (erro, saida) => {
    lendo = false;
    if (erro) return;
    const nova = [];
    for (const linha of String(saida).split(/\r?\n/)) {
      const campos = [...linha.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      if (campos.length < 5) continue;
      const pid = Number(campos[1]);
      const kb = Number(campos[4].replace(/\D/g, ''));
      if (pid > 0) nova.push({ nome: campos[0], pid, kb: kb || 0 });
    }
    if (nova.length) { lista = nova; lidoEm = Date.now(); }
  });
}
function processos() {
  if (Date.now() - lidoEm > VALIDADE_MS) relerProcessos();
  return lista;
}
relerProcessos();

// Os mais pesados, agrupados por programa como o Gerenciador faz (vinte chrome.exe viram um "chrome").
function maisPesados(n) {
  const grupos = new Map();
  for (const p of processos()) {
    const nome = p.nome.replace(/\.exe$/i, '');
    const g = grupos.get(nome.toLowerCase()) || { nome, kb: 0, n: 0 };
    g.kb += p.kb;
    g.n += 1;
    grupos.set(nome.toLowerCase(), g);
  }
  return [...grupos.values()].sort((a, b) => b.kb - a.kb).slice(0, n)
    .map((g) => ({ nome: g.nome.slice(0, 40), mb: Math.round(g.kb / 1024), n: g.n }));
}

function disco(raiz) {
  try {
    const s = fs.statfsSync(raiz);
    return { raiz, total: s.blocks * s.bsize, livre: s.bavail * s.bsize };
  } catch { return null; }
}

function lerSistema(app) {
  let ilhaMb = null;
  try { ilhaMb = Math.round(app.getAppMetrics().reduce((s, m) => s + (m.memory?.workingSetSize || 0), 0) / 1024); } catch { /* sem métrica */ }
  return {
    maquina: os.hostname(),
    memoria: { total: os.totalmem(), livre: os.freemem() },
    cpu: usoCpu(),
    nucleos: os.cpus().length,
    disco: disco(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\'),
    ligadaHa: os.uptime(),
    processos: processos().length,
    pesados: maisPesados(4),
    ilhaMb,
  };
}

module.exports = { lerSistema, processos };
