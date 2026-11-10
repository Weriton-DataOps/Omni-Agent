'use strict';

// Os painéis da ilha (F2, plano 4b). A lista vem do GET /v1/agentes da casa: cada agente instalado que
// declara `interface` no agente.json. O `modulo` e o `preload` são relativos à raiz do agente; o que sai
// dela, não existe ou tem manifesto divergente do catálogo não monta. Agente conhecido que não está
// instalado vira card apagado com "instalar" (§2), nunca erro.

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const { NOME } = require('./agente-api.js');

const CONHECIDOS = [{ agente: 'oraculo', nome: 'Oráculo' }];

// `alvo` fica dentro de `base` (e não é a própria base).
function dentro(base, alvo) {
  const rel = path.relative(base, alvo);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function caminhoNaRaiz(raiz, relativo, existe) {
  if (typeof relativo !== 'string' || relativo === '') return null;
  const absoluto = path.resolve(raiz, relativo);
  return dentro(raiz, absoluto) && existe(absoluto) ? absoluto : null;
}

function montarUm(i, existe) {
  if (!i || typeof i !== 'object' || i.divergente !== false) return null;
  if (typeof i.agente !== 'string' || !NOME.test(i.agente)) return null;
  if (typeof i.raiz !== 'string' || !path.isAbsolute(i.raiz)) return null;
  const modulo = caminhoNaRaiz(i.raiz, i.modulo, existe);
  if (!modulo) return null;
  let preload = null;
  if (i.preload !== null && i.preload !== undefined) {
    preload = caminhoNaRaiz(i.raiz, i.preload, existe);
    if (!preload) return null;
  }
  return {
    agente: i.agente,
    nome: typeof i.painel === 'string' && i.painel ? i.painel : i.agente,
    versao: i.versao ?? null,
    estado: i.estado ?? null,
    instalado: true,
    modulo,
    preload,
    pasta: path.dirname(modulo),
  };
}

function montarAgentes(lista, { existe = fs.existsSync } = {}) {
  const montados = [];
  for (const i of Array.isArray(lista) ? lista : []) {
    const m = montarUm(i, existe);
    if (m && !montados.some((x) => x.agente === m.agente)) montados.push(m);
  }
  for (const c of CONHECIDOS) {
    if (!montados.some((x) => x.agente === c.agente)) montados.push({ agente: c.agente, nome: c.nome, instalado: false });
  }
  return montados;
}

// A janela de um agente navega só por arquivos dentro da pasta da interface dele.
function podeNavegar(url, pasta) {
  if (typeof pasta !== 'string' || !pasta) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:' || u.host !== '') return false;
    return dentro(pasta, fileURLToPath(u));
  } catch {
    return false;
  }
}

module.exports = { CONHECIDOS, montarAgentes, podeNavegar };
