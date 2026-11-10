'use strict';

// Execuções do Actions (22/10): o Weriton manda executar um trabalho pela tela (de um ponto ou de um
// projeto). Enquanto o Overcore não está pronto, o trabalho vai para uma sessão do Claude Code aberta no
// VS Code — de preferência a da pasta do projeto. Cada execução é um JSON em Actions\execucoes\<id>.json,
// com o histórico de eventos.
//
// Desde o plano 4b da F2 (09/11) a tela, o despacho e a devolução moram no Oráculo, pela casa. Este
// módulo fica só porque o mesa.js ainda lê as execuções para o scripts/omni-actions.mjs da visita; sai
// no plano 5 junto com pontos/projetos/mesa/escrita.
//
// Estados: na fila → enviada → andando → concluida | bloqueada (pergunta para ele) | falhou
//          sem sessão (nenhuma sessão aberta para receber; ele abre uma e reenvia)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RAIZ, lerPonto, formatarData, hojeMs } = require('./pontos');
const { lerProjetos } = require('./projetos');
const { comTrava, gravarAtomico, mexerNoPonto } = require('./escrita');

const PASTA = path.join(RAIZ, 'execucoes');
const ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const ESTADOS = ['na fila', 'enviada', 'andando', 'concluida', 'bloqueada', 'falhou', 'sem sessão'];
const LIMITE_TEXTO = 4000;

const limpo = (s, max = LIMITE_TEXTO) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);
function novoId(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}
const arquivo = (id) => {
  if (!ID.test(String(id))) throw new Error('execução inválida');
  return path.join(PASTA, `${id}.json`);
};

function ler(id) {
  try { return JSON.parse(fs.readFileSync(arquivo(id), 'utf8')); } catch { return null; }
}

function listar() {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA).filter((n) => n.endsWith('.json')); } catch { return []; }
  return nomes.map((n) => ler(n.slice(0, -5))).filter(Boolean).sort((a, b) => b.criadoEm - a.criadoEm);
}

function salvar(ex) {
  fs.mkdirSync(PASTA, { recursive: true });
  gravarAtomico(arquivo(ex.id), JSON.stringify(ex, null, 1));
  return ex;
}

// rastro no ponto de origem: a execução aparece no histórico dele
function rastro(ex, texto) {
  if (!ex.slug) return;
  try { mexerNoPonto(ex.slug, { historico: `Execução ${ex.id}: ${texto}` }); } catch { /* ponto quebrado não derruba a execução */ }
}

// nova execução a partir da tela. slug (ponto) e/ou projeto; pelo menos um dos dois.
function criar({ slug = '', projeto = '', instrucao = '' } = {}) {
  const texto = limpo(instrucao);
  if (!texto) throw new Error('diga o que é para fazer');
  slug = limpo(slug, 120); projeto = limpo(projeto, 120);
  let titulo = '';
  if (slug) {
    const p = lerPonto(slug);
    if (!p) throw new Error('ponto não encontrado');
    titulo = p.titulo;
    if (!projeto && p.projetoLigado && !/^(novo|—|-)$/i.test(p.projetoLigado)) projeto = p.projetoLigado;
  }
  if (projeto && !lerProjetos().projetos.some((pr) => pr.nome.toLowerCase() === projeto.toLowerCase())) projeto = '';
  if (!slug && !projeto) throw new Error('a execução precisa de um ponto ou de um projeto');
  const agora = Date.now();
  const ex = {
    id: novoId(new Date(agora)), slug, projeto, titulo: titulo || projeto, instrucao: texto,
    estado: 'na fila', destino: null, criadoEm: agora, atualizadoEm: agora, vistoEm: null,
    eventos: [{ em: agora, estado: 'na fila', nota: 'mandada pela tela do Actions' }],
  };
  comTrava(() => salvar(ex));
  rastro(ex, `mandada executar — "${texto.slice(0, 200)}"`);
  return ex;
}

// muda o estado e acrescenta o evento. Concluída, bloqueada e falhou deixam rastro no ponto.
function atualizar(id, { estado, nota = '', destino } = {}) {
  arquivo(id); // id fora do formato: recusa antes de tudo
  if (!ESTADOS.includes(estado)) throw new Error(`estado: ${ESTADOS.join(', ')}`);
  const ex = comTrava(() => {
    const atual = ler(id);
    if (!atual) throw new Error('execução não encontrada');
    const agora = Date.now();
    atual.estado = estado;
    atual.atualizadoEm = agora;
    if (destino !== undefined) atual.destino = destino;
    if (['concluida', 'bloqueada', 'falhou', 'sem sessão'].includes(estado)) atual.vistoEm = null;
    atual.eventos.push({ em: agora, estado, nota: limpo(nota, 2000) });
    return salvar(atual);
  });
  if (['concluida', 'bloqueada', 'falhou'].includes(estado)) rastro(ex, `${estado}${nota ? ` — ${limpo(nota, 300)}` : ''}`);
  return ex;
}

// a resposta dele a uma execução bloqueada (ou um ajuste no meio): vira evento e volta para a fila,
// para o despacho entregar na MESMA sessão
function responder(id, texto) {
  arquivo(id);
  const t = limpo(texto);
  if (!t) throw new Error('resposta vazia');
  return comTrava(() => {
    const ex = ler(id);
    if (!ex) throw new Error('execução não encontrada');
    const agora = Date.now();
    ex.estado = 'na fila';
    ex.atualizadoEm = agora;
    ex.eventos.push({ em: agora, estado: 'na fila', nota: `resposta do Weriton: ${t}`, resposta: t });
    return salvar(ex);
  });
}

