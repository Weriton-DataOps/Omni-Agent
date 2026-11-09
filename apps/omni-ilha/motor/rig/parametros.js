// rig/parametros.js — parâmetros do modelo, molas de 2ª ordem e o simulador de passo fixo.
// Camadas, de baixo para cima: trilha da cena (+ idle) + ajuste manual -> limite -> mola -> valor.
// Do valor saem os ângulos da cabeça; pescoço e ombros seguem com fração e atraso; o cabelo
// (rig/fisica.js) atrasa sobre a cabeça. O estado no passo n só depende da cena e de n.
(function () {
  'use strict';
  const OMNI = (window.OMNI = window.OMNI || {});
  const RAD = Math.PI / 180;

  // Mola de 2ª ordem (f Hz, amortecimento zeta, resposta inicial r; r < 0 antecipa).
  // k2 estabilizado para o passo fixo não explodir em f alto.
  function mola(f, zeta, r) {
    const k1 = zeta / (Math.PI * f);
    const k2 = 1 / ((2 * Math.PI * f) ** 2);
    const k3 = (r || 0) * zeta / (2 * Math.PI * f);
    return {
      y: 0, yd: 0, xp: 0,
      reinicia(x) { this.y = x; this.yd = 0; this.xp = x; },
      passo(dt, x) {
        const xd = (x - this.xp) / dt;
        this.xp = x;
        const k2s = Math.max(k2, dt * dt / 2 + dt * k1 / 2, dt * k1);
        this.y += dt * this.yd;
        this.yd += dt * (x + k3 * xd - this.y - k1 * this.yd) / k2s;
        return this.y;
      },
    };
  }

  const limita = (v, a, b) => Math.min(b, Math.max(a, v));

  // Tabela de parâmetros + camada manual (definir).
  function parametros(modelo) {
    const defs = {};
    for (const p of modelo.parametros) defs[p.id] = p;
    const manual = {};
    return {
      defs, ids: Object.keys(defs), manual,
      definir(id, v) { if (!defs[id]) throw new Error('parâmetro inexistente: ' + id); manual[id] = v; },
      limpa() { for (const k of Object.keys(manual)) delete manual[k]; },
      // soma as camadas e limita na faixa do parâmetro
      alvo(camadas) {
        const v = {};
        for (const id of this.ids) {
          let s = 0, tem = false;
          for (const c of camadas) if (c && c[id] != null) { s += c[id]; tem = true; }
          if (manual[id] != null) { s += manual[id]; tem = true; }
          v[id] = limita(tem ? s : defs[id].padrao, defs[id].min, defs[id].max);
        }
        return v;
      },
    };
  }

  // Ângulos (rad) de cabeça, pescoço e ombros a partir dos valores normalizados.
  function angulosCabeca(modelo, v) {
    if (!modelo._defs) { modelo._defs = {}; for (const p of modelo.parametros) modelo._defs[p.id] = p; }
    const g = (id) => v[id] * modelo._defs[id].graus * RAD;
    return [g('AnguloX'), g('AnguloY'), g('AnguloZ')];
  }
  function derivados(modelo, cabeca, cabecaAtrasada) {
    const pe = modelo.rig.pescoco, om = modelo.rig.ombros;
    const a = cabecaAtrasada || cabeca;
    return {
      pescoco: [pe.yaw * a[0], pe.pitch * a[1], pe.roll * a[2]],
      ombros: [(om.yaw || 0) * a[0], (om.pitch || 0) * a[1], (om.roll || 0) * a[2]],
    };
  }

  // Estado estático (sem molas, sem atraso): para provas de pose e folha de poses.
  function estadoPose(modelo, valores) {
    const tab = parametros(modelo);
    const v = tab.alvo([valores]);
    const cabeca = angulosCabeca(modelo, v);
    const d = derivados(modelo, cabeca, null);
    return { n: 0, t: 0, valores: v, cabeca, pescoco: d.pescoco, ombros: d.ombros, cabelo: [0, 0, 0], respira: [v.Respira, v.Respira] };
  }

  // Anel de histórico por passo (para atrasos do pescoço e da respiração da cabeça).
  function anel(tamanho, canais) {
    const dados = new Float64Array(tamanho * canais);
    let topo = -1; // índice absoluto do último passo gravado
    return {
      enche(n, valores) { for (let i = 0; i < tamanho; i++) dados.set(valores, i * canais); topo = n; },
      grava(n, valores) { topo = n; dados.set(valores, (((n % tamanho) + tamanho) % tamanho) * canais); },
      // valor interpolado em (n - atraso) passos; atraso <= tamanho - 2
      le(atraso, canal) {
        const a = topo - atraso, i0 = Math.floor(a), f = a - i0;
        const p = (k) => dados[(((k % tamanho) + tamanho) % tamanho) * canais + canal];
        return p(i0) * (1 - f) + p(i0 + 1) * f;
      },
    };
  }

  // Simulador: fonte(t) devolve o alvo de cada parâmetro no instante t (já com as camadas).
  // n0 é o passo de partida (pré-rolagem nos laços). ate(n) avança passo a passo; se n voltar,
  // re-simula desde n0 — o resultado de ate(n) não depende de quem pediu antes.
  function simulador(modelo, fonte, n0) {
    const R = OMNI.relogio;
    const tab = parametros(modelo);
    const molas = {};
    for (const id of tab.ids) { const m = tab.defs[id].mola; if (m) molas[id] = mola(m.f, m.zeta, m.r); }
    const cabelo = OMNI.fisica.cabelo(modelo);
    const hist = anel(160, 4); // yaw, pitch, roll da cabeça e respiração, por passo
    const atrasoPesc = modelo.rig.pescoco.atraso * R.HZ;
    const atrasoResp = modelo.rig.respira.atrasoCabeca * R.HZ;
    let n = null, valores = null, cab = null, delta = [0, 0, 0];

    function reinicia() {
      n = n0;
      const x = fonte(R.tempo(n));
      valores = {};
      for (const id of tab.ids) { if (molas[id]) molas[id].reinicia(x[id]); valores[id] = x[id]; }
      cab = angulosCabeca(modelo, valores);
      cabelo.reinicia(cab);
      delta = [0, 0, 0];
      hist.enche(n, [cab[0], cab[1], cab[2], valores.Respira]);
    }
    function passo() {
      n += 1;
      const x = fonte(R.tempo(n));
      for (const id of tab.ids) valores[id] = molas[id] ? molas[id].passo(R.DT, x[id]) : x[id];
      cab = angulosCabeca(modelo, valores);
      delta = cabelo.passo(R.DT, cab);
      hist.grava(n, [cab[0], cab[1], cab[2], valores.Respira]);
    }
    function ate(alvo) {
      if (alvo < n0) alvo = n0;
      if (n == null || alvo < n) reinicia();
      while (n < alvo) passo();
      const atrasada = [hist.le(atrasoPesc, 0), hist.le(atrasoPesc, 1), hist.le(atrasoPesc, 2)];
      const d = derivados(modelo, cab, atrasada);
      const k = valores.CabeloAtraso;
      return {
        n, t: R.tempo(n), valores: Object.assign({}, valores),
        cabeca: cab.slice(), pescoco: d.pescoco, ombros: d.ombros,
        cabelo: [delta[0] * k, delta[1] * k, delta[2] * k],
        respira: [valores.Respira, hist.le(atrasoResp, 3)],
      };
    }
    return { ate, em: (t) => ate(R.passo(t)), tab };
  }

  OMNI.rig = OMNI.rig || {};
  Object.assign(OMNI.rig, { mola, parametros, simulador, estadoPose, angulosCabeca, RAD });
})();
