'use strict';

// Os agentes vistos da ilha (F2, plano 4b). A lista dos painéis vem do GET /v1/agentes da casa, montada
// pela agentes.js (caminho preso à raiz, conhecido ausente vira card de instalar). O resumo de um card é
// um GET no próprio agente, pelo mesmo porteiro da janela (agente-api.js): a ilha não lê disco de agente.
//
// Três quedas diferentes, três respostas diferentes:
//  - agente não instalado        → { ausente: true } (card apagado com "instalar");
//  - casa fora do ar             → { ok: false, erro } com o motivo da casa (o agente não sumiu);
//  - agente recusou ou não falou → { ok: false, erro } com o motivo dele.

const fs = require('fs');

const { criarAgenteApi } = require('./agente-api.js');
const { montarAgentes } = require('./agentes.js');

function criarPaineis({ chamar, existe = fs.existsSync }) {
  const api = criarAgenteApi({ chamar });

  async function listar() {
    let r;
    try { r = await chamar('GET', '/v1/agentes'); } catch { r = null; }
    if (!r || r.status !== 200) {
      const erro = r && r.corpo && typeof r.corpo.erro === 'string' ? r.corpo.erro : 'a casa não atendeu';
      return { ok: false, erro, agentes: [] };
    }
    const lista = r.corpo && Array.isArray(r.corpo.agentes) ? r.corpo.agentes : [];
    return { ok: true, agentes: montarAgentes(lista, { existe }) };
  }

  // null quando a casa não respondeu (a lista vem vazia): aí não dá para saber se o agente está instalado.
  async function agente(nome) {
    return (await listar()).agentes.find((a) => a.agente === nome) ?? null;
  }

  async function resumo(nome, rota) {
    const l = await listar();
    if (!l.ok) return { ok: false, erro: l.erro };
    const a = l.agentes.find((x) => x.agente === nome);
    if (!a || !a.instalado) return { ausente: true };
    const r = await api.pedir({ agente: nome, metodo: 'GET', rota }, { permitido: nome });
    if (r.status === 200 && r.corpo && typeof r.corpo === 'object' && !Array.isArray(r.corpo)) return r.corpo;
    const erro = r.corpo && typeof r.corpo.erro === 'string' && r.corpo.erro.trim();
    return { ok: false, erro: erro || `${a.nome} fora do ar` };
  }

  // O pedido da janela de um agente: `permitido` é o dono da janela, decidido pelo main.
  const pedir = (entrada, permitido) => api.pedir(entrada, { permitido });

  return { listar, agente, resumo, pedir };
}

module.exports = { criarPaineis };