function visto(id) {
  arquivo(id);
  return comTrava(() => {
    const ex = ler(id);
    if (!ex) throw new Error('execução não encontrada');
    ex.vistoEm = Date.now();
    return salvar(ex);
  });
}

// ── onde o trabalho mora ──────────────────────────────────────────────────────────────────────────────
// sessoes: [{ nome, cwd, status, startedAt }] (vivas, interativas). Ordem:
//   1) sessão aberta na pasta do projeto (ociosa primeiro, depois a mais nova);
//   2) sessão aberta na pasta do Actions;
//   3) a sessão ociosa mais nova na pasta do Omni (a que ele deixa aberta para isso), nunca a própria
//      sessão que está despachando.
// Sem nenhuma: null (a execução fica "sem sessão" e a tela diz qual pasta abrir).
const dentroDe = (cwd, pasta) => {
  if (!cwd || !pasta) return false;
  const a = path.resolve(cwd).toLowerCase(); const b = path.resolve(pasta).toLowerCase();
  return a === b || a.startsWith(b + path.sep);
};
function escolherDestino(sessoes, { pastaProjeto = '', pastaActions = RAIZ, pastaOmni = '', excluir = [] } = {}) {
  const vivas = (sessoes || []).filter((s) => s && s.nome && !excluir.includes(s.nome));
  const melhor = (lista) => lista.sort((a, b) => (a.status === 'idle' ? 0 : 1) - (b.status === 'idle' ? 0 : 1) || (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
  if (pastaProjeto) {
    const s = melhor(vivas.filter((x) => dentroDe(x.cwd, pastaProjeto)));
    if (s) return { ...s, motivo: 'sessão aberta na pasta do projeto' };
  }
  const a = melhor(vivas.filter((x) => dentroDe(x.cwd, pastaActions)));
  if (a) return { ...a, motivo: 'sessão aberta no Actions' };
  if (pastaOmni) {
    const o = vivas.filter((x) => dentroDe(x.cwd, pastaOmni) && x.status === 'idle').sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0))[0];
    if (o) return { ...o, motivo: 'sessão ociosa mais nova no Omni' };
  }
  return null;
}

// ── o pedido que sai do Actions: quem monta é o Omni, com o contexto do ponto e do projeto ────────────
function montarPedido(ex, { projeto, ponto, scriptActions, resposta } = {}) {
  const linhas = [];
  if (resposta) {
    linhas.push(`Resposta do Weriton à execução ${ex.id} (pela tela do Actions):`, '', resposta, '',
      'Siga a partir daqui com o mesmo trabalho. Ao andar, terminar ou travar, registre como antes:');
  } else {
    linhas.push(
      `Trabalho mandado pelo Weriton pela tela do Actions — execução ${ex.id}.`,
      'É pedido dele (montado pelo Omni a partir do Actions), não de outra sessão: execute.',
      '',
      '## O que ele pediu',
      ex.instrucao,
      '',
    );
    if (projeto) {
      linhas.push(`## Projeto: ${projeto.nome}`);
      if (projeto.pasta) linhas.push(`Pasta: ${projeto.pasta}`);
      if (projeto.fase) linhas.push(`Fase: ${projeto.fase}`);
      if (projeto.dor) linhas.push(`Dor do momento: ${projeto.dor}`);
      const abertos = (projeto.itens || []).filter((i) => !i.feito && !i.proposto).map((i) => `- ${i.titulo}${i.data ? ` — ${i.data}` : ''}`);
      if (abertos.length) linhas.push('Entregas abertas:', ...abertos);
      linhas.push('');
    }
    if (ponto) {
      linhas.push(`## Ponto do Actions: ${ponto.titulo} (${ponto.slug})`,
        `Arquivo: ${path.join(RAIZ, 'pontos', `${ponto.slug}.md`)} — leia inteiro antes de começar; o histórico tem as decisões.`);
      if (ponto.proximoPasso) linhas.push(`Próximo passo registrado: ${ponto.proximoPasso}`);
      if (ponto.potencial?.motivo) linhas.push(`Potencial: ${'▲'.repeat(ponto.potencial.nivel)} — ${ponto.potencial.motivo}`);
      linhas.push('');
    }
    linhas.push(
      '## Regras',
      '- As regras globais dele valem (produção HostDime só pelo caminho da casa, conta de push pelo dono do repo, nada de segredo em texto).',
      '- Sem push, PR, deploy ou publicação sem ele pedir. Código de terceiro (install, clonar e rodar) ou algo pago: pergunte antes.',
      '- Commit só depois do verde lido (nome do teste, saída, total).',
      '',
      '## Como devolver (a tela do Actions mostra isto para ele; não precisa mandar WhatsApp)',
    );
  }
  const cmd = `node "${scriptActions}" execucao ${ex.id}`;
  linhas.push(
    `- começou / marco no meio: ${cmd} --estado andando --nota "<uma linha>"`,
    `- terminou: ${cmd} --estado concluida --nota "<o que foi feito e onde ver>"`,
    `- travou em decisão que é dele: ${cmd} --estado bloqueada --nota "<a pergunta, curta>"`,
    `- não deu: ${cmd} --estado falhou --nota "<por quê>"`,
  );
  return linhas.join('\n');
}

// o que a tela mostra e o que pede ele
function paraMesa() {
  const todas = listar();
  const pede = todas.filter((e) => ['bloqueada', 'sem sessão', 'falhou', 'concluida'].includes(e.estado) && !e.vistoEm);
  return { execucoes: todas.slice(0, 50), pede };
}

module.exports = { criar, atualizar, responder, visto, ler, listar, escolherDestino, montarPedido, paraMesa, ESTADOS, PASTA, ID, formatarData, hojeMs };
