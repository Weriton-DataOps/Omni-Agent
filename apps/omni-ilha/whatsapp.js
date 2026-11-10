'use strict';

// O card "Omni WhatsApp" da ilha (21/10): se o serviço e a ponte estão de pé, se a ponte está pausada e o
// movimento do dia. Lê arquivos de %APPDATA%\omni\whatsapp e nenhum conteúdo de mensagem (o ponte.log já
// não guarda conteúdo: só ids, tipos e tamanhos). Conexões, chaves, crédito e contagem pela API vêm do
// saude.json, que a sonda servicos\whatsapp\omni\saude.mjs grava num processo à parte: a ilha não abre
// cofre nem segura chave, só dispara a sonda (uma por vez) quando o arquivo passa de 1 min.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { vistaPareamento } = require('./whatsapp-vista');

const RUN = path.join(process.env.APPDATA || '', 'omni', 'whatsapp');
const CAUDA = 64 * 1024;
const SONDA = path.join(__dirname, '..', '..', 'servicos', 'whatsapp', 'omni', 'saude.mjs');
const SONDA_A_CADA = 60e3;
const SAUDE_VELHA = 3 * 60e3;
let sondando = false;

// O electron da ilha vira node com ELECTRON_RUN_AS_NODE: não depende de node no PATH.
function sondar() {
  if (sondando || !fs.existsSync(SONDA)) return;
  sondando = true;
  try {
    const filho = spawn(process.execPath, [SONDA], {
      cwd: path.dirname(SONDA), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const fim = () => { sondando = false; };
    filho.once('exit', fim);
    filho.once('error', fim);
    setTimeout(() => { if (sondando) { try { filho.kill(); } catch { /* já saiu */ } } }, 90e3).unref();
  } catch { sondando = false; }
}

function lerSaude() {
  let saude = null;
  try { saude = JSON.parse(fs.readFileSync(path.join(RUN, 'saude.json'), 'utf8')); } catch { /* ainda não sondou */ }
  const idade = saude ? Date.now() - Date.parse(saude.em) : Infinity;
  if (!(idade < SONDA_A_CADA)) sondar();
  if (!saude) return null;
  // a contagem é "de hoje": sonda de ontem não vale para o total
  const meiaNoite = new Date();
  meiaNoite.setHours(0, 0, 0, 0);
  if (Date.parse(saude.em) < meiaNoite.getTime()) saude.mensagens = null;
  saude.velha = !(idade < SAUDE_VELHA);
  return saude;
}

// O PID do arquivo só conta se o processo existe E é node: PID reciclado por outro programa não é ponte viva.
function vivo(arquivoPid, processos) {
  try {
    const pid = Number(fs.readFileSync(path.join(RUN, arquivoPid), 'utf8').trim());
    if (!(pid > 0)) return false;
    const p = processos.find((x) => x.pid === pid);
    return !!p && /^node(\.exe)?$/i.test(p.nome);
  } catch { return false; }
}

function cauda(arquivo) {
  let fd = null;
  try {
    fd = fs.openSync(arquivo, 'r');
    const tamanho = fs.fstatSync(fd).size;
    const n = Math.min(CAUDA, tamanho);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, tamanho - n);
    return buf.toString('utf8');
  } catch { return ''; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* já fechado */ } }
}

function lerWhatsapp(processos) {
  if (!fs.existsSync(RUN)) return { instalado: false, vista: vistaPareamento({ instalado: false }) };
  let pausada = false;
  try { pausada = !!JSON.parse(fs.readFileSync(path.join(RUN, 'ponte.json'), 'utf8')).pausada; } catch { /* sem estado */ }
  let vozAte = null;
  try {
    const ate = Date.parse(JSON.parse(fs.readFileSync(path.join(RUN, 'openai-sem-credito.json'), 'utf8')).ate);
    if (ate > Date.now()) vozAte = ate;
  } catch { /* com crédito */ }

  // linhas do log: "<ISO> ← id (...)" recebida do dono, "<ISO> → id (...)" enviada a ele
  const meiaNoite = new Date();
  meiaNoite.setHours(0, 0, 0, 0);
  let recebidas = 0;
  let enviadas = 0;
  let ultima = null;
  for (const linha of cauda(path.join(RUN, 'logs', 'ponte.log')).split('\n')) {
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (←|→) /.exec(linha);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (!(t > 0)) continue;
    if (!ultima || t > ultima) ultima = t;
    if (t < meiaNoite.getTime()) continue;
    if (m[2] === '←') recebidas += 1; else enviadas += 1;
  }

  // plano 4c: o que já foi pareado e provado (pareamento.json não tem chave nem número inteiro)
  let pareamento = null;
  try { pareamento = JSON.parse(fs.readFileSync(path.join(RUN, 'pareamento.json'), 'utf8')); } catch { /* ainda não fechou */ }

  const w = {
    instalado: true,
    servico: vivo('servico.pid', processos),
    ponte: vivo('ponte.pid', processos),
    pausada,
    recebidas,
    enviadas,
    ultima,
    vozAte,
    ids: { pessoal: fs.existsSync(path.join(RUN, 'sessao.id')), bot: fs.existsSync(path.join(RUN, 'sessao-bot.id')) },
    pareamento,
    saude: lerSaude(),
  };
  w.vista = vistaPareamento(w);
  return w;
}

module.exports = { lerWhatsapp };
