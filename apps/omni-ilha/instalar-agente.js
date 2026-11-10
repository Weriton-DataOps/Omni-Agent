'use strict';

// O botão INSTALAR do card apagado (F2, plano 5c). A ilha não instala nada sozinha: confere que a pasta
// escolhida é do agente do card, chama o executor da versão em uso (instalar-agente: requisitos, tokens no
// cofre, aceite do agente e registro no núcleo) e, só se ele aceitou, registra as tarefas agendadas dos
// agentes pelo mesmo omni-tarefas.ps1 do instalador. Os dois filhos rodam com o Node do sistema e sem o
// modo Node do Electron, que a ilha herdaria do terminal do VS Code.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const LIMITE_EXECUTOR = 180000;
const LIMITE_TAREFAS = 120000;
const TETO = 256 * 1024;

function rodar(spawn, comando, args, env, ms) {
  return new Promise((resolver) => {
    const saida = []; const erro = [];
    let tamanho = 0; let acabou = false; let filho;
    const acabar = (r) => { if (!acabou) { acabou = true; clearTimeout(prazo); resolver(r); } };
    const prazo = setTimeout(() => { try { filho.kill(); } catch { /* já saiu */ } acabar({ codigo: null, motivo: `não respondeu em ${ms / 1000} s` }); }, ms);
    try {
      filho = spawn(comando, args, { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { acabar({ codigo: null, motivo: `não consegui abrir ${comando}` }); return; }
    const juntar = (lista) => (pedaco) => { tamanho += pedaco.length; if (tamanho <= TETO) lista.push(pedaco); };
    filho.stdout.on('data', juntar(saida));
    filho.stderr.on('data', juntar(erro));
    filho.once('error', () => acabar({ codigo: null, motivo: `não consegui abrir ${comando}` }));
    filho.once('close', (codigo) => acabar({ codigo, stdout: Buffer.concat(saida).toString('utf8'), stderr: Buffer.concat(erro).toString('utf8') }));
  });
}

function ultimoJson(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    try { const v = JSON.parse(linhas[i]); if (v && typeof v === 'object') return v; } catch { /* linha de log */ }
  }
  return null;
}

const primeiraLinha = (texto) => String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';

function porque(r, quem) {
  const json = ultimoJson(r.stdout);
  if (json && typeof json.erro === 'string' && json.erro) return json.erro;
  return r.motivo ? `${quem} ${r.motivo}` : primeiraLinha(r.stderr) || `${quem} saiu com ${r.codigo}`;
}

async function instalarAgente({ agente, pasta, raizOmni, env = process.env, spawn = childProcess.spawn, prefixo = 'Omni' }) {
  if (!pasta) return { ok: false, erro: 'nenhuma pasta escolhida' };
  let manifesto;
  try { manifesto = JSON.parse(fs.readFileSync(path.join(pasta, 'executor', 'agente.json'), 'utf8')); } catch { manifesto = null; }
  if (!manifesto || typeof manifesto !== 'object') return { ok: false, erro: `${pasta} não tem um executor/agente.json legível` };
  if (manifesto.agente !== agente) return { ok: false, erro: `a pasta é do agente ${manifesto.agente ?? 'sem nome'}, não do ${agente}` };

  const envFilho = { ...env };
  delete envFilho.ELECTRON_RUN_AS_NODE;
  const node = env.OMNI_NODE || 'node';

  const ex = await rodar(spawn, node, [path.join(raizOmni, 'runtime', 'executor.mjs'), 'instalar-agente', '--raiz', pasta], envFilho, LIMITE_EXECUTOR);
  const instalado = ultimoJson(ex.stdout);
  if (ex.codigo !== 0 || !instalado || instalado.ok !== true) return { ok: false, erro: porque(ex, 'o executor') };

  const ps1 = path.join(raizOmni, 'scripts', 'omni-tarefas.ps1');
  const tr = await rodar(spawn, 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Modo', 'registrar', '-Prefixo', prefixo, '-Raiz', raizOmni], envFilho, LIMITE_TAREFAS);
  const tarefas = ultimoJson(tr.stdout);
  if (tr.codigo !== 0 || !tarefas || tarefas.ok !== true) {
    return { ok: false, instalado: true, erro: `o ${agente} instalou, mas as tarefas não: ${porque(tr, 'o omni-tarefas.ps1')}` };
  }
  return { ok: true, agente: instalado.agente, versao: instalado.versao, tarefas: Array.isArray(tarefas.registradas) ? tarefas.registradas : [] };
}

module.exports = { instalarAgente };
