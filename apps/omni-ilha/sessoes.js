// Leitura das sessões do Claude Code a partir dos transcripts .jsonl.
// Só lê o fim de cada arquivo: alguns passam de 80 MB.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(os.homedir(), '.claude', 'projects');
const JANELA_MS = 3 * 60 * 60 * 1000;   // sessões com escrita nas últimas 3 h
const PERMISSAO_MS = 45 * 1000;         // ferramenta parada há mais que isso: provável pedido de permissão
const OCIOSA_MS = 10 * 60 * 1000;
const MAX_SESSOES = 8;

function cauda(arquivo, bytes) {
  const st = fs.statSync(arquivo);
  const n = Math.min(st.size, bytes);
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, st.size - n);
    const linhas = buf.toString('utf8').split('\n');
    if (n < st.size) linhas.shift(); // a primeira pode estar cortada
    return linhas.filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

function json(linha) {
  try { return JSON.parse(linha); } catch { return null; }
}

function textoDe(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n');
}

function curto(texto, max) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function resumoFerramenta(item) {
  const i = item.input || {};
  const alvo = i.file_path ? path.basename(String(i.file_path))
    : i.command ? curto(i.command, 60)
    : i.pattern ? curto(i.pattern, 50)
    : i.description ? curto(i.description, 60)
    : i.url ? curto(i.url, 60)
    : '';
  return alvo ? `${item.name} · ${alvo}` : String(item.name || 'ferramenta');
}

// Texto que o usuário "falou": ignora contexto injetado por hooks e mensagens de sistema.
function falaHumana(content) {
  const t = textoDe(content).trim();
  if (!t) return null;
  if (t.startsWith('<cross-session-message')) return { tipo: 'sessao', texto: 'mensagem de outra sessão' };
  if (t.startsWith('<')) return null;
  return { tipo: 'voce', texto: t };
}

// Nome pela pasta do projeto (onde a sessão nasceu); o cwd muda quando a sessão entra em subpastas.
function nomeProjeto(cwd, pasta) {
  const m = pasta.match(/Documents-(.+)$/);
  if (m) return m[1];
  return cwd ? path.basename(cwd) : pasta;
}

function analisar(arquivo, mtimeMs) {
  const linhas = cauda(arquivo, 256 * 1024);
  let ultimo = null;
  let pedido = '';
  let cwd = '';
  for (let k = linhas.length - 1; k >= 0; k--) {
    const o = json(linhas[k]);
    if (!o) continue;
    if (!cwd && o.cwd) cwd = o.cwd;
    if (!pedido && o.type === 'last-prompt' && o.lastPrompt) pedido = o.lastPrompt;
    if (!ultimo && !o.isSidechain && (o.type === 'assistant' || o.type === 'user') && o.message) ultimo = o;
    if (ultimo && cwd && pedido) break;
  }

  const idade = Date.now() - mtimeMs;
  let estado = 'ociosa';
  let fazendo = '';

  if (ultimo && ultimo.type === 'assistant') {
    const c = Array.isArray(ultimo.message.content) ? ultimo.message.content : [];
    const ferramenta = [...c].reverse().find((x) => x && x.type === 'tool_use');
    if (ferramenta && ultimo.message.stop_reason !== 'end_turn') {
      if (idade > PERMISSAO_MS) {
        estado = 'espera';
        fazendo = `parada em ${resumoFerramenta(ferramenta)} — pode estar pedindo permissão`;
      } else {
        estado = 'rodando';
        fazendo = resumoFerramenta(ferramenta);
      }
    } else {
      const texto = textoDe(c).trim();
      const pergunta = /\?/.test(texto.slice(-280));
      if (pergunta) {
        estado = 'espera';
        fazendo = 'perguntou: ' + curto(texto.slice(-200), 110);
      } else {
        estado = idade < OCIOSA_MS ? 'concluiu' : 'ociosa';
        fazendo = curto(texto, 110) || 'turno encerrado';
      }
    }
  } else if (ultimo && ultimo.type === 'user') {
    const fala = falaHumana(ultimo.message.content);
    estado = idade < OCIOSA_MS ? 'rodando' : 'ociosa';
    fazendo = fala ? (fala.tipo === 'sessao' ? 'recebeu mensagem de outra sessão' : 'recebeu seu pedido') : 'processando resultado de ferramenta';
  }

  return {
    arquivo,
    projeto: nomeProjeto(cwd, path.basename(path.dirname(arquivo))),
    id: path.basename(arquivo, '.jsonl').slice(0, 8),
    estado,
    fazendo,
    pedido: curto(pedido, 140),
    idadeMs: idade,
  };
}

