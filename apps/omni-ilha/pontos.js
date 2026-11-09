'use strict';

// Leitura do depósito Actions (Documents\Actions): um assunto, um ponto, em pontos/<slug>.md. O formato é o
// do CLAUDE.md de lá: "# Título", as linhas de cabeçalho **Campo:** valor e um histórico só de acréscimo com
// linhas "- dd/mm/aaaa — ...". Desde 21/10 o cabeçalho tem o ciclo (Estágio, Prazo do veredito, Próximo
// passo, Potencial, Projeto ligado, Proposta de veredito, Pra você, Veredito). A escrita mora em escrita.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = process.env.OMNI_ACTIONS || path.join(os.homedir(), 'Documents', 'Actions');
const PASTA = path.join(RAIZ, 'pontos');
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const LIMITE = 512 * 1024; // um ponto passa de 30 KB; isto só barra arquivo estranho
const DIA = 86400e3;

function campo(texto, nome) {
  const m = texto.match(new RegExp(`^\\*\\*${nome}:\\*\\*\\s*(.+)$`, 'mi'));
  return m ? m[1].trim() : '';
}

// "dd/mm/aaaa" → número ordenável (aaaammdd); 0 quando não há data
function dataOrdem(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(d || '');
  return m ? Number(m[3] + m[2] + m[1]) : 0;
}
// "dd/mm/aaaa" → meia-noite local em ms; null quando não é data
function dataMs(d) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d || '');
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : null;
}
const hojeMs = (agora = Date.now()) => { const d = new Date(agora); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const formatarData = (ms) => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

const ESTAGIOS = ['semente', 'em teste', 'veredito'];
// "▲▲ — motivo": o nível é a contagem de ▲ (1 a 3); ▲▲▲ sem teste nenhum é proibido e cai para ▲▲
function lerPotencial(valor, estagio) {
  const nivel = Math.min(3, (String(valor).match(/▲/g) || []).length);
  const motivo = String(valor).replace(/^[\s▲]*[—-]?\s*/, '').trim();
  if (nivel === 3 && estagio === 'semente') return { nivel: 2, motivo, rebaixado: true };
  return { nivel, motivo, rebaixado: false };
}
// "arquivado — motivo", "dormente até dd/mm/aaaa — motivo", "vira projeto — …", "entra em <projeto> — …"
function lerVeredito(valor) {
  const v = String(valor || '').trim();
  if (!v) return null;
  const [cabeca, ...resto] = v.split(/\s+—\s+/);
  const motivo = resto.join(' — ').trim();
  const c = cabeca.toLowerCase();
  if (c.startsWith('arquivado')) return { tipo: 'arquivado', motivo };
  if (c.startsWith('dormente')) return { tipo: 'dormente', ate: (cabeca.match(/\d{2}\/\d{2}\/\d{4}/) || [''])[0], motivo };
  if (c.startsWith('vira projeto')) return { tipo: 'projeto', motivo };
  if (c.startsWith('entra em')) return { tipo: 'entra', projeto: cabeca.replace(/^entra em\s*/i, '').trim(), motivo };
  return { tipo: 'outro', motivo: v };
}

function resumir(slug, texto, mtimeMs, agora = Date.now()) {
  const tituloMatch = texto.match(/^#\s+(.+)$/m);
  const titulo = (tituloMatch?.[1] || slug).trim();
  // último toque: a linha datada de histórico com a maior data (o histórico nem sempre é a última seção)
  let ultimo = { data: '', texto: '' };
  for (const m of texto.matchAll(/^- (\d{2}\/\d{2}\/\d{4})[^—\n]*—\s*(.*)$/gm)) {
    if (dataOrdem(m[1]) >= dataOrdem(ultimo.data)) ultimo = { data: m[1], texto: m[2].trim() };
  }
  const veredito = lerVeredito(campo(texto, 'Veredito'));
  const estagioBruto = campo(texto, 'Estágio').toLowerCase();
  const estagio = veredito ? 'veredito' : ESTAGIOS.includes(estagioBruto) ? estagioBruto : 'semente';
  const prazo = campo(texto, 'Prazo do veredito');
  const prazoMs = dataMs(prazo);
  const abertoMs = dataMs(campo(texto, 'Aberto em'));
  // dormente com a data de volta já passada volta a pedir veredito
  const dormenteVencido = veredito?.tipo === 'dormente' && dataMs(veredito.ate) !== null && dataMs(veredito.ate) <= hojeMs(agora);
  return {
    slug,
    titulo,
    status: campo(texto, 'Status'),
    abertoEm: campo(texto, 'Aberto em'),
    origem: campo(texto, 'Origem'),
    estagio,
    prazo,
    proximoPasso: campo(texto, 'Próximo passo'),
    potencial: lerPotencial(campo(texto, 'Potencial'), estagio),
    projetoLigado: campo(texto, 'Projeto ligado'),
    proposta: campo(texto, 'Proposta de veredito'),
    praVoce: campo(texto, 'Pra você'),
    veredito,
    vencido: (!veredito && prazoMs !== null && prazoMs < hojeMs(agora)) || dormenteVencido,
    diasParaPrazo: prazoMs === null ? null : Math.round((prazoMs - hojeMs(agora)) / DIA),
    idadeDias: abertoMs === null ? null : Math.max(0, Math.round((hojeMs(agora) - abertoMs) / DIA)),
    // cabeçalho que a visita não deve reescrever: sem título ou sem a data de abertura
    ilegivel: !tituloMatch || abertoMs === null,
    ultimo,
    alteradoEm: mtimeMs,
  };
}

function arquivoDoPonto(slug) { return path.join(PASTA, `${slug}.md`); }

function lerArquivo(slug) {
  const arquivo = arquivoDoPonto(slug);
  const st = fs.statSync(arquivo);
  if (!st.isFile() || st.size > LIMITE) throw new Error('ponto inválido');
  return { texto: fs.readFileSync(arquivo, 'utf8'), mtimeMs: st.mtimeMs };
}

function listarPontos(agora = Date.now()) {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA); } catch { return { raiz: RAIZ, pontos: [] }; }
  const pontos = [];
  for (const nome of nomes) {
    if (!nome.endsWith('.md')) continue;
    const slug = nome.slice(0, -3);
    if (!SLUG.test(slug)) continue;
    try {
      const { texto, mtimeMs } = lerArquivo(slug);
      pontos.push(resumir(slug, texto, mtimeMs, agora));
    } catch { /* ponto ilegível fica de fora; os outros continuam */ }
  }
  // o mais mexido primeiro: é onde a cabeça está agora
  pontos.sort((a, b) => b.alteradoEm - a.alteradoEm);
  return { raiz: RAIZ, pontos };
}

function lerPonto(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
  try {
    const { texto, mtimeMs } = lerArquivo(slug);
    return { ...resumir(slug, texto, mtimeMs), texto };
  } catch { return null; }
}

module.exports = { listarPontos, lerPonto, lerArquivo, arquivoDoPonto, resumir, campo, dataMs, hojeMs, formatarData, lerVeredito, RAIZ, PASTA, SLUG };
