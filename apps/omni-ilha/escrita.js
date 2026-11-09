'use strict';

// Escrita no depósito Actions. Quem chama: o main da ilha (botões da tela) e scripts/omni-actions.mjs (a
// visita). O renderer nunca chega aqui direto. Regras:
//   - só grava em pontos/<slug>.md, projetos.md ou num plano de origem listado no projetos.md;
//   - grava atômico (temporário + rename) e debaixo de uma trava de arquivo (.trava) — visita e clique ao
//     mesmo tempo: quem perde tenta de novo uma vez e, se falhar, recusa com erro;
//   - histórico é só de acréscimo; ponto com cabeçalho ilegível não é reescrito.

const fs = require('fs');
const path = require('path');
const { RAIZ, SLUG, arquivoDoPonto, resumir, formatarData, hojeMs } = require('./pontos');
const { lerProjetos, ARQUIVO: PROJETOS, CHECK, PROPOSTO } = require('./projetos');

const TRAVA = path.join(RAIZ, '.trava');
const TRAVA_VELHA_MS = 30e3;
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function comTrava(fn) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let fd = null;
    try {
      fd = fs.openSync(TRAVA, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // trava esquecida por um processo que morreu: passa dos 30 s, é lixo
      try { if (Date.now() - fs.statSync(TRAVA).mtimeMs > TRAVA_VELHA_MS) { fs.unlinkSync(TRAVA); continue; } } catch { continue; }
      if (tentativa === 0) { dormir(400); continue; }
      throw new Error('o Actions está sendo escrito por outra parte agora; tente de novo');
    }
    try {
      fs.writeSync(fd, String(process.pid));
      return fn();
    } finally {
      fs.closeSync(fd);
      try { fs.unlinkSync(TRAVA); } catch { /* já saiu */ }
    }
  }
  throw new Error('não consegui a trava do Actions');
}

function gravarAtomico(arquivo, texto) {
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, texto, 'utf8');
  fs.renameSync(tmp, arquivo);
}

// caminhos que a escrita aceita: pontos, projetos.md e os planos de origem que o projetos.md lista
function permitido(arquivo) {
  const alvo = path.resolve(arquivo).toLowerCase();
  if (alvo === path.resolve(PROJETOS).toLowerCase()) return true;
  const pasta = path.resolve(RAIZ, 'pontos').toLowerCase() + path.sep;
  if (alvo.startsWith(pasta) && alvo.endsWith('.md') && !alvo.slice(pasta.length).includes(path.sep)) return true;
  return lerProjetos().projetos.some((p) => p.origem && path.resolve(p.origem).toLowerCase() === alvo);
}

const EOL = (texto) => (texto.includes('\r\n') ? '\r\n' : '\n');
const hoje = () => formatarData(hojeMs());