const ORDEM = { espera: 0, rodando: 1, concluiu: 2, ociosa: 3 };

// O nome que as sessões usam entre si ("overcore-3e", "omni-a0") mora em ~/.claude/sessions/<pid>.json,
// junto com a pasta e o pipe de mensagens. Só valem as de processo vivo. É o nome que o Weriton usa
// para dizer "manda para a overcore-3e" — por isso a ilha mostra ele na pílula.
const REGISTRO = path.join(os.homedir(), '.claude', 'sessions');
function vivo(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function registroDeSessoes() {
  const mapa = new Map();
  let nomes = [];
  try { nomes = fs.readdirSync(REGISTRO).filter((n) => /^\d+\.json$/.test(n)); } catch { return mapa; }
  for (const n of nomes) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(REGISTRO, n), 'utf8'));
      if (j.sessionId && j.name && vivo(Number(j.pid))) {
        mapa.set(String(j.sessionId), { nome: String(j.name), cwd: String(j.cwd || ''), status: String(j.status || ''), pid: Number(j.pid), kind: String(j.kind || ''), startedAt: Number(j.startedAt) || 0 });
      }
    } catch { /* arquivo no meio da escrita */ }
  }
  return mapa;
}

function lerSessoes() {
  const agora = Date.now();
  const achados = [];
  let pastas = [];
  try { pastas = fs.readdirSync(RAIZ, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  for (const p of pastas) {
    const dir = path.join(RAIZ, p.name);
    let arquivos = [];
    try { arquivos = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of arquivos) {
      const f = path.join(dir, n);
      try {
        const st = fs.statSync(f);
        if (agora - st.mtimeMs <= JANELA_MS) achados.push({ f, m: st.mtimeMs });
      } catch { /* arquivo sumiu no meio da leitura */ }
    }
  }
  achados.sort((a, b) => b.m - a.m);
  const sessoes = [];
  const registro = registroDeSessoes();
  for (const a of achados.slice(0, MAX_SESSOES)) {
    try {
      const s = analisar(a.f, a.m);
      s.nome = registro.get(path.basename(a.f, '.jsonl'))?.nome || '';
      sessoes.push(s);
    } catch { /* transcript ilegível: ignora */ }
  }
  sessoes.sort((a, b) => (ORDEM[a.estado] - ORDEM[b.estado]) || (a.idadeMs - b.idadeMs));
  return sessoes;
}

// Sessões vivas e interativas (as do VS Code), para o despacho do Actions escolher onde o trabalho mora.
function sessoesVivas() {
  return [...registroDeSessoes().entries()].map(([sessionId, s]) => ({ sessionId, ...s })).filter((s) => s.kind === 'interactive');
}

// Só aceita transcript dentro de ~/.claude/projects.
function transcript(arquivo) {
  const alvo = path.resolve(String(arquivo || ''));
  return alvo.startsWith(RAIZ + path.sep) && alvo.endsWith('.jsonl') ? alvo : null;
}

// Passo a passo recente de uma sessão.
function lerPassos(arquivo) {
  const alvo = transcript(arquivo);
  if (!alvo) return [];
  const passos = [];
  for (const l of cauda(alvo, 512 * 1024)) {
    const o = json(l);
    if (!o || o.isSidechain || !o.message) continue;
    const hora = o.timestamp ? new Date(o.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    if (o.type === 'assistant' && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c.type === 'text' && c.text && c.text.trim()) passos.push({ hora, tipo: 'texto', texto: curto(c.text, 180) });
        else if (c.type === 'tool_use') passos.push({ hora, tipo: 'ferramenta', texto: resumoFerramenta(c) });
      }
    } else if (o.type === 'user') {
      const fala = falaHumana(o.message.content);
      if (fala) passos.push({ hora, tipo: fala.tipo, texto: curto(fala.texto, 180) });
      else if (Array.isArray(o.message.content) && o.message.content.some((c) => c && c.type === 'tool_result' && c.is_error)) {
        passos.push({ hora, tipo: 'erro', texto: 'a ferramenta devolveu erro' });
      }
    }
  }
  return passos.slice(-16);
}

// ── a última edição de uma sessão, como diff (o painel de código do chat da ilha) ──
// Vem do input da ferramenta no transcript: Edit/MultiEdit trazem old_string e new_string, Write traz o
// arquivo inteiro. Não é um diff contra o disco, é o pedaço que a sessão trocou. Arquivo com cara de
// segredo (.env, chave, credencial) aparece só pelo nome.
const EDICAO = new Set(['Edit', 'MultiEdit', 'Write']);
const SENSIVEL = /(^|[\\/])\.env|secret|credenc|credential|senha|password|token|\.pem$|\.key$|id_rsa|pgpass/i;
const MAX_LINHAS = 14;

const linhasDe = (s) => String(s ?? '').replace(/\r/g, '').split('\n');

// tira a indentação comum: o trecho editado costuma vir lá do fundo de uma função
function desindentar(linhas) {
  const sem = linhas.map((l) => ({ ...l, s: l.s.replace(/\t/g, '  ') }));
  let menor = Infinity;
  for (const l of sem) if (l.s.trim()) menor = Math.min(menor, l.s.match(/^ */)[0].length);
  if (!Number.isFinite(menor) || menor === 0) return sem;
  return sem.map((l) => ({ ...l, s: l.s.slice(menor) }));
}

function montarDiff(uso, hora) {
  const i = uso.input || {};
  const caminho = String(i.file_path || '');
  const arquivo = path.basename(caminho);
  if (!arquivo) return null;
  const base = { arquivo, ferramenta: uso.name, hora, mais: 0, menos: 0, linhas: [], cortadas: 0 };
  if (SENSIVEL.test(caminho)) return { ...base, oculto: true };
  let antes = [];
  let depois = [];
  if (uso.name === 'Write') depois = linhasDe(i.content);
  else {
    const e = uso.name === 'MultiEdit' ? (Array.isArray(i.edits) && i.edits[0]) || {} : i;
    antes = linhasDe(e.old_string);
    depois = linhasDe(e.new_string);
  }
  // o que é igual no começo e no fim vira contexto: uma linha de cada lado, no máximo
  let p = 0;
  while (p < antes.length && p < depois.length && antes[p] === depois[p]) p++;
  let f = 0;
  while (f < antes.length - p && f < depois.length - p && antes[antes.length - 1 - f] === depois[depois.length - 1 - f]) f++;
  const saida = [];
  if (p > 0) saida.push({ t: ' ', s: antes[p - 1] });
  for (const l of antes.slice(p, antes.length - f)) saida.push({ t: '-', s: l });
  for (const l of depois.slice(p, depois.length - f)) saida.push({ t: '+', s: l });
  if (f > 0) saida.push({ t: ' ', s: antes[antes.length - f] });
  const vistas = desindentar(saida.slice(0, MAX_LINHAS)).map((l) => ({ t: l.t, s: l.s.length > 140 ? l.s.slice(0, 139) + '…' : l.s }));
  return { ...base, mais: depois.length - p - f, menos: antes.length - p - f, linhas: vistas, cortadas: Math.max(0, saida.length - MAX_LINHAS) };
}

function lerDiff(arquivo) {
  const alvo = transcript(arquivo);
  if (!alvo) return null;
  const linhas = cauda(alvo, 512 * 1024);
  for (let k = linhas.length - 1; k >= 0; k--) {
    const o = json(linhas[k]);
    if (!o || o.isSidechain || o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    const uso = [...o.message.content].reverse().find((c) => c && c.type === 'tool_use' && EDICAO.has(c.name));
    if (!uso) continue;
    const hora = o.timestamp ? new Date(o.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    return montarDiff(uso, hora);
  }
  return null;
}

module.exports = { lerSessoes, lerPassos, lerDiff, sessoesVivas };
