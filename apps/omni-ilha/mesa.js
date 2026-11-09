'use strict';

// A mesa de decisão do Actions: junta pontos e projetos no que a tela mostra, na ordem de importância.
//   praVoce       — o que precisa dele: veredito vencido, teste pronto, entrega vencida, item proposto,
//                   ponto com cabeçalho quebrado
//   potencial     — pontos ainda sem veredito final, do ▲▲▲ para baixo, com o motivo
//   andamento     — semente / em teste / dormente
//   naoDeramCerto — arquivados, com motivo
//   ultimaVisita  — o registro mais novo em visitas/
// Só lê. Quem escreve é escrita.js (tela) ou a visita (scripts/omni-actions.mjs).

const fs = require('fs');
const path = require('path');
const { listarPontos, RAIZ } = require('./pontos');
const { lerProjetos } = require('./projetos');
const { paraMesa } = require('./execucoes');

const VISITAS = path.join(RAIZ, 'visitas');

function ultimaVisita() {
  let nomes = [];
  try { nomes = fs.readdirSync(VISITAS).filter((n) => /^\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(n)).sort(); } catch { return null; }
  const nome = nomes.pop();
  if (!nome) return null;
  try {
    const texto = fs.readFileSync(path.join(VISITAS, nome), 'utf8').slice(0, 64 * 1024);
    const resumo = (texto.match(/^\*\*Resumo:\*\*\s*(.+)$/m) || [])[1] || '';
    const interrompida = /^\*\*Situação:\*\*\s*interrompida/im.test(texto);
    const [a, m, d, hm] = nome.slice(0, -3).split('-');
    return { arquivo: nome, quando: `${d}/${m}/${a} ${hm.slice(0, 2)}h${hm.slice(2)}`, resumo: resumo.trim(), interrompida, texto };
  } catch { return null; }
}

function montarMesa(agora = Date.now()) {
  const { pontos } = listarPontos(agora);
  const { projetos } = lerProjetos(agora);
  const praVoce = [];
  for (const p of pontos) {
    if (p.ilegivel) praVoce.push({ tipo: 'conserto', slug: p.slug, titulo: p.titulo, texto: 'o cabeçalho deste ponto precisa de conserto (título ou "Aberto em")' });
    if (p.vencido) praVoce.push({ tipo: 'veredito', slug: p.slug, titulo: p.titulo, texto: p.proposta || 'prazo vencido; a visita ainda não trouxe proposta', proposta: p.proposta, dias: p.diasParaPrazo });
    if (p.praVoce) praVoce.push({ tipo: 'teste', slug: p.slug, titulo: p.titulo, texto: p.praVoce });
  }
  for (const pr of projetos) {
    for (const it of pr.itens) {
      if (it.feito) continue;
      if (it.proposto) praVoce.push({ tipo: 'item-proposto', projeto: pr.nome, item: refItem(it), titulo: pr.nome, texto: `${it.titulo}${it.data ? ` — ${it.data}` : ''}` });
      else if (it.dias !== null && it.dias < 0) praVoce.push({ tipo: 'entrega', projeto: pr.nome, item: refItem(it), titulo: pr.nome, texto: `${it.titulo} venceu em ${it.data}`, dias: it.dias });
    }
  }
  // execuções: bloqueada (pergunta dele), sem sessão, falhou e concluída ainda não vista
  const { execucoes, pede } = paraMesa();
  const ROT_EX = { bloqueada: 'execução bloqueada', 'sem sessão': 'execução sem sessão', falhou: 'execução falhou', concluida: 'execução concluída' };
  for (const e of pede) {
    const ultima = e.eventos[e.eventos.length - 1]?.nota || '';
    praVoce.push({ tipo: e.estado === 'concluida' ? 'execucao-ok' : 'execucao', execucao: e.id, slug: e.slug || undefined, titulo: e.titulo, texto: `${ROT_EX[e.estado]}: ${ultima}`, estadoExecucao: e.estado });
  }
  // quando cada pedido "aconteceu", para o filtro por período da tela
  const porSlug = new Map(pontos.map((p) => [p.slug, p]));
  const exPorId = new Map(execucoes.map((e) => [e.id, e]));
  // item de projeto não tem data própria: fica sem "quando" e só aparece na visão "tudo"
  for (const p of praVoce) p.quando = p.execucao ? exPorId.get(p.execucao)?.atualizadoEm : p.slug ? porSlug.get(p.slug)?.alteradoEm : null;
  const ordemTipo = { conserto: 0, execucao: 1, entrega: 2, veredito: 3, 'execucao-ok': 4, teste: 5, 'item-proposto': 6 };
  praVoce.sort((a, b) => ordemTipo[a.tipo] - ordemTipo[b.tipo] || (a.dias ?? 0) - (b.dias ?? 0));

  const vivos = pontos.filter((p) => !p.veredito || p.veredito.tipo === 'dormente');
  const potencial = vivos.filter((p) => p.potencial.nivel > 0)
    .sort((a, b) => b.potencial.nivel - a.potencial.nivel || b.alteradoEm - a.alteradoEm);
  const enxuto = (p) => ({
    abertoEm: p.abertoEm, alteradoEm: p.alteradoEm, origem: p.origem.slice(0, 160),
    slug: p.slug, titulo: p.titulo, estagio: p.estagio, idadeDias: p.idadeDias, diasParaPrazo: p.diasParaPrazo,
    proximoPasso: p.proximoPasso, projetoLigado: p.projetoLigado, potencial: p.potencial, veredito: p.veredito, vencido: p.vencido,
  });
  return {
    raiz: RAIZ,
    total: pontos.length,
    praVoce,
    potencial: potencial.map(enxuto),
    andamento: {
      semente: vivos.filter((p) => !p.veredito && p.estagio === 'semente').map(enxuto),
      emTeste: vivos.filter((p) => !p.veredito && p.estagio === 'em teste').map(enxuto),
      dormente: vivos.filter((p) => p.veredito?.tipo === 'dormente').map(enxuto),
    },
    decididos: pontos.filter((p) => p.veredito && ['projeto', 'entra'].includes(p.veredito.tipo)).map(enxuto),
    // todos os pontos, para o filtro por período e a ordem escolhida na tela (nada fica escondido)
    todos: pontos.map(enxuto),
    naoDeramCerto: pontos.filter((p) => p.veredito?.tipo === 'arquivado').map((p) => ({ ...enxuto(p), quando: p.ultimo.data })),
    projetos,
    execucoes,
    ultimaVisita: ultimaVisita(),
  };
}

// o que a tela devolve para marcar um item: onde ele está e como era a linha (se mudou, a escrita recusa)
function refItem(it) { return { arquivo: it.arquivo, linha: it.linha, bruto: it.bruto }; }

module.exports = { montarMesa, ultimaVisita, VISITAS };