// ── campos do cabeçalho e histórico de um ponto ───────────────────────────────────────────────────────
// define (ou remove, com valor null) a linha **Nome:** do cabeçalho; nova entra depois do último campo
function definirCampo(texto, nome, valor) {
  const nl = EOL(texto);
  const linhas = texto.split(/\r?\n/);
  const re = new RegExp(`^\\*\\*${nome}:\\*\\*`, 'i');
  const limiteCab = (() => { const i = linhas.findIndex((l) => /^##\s/.test(l)); return i < 0 ? linhas.length : i; })();
  const i = linhas.findIndex((l, k) => k < limiteCab && re.test(l));
  const nova = valor == null ? null : `**${nome}:** ${String(valor).replace(/[\r\n]+/g, ' ').trim()}`;
  if (i >= 0) { if (nova === null) linhas.splice(i, 1); else linhas[i] = nova; return linhas.join(nl); }
  if (nova === null) return texto;
  let ultimo = -1;
  for (let k = 0; k < limiteCab; k++) if (/^\*\*[^*]+:\*\*/.test(linhas[k])) ultimo = k;
  if (ultimo < 0) ultimo = Math.max(0, linhas.findIndex((l) => /^#\s/.test(l)));
  linhas.splice(ultimo + 1, 0, nova);
  return linhas.join(nl);
}

// acrescenta "- dd/mm/aaaa — texto" no fim da seção ## Histórico (que nem sempre é a última)
function acrescentarHistorico(texto, linha) {
  const nl = EOL(texto);
  const linhas = texto.split(/\r?\n/);
  const entrada = `- ${hoje()} — ${String(linha).replace(/[\r\n]+/g, ' ').trim()}`;
  const h = linhas.findIndex((l) => /^##\s+Histórico/i.test(l));
  if (h < 0) {
    while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
    linhas.push('', '## Histórico', entrada, '');
    return linhas.join(nl);
  }
  let fim = linhas.findIndex((l, k) => k > h && /^##\s/.test(l));
  if (fim < 0) fim = linhas.length;
  let ins = fim;
  while (ins > h + 1 && !linhas[ins - 1].trim()) ins--;
  linhas.splice(ins, 0, entrada);
  return linhas.join(nl);
}

function lerPontoBruto(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('ponto inválido');
  const arquivo = arquivoDoPonto(slug);
  if (!permitido(arquivo)) throw new Error('caminho fora do Actions');
  const texto = fs.readFileSync(arquivo, 'utf8');
  if (resumir(slug, texto, 0).ilegivel) throw new Error('cabeçalho ilegível: o ponto precisa de conserto à mão');
  return { arquivo, texto };
}

// muda campos e acrescenta histórico num ponto, numa escrita só
function mexerNoPonto(slug, { campos = {}, historico } = {}) {
  return comTrava(() => {
    const { arquivo, texto } = lerPontoBruto(slug);
    let novo = texto;
    for (const [nome, valor] of Object.entries(campos)) novo = definirCampo(novo, nome, valor);
    if (historico) novo = acrescentarHistorico(novo, historico);
    if (novo !== texto) gravarAtomico(arquivo, novo);
    return resumir(slug, novo, Date.now());
  });
}

// ── projetos.md ───────────────────────────────────────────────────────────────────────────────────────
function blocoDoProjeto(linhas, nome) {
  const ini = linhas.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim().toLowerCase() === String(nome).trim().toLowerCase());
  if (ini < 0) return null;
  let fim = linhas.findIndex((l, k) => k > ini && /^##\s+/.test(l));
  if (fim < 0) fim = linhas.length;
  return { ini, fim };
}

// põe um item no fim da lista **Entregas:** do projeto (cria a lista se não houver)
function inserirItem(linhas, bloco, linhaItem) {
  const e = linhas.findIndex((l, k) => k > bloco.ini && k < bloco.fim && /^\*\*Entregas:\*\*/i.test(l));
  if (e < 0) {
    let ins = bloco.fim;
    while (ins > bloco.ini + 1 && !linhas[ins - 1].trim()) ins--;
    linhas.splice(ins, 0, '**Entregas:**', linhaItem);
    return;
  }
  let k = e + 1;
  while (k < bloco.fim && CHECK.test(linhas[k])) k++;
  linhas.splice(k, 0, linhaItem);
}

function ligarIdeia(linhas, bloco, slug) {
  const i = linhas.findIndex((l, k) => k > bloco.ini && k < bloco.fim && /^\*\*Ideias ligadas:\*\*/i.test(l));
  if (i < 0) { linhas.splice(bloco.ini + 1, 0, `**Ideias ligadas:** ${slug}`); return; }
  const atuais = linhas[i].replace(/^\*\*Ideias ligadas:\*\*\s*/i, '').split(',').map((s) => s.trim()).filter((s) => s && !/^[—-]+$/.test(s));
  if (!atuais.some((s) => s.replace(/\s*\(.*\)$/, '') === slug)) atuais.push(slug);
  linhas[i] = `**Ideias ligadas:** ${atuais.join(', ')}`;
}

function mexerNosProjetos(fn) {
  return comTrava(() => {
    const texto = fs.readFileSync(PROJETOS, 'utf8');
    const nl = EOL(texto);
    const linhas = texto.split(/\r?\n/);
    fn(linhas);
    const novo = linhas.join(nl);
    if (novo !== texto) gravarAtomico(PROJETOS, novo);
  });
}

// marca/desmarca, aceita ou recusa um item. A tela manda {arquivo, linha, bruto}: se a linha não é mais a
// mesma (alguém editou no meio), recusa em vez de mexer na linha errada.
function mexerNoItem(ref, acao) {
  const arquivo = path.resolve(String(ref?.arquivo || ''));
  if (!permitido(arquivo)) throw new Error('arquivo fora do Actions e dos planos de origem');
  return comTrava(() => {
    const texto = fs.readFileSync(arquivo, 'utf8');
    const nl = EOL(texto);
    const linhas = texto.split(/\r?\n/);
    let i = Number(ref.linha);
    if (linhas[i] !== ref.bruto) {
      const achados = linhas.map((l, k) => (l === ref.bruto ? k : -1)).filter((k) => k >= 0);
      if (achados.length !== 1) throw new Error('o item mudou desde que a tela leu; reabra a janela');
      i = achados[0];
    }
    const c = CHECK.exec(linhas[i]);
    if (!c) throw new Error('a linha não é mais um item');
    if (acao === 'marcar') linhas[i] = `${c[1]}- [x] ${c[3]}`;
    else if (acao === 'desmarcar') linhas[i] = `${c[1]}- [ ] ${c[3]}`;
    else if (acao === 'aceitar') linhas[i] = `${c[1]}- [${c[2]}] ${c[3].replace(PROPOSTO, '').trimEnd()}`;
    else if (acao === 'recusar') { if (!PROPOSTO.test(c[3])) throw new Error('só item proposto pode ser recusado'); linhas.splice(i, 1); }
    else throw new Error('ação desconhecida');
    gravarAtomico(arquivo, linhas.join(nl));
    return true;
  });
}

// o Omni propõe um item; ele só vale depois do ✓ dele na tela
function proporItem(projeto, texto, data) {
  const titulo = String(texto || '').replace(/[\r\n]+/g, ' ').trim();
  if (!titulo) throw new Error('item vazio');
  if (data && !/^\d{2}\/\d{2}\/\d{4}$/.test(data)) throw new Error('data no formato dd/mm/aaaa');
  mexerNosProjetos((linhas) => {
    const b = blocoDoProjeto(linhas, projeto);
    if (!b) throw new Error(`projeto "${projeto}" não está no projetos.md`);
    inserirItem(linhas, b, `- [ ] ${titulo}${data ? ` — ${data}` : ''} (proposto pelo Omni)`);
  });
}

// ── veredito pela tela ────────────────────────────────────────────────────────────────────────────────
// tipo: projeto | entra | arquivado | dormente. arquivado exige motivo; dormente exige data; entra exige projeto.
function registrarVeredito(slug, { tipo, motivo = '', projeto = '', ate = '' } = {}) {
  motivo = String(motivo).replace(/[\r\n]+/g, ' ').trim();
  let valor; let status; let hist;
  if (tipo === 'arquivado') {
    if (!motivo) throw new Error('arquivar exige o motivo');
    valor = `arquivado — ${motivo}`; status = `arquivado em ${hoje()}`; hist = `Veredito: arquivado. Motivo: ${motivo}`;
  } else if (tipo === 'dormente') {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ate)) throw new Error('dormente exige a data de volta (dd/mm/aaaa)');
    valor = `dormente até ${ate}${motivo ? ` — ${motivo}` : ''}`; status = `dormente até ${ate}`; hist = `Veredito: dormente até ${ate}${motivo ? `. ${motivo}` : ''}`;
  } else if (tipo === 'projeto') {
    valor = `vira projeto${motivo ? ` — ${motivo}` : ''}`; status = 'virou projeto'; hist = `Veredito: vira projeto${motivo ? `. ${motivo}` : ''}`;
  } else if (tipo === 'entra') {
    if (!String(projeto).trim()) throw new Error('entrar em projeto exige o projeto');
    valor = `entra em ${projeto}${motivo ? ` — ${motivo}` : ''}`; status = `entrou em ${projeto}`; hist = `Veredito: entra em ${projeto}${motivo ? `. ${motivo}` : ''}`;
  } else throw new Error('veredito desconhecido');

  const { texto } = lerPontoBruto(slug);
  const titulo = (texto.match(/^#\s+(.+)$/m)?.[1] || slug).trim();
  // projeto antes do ponto: se o projeto não existir, nada foi escrito ainda
  if (tipo === 'entra') {
    mexerNosProjetos((linhas) => {
      const b = blocoDoProjeto(linhas, projeto);
      if (!b) throw new Error(`projeto "${projeto}" não está no projetos.md`);
      inserirItem(linhas, b, `- [ ] Integrar "${titulo}" (ponto ${slug})`);
      ligarIdeia(linhas, blocoDoProjeto(linhas, projeto), slug);
    });
  } else if (tipo === 'projeto') {
    mexerNosProjetos((linhas) => {
      if (!blocoDoProjeto(linhas, titulo)) {
        while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
        linhas.push('', `## ${titulo}`, `**Fase:** nasceu do ponto ${slug} em ${hoje()}`, '**Dor do momento:** a confirmar', '**Plano de origem:** —', `**Ideias ligadas:** ${slug}`, '**Entregas:**', '- [ ] Definir o primeiro marco (proposto pelo Omni)', '');
      }
    });
  }
  return mexerNoPonto(slug, {
    campos: { 'Veredito': valor, 'Estágio': 'veredito', 'Status': status, 'Proposta de veredito': null, 'Pra você': null, ...(tipo === 'entra' ? { 'Projeto ligado': projeto } : {}) },
    historico: `${hist} (pela tela do Actions)`,
  });
}

// "já olhei" num teste pronto: limpa o Pra você e deixa o rastro
function dispensarPraVoce(slug) {
  const { texto } = lerPontoBruto(slug);
  const antes = (texto.match(/^\*\*Pra você:\*\*\s*(.+)$/mi) || [])[1] || '';
  return mexerNoPonto(slug, { campos: { 'Pra você': null }, historico: `Weriton olhou: ${antes || 'o que estava pra ele'} (pela tela do Actions)` });
}

module.exports = {
  comTrava, gravarAtomico, permitido, definirCampo, acrescentarHistorico, mexerNoPonto,
  mexerNoItem, proporItem, registrarVeredito, dispensarPraVoce, blocoDoProjeto,
};
