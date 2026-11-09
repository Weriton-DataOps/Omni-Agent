'use strict';

// O Overcore visto da ilha (22/10). A ilha não segura o token do Overcore: quem fala com a API é
// scripts/omni-overcore.mjs, num processo à parte (o electron vira node, como na sonda do WhatsApp). Aqui
// fica o último retrato, renovado no máximo a cada 4 s, e as ações (retomar, cancelar, ligar).

const { spawn } = require('child_process');
const path = require('path');

const OMNI = path.join(__dirname, '..', '..');
const MAO = path.join(OMNI, 'scripts', 'omni-overcore.mjs');
const OVERCORE = process.env.OMNI_OVERCORE_DIR || path.join(require('os').homedir(), 'Documents', 'Overcore');
const LANCADOR = path.join(OVERCORE, 'scripts', 'start-local.mjs');
const RENOVA_MS = 4000;

let retrato = { ok: false, desligado: true, erro: 'ainda não lido', executions: [], lidoEm: 0 };
let lendo = null;

function rodar(args, ms = 15000) {
  return new Promise((resolve) => {
    let saida = '';
    let filho;
    try {
      filho = spawn(process.execPath, [MAO, ...args], { cwd: OMNI, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    } catch (e) { resolve({ ok: false, erro: String(e.message || e) }); return; }
    const limite = setTimeout(() => { try { filho.kill(); } catch { /* já saiu */ } resolve({ ok: false, erro: 'a consulta ao Overcore travou' }); }, ms);
    filho.stdout.on('data', (d) => { saida += d; });
    filho.once('error', (e) => { clearTimeout(limite); resolve({ ok: false, erro: String(e.message || e) }); });
    filho.once('close', () => { clearTimeout(limite); try { resolve(JSON.parse(saida)); } catch { resolve({ ok: false, erro: 'resposta ilegível da consulta' }); } });
  });
}

// devolve o retrato atual e, se estiver velho, renova em segundo plano (quem pede de novo já vê o novo)
function lerOvercore() {
  if (!lendo && Date.now() - retrato.lidoEm > RENOVA_MS) {
    lendo = rodar(['execucoes']).then((r) => { retrato = { executions: [], ...r, lidoEm: Date.now() }; }).finally(() => { lendo = null; });
  }
  return retrato;
}
async function lerAgora() { lerOvercore(); if (lendo) await lendo; return retrato; }

function resumo() {
  const r = lerOvercore();
  const ex = r.executions || [];
  const ativos = ex.filter((e) => !e.terminal && e.state !== 'blocked');
  const pedem = ex.filter((e) => e.needsAnswer);
  return {
    ok: !!r.ok, desligado: !!r.desligado, erro: r.ok ? '' : r.erro || '', total: ex.length,
    rodando: ativos.length, bloqueadas: pedem.length,
    concluidas: ex.filter((e) => e.terminal).length,
    ultima: ex.reduce((m, e) => (e.lastActivityAt && e.lastActivityAt > m ? e.lastActivityAt : m), ''),
    linhas: [...pedem, ...ativos, ...ex.filter((e) => e.terminal)].slice(0, 3).map((e) => ({ titulo: String(e.title || '').slice(0, 90), estado: e.state, pede: !!e.needsAnswer, ultima: e.lastActivityAt })),
    // as pílulas da coluna da direita (27/10): só o que não terminou, ativo ou ocioso; quem pede ele primeiro
    sessoes: [...pedem, ...ex.filter((e) => !e.terminal && !e.needsAnswer)].slice(0, 12).map((e) => ({ id: e.id, titulo: String(e.title || '').slice(0, 90), estado: e.state, pede: !!e.needsAnswer })),
  };
}

async function agir(acao, id) {
  if (!['retomar', 'cancelar', 'detalhe'].includes(acao)) return { ok: false, erro: 'ação desconhecida' };
  const r = await rodar([acao, String(id)]);
  if (acao !== 'detalhe') { retrato.lidoEm = 0; lerOvercore(); }
  return r;
}

// liga o Overcore pelo lançador dele (sobe o provedor de autoridade do Omni + o runtime). Destacado e
// escondido: sobrevive à ilha. Precisa de OVERCORE_DATABASE_URL no ambiente do usuário.
function ligar() {
  if (retrato.ok) return { ok: true, aviso: 'já está ligado' };
  if (!process.env.OVERCORE_DATABASE_URL) return { ok: false, erro: 'falta OVERCORE_DATABASE_URL no ambiente do usuário' };
  try {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const p = spawn(process.execPath, [LANCADOR, OMNI], { cwd: OVERCORE, windowsHide: true, detached: true, stdio: 'ignore', env });
    p.unref();
    retrato.lidoEm = 0;
    return { ok: true, aviso: 'ligando; leva uns 20 s' };
  } catch (e) { return { ok: false, erro: String(e.message || e) }; }
}

module.exports = { lerOvercore, lerAgora, resumo, agir, ligar };
